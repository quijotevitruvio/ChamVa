import { DEFAULT_ADJUST, type ImageAdjust, type ImageLayer } from './types';
import { applyOverlayDuotone, cssFor, getFilter } from './filters';
import { applyCurves, hasCurves } from './curves';
import { applyLevels, isNeutralLevels } from './levels';
import { applyHslMix, hasHslMix } from './hslMixer';
import { applyDehaze, applyDenoise, applyLens } from './photoFix';
import { applyImageEffects, hasImageFx } from './imageEffects';
import { cropPixelRect, sourcePixels, validCrop } from './imageCrop';
import { getPixelPool, MIN_WORKER_PIXELS } from './pixelPool';

// String de filtro CSS (ajustes + filtro con nombre). Lo usan igual editor y export.
export function buildFilterString(layer: ImageLayer): string {
  return cssFor(getFilter(layer.filter), layer.adjust);
}

type PixelData = Pick<ImageData, 'data' | 'width' | 'height'>;

const n = (v: number | undefined, neutral = 0) => (typeof v === 'number' && isFinite(v) ? v : neutral);

// ¿Hay algún ajuste por píxel (no CSS) activo?
export function hasPixelOps(a: ImageAdjust): boolean {
  return (
    n(a.temperature) !== 0 ||
    n(a.tint) !== 0 ||
    n(a.highlights) !== 0 ||
    n(a.shadows) !== 0 ||
    n(a.vibrance) !== 0 ||
    n(a.posterize) > 0 ||
    n(a.sharpen) > 0 ||
    n(a.clarity) > 0 ||
    n(a.exposure) !== 0 ||
    n(a.hue) !== 0 ||
    n(a.grayscale) > 0 ||
    n(a.sepia) > 0 ||
    n(a.threshold) > 0 ||
    a.invert === true ||
    n(a.pixelate) > 0 ||
    n(a.vignette) > 0 ||
    n(a.grain) > 0 ||
    hasCurves(a.curves) ||
    !isNeutralLevels(a.levels) ||
    hasHslMix(a.hslMix) ||
    n(a.denoise) > 0 ||
    n(a.denoiseColor) > 0 ||
    n(a.dehaze) > 0 ||
    n(a.lensDistortion) !== 0 ||
    n(a.lensVignette) > 0 ||
    hasImageFx(a.fx)
  );
}

// ¿La capa tiene algún ajuste/filtro/volteo aplicado?
export function needsProcessing(layer: ImageLayer): boolean {
  const a = layer.adjust ?? DEFAULT_ADJUST;
  return (
    a.brightness !== 1 ||
    a.contrast !== 1 ||
    a.saturate !== 1 ||
    n(a.blur) > 0 ||
    n(a.outline) > 0 ||
    hasPixelOps(a) ||
    (!!layer.filter && layer.filter !== 'none') ||
    layer.flipX ||
    layer.flipY ||
    !!validCrop(layer.crop) // recorte no destructivo: se aplica al dibujar
  );
}

// ---------------------------------------------------------------------------
// Operaciones de píxel (puras, sobre arrays tipados; respetan el canal alfa)
// ---------------------------------------------------------------------------

function clampTo01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Temperatura, tinte, luces, sombras, vibrance y posterizado en un solo recorrido.
export function applyColorOps(img: PixelData, a: ImageAdjust) {
  const temp = n(a.temperature);
  const tint = n(a.tint);
  const hi = n(a.highlights);
  const sh = n(a.shadows);
  const vib = n(a.vibrance);
  const post = n(a.posterize);
  const expo = n(a.exposure);
  const hueDeg = n(a.hue);
  const gray = clampTo01(n(a.grayscale) / 100);
  const sep = clampTo01(n(a.sepia) / 100);
  if (!temp && !tint && !hi && !sh && !vib && post <= 0 && !expo && !hueDeg && !gray && !sep) return;
  const expoK = expo ? Math.pow(2, expo / 50) : 1; // ±100 = ±2 pasos de luz
  // Matriz de rotación de tono (la misma que usa CSS hue-rotate).
  const rad = (hueDeg * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  const hm = [
    0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
    0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283,
    0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072,
  ];
  const d = img.data as Uint8ClampedArray;
  const levels = post > 0 ? Math.max(2, Math.round(32 - post * 30)) : 0;
  const step = levels ? 255 / (levels - 1) : 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    if (expo) {
      r *= expoK;
      g *= expoK;
      b *= expoK;
    }
    if (temp || tint) {
      r += temp * 40 + tint * 12;
      b += -temp * 40 + tint * 12;
      g += -tint * 35;
    }
    if (hi || sh) {
      const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const lc = L < 0 ? 0 : L > 1 ? 1 : L;
      const delta = sh * 80 * (1 - lc) * (1 - lc) - hi * 80 * lc * lc;
      r += delta;
      g += delta;
      b += delta;
    }
    if (vib) {
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const satur = mx > 0 ? (mx - mn) / mx : 0;
      const f = 1 + vib * (1 - satur);
      const avg = (r + g + b) / 3;
      r = avg + (r - avg) * f;
      g = avg + (g - avg) * f;
      b = avg + (b - avg) * f;
    }
    if (hueDeg) {
      const r0 = clamp255(r);
      const g0 = clamp255(g);
      const b0 = clamp255(b);
      r = hm[0] * r0 + hm[1] * g0 + hm[2] * b0;
      g = hm[3] * r0 + hm[4] * g0 + hm[5] * b0;
      b = hm[6] * r0 + hm[7] * g0 + hm[8] * b0;
    }
    if (gray) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r += (y - r) * gray;
      g += (y - g) * gray;
      b += (y - b) * gray;
    }
    if (sep) {
      const r0 = clamp255(r);
      const g0 = clamp255(g);
      const b0 = clamp255(b);
      const sr = 0.393 * r0 + 0.769 * g0 + 0.189 * b0;
      const sg = 0.349 * r0 + 0.686 * g0 + 0.168 * b0;
      const sb = 0.272 * r0 + 0.534 * g0 + 0.131 * b0;
      r = r0 + (sr - r0) * sep;
      g = g0 + (sg - g0) * sep;
      b = b0 + (sb - b0) * sep;
    }
    if (levels) {
      r = Math.round(clamp255(r) / step) * step;
      g = Math.round(clamp255(g) / step) * step;
      b = Math.round(clamp255(b) / step) * step;
    }
    d[i] = r; // Uint8ClampedArray satura y redondea
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

// Desenfoque de caja separable O(n) con ventana deslizante (bordes: ventana recortada).
function boxBlur(src: Float32Array, dst: Float32Array, tmp: Float32Array, w: number, h: number, r: number) {
  // horizontal: src -> tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    let cnt = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) {
      sum += src[row + x];
      cnt++;
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / cnt;
      const add = x + r + 1;
      const rem = x - r;
      if (add < w) {
        sum += src[row + add];
        cnt++;
      }
      if (rem >= 0) {
        sum -= src[row + rem];
        cnt--;
      }
    }
  }
  // vertical: tmp -> dst
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let cnt = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) {
      sum += tmp[y * w + x];
      cnt++;
    }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / cnt;
      const add = y + r + 1;
      const rem = y - r;
      if (add < h) {
        sum += tmp[add * w + x];
        cnt++;
      }
      if (rem >= 0) {
        sum -= tmp[rem * w + x];
        cnt--;
      }
    }
  }
}

// Nitidez (unsharp mask sobre luminancia, ponderada por alfa para no crear halos en los bordes).
export function applySharpen(img: PixelData, amount: number, scale = 1) {
  if (amount <= 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const N = w * h;
  const r = Math.max(1, Math.round(1.5 * scale));
  const ya = new Float32Array(N); // luminancia * alfa
  const aa = new Float32Array(N); // alfa
  const lum = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const a = d[i + 3] / 255;
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lum[p] = y;
    ya[p] = y * a;
    aa[p] = a;
  }
  const tmp = new Float32Array(N);
  const yb = new Float32Array(N);
  const ab = new Float32Array(N);
  boxBlur(ya, yb, tmp, w, h, r);
  boxBlur(aa, ab, tmp, w, h, r);
  const k = amount * 1.5;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (d[i + 3] === 0 || ab[p] < 1e-4) continue;
    const blurred = yb[p] / ab[p];
    const delta = (lum[p] - blurred) * k;
    d[i] += delta;
    d[i + 1] += delta;
    d[i + 2] += delta;
  }
}

// Claridad: contraste local (unsharp mask con radio grande sobre luminancia, más fuerte en tonos medios).
export function applyClarity(img: PixelData, amount: number, scale = 1) {
  if (amount <= 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const N = w * h;
  const r = Math.max(2, Math.round(15 * scale));
  const ya = new Float32Array(N);
  const aa = new Float32Array(N);
  const lum = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const a = d[i + 3] / 255;
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lum[p] = y;
    ya[p] = y * a;
    aa[p] = a;
  }
  const tmp = new Float32Array(N);
  const yb = new Float32Array(N);
  const ab = new Float32Array(N);
  boxBlur(ya, yb, tmp, w, h, r);
  boxBlur(aa, ab, tmp, w, h, r);
  const k = (Math.min(100, amount) / 100) * 1.2;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (d[i + 3] === 0 || ab[p] < 1e-4) continue;
    const blurred = yb[p] / ab[p];
    const t = lum[p] / 127.5 - 1;
    const mid = 0.3 + 0.7 * (1 - t * t); // protege negros y blancos
    const delta = (lum[p] - blurred) * k * mid;
    d[i] += delta;
    d[i + 1] += delta;
    d[i + 2] += delta;
  }
}

// Invertir (negativo) y umbral (blanco/negro puro). No tocan el alfa.
export function applyInvertThreshold(img: PixelData, a: ImageAdjust) {
  const inv = a.invert === true;
  const th = n(a.threshold);
  if (!inv && th <= 0) return;
  const d = img.data as Uint8ClampedArray;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    if (inv) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    if (th > 0) {
      const v = 0.299 * r + 0.587 * g + 0.114 * b >= th ? 255 : 0;
      r = g = b = v;
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

// Pixelado: promedia bloques de `size` píxeles (ponderado por alfa).
export function applyPixelate(img: PixelData, size: number) {
  const b = Math.round(size);
  if (b < 2) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  for (let by = 0; by < h; by += b) {
    for (let bx = 0; bx < w; bx += b) {
      const ex = Math.min(bx + b, w);
      const ey = Math.min(by + b, h);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let cnt = 0;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          const a = d[i + 3];
          sr += d[i] * a;
          sg += d[i + 1] * a;
          sb += d[i + 2] * a;
          sa += a;
          cnt++;
        }
      }
      const rr = sa ? sr / sa : 0;
      const gg = sa ? sg / sa : 0;
      const bb = sa ? sb / sa : 0;
      const aa = sa / cnt;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          d[i] = rr;
          d[i + 1] = gg;
          d[i + 2] = bb;
          d[i + 3] = aa;
        }
      }
    }
  }
}

// Viñeta: oscurece los bordes (no toca el alfa).
export function applyVignette(img: PixelData, amount: number) {
  if (amount <= 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const cx = (w - 1) / 2 || 1;
  const cy = (h - 1) / 2 || 1;
  const dx2 = new Float32Array(w);
  for (let x = 0; x < w; x++) dx2[x] = ((x - cx) / cx) ** 2;
  for (let y = 0; y < h; y++) {
    const dy2 = ((y - cy) / cy) ** 2;
    for (let x = 0; x < w; x++) {
      const dist = Math.sqrt((dx2[x] + dy2) / 2); // 0 centro .. 1 esquina
      let t = (dist - 0.35) / 0.65;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const f = 1 - amount * 0.9 * t * t * (3 - 2 * t);
      const i = (y * w + x) * 4;
      d[i] *= f;
      d[i + 1] *= f;
      d[i + 2] *= f;
    }
  }
}

// PRNG determinista (mulberry32): mismo grano en editor y exportación.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Grano de película monocromo con semilla fija.
export function applyGrain(img: PixelData, amount: number) {
  if (amount <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const rnd = mulberry32(0x5eed1234);
  const k = amount * 70;
  for (let i = 0; i < d.length; i += 4) {
    const noise = (rnd() + rnd() - 1) * k; // aprox. triangular/gaussiana
    if (d[i + 3] === 0) continue;
    d[i] += noise;
    d[i + 1] += noise;
    d[i + 2] += noise;
  }
}

// Transformada de distancia euclídea 1D (Felzenszwalb), sobre cuadrados de distancia.
function edt1d(f: Float32Array, n: number, out: Float32Array, v: Int32Array, z: Float32Array, off: number, stride: number) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  const inter = (q: number, p: number) =>
    (f[off + q * stride] + q * q - (f[off + p * stride] + p * p)) / (2 * q - 2 * p);
  for (let q = 1; q < n; q++) {
    let s = inter(q, v[k]);
    while (s <= z[k]) {
      k--;
      s = inter(q, v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    out[off + q * stride] = (q - p) * (q - p) + f[off + p * stride];
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// Contorno tipo sticker: dilata la silueta (alfa) `radius` px y pinta `color` por detrás.
// Queda recortado al tamaño de la imagen.
export function applyOutline(img: PixelData, radius: number, color: string) {
  if (radius <= 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const N = w * h;
  const INF = 1e12;
  const f = new Float32Array(N);
  for (let p = 0; p < N; p++) f[p] = d[p * 4 + 3] >= 128 ? 0 : INF;
  const m = Math.max(w, h);
  const out = new Float32Array(N);
  const v = new Int32Array(m + 1);
  const z = new Float32Array(m + 2);
  for (let x = 0; x < w; x++) edt1d(f, h, out, v, z, x, w); // columnas
  for (let y = 0; y < h; y++) edt1d(out, w, f, v, z, y * w, 1); // filas (resultado en f)
  const [cr, cg, cb] = hexToRgb(color);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const dist = Math.sqrt(f[p]);
    let oa = radius + 0.5 - dist;
    oa = oa < 0 ? 0 : oa > 1 ? 1 : oa;
    if (oa === 0) continue;
    const a = d[i + 3] / 255;
    if (a >= 1) continue;
    const outA = a + oa * (1 - a);
    d[i] = (d[i] * a + cr * oa * (1 - a)) / outA;
    d[i + 1] = (d[i + 1] * a + cg * oa * (1 - a)) / outA;
    d[i + 2] = (d[i + 2] * a + cb * oa * (1 - a)) / outA;
    d[i + 3] = outA * 255;
  }
}

// ---------------------------------------------------------------------------
// Pipeline principal
// ---------------------------------------------------------------------------

// Pasos por píxel (en orden fijo). `weight` = coste relativo para repartir el progreso por tramos;
// `active` decide si el paso cuenta en la barra (los inactivos se ejecutan igual: salen al instante).
export interface PixelStep {
  id: string;
  label: string;
  weight: number;
  active: (a: ImageAdjust) => boolean;
  run: (d: PixelData, a: ImageAdjust, scale: number, sub?: (f: number) => void) => void;
}

export const PIXEL_STEPS: PixelStep[] = [
  { id: 'lens', label: 'Lente', weight: 2, active: (a) => n(a.lensDistortion) !== 0 || n(a.lensVignette) > 0, run: (d, a) => applyLens(d, n(a.lensDistortion), n(a.lensVignette)) },
  { id: 'denoise', label: 'Reducir ruido', weight: 60, active: (a) => n(a.denoise) > 0 || n(a.denoiseColor) > 0, run: (d, a, _s, sub) => applyDenoise(d, n(a.denoise), n(a.denoiseColor), sub) },
  { id: 'dehaze', label: 'Quitar neblina', weight: 10, active: (a) => n(a.dehaze) > 0, run: (d, a, s) => applyDehaze(d, n(a.dehaze), s) },
  { id: 'levels', label: 'Niveles', weight: 1, active: (a) => !isNeutralLevels(a.levels), run: (d, a) => applyLevels(d, a.levels) },
  { id: 'curves', label: 'Curvas', weight: 1, active: (a) => hasCurves(a.curves), run: (d, a) => applyCurves(d, a.curves) },
  {
    id: 'color',
    label: 'Color',
    weight: 2,
    active: (a) =>
      !!(n(a.temperature) || n(a.tint) || n(a.highlights) || n(a.shadows) || n(a.vibrance) || n(a.posterize) > 0 || n(a.exposure) || n(a.hue) || n(a.grayscale) > 0 || n(a.sepia) > 0),
    run: (d, a) => applyColorOps(d, a),
  },
  { id: 'hsl', label: 'HSL', weight: 3, active: (a) => hasHslMix(a.hslMix), run: (d, a) => applyHslMix(d, a.hslMix) },
  { id: 'sharpen', label: 'Nitidez', weight: 4, active: (a) => n(a.sharpen) > 0, run: (d, a, s) => applySharpen(d, n(a.sharpen), s) },
  { id: 'clarity', label: 'Claridad', weight: 4, active: (a) => n(a.clarity) > 0, run: (d, a, s) => applyClarity(d, n(a.clarity), s) },
  { id: 'invert', label: 'Invertir/umbral', weight: 1, active: (a) => a.invert === true || n(a.threshold) > 0, run: (d, a) => applyInvertThreshold(d, a) },
  // --- hook efectos creativos ---
  { id: 'fx', label: 'Efectos', weight: 8, active: (a) => hasImageFx(a.fx), run: (d, a) => applyImageEffects(d, a.fx) },
  { id: 'pixelate', label: 'Pixelar', weight: 1, active: (a) => n(a.pixelate) > 0, run: (d, a, s) => applyPixelate(d, n(a.pixelate) * s) },
  { id: 'vignette', label: 'Viñeta', weight: 1, active: (a) => n(a.vignette) > 0, run: (d, a) => applyVignette(d, n(a.vignette)) },
  { id: 'grain', label: 'Grano', weight: 2, active: (a) => n(a.grain) > 0, run: (d, a) => applyGrain(d, n(a.grain)) },
];

// Ejecuta TODOS los pasos por píxel, en el orden de siempre (idéntico en hilo principal y worker).
// `onProgress(0..1, etiqueta)` informa por tramos; nunca altera los píxeles.
export function runPixelStage(
  data: PixelData,
  adj: ImageAdjust,
  scale: number,
  onProgress?: (fraction: number, label: string) => void,
) {
  const total = PIXEL_STEPS.reduce((acc, st) => acc + (st.active(adj) ? st.weight : 0), 0) || 1;
  let done = 0;
  for (const st of PIXEL_STEPS) {
    const act = st.active(adj);
    if (act) onProgress?.(done / total, st.label);
    const base = done;
    st.run(
      data,
      adj,
      scale,
      act && onProgress ? (f) => onProgress(Math.min(1, (base + st.weight * f) / total), st.label) : undefined,
    );
    if (act) done += st.weight;
  }
  onProgress?.(1, 'Listo');
}

// El contorno va el último (después del duotono) para que conserve su color exacto.
export function runOutlineStage(data: PixelData, adj: ImageAdjust, scale: number) {
  const outline = n(adj.outline) * scale;
  if (outline > 0) applyOutline(data, outline, adj.outlineColor ?? '#ffffff');
}

// ¿Algún efecto necesita el DOM (doble exposición con su imagen precargada)? Entonces los
// píxeles se procesan en el hilo principal: un worker no tiene esa imagen.
export function pixelStageNeedsMain(adj: ImageAdjust): boolean {
  const fx = adj.fx;
  return !!fx && !!fx.dblSrc && n(fx.dblOpacity) > 0;
}

interface BaseStage {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  scale: number;
  adj: ImageAdjust;
  def: ReturnType<typeof getFilter>;
}

// Etapa de canvas: dibuja con filtro CSS, desenfoque, recorte y volteo (rápida, acelerada).
function drawBase(img: CanvasImageSource, layer: ImageLayer, maxSize: number): BaseStage {
  const nw = layer.naturalWidth;
  const nh = layer.naturalHeight;
  const longest = Math.max(nw, nh);
  const scale = longest > maxSize ? maxSize / longest : 1;
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  const adj = layer.adjust ?? DEFAULT_ADJUST;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const def = getFilter(layer.filter);
  const blur = n(adj.blur) * scale;
  ctx.filter = cssFor(def, layer.adjust) + (blur > 0.05 ? ` blur(${blur.toFixed(2)}px)` : '');
  ctx.translate(layer.flipX ? w : 0, layer.flipY ? h : 0);
  ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  // Recorte no destructivo: solo la región visible de la fuente (antes del volteo, que se aplica
  // al trozo). Fracciones × tamaño real de la imagen cargada (vale a cualquier resolución).
  const px = sourcePixels(img);
  const cr = cropPixelRect(layer.crop, px.w, px.h);
  if (cr) ctx.drawImage(img, cr.x, cr.y, cr.w, cr.h, 0, 0, w, h);
  else ctx.drawImage(img, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  return { canvas, ctx, w, h, scale, adj, def };
}

// Devuelve un canvas con filtros, tinte/duotono y volteo ya aplicados (síncrono, hilo principal).
// maxSize limita la resolución (vista previa del editor); en export = Infinity.
export function processImage(
  img: CanvasImageSource,
  layer: ImageLayer,
  maxSize = Infinity,
): HTMLCanvasElement {
  const { canvas, ctx, w, h, scale, adj, def } = drawBase(img, layer, maxSize);

  if (hasPixelOps(adj)) {
    const data = ctx.getImageData(0, 0, w, h);
    // Correcciones de foto primero (geometría, ruido, bruma), luego tono y color.
    runPixelStage(data, adj, scale);
    ctx.putImageData(data, 0, 0);
  }

  // Tinte/duotono se aplican sobre los píxeles ya dibujados.
  applyOverlayDuotone(ctx, w, h, def);

  // El contorno va el último para que conserve su color exacto.
  if (n(adj.outline) * scale > 0) {
    const data = ctx.getImageData(0, 0, w, h);
    runOutlineStage(data, adj, scale);
    ctx.putImageData(data, 0, 0);
  }

  return canvas;
}

// Solo la etapa de canvas (filtro CSS, desenfoque, recorte, volteo y duotono), SIN cálculos por píxel:
// resultado aproximado e inmediato mientras el worker termina el real.
export function processImageBase(img: CanvasImageSource, layer: ImageLayer, maxSize = Infinity): HTMLCanvasElement {
  const { canvas, ctx, w, h, def } = drawBase(img, layer, maxSize);
  applyOverlayDuotone(ctx, w, h, def);
  return canvas;
}

export interface AsyncProcessOpts {
  signal?: AbortSignal;
  onProgress?: (fraction: number, label: string) => void;
  /** 0 = vista previa (prioridad), 1 = exportación. */
  priority?: number;
  /** Etiqueta del trabajo para la barra «Procesando…». */
  label?: string;
}

// Igual que processImage, pero los cálculos por píxel van a un worker (cola, progreso,
// cancelación). Resultado idéntico bit a bit: la misma función `runPixelStage`. Si no hay
// worker (o falla) se hace en el hilo principal.
export async function processImageAsync(
  img: CanvasImageSource,
  layer: ImageLayer,
  maxSize = Infinity,
  opts: AsyncProcessOpts = {},
): Promise<HTMLCanvasElement> {
  const { canvas, ctx, w, h, scale, adj, def } = drawBase(img, layer, maxSize);
  const { signal, onProgress } = opts;
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
  };
  throwIfAborted();
  const pool = getPixelPool();

  const runStage = async (op: 'pixels' | 'outline') => {
    let data = ctx.getImageData(0, 0, w, h);
    const useMain = op === 'pixels' && pixelStageNeedsMain(adj);
    if (!useMain && pool.available() && w * h >= MIN_WORKER_PIXELS) {
      try {
        const out = await pool.run(
          { op, buffer: data.data.buffer as ArrayBuffer, width: w, height: h, adj, scale },
          { signal, onProgress, priority: opts.priority ?? 0, label: opts.label },
        );
        ctx.putImageData(new ImageData(new Uint8ClampedArray(out), w, h), 0, 0);
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        // El worker falló: el canvas conserva los píxeles de partida; se rehace en el principal.
        data = ctx.getImageData(0, 0, w, h);
      }
    }
    throwIfAborted();
    if (op === 'pixels') runPixelStage(data, adj, scale, onProgress);
    else runOutlineStage(data, adj, scale);
    ctx.putImageData(data, 0, 0);
  };

  if (hasPixelOps(adj)) await runStage('pixels');
  throwIfAborted();
  applyOverlayDuotone(ctx, w, h, def);
  if (n(adj.outline) * scale > 0) await runStage('outline');
  return canvas;
}

// ---------------------------------------------------------------------------
// Auto-mejorar y presets
// ---------------------------------------------------------------------------

const round2 = (v: number) => Math.round(v * 100) / 100;
const clampTo = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Analiza el histograma (ignora píxeles casi transparentes) y propone ajustes moderados.
export function autoEnhance(data: PixelData): Partial<ImageAdjust> {
  const d = data.data;
  const total = data.width * data.height;
  const stride = Math.max(1, Math.floor(total / 65536)); // submuestreo
  const hist = new Uint32Array(256);
  let count = 0;
  let sumL = 0;
  let sumR = 0;
  let sumB = 0;
  let sumSat = 0;
  for (let p = 0; p < total; p += stride) {
    const i = p * 4;
    if (d[i + 3] < 16) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const L = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[L]++;
    count++;
    sumL += L;
    sumR += r;
    sumB += b;
    const mx = Math.max(r, g, b);
    sumSat += mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
  }
  if (count === 0) return {};
  const pct = (q: number) => {
    const target = count * q;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i / 255;
    }
    return 1;
  };
  const mean = sumL / count / 255;
  const range = pct(0.98) - pct(0.02);
  const meanSat = sumSat / count;
  const meanR = sumR / count;
  const meanB = sumB / count;

  return {
    brightness: round2(clampTo(1 + (0.46 - mean) * 1.2, 0.7, 1.45)),
    contrast: round2(range < 0.85 ? clampTo(1 + (0.85 - range) * 0.8, 1, 1.35) : 1),
    saturate: round2(meanSat < 0.3 ? clampTo(1 + (0.3 - meanSat) * 1.2, 1, 1.25) : 1),
    temperature: round2(clampTo(((meanB - meanR) / 255) * 1.2, -0.25, 0.25)),
  };
}

export const ADJUST_PRESETS: { id: string; label: string; adjust: Partial<ImageAdjust> }[] = [
  {
    id: 'vivid',
    label: 'Vívido',
    adjust: { contrast: 1.12, saturate: 1.2, vibrance: 0.35, sharpen: 0.3 },
  },
  {
    id: 'warm',
    label: 'Cálido',
    adjust: { temperature: 0.4, tint: 0.05, brightness: 1.03, saturate: 1.05 },
  },
  {
    id: 'cool',
    label: 'Frío',
    adjust: { temperature: -0.4, contrast: 1.05, saturate: 0.95 },
  },
  {
    id: 'bw',
    label: 'Blanco y negro dramático',
    adjust: { saturate: 0, contrast: 1.35, shadows: -0.2, highlights: 0.15, vignette: 0.35, grain: 0.15 },
  },
  {
    id: 'retro',
    label: 'Retro',
    adjust: { saturate: 0.8, temperature: 0.3, tint: 0.1, contrast: 0.92, brightness: 1.05, grain: 0.35, vignette: 0.4 },
  },
  {
    id: 'soft',
    label: 'Suave',
    adjust: { contrast: 0.88, brightness: 1.06, saturate: 0.92, highlights: 0.2, shadows: 0.25, blur: 1 },
  },
  {
    id: 'sharp',
    label: 'Nítido',
    adjust: { sharpen: 0.7, contrast: 1.1, vibrance: 0.15 },
  },
  {
    id: 'bw-pure',
    label: 'Blanco y negro',
    adjust: { grayscale: 100 },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    adjust: { sepia: 100, contrast: 1.05 },
  },
  {
    id: 'negative',
    label: 'Negativo',
    adjust: { invert: true },
  },
  {
    id: 'bw-contrast',
    label: 'Alto contraste B/N',
    adjust: { grayscale: 100, contrast: 1.6, clarity: 30 },
  },
  {
    id: 'poster',
    label: 'Póster',
    adjust: { posterize: 0.75, saturate: 1.3, contrast: 1.15 },
  },
  // Estilos con efectos creativos (ver imageEffects.ts)
  { id: 'comic', label: 'Cómic', adjust: { contrast: 1.1, fx: { sketchMode: 'comic', sketchAmount: 100 } } },
  { id: 'pencil', label: 'Lápiz', adjust: { fx: { sketchMode: 'pencil', sketchAmount: 100 } } },
  { id: 'glitch', label: 'Glitch', adjust: { fx: { glitch: 45, glitchSeed: 7, chroma: 35, chromaAngle: 0 } } },
  {
    id: 'film',
    label: 'Película',
    adjust: {
      temperature: 0.15,
      contrast: 0.95,
      saturate: 0.88,
      vignette: 0.3,
      fx: { texKind: 'film', texAmount: 0.55, texMode: 'overlay', texSeed: 3, glowAmount: 20, glowRadius: 30 },
    },
  },
  {
    id: 'dreamy',
    label: 'Soñador',
    adjust: { brightness: 1.05, contrast: 0.92, saturate: 1.1, fx: { glowAmount: 55, glowRadius: 55 } },
  },
  {
    id: 'pop',
    label: 'Pop art',
    adjust: { saturate: 1.4, contrast: 1.1, fx: { htSize: 16, htAngle: 45, htColor: true } },
  },
  {
    id: 'miniature',
    label: 'Maqueta',
    adjust: { contrast: 1.08, fx: { tiltAmount: 60, tiltPos: 0.5, tiltWidth: 0.22, tiltSat: 45 } },
  },
  {
    id: 'duotone',
    label: 'Duotono',
    adjust: {
      fx: {
        gradMapAmount: 100,
        gradMap: { angle: 0, stops: [{ offset: 0, color: '#0b1a3a' }, { offset: 1, color: '#f5d9a8' }] },
      },
    },
  },
];
