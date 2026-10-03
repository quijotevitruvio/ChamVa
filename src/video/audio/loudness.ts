// Sonoridad según ITU-R BS.1770-4 / EBU R128 (puro, sin Web Audio): ponderación K (dos filtros
// bicuadráticos), bloques de 400 ms con solape del 75 %, doble puerta (−70 LUFS absoluta y −10 LU
// relativa) para la sonoridad integrada, momentánea (400 ms), a corto plazo (3 s) y pico real
// (true peak) con sobremuestreo ×4. Todo en streaming: se alimenta por bloques de cualquier tamaño.

/** Desplazamiento de la norma: LUFS = −0,691 + 10·log10(Σ G·z). */
const OFFSET = -0.691;

export const toDb = (lin: number): number => (lin > 1e-12 ? 20 * Math.log10(lin) : -Infinity);
export const fromDb = (db: number): number => Math.pow(10, db / 20);

/** Coeficientes (b0,b1,b2,a1,a2 normalizados) de las dos etapas de la ponderación K para cualquier frecuencia de muestreo. */
export function kWeightingCoeffs(sampleRate: number): [number[], number[]] {
  // Etapa 1: estante de agudos (+4 dB, la cabeza humana). Valores de libebur128 / pyloudnorm; a 48 kHz dan los de la norma.
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  // Etapa 2: filtro de paso alto RLB.
  const f1 = 38.13547087602444;
  const Q2 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / sampleRate);
  a0 = 1 + K / Q2 + K * K;
  const s2 = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0];
  return [s1, s2];
}

/** Respuesta (dB) de la ponderación K a una frecuencia (para pruebas). */
export function kWeightingGainDb(freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  let mag = 1;
  for (const [b0, b1, b2, a1, a2] of kWeightingCoeffs(sampleRate)) {
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
    const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    mag *= Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return 20 * Math.log10(mag);
}

class KFilter {
  private c: [number[], number[]];
  // estado de cada etapa (forma directa II traspuesta)
  private z = new Float64Array(4);
  constructor(sampleRate: number) {
    this.c = kWeightingCoeffs(sampleRate);
  }
  run(x: number): number {
    const z = this.z;
    const [b0, b1, b2, a1, a2] = this.c[0];
    let y = b0 * x + z[0];
    z[0] = b1 * x - a1 * y + z[1];
    z[1] = b2 * x - a2 * y;
    const [c0, c1, c2, d1, d2] = this.c[1];
    const x2 = y;
    y = c0 * x2 + z[2];
    z[2] = c1 * x2 - d1 * y + z[3];
    z[3] = c2 * x2 - d2 * y;
    return y;
  }
}

/** Detector de pico real: interpola ×4 (FIR de Kaiser de 16 puntos por fase). Devuelve el máximo de las 4 fases. */
export class TruePeakDetector {
  static readonly TAPS = 16;
  /** retardo (muestras) entre la entrada y el instante al que corresponde el valor devuelto */
  static readonly DELAY = 8;
  static phases: Float64Array[] | null = null;
  static beta = 7;
  private hist = new Float64Array(TruePeakDetector.TAPS);
  private ph = TruePeakDetector.build();

  private static build(): Float64Array[] {
    if (TruePeakDetector.phases) return TruePeakDetector.phases;
    const T = TruePeakDetector.TAPS;
    const c = T / 2;
    const beta = TruePeakDetector.beta;
    const i0 = (x: number) => {
      let s = 1;
      let t = 1;
      for (let k = 1; k < 30; k++) {
        t *= (x / (2 * k)) * (x / (2 * k));
        s += t;
      }
      return s;
    };
    const ph: Float64Array[] = [];
    for (let p = 0; p < 4; p++) {
      const f = p / 4;
      const h = new Float64Array(T);
      let sum = 0;
      for (let j = 0; j < T; j++) {
        // j = 0 es la muestra más reciente; el instante interpolado queda c muestras atrás más la fracción f hacia delante
        const d = j - c + f;
        const sinc = Math.abs(d) < 1e-12 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
        const r = d / c;
        const w = Math.abs(r) < 1 ? i0(beta * Math.sqrt(1 - r * r)) / i0(beta) : 0;
        h[j] = sinc * w;
        sum += h[j];
      }
      for (let j = 0; j < T; j++) h[j] /= sum;
      ph.push(h);
    }
    TruePeakDetector.phases = ph;
    return ph;
  }

  /** Mete una muestra y devuelve el pico real (lineal, ≥ 0) del intervalo [n − DELAY, n − DELAY + 1). */
  push(x: number): number {
    const h = this.hist;
    for (let j = h.length - 1; j > 0; j--) h[j] = h[j - 1];
    h[0] = x;
    let best = 0;
    for (let p = 0; p < 4; p++) {
      const c = this.ph[p];
      let s = 0;
      for (let j = 0; j < h.length; j++) s += c[j] * h[j];
      const a = s < 0 ? -s : s;
      if (a > best) best = a;
    }
    return best;
  }
}

/** Medidor de sonoridad en streaming (estéreo: L y R con peso 1). */
export class LoudnessMeter {
  private readonly sub: number; // muestras por sub-bloque (100 ms)
  private kl: KFilter;
  private kr: KFilter;
  private tpL = new TruePeakDetector();
  private tpR = new TruePeakDetector();
  private acc = 0; // energía acumulada del sub-bloque en curso
  private cnt = 0;
  private subs: number[]; // energía media de los últimos 30 sub-bloques (anillo)
  private subPos = 0;
  private subCount = 0;
  /** energía media (Σ G·z) de cada bloque de 400 ms ya cerrado (para la puerta) */
  private blocks: number[] = [];
  private totalSum = 0;
  private totalCount = 0;
  private tp = 0;
  private samplePeak = 0;

  constructor(readonly sampleRate = 48000) {
    this.sub = Math.max(1, Math.round(sampleRate / 10));
    this.kl = new KFilter(sampleRate);
    this.kr = new KFilter(sampleRate);
    this.subs = new Array(30).fill(0);
  }

  process(L: Float32Array, R: Float32Array, n = L.length) {
    let acc = this.acc;
    let cnt = this.cnt;
    let tp = this.tp;
    let sp = this.samplePeak;
    for (let i = 0; i < n; i++) {
      const l = L[i];
      const r = R[i];
      const yl = this.kl.run(l);
      const yr = this.kr.run(r);
      acc += yl * yl + yr * yr;
      const a = this.tpL.push(l);
      const b = this.tpR.push(r);
      if (a > tp) tp = a;
      if (b > tp) tp = b;
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > sp) sp = al;
      if (ar > sp) sp = ar;
      if (++cnt >= this.sub) {
        this.closeSub(acc / cnt);
        acc = 0;
        cnt = 0;
      }
    }
    this.acc = acc;
    this.cnt = cnt;
    this.tp = tp;
    this.samplePeak = sp;
  }

  private closeSub(energy: number) {
    this.subs[this.subPos] = energy;
    this.subPos = (this.subPos + 1) % 30;
    this.subCount++;
    this.totalSum += energy;
    this.totalCount++;
    if (this.subCount >= 4) {
      let s = 0;
      for (let k = 1; k <= 4; k++) s += this.subs[(this.subPos - k + 30) % 30];
      this.blocks.push(s / 4);
    }
  }

  private static lufs(energy: number): number {
    return energy > 0 ? OFFSET + 10 * Math.log10(energy) : -Infinity;
  }

  /** Sonoridad momentánea (últimos 400 ms), LUFS. */
  momentary(): number {
    if (this.subCount < 4) return -Infinity;
    let s = 0;
    for (let k = 1; k <= 4; k++) s += this.subs[(this.subPos - k + 30) % 30];
    return LoudnessMeter.lufs(s / 4);
  }

  /** Sonoridad a corto plazo (últimos 3 s), LUFS. */
  shortTerm(): number {
    if (this.subCount < 30) return -Infinity;
    let s = 0;
    for (let k = 0; k < 30; k++) s += this.subs[k];
    return LoudnessMeter.lufs(s / 30);
  }

  /** Sonoridad integrada con la doble puerta de BS.1770-4; −Infinity si no hay ningún bloque válido. */
  integrated(): number {
    const blocks = this.blocks;
    const absThr = Math.pow(10, (-70 - OFFSET) / 10);
    let s = 0;
    let n = 0;
    for (const e of blocks)
      if (e > absThr) {
        s += e;
        n++;
      }
    if (!n) return -Infinity;
    const relThr = (s / n) * 0.1; // −10 LU
    let s2 = 0;
    let n2 = 0;
    for (const e of blocks)
      if (e > absThr && e > relThr) {
        s2 += e;
        n2++;
      }
    return n2 ? LoudnessMeter.lufs(s2 / n2) : -Infinity;
  }

  /** Sonoridad media sin puertas de todo lo medido (respaldo para clips de menos de 400 ms). */
  ungated(): number {
    const tail = this.cnt > 0 ? this.acc / this.cnt : 0;
    const n = this.totalCount + (this.cnt > 0 ? 1 : 0);
    return n ? LoudnessMeter.lufs((this.totalSum + tail) / n) : -Infinity;
  }

  /** Pico real máximo (dBTP). */
  truePeakDb(): number {
    return toDb(this.tp);
  }
  /** Pico de muestra máximo (dBFS). */
  samplePeakDb(): number {
    return toDb(this.samplePeak);
  }
  get blockCount(): number {
    return this.blocks.length;
  }
}

export interface LoudnessReport {
  integrated: number;
  momentaryMax: number;
  shortTermMax: number;
  truePeak: number;
  samplePeak: number;
}

/** Mide un par de canales completos (para pruebas y análisis cortos). */
export function measureLoudness(L: Float32Array, R: Float32Array, sampleRate = 48000): LoudnessReport {
  const m = new LoudnessMeter(sampleRate);
  let mMax = -Infinity;
  let sMax = -Infinity;
  const step = Math.max(1, Math.round(sampleRate / 10));
  for (let i = 0; i < L.length; i += step) {
    const e = Math.min(L.length, i + step);
    m.process(L.subarray(i, e), R.subarray(i, e), e - i);
    mMax = Math.max(mMax, m.momentary());
    sMax = Math.max(sMax, m.shortTerm());
  }
  return { integrated: m.integrated(), momentaryMax: mMax, shortTermMax: sMax, truePeak: m.truePeakDb(), samplePeak: m.samplePeakDb() };
}

/** Objetivos de sonoridad habituales (LUFS). */
export const LOUDNESS_TARGETS = [
  { id: 'youtube', label: 'YouTube / redes (−14 LUFS)', lufs: -14 },
  { id: 'podcast', label: 'Podcast (−16 LUFS)', lufs: -16 },
  { id: 'tv', label: 'TV (EBU R128, −23 LUFS)', lufs: -23 },
] as const;

/** Pico real máximo permitido en el archivo final (dBTP, BS.1770 / EBU R128). */
export const TRUE_PEAK_LIMIT_DB = -1;
