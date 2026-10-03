// Detección de ritmo: flujo espectral (aumento de energía por bin en el espectro logarítmico), tempo por
// autocorrelación de la envolvente de inicios y marcas de pulso por programación dinámica (Ellis, 2007).
// Puro y sin dependencias: recibe audio mono y devuelve segundos del archivo.
import { FFT } from './fft';

export interface BeatResult {
  /** pulsos por minuto (0 si no se pudo estimar) */
  bpm: number;
  /** instantes (s) de los pulsos */
  beats: number[];
  /** instantes (s) de los inicios de sonido detectados (golpes) */
  onsets: number[];
  /** 0..1: lo claro que es el pulso */
  confidence: number;
}

const WIN = 512;
const HOP = 128;
const TARGET_SR = 12000;

/** Mezcla estéreo a mono. */
export function toMono(L: Float32Array, R: Float32Array): Float32Array {
  const out = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) out[i] = (L[i] + R[i]) * 0.5;
  return out;
}

/** Reduce la frecuencia de muestreo promediando bloques (basta para los inicios de sonido). */
function decimate(x: Float32Array, sr: number): { y: Float32Array; sr: number } {
  const f = Math.max(1, Math.floor(sr / TARGET_SR));
  if (f === 1) return { y: x, sr };
  const n = Math.floor(x.length / f);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < f; j++) s += x[i * f + j];
    y[i] = s / f;
  }
  return { y, sr: sr / f };
}

/** Envolvente de inicios (flujo espectral) y su frecuencia de cuadros (cuadros por segundo). */
export function onsetEnvelope(mono: Float32Array, sampleRate: number): { env: Float32Array; fps: number; frameOffset: number } {
  const { y, sr } = decimate(mono, sampleRate);
  const fps = sr / HOP;
  const frames = Math.max(0, Math.floor((y.length - WIN) / HOP) + 1);
  const env = new Float32Array(frames);
  if (!frames) return { env, fps, frameOffset: WIN / 2 / sr };
  const fft = new FFT(WIN);
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  const win = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN);
  const bins = Math.min(WIN / 2, Math.floor((5000 / sr) * WIN));
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  for (let t = 0; t < frames; t++) {
    const o = t * HOP;
    for (let i = 0; i < WIN; i++) {
      re[i] = y[o + i] * win[i];
      im[i] = 0;
    }
    fft.forward(re, im);
    let flux = 0;
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(80 * Math.hypot(re[k], im[k]) * (2 / WIN) * 8);
      if (t > 0) {
        const d = cur[k] - prev[k];
        if (d > 0) flux += d;
      }
    }
    env[t] = flux;
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return { env, fps, frameOffset: WIN / 2 / sr };
}

/** Quita la media local (ventana ~1 s) y deja solo lo positivo. */
function detrend(env: Float32Array, fps: number): Float32Array {
  const w = Math.max(3, Math.round(fps * 0.5));
  const out = new Float32Array(env.length);
  let sum = 0;
  const pre = new Float64Array(env.length + 1);
  for (let i = 0; i < env.length; i++) {
    sum += env[i];
    pre[i + 1] = sum;
  }
  for (let i = 0; i < env.length; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(env.length, i + w + 1);
    const mean = (pre[b] - pre[a]) / (b - a);
    out[i] = Math.max(0, env[i] - mean);
  }
  return out;
}

/** Estima el periodo (en cuadros) por autocorrelación ponderada hacia ~120 BPM. */
function estimatePeriod(env: Float32Array, fps: number): { period: number; strength: number } {
  const minLag = Math.max(2, Math.floor((fps * 60) / 200));
  const maxLag = Math.min(env.length - 1, Math.ceil((fps * 60) / 60));
  if (maxLag <= minLag + 1) return { period: 0, strength: 0 };
  let energy = 0;
  for (let i = 0; i < env.length; i++) energy += env[i] * env[i];
  if (energy <= 0) return { period: 0, strength: 0 };
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (env.length - lag);
  }
  let best = -1;
  let bestV = -Infinity;
  let sum = 0;
  let cnt = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (fps * 60) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2)); // sesgo suave hacia 120 BPM
    const v = ac[lag] * w;
    sum += ac[lag];
    cnt++;
    if (v > bestV) {
      bestV = v;
      best = lag;
    }
  }
  if (best < 0 || ac[best] <= 0) return { period: 0, strength: 0 };
  // interpolación parabólica
  const a = ac[best - 1], b = ac[best], c = ac[best + 1];
  const den = a - 2 * b + c;
  const off = den < 0 ? (0.5 * (a - c)) / den : 0;
  const mean = sum / Math.max(1, cnt);
  return { period: best + Math.max(-0.5, Math.min(0.5, off)), strength: mean > 0 ? Math.min(1, (ac[best] / mean - 1) / 8) : 0 };
}

/** Programación dinámica de pulsos: puntúa la envolvente en cada pulso y penaliza desviarse del periodo. */
function trackBeats(env: Float32Array, period: number): number[] {
  const n = env.length;
  if (!n || period <= 1) return [];
  let mx = 0;
  for (let i = 0; i < n; i++) mx = Math.max(mx, env[i]);
  if (mx <= 0) return [];
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) e[i] = env[i] / mx;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.max(1, Math.floor(period / 2));
  const hi = Math.ceil(period * 2);
  const tight = 8;
  for (let t = 0; t < n; t++) {
    let bestS = 0; // empezar aquí (sin pulso anterior)
    let bestP = -1;
    for (let tau = lo; tau <= hi && tau <= t; tau++) {
      const l = Math.log(tau / period);
      const s = score[t - tau] - tight * l * l;
      if (s > bestS) {
        bestS = s;
        bestP = t - tau;
      }
    }
    score[t] = e[t] + bestS;
    back[t] = bestP;
  }
  // el final: el mejor entre las últimas posiciones (dentro de un periodo del final)
  let end = n - 1;
  let endS = -Infinity;
  for (let t = Math.max(0, n - Math.ceil(period) - 1); t < n; t++) {
    if (score[t] > endS) {
      endS = score[t];
      end = t;
    }
  }
  const out: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    out.push(t);
    if (back[t] < 0) break;
  }
  return out.reverse();
}

/** Picos de la envolvente (inicios de sonido). */
function pickOnsets(env: Float32Array, fps: number): number[] {
  const w = Math.max(2, Math.round(fps * 0.03));
  let mean = 0;
  for (const v of env) mean += v;
  mean /= Math.max(1, env.length);
  let varr = 0;
  for (const v of env) varr += (v - mean) * (v - mean);
  const sd = Math.sqrt(varr / Math.max(1, env.length));
  const thr = mean + 0.6 * sd;
  const out: number[] = [];
  let last = -1e9;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] < thr || env[i] < env[i - 1] || env[i] <= env[i + 1]) continue;
    let isMax = true;
    for (let j = Math.max(0, i - w); j <= Math.min(env.length - 1, i + w); j++) if (env[j] > env[i]) isMax = false;
    if (!isMax || i - last < w) continue;
    out.push(i);
    last = i;
  }
  return out;
}

export function detectBeats(mono: Float32Array, sampleRate: number): BeatResult {
  const { env, fps, frameOffset } = onsetEnvelope(mono, sampleRate);
  if (env.length < fps) return { bpm: 0, beats: [], onsets: [], confidence: 0 };
  const d = detrend(env, fps);
  const toSec = (f: number) => f / fps + frameOffset;
  const onsets = pickOnsets(d, fps).map(toSec);
  const { period, strength } = estimatePeriod(d, fps);
  if (!period) return { bpm: 0, beats: [], onsets, confidence: 0 };
  const idx = trackBeats(d, period);
  const beats = idx.map(toSec);
  // BPM: mediana de los intervalos entre pulsos (más estable que el periodo del autocorrelograma)
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i++) gaps.push(beats[i] - beats[i - 1]);
  gaps.sort((a, b) => a - b);
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : (60 * 1) / ((fps * 60) / period);
  const bpm = med > 0 ? 60 / med : 0;
  return { bpm, beats, onsets, confidence: strength };
}
