// Filtro bicuadrático (RBJ) con la semántica de BiquadFilterNode de Web Audio para paso bajo/alto y
// campana (peaking), más estantes (shelf) y muesca (notch). Lo usan los filtros de voz, el ecualizador
// paramétrico y la maestra; la respuesta en frecuencia (`biquadResponseDb`) dibuja la curva del editor.

export type BiquadType = 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'notch';

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface BiquadOpts {
  /** paso bajo/alto: dB (como Web Audio); peaking/shelf/notch: Q lineal */
  q?: number;
  gainDb?: number;
}

/** Coeficientes normalizados, o null si el filtro no hace nada (se salta). */
export function biquadCoeffs(type: BiquadType, freq: number, sampleRate: number, opts: BiquadOpts = {}): BiquadCoeffs | null {
  const q = opts.q ?? 1;
  const gainDb = opts.gainDb ?? 0;
  const nyq = sampleRate / 2;
  if (((type === 'peaking' || type === 'lowshelf' || type === 'highshelf') && gainDb === 0) || (type === 'lowpass' && freq >= nyq) || (type === 'highpass' && freq <= 0)) return null;
  const f = Math.max(1, Math.min(freq, nyq * 0.999));
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
  } else if (type === 'lowshelf' || type === 'highshelf') {
    const A = Math.pow(10, gainDb / 40);
    const alpha = sin / (2 * Math.max(0.05, q));
    const sa = 2 * Math.sqrt(A) * alpha;
    if (type === 'lowshelf') {
      b0 = A * (A + 1 - (A - 1) * cos + sa);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - sa);
      a0 = A + 1 + (A - 1) * cos + sa;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - sa;
    } else {
      b0 = A * (A + 1 + (A - 1) * cos + sa);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - sa);
      a0 = A + 1 - (A - 1) * cos + sa;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - sa;
    }
  } else if (type === 'notch') {
    const alpha = sin / (2 * Math.max(0.05, q));
    b0 = 1;
    b1 = -2 * cos;
    b2 = 1;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
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
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Magnitud (dB) de un filtro a una frecuencia. */
export function biquadResponseDb(c: BiquadCoeffs, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2;
  const ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2;
  const di = -(c.a1 * s1 + c.a2 * s2);
  const m = (nr * nr + ni * ni) / (dr * dr + di * di);
  return 10 * Math.log10(Math.max(m, 1e-30));
}

export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z: Float64Array; // estado por canal: x1, x2, y1, y2
  readonly bypass: boolean;

  constructor(type: BiquadType, freq: number, sampleRate: number, opts: BiquadOpts = {}, channels = 2) {
    this.z = new Float64Array(channels * 4);
    const c = biquadCoeffs(type, freq, sampleRate, opts);
    if (!c) {
      this.bypass = true;
      return;
    }
    this.bypass = false;
    this.b0 = c.b0;
    this.b1 = c.b1;
    this.b2 = c.b2;
    this.a1 = c.a1;
    this.a2 = c.a2;
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
