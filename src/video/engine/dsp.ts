// Procesado de audio en bloques (puro, sin Web Audio): permite mezclar la
// exportación en streaming —sin tener todo el audio en memoria como hacía
// OfflineAudioContext— y probar cada pieza con números en Vitest.
//
// Las piezas imitan los nodos que usa la vista previa del editor (BiquadFilter
// con la semántica de Web Audio, compuerta, eco y compresor) para que lo que se
// oye al previsualizar sea lo que sale; y al final siempre va un limitador.

export const LIMIT_CEILING = Math.pow(10, -1 / 20); // −1 dBFS ≈ 0,891

export type BiquadType = 'lowpass' | 'highpass' | 'peaking';

/** Filtro bicuadrático (RBJ), con la misma semántica que BiquadFilterNode de Web Audio. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z: Float64Array; // estado por canal: x1, x2, y1, y2
  readonly bypass: boolean;

  constructor(type: BiquadType, freq: number, sampleRate: number, opts: { q?: number; gainDb?: number } = {}, channels = 2) {
    this.z = new Float64Array(channels * 4);
    const q = opts.q ?? 1;
    const gainDb = opts.gainDb ?? 0;
    const nyq = sampleRate / 2;
    if ((type === 'peaking' && gainDb === 0) || (type === 'lowpass' && freq >= nyq) || (type === 'highpass' && freq <= 0)) {
      this.bypass = true;
      return;
    }
    this.bypass = false;
    const f = Math.min(freq, nyq * 0.999);
    const w0 = (2 * Math.PI * f) / sampleRate;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === 'peaking') {
      const A = Math.pow(10, gainDb / 40);
      const alpha = sin / (2 * q);
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
    } else {
      // En Web Audio la Q de paso bajo/alto está en dB.
      const qLin = Math.pow(10, q / 20);
      const alpha = sin / (2 * qLin);
      if (type === 'lowpass') {
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = (1 - cos) / 2;
      } else {
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = (1 + cos) / 2;
      }
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(ch: Float32Array, channel: number, n = ch.length) {
    if (this.bypass) return;
    const z = this.z;
    const o = channel * 4;
    let x1 = z[o], x2 = z[o + 1], y1 = z[o + 2], y2 = z[o + 3];
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < n; i++) {
      const x = ch[i];
      let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      if (Math.abs(y) < 1e-30) y = 0; // evita denormales
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      ch[i] = y;
    }
    z[o] = x1;
    z[o + 1] = x2;
    z[o + 2] = y1;
    z[o + 3] = y2;
  }
}

/**
 * Compuerta de ruido como la de la vista previa: mide el RMS (mono) de los
 * últimos 1024 muestras; por encima de 0,025 abre (1), por debajo cierra (0,02),
 * con transición exponencial de 50 ms (setTargetAtTime).
 */
export class NoiseGate {
  static readonly THRESHOLD = 0.025;
  static readonly CLOSED = 0.02;
  private win = new Float32Array(1024);
  private wpos = 0;
  private sumSq = 0;
  private gain = 1;
  private target = 1;
  private sinceEval = 0;
  private readonly k: number;

  constructor(sampleRate: number) {
    this.k = 1 - Math.exp(-1 / (0.05 * sampleRate));
  }

  process(L: Float32Array, R: Float32Array, n = L.length) {
    const win = this.win;
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5;
      const old = win[this.wpos];
      this.sumSq += m * m - old * old;
      win[this.wpos] = m;
      this.wpos = (this.wpos + 1) & 1023;
      if (++this.sinceEval >= 128) {
        this.sinceEval = 0;
        const rms = Math.sqrt(Math.max(0, this.sumSq) / 1024);
        this.target = rms > NoiseGate.THRESHOLD ? 1 : NoiseGate.CLOSED;
      }
      this.gain += (this.target - this.gain) * this.k;
      L[i] *= this.gain;
      R[i] *= this.gain;
    }
  }
}

/** Eco: retardo de 0,28 s con realimentación 0,35 (mismo grafo que la exportación anterior). */
export class Echo {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private pos = 0;
  constructor(sampleRate: number, private amount: number, delay = 0.28, private feedback = 0.35) {
    const d = Math.max(1, Math.round(delay * sampleRate));
    this.bufL = new Float32Array(d);
    this.bufR = new Float32Array(d);
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    const d = this.bufL.length;
    for (let i = 0; i < n; i++) {
      const outL = this.bufL[this.pos];
      const outR = this.bufR[this.pos];
      // entrada de la línea = eco·x + realimentación·salida
      this.bufL[this.pos] = L[i] * this.amount + outL * this.feedback;
      this.bufR[this.pos] = R[i] * this.amount + outR * this.feedback;
      L[i] += outL;
      R[i] += outR;
      this.pos = this.pos + 1 === d ? 0 : this.pos + 1;
    }
  }
}

/**
 * Compresor con rodilla suave (umbral −24 dB, 4:1, rodilla 30 dB, ataque 3 ms,
 * relajación 250 ms) y ganancia de compensación automática como la de
 * DynamicsCompressorNode: (1 / curva(0 dBFS))^0,6. Es el «Normalizar» del editor.
 */
export class Compressor {
  private env = 0; // reducción de ganancia actual (dB, ≤ 0)
  private readonly att: number;
  private readonly rel: number;
  private readonly makeup: number;
  constructor(sampleRate: number, private threshold = -24, private ratio = 4, private knee = 30) {
    this.att = Math.exp(-1 / (0.003 * sampleRate));
    this.rel = Math.exp(-1 / (0.25 * sampleRate));
    const full = this.curve(0); // dB de salida para 0 dBFS de entrada
    this.makeup = Math.pow(1 / Math.pow(10, full / 20), 0.6);
  }
  curve(xDb: number): number {
    const { threshold: T, ratio: R, knee: K } = this;
    if (xDb < T - K / 2) return xDb;
    if (xDb > T + K / 2) return T + (xDb - T) / R;
    const d = xDb - T + K / 2;
    return xDb + ((1 / R - 1) * d * d) / (2 * K);
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    for (let i = 0; i < n; i++) {
      const peak = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      const xDb = peak > 1e-9 ? 20 * Math.log10(peak) : -180;
      const gr = this.curve(xDb) - xDb; // ≤ 0
      const coef = gr < this.env ? this.att : this.rel;
      this.env = coef * this.env + (1 - coef) * gr;
      const g = Math.pow(10, this.env / 20) * this.makeup;
      L[i] *= g;
      R[i] *= g;
    }
  }
}

/**
 * Limitador de pico sin latencia: si una muestra superaría el techo, la ganancia
 * baja al instante justo lo necesario y se recupera en ~100 ms. Garantiza
 * |salida| ≤ techo (−1 dBFS) en cada muestra: antes el MP4 llegaba a pico 1,00.
 */
export class Limiter {
  private gain = 1;
  private readonly k: number;
  peakIn = 0;
  peakOut = 0;
  reduced = 0; // muestras en las que actuó
  constructor(sampleRate: number, readonly ceiling = LIMIT_CEILING, release = 0.1) {
    this.k = 1 - Math.exp(-1 / (release * sampleRate));
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    const c = this.ceiling;
    for (let i = 0; i < n; i++) {
      let l = L[i];
      let r = R[i];
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;
      const peak = Math.max(Math.abs(l), Math.abs(r));
      if (peak > this.peakIn) this.peakIn = peak;
      const need = peak > c ? c / peak : 1;
      let g = this.gain + (1 - this.gain) * this.k;
      if (need < g) {
        g = need;
        this.reduced++;
      }
      this.gain = g;
      l *= g;
      r *= g;
      // Seguro final contra errores de redondeo.
      if (l > c) l = c;
      else if (l < -c) l = -c;
      if (r > c) r = c;
      else if (r < -c) r = -c;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > this.peakOut) this.peakOut = p;
      L[i] = l;
      R[i] = r;
    }
  }
}

/** Parámetros de audio de un clip (los del efecto «Voz» y el volumen). */
export interface ClipAudioFx {
  volume: number;
  hp: number;
  lp: number;
  echo: number;
  gate: boolean;
}

/** Cadena por clip, en el mismo orden que la vista previa: paso alto → paso bajo → compuerta → volumen → (+eco). */
export class ClipChain {
  private hp: Biquad;
  private lp: Biquad;
  private gate: NoiseGate | null;
  private echo: Echo | null;
  constructor(private fx: ClipAudioFx, sampleRate: number) {
    this.hp = new Biquad('highpass', fx.hp, sampleRate);
    this.lp = new Biquad('lowpass', fx.lp, sampleRate);
    this.gate = fx.gate ? new NoiseGate(sampleRate) : null;
    this.echo = fx.echo > 0 ? new Echo(sampleRate, fx.echo) : null;
  }
  /** Cambia solo el volumen sin perder el estado de la cadena (filtros, compuerta, eco). */
  setVolume(v: number) {
    this.fx = { ...this.fx, volume: v };
  }
  /** Segundos de cola que siguen sonando tras el final del clip (eco). */
  get tail(): number {
    return this.echo ? 2 : 0;
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    this.hp.process(L, 0, n);
    this.hp.process(R, 1, n);
    this.lp.process(L, 0, n);
    this.lp.process(R, 1, n);
    this.gate?.process(L, R, n);
    const v = this.fx.volume;
    if (v !== 1)
      for (let i = 0; i < n; i++) {
        L[i] *= v;
        R[i] *= v;
      }
    this.echo?.process(L, R, n);
  }
}

/** Cadena maestra: ecualizador de 3 bandas → compresor (si «Normalizar») → limitador a −1 dBFS. */
export class MasterChain {
  private eq: Biquad[];
  private comp: Compressor | null;
  readonly limiter: Limiter;
  constructor(eq: { low: number; mid: number; high: number }, normalize: boolean, sampleRate: number) {
    this.eq = [
      new Biquad('peaking', 120, sampleRate, { q: 1, gainDb: eq.low }),
      new Biquad('peaking', 1000, sampleRate, { q: 1, gainDb: eq.mid }),
      new Biquad('peaking', 6000, sampleRate, { q: 1, gainDb: eq.high }),
    ];
    this.comp = normalize ? new Compressor(sampleRate) : null;
    this.limiter = new Limiter(sampleRate);
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    for (const b of this.eq) {
      b.process(L, 0, n);
      b.process(R, 1, n);
    }
    this.comp?.process(L, R, n);
    this.limiter.process(L, R, n);
  }
}
