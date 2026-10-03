// Efectos de color e imagen sobre píxeles (CPU, ImageData). Reutilizan las funciones del editor de diseño
// (src/editor/core: color, curvas, nitidez, pixelado, aberración cromática, glitch, desenfoques) y añaden lo propio
// del video (grano animado, VHS, rayos de luz, espejo, mosaico, croma, preajustes de color). Todo opera sobre
// `{data, width, height}` (RGBA de 8 bits, sin premultiplicar), respeta el alfa y usa aritmética entera y tablas
// (coste de un fotograma 720p: ~3–6 ms por pasada). Las medidas en píxeles se dan para un lado corto de 720 px y se
// escalan con `env.scale`, así vista previa y exportación coinciden.
//
// Los efectos que son una tabla por canal (brillo, contraste, exposición, temperatura, tinte, curvas y el preajuste
// cuando no toca la saturación) se FUSIONAN: varios seguidos en la pila cuestan una sola pasada (`PixelPipe`).
import { applyColorOps, applySharpen, applyPixelate } from '../../editor/core/imageProcessing';
import { applyChromatic, applyGlitch, applyMotionBlur, blurRGBA } from '../../editor/core/imageEffects';
import { curveLuts } from '../../editor/core/curves';
import type { ImageAdjust, ImageFx, ToneCurves } from '../../editor/core/types';
import { activeFx, effectiveParams, lookById, type Look } from './effects';
import type { FxInstance } from '../model/types';

export type Px = Pick<ImageData, 'data' | 'width' | 'height'>;

/** Contexto de cálculo de un efecto. */
export interface PixelEnv {
  /** intensidad bruta del efecto (0..1) */
  k: number;
  /** semilla que cambia con el fotograma (grano, glitch, VHS animados) */
  seed: number;
  /** lado corto / 720 */
  scale: number;
}
export type Q = Record<string, number | string>;
type PixelFn = (img: Px, q: Q, env: PixelEnv) => void;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const n = (q: Q, k: string) => (typeof q[k] === 'number' ? (q[k] as number) : 0);

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

export function hexToRgb(hex: unknown, fallback: [number, number, number] = [255, 255, 255]): [number, number, number] {
  if (typeof hex !== 'string') return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---------------- tablas por canal (fusionables) ----------------

export type Lut3 = [Uint8Array, Uint8Array, Uint8Array];

/** Tablas a partir de una función (valor, canal) → valor; redondea y limita a 0..255. */
export function lutFrom(f: (v: number, c: number) => number): Lut3 {
  const out = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)] as Lut3;
  for (let c = 0; c < 3; c++) for (let v = 0; v < 256; v++) out[c][v] = clamp(Math.round(f(v, c)), 0, 255);
  return out;
}
/** b después de a (cada canal es independiente: la composición de tablas es otra tabla). */
export function composeLut(a: Lut3, b: Lut3): Lut3 {
  const out = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)] as Lut3;
  for (let c = 0; c < 3; c++) for (let v = 0; v < 256; v++) out[c][v] = b[c][a[c][v]];
  return out;
}
export function applyLut(img: Px, l: Lut3) {
  const d = img.data as Uint8ClampedArray;
  const [lr, lg, lb] = l;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = lr[d[i]];
    d[i + 1] = lg[d[i + 1]];
    d[i + 2] = lb[d[i + 2]];
  }
}

/** Curva de tono simple: tres puntos de control (sombras, medios, luces) sobre la diagonal. */
export function curvePoints(sh: number, mid: number, hi: number): ToneCurves {
  const off = (x: number, amt: number) => clamp(x + amt * 60, 0, 255);
  return { rgb: [[0, 0], [64, off(64, sh)], [128, off(128, mid)], [192, off(192, hi)], [255, 255]] };
}

/** Tablas por canal de un preajuste de color (curva de tono + ganancia por canal). */
export function lookTables(l: Look): Lut3 {
  return lutFrom((v, c) => {
    let x = v / 255;
    x = (x - 0.5) * l.con + 0.5 + l.bri;
    x = l.fade + x * (1 - l.fade);
    x = clamp(x, 0, 1);
    if (l.gamma !== 1) x = Math.pow(x, 1 / l.gamma);
    return x * l.gain[c] * 255;
  });
}

/** ¿El preajuste solo necesita tablas por canal (sin saturación, gris ni tinte de sombras/luces)? */
const lookIsLutOnly = (l: Look) => l.sat === 1 && !l.gray && l.sh.every((v) => !v) && l.hi.every((v) => !v);

/** Efectos que son una tabla por canal: devuelven la tabla (o null si no hacen nada con esos parámetros). */
export const LUT_FX: Record<string, (q: Q, env: PixelEnv) => Lut3 | null> = {
  brightness: (q) => (n(q, 'v') ? lutFrom((v) => v + n(q, 'v') * 128) : null),
  contrast: (q) => {
    const v = n(q, 'v');
    if (!v) return null;
    const f = v >= 0 ? 1 + v * 1.5 : 1 + v;
    return lutFrom((x) => (x - 128) * f + 128);
  },
  exposure: (q) => (n(q, 'v') ? lutFrom((x) => x * Math.pow(2, n(q, 'v') * 2)) : null),
  temperature: (q) => {
    const t = n(q, 'v') * 40;
    return t ? lutFrom((x, c) => (c === 0 ? x + t : c === 2 ? x - t : x)) : null;
  },
  tint: (q) => {
    const v = n(q, 'v');
    return v ? lutFrom((x, c) => (c === 0 ? x + v * 12 : c === 1 ? x - v * 35 : x + v * 12)) : null;
  },
  curves: (q) => {
    const l = curveLuts(curvePoints(n(q, 'sh'), n(q, 'mid'), n(q, 'hi')));
    return l ? [l.r, l.g, l.b] : null;
  },
  look: (q, env) => {
    const l = lookById(q.preset);
    if (!lookIsLutOnly(l)) return null;
    const t = lookTables(l);
    return env.k >= 1 ? t : lutFrom((v, c) => v + (t[c][v] - v) * env.k);
  },
};

/** Preajuste con saturación, gris o tinte: pasada entera por píxel (tablas por canal + mezcla de luma + tinte por luma). `mix` 0..1. */
export function applyLook(img: Px, l: Look, mix: number) {
  if (mix <= 0) return;
  const [tr, tg, tb] = lookTables(l);
  const d = img.data as Uint8ClampedArray;
  const satQ = Math.round(l.sat * 256);
  const split = l.sh.some((v) => v) || l.hi.some((v) => v);
  // tinte por luma (0..255) y canal, en enteros
  const tint = [new Int16Array(256), new Int16Array(256), new Int16Array(256)];
  if (split)
    for (let y = 0; y < 256; y++) {
      const u = y / 255;
      for (let c = 0; c < 3; c++) tint[c][y] = Math.round((l.sh[c] * (1 - u) * (1 - u) + l.hi[c] * u * u) * 255);
    }
  const mixQ = Math.round(clamp(mix, 0, 1) * 256);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r0 = d[i];
    const g0 = d[i + 1];
    const b0 = d[i + 2];
    let r: number;
    let g: number;
    let b: number;
    let y: number;
    if (l.gray) {
      y = (77 * r0 + 150 * g0 + 29 * b0) >> 8;
      r = tr[y];
      g = tg[y];
      b = tb[y];
    } else {
      r = tr[r0];
      g = tg[g0];
      b = tb[b0];
      y = (77 * r + 150 * g + 29 * b) >> 8;
      if (satQ !== 256) {
        r = y + (((r - y) * satQ) >> 8);
        g = y + (((g - y) * satQ) >> 8);
        b = y + (((b - y) * satQ) >> 8);
      }
    }
    if (split) {
      r += tint[0][y];
      g += tint[1][y];
      b += tint[2][y];
    }
    if (mixQ < 256) {
      r = r0 + (((r - r0) * mixQ) >> 8);
      g = g0 + (((g - g0) * mixQ) >> 8);
      b = b0 + (((b - b0) * mixQ) >> 8);
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

// ---------------- color por píxel (no son tablas) ----------------

const saturation: PixelFn = (img, q) => {
  const v = n(q, 'v');
  if (!v) return;
  const sQ = Math.round((1 + v) * 256);
  const d = img.data as Uint8ClampedArray;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const y = (77 * d[i] + 150 * d[i + 1] + 29 * d[i + 2]) >> 8;
    d[i] = y + (((d[i] - y) * sQ) >> 8);
    d[i + 1] = y + (((d[i + 1] - y) * sQ) >> 8);
    d[i + 2] = y + (((d[i + 2] - y) * sQ) >> 8);
  }
};

/** Ajustes de color del editor (luces/sombras, vibración, matiz). */
const colorOps = (map: (q: Q) => Partial<ImageAdjust>): PixelFn => (img, q) => applyColorOps(img, map(q) as ImageAdjust);

/** Mapas de viñeta (0..255 por píxel, solo geometría) por tamaño: la fuerza se aplica con una tabla de 256 entradas. */
const vigMaps = new Map<string, Uint8Array>();
function vignetteMap(w: number, h: number): Uint8Array {
  const key = `${w}x${h}`;
  let m = vigMaps.get(key);
  if (m) return m;
  m = new Uint8Array(w * h);
  const cx = (w - 1) / 2 || 1;
  const cy = (h - 1) / 2 || 1;
  const dx2 = new Float32Array(w);
  for (let x = 0; x < w; x++) dx2[x] = ((x - cx) / cx) ** 2;
  for (let y = 0; y < h; y++) {
    const dy2 = ((y - cy) / cy) ** 2;
    for (let x = 0; x < w; x++) {
      const dist = Math.sqrt((dx2[x] + dy2) / 2);
      const t = clamp((dist - 0.35) / 0.65, 0, 1);
      m[y * w + x] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }
  if (vigMaps.size > 6) vigMaps.clear();
  vigMaps.set(key, m);
  return m;
}
/** Viñeta: oscurece los bordes (no toca el alfa). Misma curva que la del editor de diseño. */
export function applyVignetteFast(img: Px, amount: number) {
  if (amount <= 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const map = vignetteMap(w, h);
  const f = new Uint16Array(256);
  for (let s = 0; s < 256; s++) f[s] = Math.round(256 * (1 - amount * 0.9 * (s / 255)));
  for (let p = 0, i = 0; p < map.length; p++, i += 4) {
    const k = f[map[p]];
    if (k === 256) continue;
    d[i] = (d[i] * k) >> 8;
    d[i + 1] = (d[i + 1] * k) >> 8;
    d[i + 2] = (d[i + 2] * k) >> 8;
  }
}
const vignette: PixelFn = (img, q) => applyVignetteFast(img, clamp(n(q, 'v'), 0, 1));

const look: PixelFn = (img, q, env) => applyLook(img, lookById(q.preset), env.k);

// ---------------- imagen ----------------

/**
 * Aplica `op` sobre una copia reducida (factor f, media de bloque) y la amplía (bilineal) sobre la imagen original:
 * para desenfoques el coste baja f² veces y el resultado es el mismo salvo por el redondeo de la ampliación.
 */
export function reduceExpand(img: Px, f: number, op: (small: Px) => Uint8ClampedArray | void) {
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const sw = Math.max(2, Math.round(w / f));
  const sh = Math.max(2, Math.round(h / f));
  const small = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor((y * h) / sh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / sh));
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor((x * w) / sw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / sw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let cnt = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          a += d[i + 3];
          cnt++;
        }
      const o = (y * sw + x) * 4;
      small[o] = r / cnt;
      small[o + 1] = g / cnt;
      small[o + 2] = b / cnt;
      small[o + 3] = a / cnt;
    }
  }
  const res = op({ data: small, width: sw, height: sh }) || small;
  for (let y = 0; y < h; y++) {
    const fy = clamp((y + 0.5) * (sh / h) - 0.5, 0, sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp((x + 0.5) * (sw / w) - 0.5, 0, sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p = res[(y0 * sw + x0) * 4 + c] * (1 - tx) + res[(y0 * sw + x1) * 4 + c] * tx;
        const q = res[(y1 * sw + x0) * 4 + c] * (1 - tx) + res[(y1 * sw + x1) * 4 + c] * tx;
        d[i + c] = p * (1 - ty) + q * ty;
      }
    }
  }
}

/** Desenfoque gaussiano (~): radio en px de salida; con radios grandes se calcula reducido (ver reduceExpand). */
export function applyBlur(img: Px, radius: number) {
  if (radius < 0.5) return;
  const { width: w, height: h } = img;
  const f = radius >= 6 ? Math.min(6, Math.floor(radius / 2)) : 1;
  if (f <= 1) {
    (img.data as Uint8ClampedArray).set(blurRGBA(img.data as Uint8ClampedArray, w, h, radius / 1.6, 3));
    return;
  }
  reduceExpand(img, f, (s) => blurRGBA(s.data as Uint8ClampedArray, s.width, s.height, radius / f / 1.6, 3));
}
const blur: PixelFn = (img, q, env) => applyBlur(img, n(q, 'r') * env.scale);

const motionBlur: PixelFn = (img, q) => {
  if (n(q, 'dist') <= 0) return;
  // el desenfoque de movimiento ya es borroso: se calcula a 1/3 de resolución (9 veces menos coste)
  reduceExpand(img, 3, (s) => applyMotionBlur(s, { motionDist: n(q, 'dist'), motionAngle: n(q, 'angle') } as ImageFx));
};
const sharpen: PixelFn = (img, q, env) => applySharpen(img, clamp(n(q, 'v'), 0, 1), env.scale);
const pixelate: PixelFn = (img, q, env) => applyPixelate(img, n(q, 'size') * env.scale);
const chromatic: PixelFn = (img, q) => applyChromatic(img, n(q, 'v'), n(q, 'angle'));
const glitch: PixelFn = (img, q, env) => applyGlitch(img, n(q, 'v'), env.seed);

/** Tabla de ruido (1 M de entradas, −127..127 aprox. triangular) generada una vez: el grano y el VHS la recorren con un desfase por fotograma. */
let noiseTable: Int8Array | null = null;
const NOISE_BITS = 20;
function noise(): Int8Array {
  if (noiseTable) return noiseTable;
  const t = new Int8Array(1 << NOISE_BITS);
  const rnd = mulberry32(0x5eed1234);
  for (let i = 0; i < t.length; i++) t[i] = Math.round((rnd() + rnd() - 1) * 127);
  noiseTable = t;
  return t;
}

/** Grano de película monocromo que cambia en cada fotograma (la semilla desplaza la lectura de la tabla de ruido). */
export function applyGrainAnimated(img: Px, amount: number, seed: number) {
  if (amount <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const t = noise();
  const mask = t.length - 1;
  const off = Math.imul(seed + 1, 0x9e3779b1) >>> 0;
  const k = Math.round((amount * 70 * 256) / 127);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] === 0) continue;
    const v = (t[(p + off) & mask] * k) >> 8;
    d[i] += v;
    d[i + 1] += v;
    d[i + 2] += v;
  }
}
const grain: PixelFn = (img, q, env) => applyGrainAnimated(img, n(q, 'v'), env.seed);

/** Mosaico: teselas cuadradas del color medio con una junta oscura entre ellas. */
export function applyMosaic(img: Px, size: number, gap: number) {
  const b = Math.round(size);
  if (b < 3) return;
  applyPixelate(img, b);
  const g = Math.max(0, Math.min(b / 2, Math.round(b * gap)));
  if (g < 1) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  for (let y = 0; y < h; y++) {
    const rowGap = y % b < g;
    for (let x = 0; x < w; x++) {
      if (!rowGap && x % b >= g) continue;
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      d[i] *= 0.35;
      d[i + 1] *= 0.35;
      d[i + 2] *= 0.35;
    }
  }
}
const mosaic: PixelFn = (img, q, env) => applyMosaic(img, n(q, 'size') * env.scale, n(q, 'gap'));

/** Espejo: refleja una mitad sobre la otra (o los cuatro cuadrantes). */
export function applyMirror(img: Px, mode: string) {
  const { width: w, height: h } = img;
  const d32 = new Uint32Array((img.data as Uint8ClampedArray).buffer, (img.data as Uint8ClampedArray).byteOffset, w * h);
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  const xs = (x: number) => (mode === 'lr' && x >= w - hw) || (mode === 'quad' && x >= w - hw) ? w - 1 - x : mode === 'rl' && x < hw ? w - 1 - x : x;
  const ys = (y: number) => ((mode === 'tb' || mode === 'quad') && y >= h - hh ? h - 1 - y : mode === 'bt' && y < hh ? h - 1 - y : y);
  for (let y = 0; y < h; y++) {
    const sy = ys(y);
    for (let x = 0; x < w; x++) {
      const sx = xs(x);
      if (sx !== x || sy !== y) d32[y * w + x] = d32[sy * w + sx];
    }
  }
}
const mirror: PixelFn = (img, q) => applyMirror(img, String(q.mode));

/** Ruido VHS: líneas de barrido, sangrado de color, bandas con temblor horizontal y ruido. */
export function applyVhs(img: Px, amount: number, seed: number, scale: number) {
  if (amount <= 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const src = new Uint8ClampedArray(d);
  const rnd = mulberry32(0x77a11 + seed * 104729);
  const t = noise();
  const mask = t.length - 1;
  const off = Math.imul(seed + 7, 0x85ebca6b) >>> 0;
  const nk = Math.round((amount * 60 * 256) / 254);
  const shift = Math.max(1, Math.round(amount * 5 * scale));
  const line = Math.max(2, Math.round(3 * scale));
  const jitter = new Int16Array(h);
  const bands = 2 + Math.round(amount * 4);
  for (let b = 0; b < bands; b++) {
    const y0 = Math.floor(rnd() * h);
    const bh = Math.max(2, Math.round((0.01 + rnd() * 0.05) * h));
    const sh = Math.round((rnd() - 0.5) * amount * 0.1 * w);
    for (let y = y0; y < Math.min(h, y0 + bh); y++) jitter[y] = sh;
  }
  const darkQ = Math.round((1 - 0.28 * amount) * 256);
  for (let y = 0; y < h; y++) {
    const dk = y % line === 0 ? darkQ : 256;
    const jx = jitter[y];
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (src[o + 3] === 0) continue;
      const sx = clamp(x - jx, 0, w - 1);
      const xr = clamp(sx + shift, 0, w - 1);
      const xb = clamp(sx - shift, 0, w - 1);
      const nz = (t[(y * w + x + off) & mask] * nk) >> 8;
      d[o] = ((src[(y * w + xr) * 4] + nz) * dk) >> 8;
      d[o + 1] = ((src[(y * w + sx) * 4 + 1] + nz) * dk) >> 8;
      d[o + 2] = ((src[(y * w + xb) * 4 + 2] + nz) * dk) >> 8;
    }
  }
}
const vhs: PixelFn = (img, q, env) => applyVhs(img, clamp(n(q, 'v'), 0, 1), env.seed, env.scale);

/**
 * Rayos de luz: lo claro (por encima de `thr`) se estira radialmente desde (cx, cy) y se suma. Se calcula en una copia
 * a 1/4 de resolución (coste 16 veces menor) y se muestrea con interpolación bilineal.
 */
export function applyRays(img: Px, amount: number, cx: number, cy: number, thr: number) {
  if (amount <= 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const sw = Math.max(8, Math.round(w / 4));
  const sh = Math.max(8, Math.round(h / 4));
  const small = new Float32Array(sw * sh * 3);
  const t0 = thr * 255;
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / sh));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / sw));
      const i = (sy * w + sx) * 4;
      if (d[i + 3] === 0) continue;
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const k = l > t0 ? (l - t0) / Math.max(1, 255 - t0) : 0;
      const o = (y * sw + x) * 3;
      small[o] = d[i] * k;
      small[o + 1] = d[i + 1] * k;
      small[o + 2] = d[i + 2] * k;
    }
  }
  const N = 24;
  const ox = cx * sw;
  const oy = cy * sh;
  const rays = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let s = 0; s < N; s++) {
        const f = (s / (N - 1)) * 0.85;
        const px = clamp(Math.round(x + (ox - x) * f), 0, sw - 1);
        const py = clamp(Math.round(y + (oy - y) * f), 0, sh - 1);
        const o = (py * sw + px) * 3;
        const wgt = 1 - s / N;
        r += small[o] * wgt;
        g += small[o + 1] * wgt;
        b += small[o + 2] * wgt;
      }
      const o = (y * sw + x) * 3;
      rays[o] = r / (N * 0.5);
      rays[o + 1] = g / (N * 0.5);
      rays[o + 2] = b / (N * 0.5);
    }
  for (let y = 0; y < h; y++) {
    const fy = clamp((y + 0.5) * (sh / h) - 0.5, 0, sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const fx = clamp((x + 0.5) * (sw / w) - 0.5, 0, sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = rays[(y0 * sw + x0) * 3 + c] * (1 - tx) + rays[(y0 * sw + x1) * 3 + c] * tx;
        const b = rays[(y1 * sw + x0) * 3 + c] * (1 - tx) + rays[(y1 * sw + x1) * 3 + c] * tx;
        d[i + c] += (a * (1 - ty) + b * ty) * amount;
      }
    }
  }
}
const rays: PixelFn = (img, q) => applyRays(img, clamp(n(q, 'v'), 0, 1), n(q, 'cx'), n(q, 'cy'), n(q, 'thr'));

// ---------------- croma ----------------

/** Plano de color (Cb, Cr) de un RGB (reales, para la tabla). */
const chromaVec = (r: number, g: number, b: number): [number, number] => [-0.169 * r - 0.331 * g + 0.5 * b, 0.5 * r - 0.419 * g - 0.081 * b];

/**
 * Clave de color. Se compara la TONALIDAD (ángulo en el plano Cb/Cr) y no la distancia, para que un verde apagado o
 * en sombra también se quite; los grises (sin color) se conservan. `tol` 0..1 → 0..90° y `soft` 0..1 → 0..90° de
 * transición. `spill` quita el reflejo del color del fondo en los bordes y en el pelo. La decisión por píxel sale de
 * una tabla de 128×128 celdas sobre (Cb, Cr) calculada una vez por llamada. `mix` (0..1) = intensidad del efecto.
 */
export function applyChromaKey(img: Px, key: [number, number, number], tol: number, soft: number, spill: number, mix = 1) {
  const [kc, kr] = chromaVec(key[0], key[1], key[2]);
  const kMag = Math.hypot(kc, kr);
  if (kMag < 1) return; // el color a quitar no tiene tono (gris): nada que hacer
  const kAng = Math.atan2(kr, kc);
  const tolA = (clamp(tol, 0, 1) * 90 * Math.PI) / 180;
  const softA = Math.max(1e-4, (clamp(soft, 0, 1) * 90 * Math.PI) / 180);
  // tabla: fracción que se CONSERVA (0..256) por celda (cb, cr) de 2 unidades
  const keep = new Uint16Array(128 * 128);
  for (let ib = 0; ib < 128; ib++)
    for (let ir = 0; ir < 128; ir++) {
      const cb = ib * 2 - 128 + 1;
      const cr = ir * 2 - 128 + 1;
      let diff = Math.abs(Math.atan2(cr, cb) - kAng);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      let kp = smooth(clamp((diff - tolA) / softA, 0, 1));
      const colorful = smooth(clamp((Math.hypot(cb, cr) - 2) / 10, 0, 1));
      kp = 1 - colorful * (1 - kp);
      keep[ib * 128 + ir] = Math.round(256 * (1 - (1 - kp) * mix));
    }
  const d = img.data as Uint8ClampedArray;
  const dom = key[1] >= key[0] && key[1] >= key[2] ? 1 : key[2] >= key[0] && key[2] >= key[1] ? 2 : 0;
  const sp = clamp(spill, 0, 1) * mix;
  for (let i = 0; i < d.length; i += 4) {
    const a0 = d[i + 3];
    if (a0 === 0) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const cb = (-43 * r - 85 * g + 128 * b) >> 8;
    const cr = (128 * r - 107 * g - 21 * b) >> 8;
    const k = keep[((cb + 128) >> 1) * 128 + ((cr + 128) >> 1)];
    d[i + 3] = (a0 * k) >> 8;
    if (sp > 0 && k > 0) {
      const others = dom === 0 ? (g > b ? g : b) : dom === 1 ? (r > b ? r : b) : r > g ? r : g;
      const cur = dom === 0 ? r : dom === 1 ? g : b;
      if (cur > others) d[i + dom] = cur - (cur - others) * sp;
    }
  }
}
const chroma: PixelFn = (img, q, env) => applyChromaKey(img, hexToRgb(q.color, [0, 255, 0]), n(q, 'tol'), n(q, 'soft'), n(q, 'spill'), env.k);

/** Efectos de píxel por tipo. Los de lienzo (máscara, borde, sombra) los resuelve fxDraw.ts. */
export const PIXEL_FX: Record<string, PixelFn> = {
  saturation,
  lights: colorOps((q) => ({ highlights: n(q, 'hi'), shadows: n(q, 'sh') })),
  vibrance: colorOps((q) => ({ vibrance: n(q, 'v') })),
  hue: colorOps((q) => ({ hue: n(q, 'v') })),
  vignette,
  look,
  blur,
  motionBlur,
  sharpen,
  pixelate,
  mosaic,
  grain,
  chromatic,
  glitch,
  mirror,
  vhs,
  rays,
  chroma,
  // los de tabla por canal también existen como pasada suelta (se usan si no se fusionan)
  brightness: (img, q, env) => runLut('brightness', img, q, env),
  contrast: (img, q, env) => runLut('contrast', img, q, env),
  exposure: (img, q, env) => runLut('exposure', img, q, env),
  temperature: (img, q, env) => runLut('temperature', img, q, env),
  tint: (img, q, env) => runLut('tint', img, q, env),
  curves: (img, q, env) => runLut('curves', img, q, env),
};
function runLut(type: string, img: Px, q: Q, env: PixelEnv) {
  const l = LUT_FX[type](q, env);
  if (l) applyLut(img, l);
}

/**
 * Pila de efectos de píxel sobre un ImageData, en orden. Los efectos que son una tabla por canal y van seguidos se
 * funden en una sola tabla (una pasada por todos); cualquier otro efecto corta la fusión. `skip`: tipos que no se
 * ejecutan aquí (los de lienzo).
 */
export class PixelPipe {
  private lut: Lut3 | null = null;
  constructor(
    private img: Px,
    private env: { seed: number; scale: number },
  ) {}
  apply(fx: FxInstance) {
    const q = effectiveParams(fx);
    const env: PixelEnv = { k: fx.amount, seed: this.env.seed, scale: this.env.scale };
    const lutFn: ((q: Q, env: PixelEnv) => Lut3 | null) | undefined = LUT_FX[fx.type];
    if (lutFn) {
      const l = lutFn(q, env);
      if (l) {
        this.lut = this.lut ? composeLut(this.lut, l) : l;
        return;
      }
      if (fx.type !== 'look') return; // tabla neutra: no hace nada
    }
    this.flush();
    const fn: PixelFn | undefined = PIXEL_FX[fx.type];
    if (fn) fn(this.img, q, env); // (los tipos de tabla ya volvieron arriba salvo «look» sin tabla pura)
  }
  /** Aplica la tabla fusionada pendiente (hay que llamarlo antes de leer o de cambiar de tipo de operación). */
  flush() {
    if (this.lut) {
      applyLut(this.img, this.lut);
      this.lut = null;
    }
  }
}

/** Aplica en orden solo los efectos de píxel (los de lienzo —máscara, borde, sombra— se saltan). */
export function runPixelList(img: Px, list: readonly FxInstance[], seed: number, scale = 1, skip: ReadonlySet<string> = new Set()): void {
  const pipe = new PixelPipe(img, { seed, scale });
  for (const fx of activeFx(list)) if (!skip.has(fx.type)) pipe.apply(fx);
  pipe.flush();
}
