// Audio de un clip con tiempo especial (V8): curva de velocidad, invertido, bucle con fundido cruzado y «conservar el tono».
//
// El mezclador ve un clip normal (inicio, fin, `speed` 1, `inP` 0): le pide muestras en el TIEMPO LOCAL del clip y esta
// fuente las traduce, con el mismo mapa de tiempo que usa el video (`speed/clipTime.ts`), a lecturas de la fuente real:
//  - sin conservar el tono: lectura remuestreada por tramos de 64 muestras (1,3 ms) con la velocidad exacta de cada tramo
//    (el sonido se acelera y se agudiza igual que la imagen);
//  - invertido: `ReverseAudioSource` decodifica bloques de 2 s y los lee hacia atrás (memoria acotada);
//  - bucle: cada pasada usa su propia fuente (la saliente y la entrante a la vez durante el fundido cruzado);
//  - conservar el tono: estiramiento por solapamiento (WSOLA) sobre el audio a ritmo natural.
import type { Clip } from '../model/types';
import { isTimeSpecial, layersAt, loopInfo, passSource, type TimeFields } from '../speed/clipTime';
import type { PcmSource } from './mixer';

const SR = 48000;
const CHUNK = 64;

/** Abre una fuente de audio que empieza a decodificar cerca del instante `startAt` (s del archivo). */
export type OpenAt = (startAt: number) => Promise<PcmSource | null>;

// ---------------- invertir ----------------

const REV_BLOCK = 2; // s

/** Lee el audio hacia atrás: el paso es negativo. Mantiene un solo bloque de 2 s (≈ 770 kB) en memoria. */
export class ReverseAudioSource implements PcmSource {
  private L = new Float32Array(0);
  private R = new Float32Array(0);
  private lo = 0;
  private hi = 0;
  private have = false;
  loads = 0;

  constructor(private openAt: OpenAt) {}

  private async load(hiTarget: number) {
    const hi = Math.max(0.05, hiTarget + 0.05);
    const lo = Math.max(0, hi - REV_BLOCK);
    const n = Math.max(1, Math.round((hi - lo) * SR));
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    const src = await this.openAt(lo);
    if (src) {
      try {
        await src.read(lo, 1 / SR, n, L, R);
      } finally {
        src.close();
      }
    }
    this.L = L;
    this.R = R;
    this.lo = lo;
    this.hi = hi;
    this.have = true;
    this.loads++;
  }

  async read(srcStart: number, step: number, n: number, outL: Float32Array, outR: Float32Array): Promise<void> {
    const last = srcStart + (n - 1) * step;
    const top = Math.max(srcStart, last);
    const bottom = Math.min(srcStart, last);
    if (!this.have || bottom - 0.002 < this.lo && this.lo > 0 || top + 0.002 > this.hi) await this.load(top);
    const { L, R, lo } = this;
    const len = L.length;
    for (let i = 0; i < n; i++) {
      const x = (srcStart + i * step - lo) * SR;
      const j = Math.floor(x);
      if (j < 0 || j >= len) {
        outL[i] = 0;
        outR[i] = 0;
        continue;
      }
      const f = x - j;
      const j1 = j + 1 < len ? j + 1 : j;
      outL[i] = L[j] + (L[j1] - L[j]) * f;
      outR[i] = R[j] + (R[j1] - R[j]) * f;
    }
  }

  close() {
    this.L = new Float32Array(0);
    this.R = new Float32Array(0);
    this.have = false;
  }
}

// ---------------- conservar el tono (WSOLA) ----------------

const G = 1920; // grano: 40 ms
const HS = G / 2; // salto de síntesis
const SEARCH = 360; // ±7,5 ms de búsqueda de la mejor fase
const HANN = (() => {
  const w = new Float32Array(G);
  for (let i = 0; i < G; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / G);
  return w;
})();

/** Audio a ritmo natural (48 kHz) leído hacia delante, con una ventana corta; se reposiciona si se salta. */
class NaturalBuffer {
  private L = new Float32Array(0);
  private R = new Float32Array(0);
  private base = 0; // índice de muestra (a 48 kHz) del primer elemento
  private len = 0;
  private src: PcmSource | null = null;
  private opened = false;
  constructor(private openAt: OpenAt) {}

  private async reset(pos: number) {
    this.src?.close();
    this.src = null;
    this.len = 0;
    this.base = Math.max(0, Math.floor(pos));
    this.src = await this.openAt(this.base / SR);
    this.opened = true;
  }

  /** Garantiza que el rango [from, to) está cargado (muestras absolutas). */
  async ensure(from: number, to: number) {
    from = Math.max(0, Math.floor(from));
    to = Math.max(from, Math.ceil(to));
    if (!this.opened || from < this.base - 1 || from > this.base + this.len + 4 * SR) await this.reset(from);
    // olvidar lo anterior a `from` (menos un margen)
    const drop = Math.min(this.len, Math.max(0, from - SEARCH * 2 - this.base));
    if (drop > 4800) {
      this.L.copyWithin(0, drop, this.len);
      this.R.copyWithin(0, drop, this.len);
      this.len -= drop;
      this.base += drop;
    }
    while (this.base + this.len < to) {
      const k = Math.max(4800, Math.min(48000, to - (this.base + this.len)));
      if (this.L.length < this.len + k) {
        const cap = Math.max(this.len + k, this.L.length * 2);
        const nl = new Float32Array(cap);
        const nr = new Float32Array(cap);
        nl.set(this.L.subarray(0, this.len));
        nr.set(this.R.subarray(0, this.len));
        this.L = nl;
        this.R = nr;
      }
      const tl = this.L.subarray(this.len, this.len + k);
      const tr = this.R.subarray(this.len, this.len + k);
      tl.fill(0);
      tr.fill(0);
      if (this.src) await this.src.read((this.base + this.len) / SR, 1 / SR, k, tl, tr);
      this.len += k;
    }
  }

  /** Muestra absoluta `i` (0 fuera de lo cargado). */
  l(i: number): number {
    const j = i - this.base;
    return j >= 0 && j < this.len ? this.L[j] : 0;
  }
  r(i: number): number {
    const j = i - this.base;
    return j >= 0 && j < this.len ? this.R[j] : 0;
  }

  close() {
    this.src?.close();
    this.src = null;
    this.opened = false;
    this.len = 0;
  }
}

/** Estira el audio siguiendo el mapa de tiempo del clip SIN cambiar el tono. */
export class PitchTimeSource implements PcmSource {
  private nat: NaturalBuffer;
  private accL = new Float32Array(G * 8);
  private accR = new Float32Array(G * 8);
  private accBase = 0; // índice de salida de acc[0]
  private ready = 0; // salida completa hasta aquí (exclusivo)
  private m = -1; // último grano añadido
  private prevStart = 0; // inicio (muestras de archivo) del último grano
  private hasPrev = false;

  constructor(private clip: TimeFields, openAt: OpenAt) {
    this.nat = new NaturalBuffer(openAt);
  }

  private srcPos(centerOut: number): number {
    return passSource(this.clip, centerOut / SR) * SR;
  }

  private async addGrain(m: number) {
    const at = m * HS;
    const center = this.srcPos(at + HS);
    let start = Math.round(center - HS);
    await this.nat.ensure(Math.min(start, this.hasPrev ? this.prevStart + HS : start) - SEARCH, Math.max(start + G, this.hasPrev ? this.prevStart + G : 0) + SEARCH);
    if (this.hasPrev) {
      // la fase que mejor continúa al grano anterior (correlación sobre la mitad solapada, submuestreada ×2)
      const tpl = this.prevStart + HS;
      let best = -Infinity;
      let bestD = 0;
      for (let d = -SEARCH; d <= SEARCH; d += 2) {
        const s0 = start + d;
        if (s0 < 0) continue;
        let c = 0;
        let e = 1e-9;
        for (let i = 0; i < HS; i += 2) {
          const a = this.nat.l(tpl + i);
          const b = this.nat.l(s0 + i);
          c += a * b;
          e += b * b;
        }
        const score = c / Math.sqrt(e);
        if (score > best) {
          best = score;
          bestD = d;
        }
      }
      start += bestD;
      if (start < 0) start = 0;
    }
    // sumar el grano (con ventana) en la salida
    const need = at + G - this.accBase;
    if (need > this.accL.length) {
      const cap = Math.max(need, this.accL.length * 2);
      const nl = new Float32Array(cap);
      const nr = new Float32Array(cap);
      nl.set(this.accL);
      nr.set(this.accR);
      this.accL = nl;
      this.accR = nr;
    }
    for (let i = 0; i < G; i++) {
      const j = at - this.accBase + i;
      if (j < 0) continue;
      const w = HANN[i];
      this.accL[j] += this.nat.l(start + i) * w;
      this.accR[j] += this.nat.r(start + i) * w;
    }
    this.prevStart = start;
    this.hasPrev = true;
    this.m = m;
    this.ready = at + HS; // lo anterior a la mitad de este grano ya no recibe más
  }

  async read(localStart: number, _step: number, n: number, L: Float32Array, R: Float32Array): Promise<void> {
    const i0 = Math.round(localStart * SR);
    if (this.m < 0) {
      this.m = Math.floor(i0 / HS) - 2;
      this.accBase = (this.m + 1) * HS;
      this.accL.fill(0);
      this.accR.fill(0);
      this.ready = this.accBase;
    } else if (i0 < this.accBase) {
      // reposicionado hacia atrás (poco habitual): se vuelve a empezar
      this.m = Math.floor(i0 / HS) - 2;
      this.accBase = (this.m + 1) * HS;
      this.accL.fill(0);
      this.accR.fill(0);
      this.ready = this.accBase;
      this.hasPrev = false;
    }
    while (this.ready < i0 + n) await this.addGrain(this.m + 1);
    for (let i = 0; i < n; i++) {
      const j = i0 + i - this.accBase;
      L[i] = j >= 0 ? this.accL[j] : 0;
      R[i] = j >= 0 ? this.accR[j] : 0;
    }
    // olvidar lo ya entregado
    const drop = i0 + n - this.accBase - HS;
    if (drop > G * 2) {
      this.accL.copyWithin(0, drop);
      this.accR.copyWithin(0, drop);
      this.accL.fill(0, this.accL.length - drop);
      this.accR.fill(0, this.accR.length - drop);
      this.accBase += drop;
    }
  }

  close() {
    this.nat.close();
  }
}

// ---------------- fuente por tiempo local ----------------

interface Slot {
  src: PcmSource | null;
  /** fin de la última lectura (s de archivo) y de qué pasada era */
  lastEnd: number;
  pass: number;
  dead: boolean;
}

/**
 * Fuente que el mezclador abre en lugar de la del archivo: se le pide audio en el tiempo local del clip.
 */
export class ClipTimeSource implements PcmSource {
  private slots: Slot[] = [
    { src: null, lastEnd: -Infinity, pass: -1, dead: false },
    { src: null, lastEnd: -Infinity, pass: -1, dead: false },
  ];
  private tl = new Float32Array(CHUNK);
  private tr = new Float32Array(CHUNK);
  /** conservar tono: un estirador por pasada del bucle (sin bucle, solo la 0) */
  private pitchPasses = new Map<number, PitchTimeSource>();
  /** lecturas de la fuente real (diagnóstico y pruebas) */
  reads = 0;
  reopens = 0;

  constructor(
    private clip: TimeFields,
    private openAt: OpenAt,
    private opts: { pitch?: boolean } = {},
  ) {}

  private async slot(i: number, pass: number, s0: number): Promise<Slot> {
    const sl = this.slots[i];
    const rev = !!this.clip.reverse;
    const jumped = rev ? s0 > sl.lastEnd + 0.1 : s0 < sl.lastEnd - 0.1;
    if (sl.dead) return sl;
    if (!sl.src || sl.pass !== pass || jumped) {
      sl.src?.close();
      sl.src = rev ? new ReverseAudioSource(this.openAt) : await this.openAt(s0);
      sl.pass = pass;
      sl.lastEnd = s0;
      this.reopens++;
      if (!sl.src) sl.dead = true;
    }
    return sl;
  }

  /** Estirador de una pasada: ve el clip SIN bucle, así su mapa de tiempo local es el de una sola pasada. */
  private pitchFor(pass: number): PitchTimeSource {
    let s = this.pitchPasses.get(pass);
    if (!s) {
      s = new PitchTimeSource({ ...this.clip, loop: undefined, xlayer: undefined }, this.openAt);
      this.pitchPasses.set(pass, s);
      for (const [k, v] of this.pitchPasses)
        if (k < pass - 1) {
          v.close();
          this.pitchPasses.delete(k);
        }
    }
    return s;
  }

  /** Bucle con «conservar tono»: cada pasada (la saliente y la entrante a la vez en el fundido) estira la suya, con su ganancia. */
  private async readPitchLoop(P: number, B: number, localStart: number, step: number, n: number, L: Float32Array, R: Float32Array): Promise<void> {
    const { tl, tr } = this;
    for (let i = 0; i < n; ) {
      let k = Math.min(CHUNK, n - i);
      let l0 = localStart + i * step;
      let a = layersAt(this.clip, l0);
      let b = layersAt(this.clip, l0 + (k - 1) * step);
      if (a.length !== b.length || a.some((x, j) => x.pass !== b[j].pass)) {
        k = 1;
        l0 = localStart + i * step;
        a = layersAt(this.clip, l0);
        b = a;
      }
      for (let j = 0; j < a.length; j++) {
        const t1 = tl.subarray(0, k);
        const t2 = tr.subarray(0, k);
        await this.pitchFor(a[j].pass).read(Math.max(0, Math.min(B, l0 - a[j].pass * P)), step, k, t1, t2);
        const g0 = a[j].g;
        const g1 = b[j].g;
        for (let q = 0; q < k; q++) {
          const g = k > 1 ? g0 + ((g1 - g0) * q) / (k - 1) : g0;
          L[i + q] += t1[q] * g;
          R[i + q] += t2[q] * g;
        }
      }
      i += k;
    }
  }

  async read(localStart: number, step: number, n: number, L: Float32Array, R: Float32Array): Promise<void> {
    L.fill(0, 0, n);
    R.fill(0, 0, n);
    if (this.clip.freeze) return; // un fotograma congelado no suena
    if (this.opts.pitch && !this.clip.reverse) {
      const li = loopInfo(this.clip);
      if (!li) return this.pitchFor(0).read(localStart, step, n, L, R);
      return this.readPitchLoop(li.P, li.B, localStart, step, n, L, R);
    }
    const { tl, tr } = this;
    for (let i = 0; i < n; ) {
      let k = Math.min(CHUNK, n - i);
      let l0 = localStart + i * step;
      let a = layersAt(this.clip, l0);
      let b = layersAt(this.clip, l0 + (k - 1) * step);
      if (a.length !== b.length || a.some((x, j) => x.pass !== b[j].pass)) {
        // el bucle cambia de pasada dentro del tramo: muestra a muestra
        k = 1;
        l0 = localStart + i * step;
        a = layersAt(this.clip, l0);
        b = a;
      }
      for (let j = 0; j < a.length; j++) {
        const s0 = a[j].s;
        const ds = k > 1 ? (b[j].s - s0) / (k - 1) : 0;
        const sl = await this.slot(a[j].pass & 1, a[j].pass, s0);
        if (!sl.src) continue;
        const t1 = tl.subarray(0, k);
        const t2 = tr.subarray(0, k);
        await sl.src.read(s0, ds, k, t1, t2);
        this.reads++;
        sl.lastEnd = s0 + ds * k;
        const g0 = a[j].g;
        const g1 = b[j].g;
        for (let q = 0; q < k; q++) {
          const g = k > 1 ? g0 + ((g1 - g0) * q) / (k - 1) : g0;
          L[i + q] += t1[q] * g;
          R[i + q] += t2[q] * g;
        }
      }
      i += k;
    }
  }

  close() {
    for (const s of this.slots) {
      s.src?.close();
      s.src = null;
    }
    for (const p of this.pitchPasses.values()) p.close();
    this.pitchPasses.clear();
  }
}

/** ¿Este clip necesita pasar por `ClipTimeSource`? (sin V8 el mezclador lo resuelve solo, como antes) */
export const needsTimeSource = (c: Pick<Clip, 'curve' | 'reverse' | 'freeze' | 'loop' | 'pitch' | 'speed'>): boolean => isTimeSpecial(c) || (!!c.pitch && (c.speed || 1) !== 1);
