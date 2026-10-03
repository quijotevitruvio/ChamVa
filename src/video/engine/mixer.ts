// Mezclador de la línea de tiempo en streaming: produce el audio final bloque a
// bloque (48 kHz estéreo) a medida que avanza el video. Cada fuente se abre al
// llegar a su tramo y se cierra al salir, así que en memoria solo hay unos
// segundos de audio, no el proyecto entero (antes: OfflineAudioContext con toda
// la duración + cada archivo decodificado completo, una vez por clip).
//
// V7: cada clip suma en el BUS de su pista; cada pista pasa por su cadena (ecualizador, volumen en dB,
// ducking por sidechain con las pistas de control, panorámica) y los buses se suman en la maestra
// (ecualizador, sonoridad y limitador de pico real). Fundido cruzado de audio en las uniones: el clip
// saliente sigue un poco más allá de su salida y el entrante empieza un poco antes, con ganancias de
// potencia constante.
import { ClipChain, MasterChain, TrackChain, fxTail, trackHasFx, type ClipAudioFx, type MasterOptions, type TrackFx } from './dsp';

/** Fuente de audio ya decodificada que se puede leer remuestreada. */
export interface PcmSource {
  /**
   * Escribe n muestras empezando en el instante `srcStart` (s del archivo) y
   * avanzando `step` s de archivo por muestra de salida (velocidad / 48 kHz).
   * Debe llamarse con tiempos crecientes. Devuelve silencio donde no hay datos.
   */
  read(srcStart: number, step: number, n: number, L: Float32Array, R: Float32Array): Promise<void>;
  close(): void;
}

export interface MixEntry {
  start: number; // s de la línea de tiempo
  end: number;
  inP: number;
  outP: number;
  speed: number;
  fx: ClipAudioFx;
  /** Fundido del sonido (s) al principio y al final del tramo (0 = sin fundido). */
  fadeIn?: number;
  fadeOut?: number;
  /** Envolvente de ganancia (fotogramas clave de volumen): multiplica el sonido; recibe el instante de la línea de tiempo. */
  gain?: (t: number) => number;
  /** V7: pista a cuyo bus suma (sin definir = bus sin procesar) */
  trackId?: string;
  /** V7: fundido cruzado de entrada: el clip empieza `pre` s antes y su ganancia sube (potencia constante) durante `len` s desde ese punto */
  xfIn?: { pre: number; len: number };
  /** V7: fundido cruzado de salida: el clip sigue `post` s más y su ganancia baja durante `len` s hasta ese punto */
  xfOut?: { post: number; len: number };
  /** Abre la fuente (null = el archivo no tiene audio). */
  open: () => Promise<PcmSource | null>;
}

/** Una pista del mezclador: sus ajustes y las pistas cuya señal dispara su ducking (ya resueltas). */
export interface MixTrack {
  fx: TrackFx;
  key: string[];
}

interface Active {
  e: MixEntry;
  src: PcmSource | null;
  chain: ClipChain;
}

export class TimelineMixer {
  private pos = 0; // muestra de salida siguiente (ya alineada)
  private fed = 0; // muestras mezcladas y metidas en la maestra
  private active = new Map<MixEntry, Active>();
  private done = new Set<MixEntry>();
  private tmpL = new Float32Array(0);
  private tmpR = new Float32Array(0);
  readonly master: MasterChain;
  readonly totalSamples: number;
  private chains = new Map<string, TrackChain>();
  private tapIds = new Set<string>();
  private trackKeys = new Map<string, string[]>();

  constructor(
    private entries: MixEntry[],
    master: MasterOptions,
    duration: number,
    readonly sampleRate = 48000,
    tracks: Record<string, MixTrack> = {},
  ) {
    this.master = new MasterChain(master.eq, master.normalize, sampleRate, { eqBands: master.eqBands, gainDb: master.gainDb, ceilingDb: master.ceilingDb });
    this.totalSamples = Math.round(duration * sampleRate);
    for (const [id, t] of Object.entries(tracks)) {
      if (trackHasFx(t.fx)) this.chains.set(id, new TrackChain(t.fx, sampleRate));
      if (t.fx.duck?.on) {
        this.trackKeys.set(id, t.key);
        for (const k of t.key) this.tapIds.add(k);
      }
    }
  }

  get position(): number {
    return this.pos;
  }
  get finished(): boolean {
    return this.pos >= this.totalSamples;
  }

  /** Estado de las pistas procesadas (picos, ducking) para medir y para el banco. */
  trackStats(): Record<string, { peak: number; minDuckDb: number }> {
    const out: Record<string, { peak: number; minDuckDb: number }> = {};
    for (const [id, c] of this.chains) out[id] = { peak: Math.max(c.peakL, c.peakR), minDuckDb: c.minDuckDb };
    return out;
  }

  /** Devuelve las siguientes n muestras (o menos al final), alineadas con la línea de tiempo. */
  async render(n: number): Promise<{ L: Float32Array; R: Float32Array; frames: number; startSample: number }> {
    const count = Math.max(0, Math.min(n, this.totalSamples - this.pos));
    const startSample = this.pos;
    if (count === 0) return { L: new Float32Array(0), R: new Float32Array(0), frames: 0, startSample };
    // El limitador de pico real retrasa `latency` muestras: se mezcla ese tanto por delante y se descarta el arranque.
    const lat = this.master.latency;
    const need = this.fed === 0 ? count + lat : count;
    const { L, R } = await this.mixBlock(this.fed, need);
    this.master.process(L, R, need);
    this.fed += need;
    this.pos += count;
    const skip = need - count;
    return { L: skip ? L.subarray(skip) : L, R: skip ? R.subarray(skip) : R, frames: count, startSample };
  }

  /** Mezcla las muestras [start, start + count) de la línea de tiempo (sin la maestra). */
  private async mixBlock(start: number, count: number): Promise<{ L: Float32Array; R: Float32Array }> {
    const sr = this.sampleRate;
    const outL = new Float32Array(count);
    const outR = new Float32Array(count);
    if (this.tmpL.length < count) {
      this.tmpL = new Float32Array(count);
      this.tmpR = new Float32Array(count);
    }
    const t0 = start / sr;
    const t1 = (start + count) / sr;
    const buses = new Map<string, { L: Float32Array; R: Float32Array }>();
    const busOf = (id: string) => {
      let b = buses.get(id);
      if (!b) {
        b = { L: new Float32Array(count), R: new Float32Array(count) };
        buses.set(id, b);
      }
      return b;
    };
    for (const id of this.chains.keys()) busOf(id); // las pistas con cadena corren siempre (el ducking y los filtros avanzan en los huecos)
    for (const e of this.entries) {
      if (this.done.has(e)) continue;
      let a = this.active.get(e);
      const pre = e.xfIn?.pre ?? 0;
      const post = e.xfOut?.post ?? 0;
      const tailEnd = e.end + post + (a ? a.chain.tail : fxTail(e.fx, sr));
      if (e.start - pre >= t1) continue; // todavía no empieza
      if (t0 >= tailEnd) {
        // terminó (incluida la cola del eco)
        if (a) {
          a.src?.close();
          this.active.delete(e);
        }
        this.done.add(e);
        continue;
      }
      if (!a) {
        a = { e, src: await e.open(), chain: new ClipChain(e.fx, sr) };
        this.active.set(e, a);
      }
      const tl = this.tmpL.subarray(0, count);
      const tr = this.tmpR.subarray(0, count);
      tl.fill(0);
      tr.fill(0);
      // Tramo del bloque que cae dentro del clip (fuera: silencio, pero la cadena sigue para la cola).
      const speed = e.speed || 1;
      const firstIn = Math.max(0, Math.ceil((e.start - pre) * sr - start - 1e-6));
      const lastIn = Math.min(count, Math.ceil((e.end + post) * sr - start - 1e-6));
      if (a.src && lastIn > firstIn) {
        const step = speed / sr;
        const tStart = (start + firstIn) / sr;
        const srcStart = e.inP + (tStart - e.start) * speed;
        const k = lastIn - firstIn;
        await a.src.read(srcStart, step, k, tl.subarray(firstIn, lastIn), tr.subarray(firstIn, lastIn));
        // Nada más allá del punto de salida del clip (salvo la prolongación del fundido cruzado).
        const outLimit = e.outP + post * speed;
        for (let i = firstIn; i < lastIn; i++) {
          const s = srcStart + (i - firstIn) * step;
          if (s >= outLimit) {
            tl[i] = 0;
            tr[i] = 0;
          }
        }
        // Fundidos de sonido (lineales), antes de la cadena del clip como el volumen de la fuente.
        const fi = e.fadeIn ?? 0;
        const fo = e.fadeOut ?? 0;
        if (e.gain)
          for (let i = firstIn; i < lastIn; i++) {
            const g = e.gain((start + i) / sr);
            tl[i] *= g;
            tr[i] *= g;
          }
        if (fi > 0 || fo > 0)
          for (let i = firstIn; i < lastIn; i++) {
            const tt = (start + i) / sr;
            let g = 1;
            if (fi > 0 && tt - e.start < fi) g = (tt - e.start) / fi;
            if (fo > 0 && e.end - tt < fo) g = Math.min(g, (e.end - tt) / fo);
            g = Math.max(0, Math.min(1, g));
            tl[i] *= g;
            tr[i] *= g;
          }
        // Fundido cruzado en las uniones: ganancias de potencia constante (cos / sin).
        if (e.xfIn) {
          const w0 = e.start - e.xfIn.pre;
          for (let i = firstIn; i < lastIn; i++) {
            const u = ((start + i) / sr - w0) / e.xfIn.len;
            const g = u <= 0 ? 0 : u >= 1 ? 1 : Math.sin((Math.PI / 2) * u);
            tl[i] *= g;
            tr[i] *= g;
          }
        }
        if (e.xfOut) {
          const w0 = e.end + e.xfOut.post - e.xfOut.len;
          for (let i = firstIn; i < lastIn; i++) {
            const u = ((start + i) / sr - w0) / e.xfOut.len;
            const g = u <= 0 ? 1 : u >= 1 ? 0 : Math.cos((Math.PI / 2) * u);
            tl[i] *= g;
            tr[i] *= g;
          }
        }
      }
      a.chain.process(tl, tr, count);
      const bus = busOf(e.trackId ?? '');
      for (let i = 0; i < count; i++) {
        bus.L[i] += tl[i];
        bus.R[i] += tr[i];
      }
    }
    // Pistas: primero las que no hacen ducking (sus tomas sirven de control), después las que sí.
    const taps = new Map<string, { L: Float32Array; R: Float32Array }>();
    const ducked: string[] = [];
    for (const [id, bus] of buses) {
      const chain = this.chains.get(id);
      if (chain?.ducking) {
        ducked.push(id);
        continue;
      }
      let tap: { L: Float32Array; R: Float32Array } | undefined;
      if (this.tapIds.has(id)) {
        tap = { L: new Float32Array(count), R: new Float32Array(count) };
        taps.set(id, tap);
      }
      if (chain) chain.process(bus.L, bus.R, count, null, null, tap?.L, tap?.R);
      else if (tap) {
        tap.L.set(bus.L);
        tap.R.set(bus.R);
      }
    }
    for (const id of ducked) {
      const bus = buses.get(id)!;
      const keyIds = this.trackKeys.get(id) ?? [];
      let kL: Float32Array | null = null;
      let kR: Float32Array | null = null;
      for (const k of keyIds) {
        const tap = taps.get(k);
        if (!tap) continue;
        if (!kL || !kR) {
          kL = new Float32Array(count);
          kR = new Float32Array(count);
        }
        for (let i = 0; i < count; i++) {
          kL[i] += tap.L[i];
          kR[i] += tap.R[i];
        }
      }
      this.chains.get(id)!.process(bus.L, bus.R, count, kL, kR);
    }
    for (const bus of buses.values())
      for (let i = 0; i < count; i++) {
        outL[i] += bus.L[i];
        outR[i] += bus.R[i];
      }
    return { L: outL, R: outR };
  }

  close() {
    for (const a of this.active.values()) a.src?.close();
    this.active.clear();
  }
}

/** Entradas de mezcla: audio de cada tramo de video + pista de audio en secuencia desde 0. */
export function buildMixEntries<C extends { inP: number; outP: number; speed: number } & ClipAudioFx>(
  videoSegs: { clip: C; start: number; end: number }[],
  audioClips: C[],
  duration: number,
  open: (clip: C) => () => Promise<PcmSource | null>,
): MixEntry[] {
  const out: MixEntry[] = [];
  for (const s of videoSegs)
    out.push({ start: s.start, end: s.end, inP: s.clip.inP, outP: s.clip.outP, speed: s.clip.speed || 1, fx: fxOf(s.clip), open: open(s.clip) });
  let at = 0;
  for (const c of audioClips) {
    if (at >= duration) break;
    const dur = Math.max(0.01, (c.outP - c.inP) / (c.speed || 1));
    out.push({ start: at, end: Math.min(duration, at + dur), inP: c.inP, outP: c.outP, speed: c.speed || 1, fx: fxOf(c), open: open(c) });
    at += dur;
  }
  return out;
}

const fxOf = (c: ClipAudioFx): ClipAudioFx => ({ volume: c.volume, hp: c.hp, lp: c.lp, echo: c.echo, gate: !!c.gate });
