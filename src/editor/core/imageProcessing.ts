import { DEFAULT_ADJUST, type ImageAdjust, type ImageLayer } from './types';
import { applyOverlayDuotone, cssFor, getFilter } from './filters';

// String de filtro CSS (ajustes + filtro con nombre). Lo usan igual editor y export.
export function buildFilterString(layer: ImageLayer): string {
  return cssFor(getFilter(layer.filter), layer.adjust);
}

type PixelData = Pick<ImageData, 'data' | 'width' | 'height'>;

const n = (v: number | undefined, neutral = 0) => (typeof v === 'number' && isFinite(v) ? v : neutral);

// ¿Hay algún ajuste por píxel (no CSS) activo?
function hasPixelOps(a: ImageAdjust): boolean {
  return (
    n(a.temperature) !== 0 ||
    n(a.tint) !== 0 ||
    n(a.highlights) !== 0 ||
    n(a.shadows) !== 0 ||
    n(a.vibrance) !== 0 ||
    n(a.posterize) > 0 ||
    n(a.sharpen) > 0 ||
    n(a.pixelate) > 0 ||
    n(a.vignette) > 0 ||
    n(a.grain) > 0
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
    layer.flipY
  );
}

// ---------------------------------------------------------------------------
// Operaciones de píxel (puras, sobre arrays tipados; respetan el canal alfa)
// ---------------------------------------------------------------------------

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
  if (!temp && !tint && !hi && !sh && !vib && post <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const levels = post > 0 ? Math.max(2, Math.round(32 - post * 30)) : 0;
  const step = levels ? 255 / (levels - 1) : 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
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

// Devuelve un canvas con filtros, tinte/duotono y volteo ya aplicados.
// maxSize limita la resolución (vista previa del editor); en export = Infinity.
export function processImage(
  img: CanvasImageSource,
  layer: ImageLayer,
  maxSize = Infinity,
): HTMLCanvasElement {
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
  ctx.drawImage(img, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';

  if (hasPixelOps(adj)) {
    const data = ctx.getImageData(0, 0, w, h);
    applyColorOps(data, adj);
    applySharpen(data, n(adj.sharpen), scale);
    applyPixelate(data, n(adj.pixelate) * scale);
    applyVignette(data, n(adj.vignette));
    applyGrain(data, n(adj.grain));
    ctx.putImageData(data, 0, 0);
  }

  // Tinte/duotono se aplican sobre los píxeles ya dibujados.
  applyOverlayDuotone(ctx, w, h, def);

  // El contorno va el último para que conserve su color exacto.
  const outline = n(adj.outline) * scale;
  if (outline > 0) {
    const data = ctx.getImageData(0, 0, w, h);
    applyOutline(data, outline, adj.outlineColor ?? '#ffffff');
    ctx.putImageData(data, 0, 0);
  }

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
    id: 'poster',
    label: 'Póster',
    adjust: { posterize: 0.75, saturate: 1.3, contrast: 1.15 },
  },
];
