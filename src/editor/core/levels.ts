import type { LevelsAdjust } from './types';

type PixelData = Pick<ImageData, 'data' | 'width' | 'height'>;

export const NEUTRAL_LEVELS: LevelsAdjust = { inBlack: 0, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 };

function n(v: number | undefined, neutral: number) {
  return typeof v === 'number' && isFinite(v) ? v : neutral;
}

export function isNeutralLevels(l: LevelsAdjust | undefined): boolean {
  if (!l) return true;
  return (
    n(l.inBlack, 0) <= 0 &&
    Math.abs(n(l.gamma, 1) - 1) < 0.005 &&
    n(l.inWhite, 255) >= 255 &&
    n(l.outBlack, 0) <= 0 &&
    n(l.outWhite, 255) >= 255
  );
}

// Tabla de 256 entradas: recorta la entrada, aplica gamma y reescala a la salida.
export function levelsLut(l: LevelsAdjust | undefined): Uint8Array {
  const lut = new Uint8Array(256);
  const inB = Math.min(254, Math.max(0, n(l?.inBlack, 0)));
  const inW = Math.min(255, Math.max(inB + 1, n(l?.inWhite, 255)));
  const g = Math.min(10, Math.max(0.1, n(l?.gamma, 1)));
  const outB = Math.min(255, Math.max(0, n(l?.outBlack, 0)));
  const outW = Math.min(255, Math.max(0, n(l?.outWhite, 255)));
  for (let i = 0; i < 256; i++) {
    let t = (i - inB) / (inW - inB);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = Math.pow(t, 1 / g);
    const v = outB + t * (outW - outB);
    lut[i] = Math.round(v < 0 ? 0 : v > 255 ? 255 : v);
  }
  return lut;
}

export function applyLevels(img: PixelData, l: LevelsAdjust | undefined) {
  if (isNeutralLevels(l)) return;
  const lut = levelsLut(l);
  const d = img.data as Uint8ClampedArray;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

// El tirador de medios vive en la fracción t0 del tramo negro..blanco donde la salida vale 0,5.
export function gammaToMidFraction(gamma: number): number {
  return Math.pow(0.5, Math.min(10, Math.max(0.1, gamma)));
}
export function midFractionToGamma(t0: number): number {
  const t = Math.min(0.99, Math.max(0.01, t0));
  return Math.min(10, Math.max(0.1, Math.log(t) / Math.log(0.5)));
}

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  lum: Uint32Array;
  count: number;
  max: number; // cubo más alto de la luminancia (para escalar el dibujo)
}

// Histograma de 256 cubos; ignora píxeles casi transparentes y submuestrea imágenes grandes.
export function computeHistogram(img: PixelData): Histogram {
  const d = img.data;
  const total = img.width * img.height;
  const stride = Math.max(1, Math.floor(total / 262144));
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const lum = new Uint32Array(256);
  let count = 0;
  for (let p = 0; p < total; p += stride) {
    const i = p * 4;
    if (d[i + 3] < 16) continue;
    r[d[i]]++;
    g[d[i + 1]]++;
    b[d[i + 2]]++;
    lum[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
    count++;
  }
  let max = 0;
  for (let i = 0; i < 256; i++) if (lum[i] > max) max = lum[i];
  return { r, g, b, lum, count, max };
}
