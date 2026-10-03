// Reducción de ruido por sustracción espectral (propia, sin dependencias). RNNoise no se integra (ver
// docs/plan-video.md, V7): aquí el ruido estacionario (siseo, ventilador, zumbido) se estima solo, sin
// perfil previo, con estadística de mínimos por bin, y se resta con una regla de Wiener atenuada.
//
//   STFT de 1024 puntos, paso 256 (solape 75 %), ventana raíz de Hann en análisis y síntesis.
//   Un único FFT complejo para los dos canales (L + jR): la ganancia es real y simétrica.
//   Ruido: mínimo de la potencia suavizada en 8 subventanas de 40 cuadros (~1,7 s) × corrección de sesgo.
//   Ganancia: G = √max(0, 1 − α·N/P), con suelo β; abre al instante y cierra despacio (sin picoteo
//   en el arranque de las palabras) y se suaviza en frecuencia.
//   `amount` (0..1): α de 1 a 2,6 y suelo de −6 a −30 dB.
//
// Latencia: LATENCY muestras (21 ms): la salida n corresponde a la entrada n − LATENCY.
import { FFT } from './fft';

const N = 1024;
const HOP = 256;
const BINS = N / 2 + 1;
const SUB_FRAMES = 40;
const SUB_COUNT = 8;


export class SpectralDenoiser {
  /** parámetros de ajuste (solo se tocan en las pruebas de calibración) */
  static tune = { psTime: 0.8, psFreq: 2, bias: 2.6, lf: 1, alpha0: 1.2, alphaK: 2.0, open: 0.45, close: 0.75, floor0: 6, floorK: 24 };
  static readonly LATENCY = N;
  readonly active: boolean;
  private fft = new FFT(N);
  private win = new Float64Array(N);
  private inL = new Float32Array(N); // anillo de entrada
  private inR = new Float32Array(N);
  private inPos = 0;
  private sinceFrame = 0;
  private re = new Float64Array(N);
  private im = new Float64Array(N);
  private fifoL: Float32Array;
  private fifoR: Float32Array;
  private rd = 0;
  private wr = 0;
  private fifoSize: number;
  private ps = new Float64Array(BINS); // potencia suavizada
  private raw = new Float64Array(BINS);
  private gs = new Float64Array(BINS).fill(1); // ganancia suavizada
  private g = new Float64Array(BINS);
  private cur = new Float64Array(BINS).fill(Infinity);
  private hist: Float64Array[] = [];
  private histPos = 0;
  private subCount = 0;
  private frames = 0;
  private noise = new Float64Array(BINS);
  private alpha: number;
  private floor: number;
  /** ruido estimado medio (potencia lineal), para diagnóstico */
  get noiseLevel(): number {
    let s = 0;
    for (let k = 0; k < BINS; k++) s += this.noise[k];
    return s / BINS;
  }

  constructor(readonly amount: number, readonly sampleRate = 48000) {
    const a = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
    this.active = a > 0;
    const T = SpectralDenoiser.tune;
    this.alpha = T.alpha0 + T.alphaK * a;
    this.floor = Math.pow(10, -(T.floor0 + T.floorK * a) / 20);
    for (let i = 0; i < N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    for (let m = 0; m < SUB_COUNT; m++) this.hist.push(new Float64Array(BINS).fill(Infinity));
    this.fifoSize = 8192;
    this.fifoL = new Float32Array(this.fifoSize);
    this.fifoR = new Float32Array(this.fifoSize);
    this.wr = HOP; // HOP ceros de partida (ver el cálculo del retardo)
  }

  process(L: Float32Array, R: Float32Array, n = L.length) {
    if (!this.active) return;
    const mask = this.fifoSize - 1;
    for (let i = 0; i < n; i++) {
      this.inL[this.inPos] = L[i];
      this.inR[this.inPos] = R[i];
      this.inPos = (this.inPos + 1) & (N - 1);
      L[i] = this.fifoL[this.rd & mask];
      R[i] = this.fifoR[this.rd & mask];
      this.fifoL[this.rd & mask] = 0;
      this.fifoR[this.rd & mask] = 0;
      this.rd++;
      if (++this.sinceFrame >= HOP) {
        this.sinceFrame = 0;
        this.frame();
      }
    }
  }

  private frame() {
    const { re, im, win } = this;
    // ventana de los últimos N (el más antiguo está en inPos)
    for (let i = 0; i < N; i++) {
      const p = (this.inPos + i) & (N - 1);
      re[i] = this.inL[p] * win[i];
      im[i] = this.inR[p] * win[i];
    }
    this.fft.forward(re, im);
    // potencia (media de L y R) por bin 0..N/2
    const ps = this.ps;
    const raw = this.raw;
    const T = SpectralDenoiser.tune;
    const first = this.frames === 0;
    for (let k = 0; k < BINS; k++) {
      const k2 = (N - k) & (N - 1);
      raw[k] = (re[k] * re[k] + im[k] * im[k] + re[k2] * re[k2] + im[k2] * im[k2]) * 0.25;
    }
    // media en frecuencia (±psFreq bins) y en tiempo (suavizado exponencial): menos varianza, menos «picoteo»
    const pf = T.psFreq;
    for (let k = 0; k < BINS; k++) {
      let sum = 0;
      let c = 0;
      for (let j = Math.max(0, k - pf); j <= Math.min(BINS - 1, k + pf); j++) {
        sum += raw[j];
        c++;
      }
      const p = sum / c;
      ps[k] = first ? p : T.psTime * ps[k] + (1 - T.psTime) * p;
    }
    this.frames++;
    this.updateNoise();
    // ganancia
    const { alpha, floor, noise, g, gs } = this;
    for (let k = 0; k < BINS; k++) {
      const nz = noise[k];
      const p = ps[k] + 1e-20;
      let G = Math.sqrt(Math.max(0, 1 - (alpha * nz) / p));
      if (G < floor) G = floor;
      gs[k] = G > gs[k] ? T.open * gs[k] + (1 - T.open) * G : T.close * gs[k] + (1 - T.close) * G;
    }
    // suavizado en frecuencia (3 puntos)
    for (let k = 0; k < BINS; k++) {
      const a = gs[k > 0 ? k - 1 : 0];
      const b = gs[k];
      const c = gs[k < BINS - 1 ? k + 1 : BINS - 1];
      g[k] = 0.25 * a + 0.5 * b + 0.25 * c;
    }
    for (let k = 0; k < BINS; k++) {
      const gk = g[k];
      re[k] *= gk;
      im[k] *= gk;
      if (k > 0 && k < N / 2) {
        re[N - k] *= gk;
        im[N - k] *= gk;
      }
    }
    this.fft.inverse(re, im);
    // síntesis: ventana + suma solapada directamente sobre la cola de salida (que hace de acumulador).
    const mask = this.fifoSize - 1;
    const base = this.wr; // índice de cola de la muestra 0 de este cuadro (la cola ya tiene `wr` muestras decididas)
    for (let i = 0; i < N; i++) {
      const idx = (base + i) & mask;
      const w = win[i] * 0.5; // Σ de ventanas² con solape del 75 % = 2
      this.fifoL[idx] += re[i] * w;
      this.fifoR[idx] += im[i] * w;
    }
    this.wr += HOP;
  }

  private updateNoise() {
    const { ps, cur, noise } = this;
    for (let k = 0; k < BINS; k++) if (ps[k] < cur[k]) cur[k] = ps[k];
    if (++this.subCount >= SUB_FRAMES) {
      this.subCount = 0;
      this.hist[this.histPos].set(cur);
      this.histPos = (this.histPos + 1) % SUB_COUNT;
      cur.fill(Infinity);
    }
    for (let k = 0; k < BINS; k++) {
      let m = cur[k];
      for (let h = 0; h < SUB_COUNT; h++) if (this.hist[h][k] < m) m = this.hist[h][k];
      // los primeros bins (graves, < 200 Hz) fluctúan más (ruido rosa, viento): sesgo mayor
      noise[k] = (Number.isFinite(m) ? m : ps[k]) * SpectralDenoiser.tune.bias * (k < 5 ? 1 + SpectralDenoiser.tune.lf : 1);
    }
  }
}
