// Efectos creativos y retoque de imagen: tilt-shift, desenfoques de movimiento / radial / zoom,
// aberración cromática, glitch, halftone, lápiz y cómic, doble exposición, texturas, ojos rojos,
// suavizar piel, mapa de degradado y resplandor.
//
// Funciones puras sobre ImageData (respetan el alfa); las llama processImage UNA vez
// (applyImageEffects), así lienzo, PNG/JPG y SVG dan el mismo resultado. Todas las distancias
// son relativas al lado mayor de la imagen (la vista previa y la exportación coinciden) y los
// desenfoques usan acumuladores deslizantes: coste lineal, radios acotados.
import type { FxBlend, ImageAdjust, ImageFx } from './types';
import { parseColor } from './gradients';
import { generateTexture } from './proceduralTextures';
import type { Gradient } from './types';

type PixelData = Pick<ImageData, 'data' | 'width' | 'height'>;

const num = (v: number | undefined, neutral = 0) => (typeof v === 'number' && isFinite(v) ? v : neutral);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const smooth = (t: number) => t * t * (3 - 2 * t);

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

// ---------------------------------------------------------------------------
// ¿Hay algún efecto activo?
// ---------------------------------------------------------------------------

export function hasImageFx(fx: ImageFx | undefined): boolean {
  if (!fx) return false;
  return (
    num(fx.tiltAmount) > 0 ||
    num(fx.tiltSat) > 0 ||
    num(fx.motionDist) > 0 ||
    num(fx.radialAmount) > 0 ||
    num(fx.zoomAmount) > 0 ||
    num(fx.chroma) > 0 ||
    num(fx.glitch) > 0 ||
    num(fx.htSize) > 0 ||
    num(fx.sketchAmount) > 0 ||
    (!!fx.dblSrc && num(fx.dblOpacity) > 0) ||
    num(fx.texAmount) > 0 ||
    (fx.redEyes?.length ?? 0) > 0 ||
    num(fx.skin) > 0 ||
    (!!fx.gradMap && num(fx.gradMapAmount) > 0) ||
    num(fx.glowAmount) > 0
  );
}

// ---------------------------------------------------------------------------
// Desenfoque de caja separable sobre RGBA de 8 bits (premultiplicado), en tiempo lineal
// ---------------------------------------------------------------------------

function toPremult(d: Uint8ClampedArray): Uint8ClampedArray {
  const o = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) {
      o[i] = d[i];
      o[i + 1] = d[i + 1];
      o[i + 2] = d[i + 2];
    } else if (a > 0) {
      const k = a / 255;
      o[i] = d[i] * k;
      o[i + 1] = d[i + 1] * k;
      o[i + 2] = d[i + 2] * k;
    }
    o[i + 3] = a;
  }
  return o;
}

function fromPremult(pm: Uint8ClampedArray, d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const a = pm[i + 3];
    if (a === 255) {
      d[i] = pm[i];
      d[i + 1] = pm[i + 1];
      d[i + 2] = pm[i + 2];
    } else if (a > 0) {
      const k = 255 / a;
      d[i] = pm[i] * k;
      d[i + 1] = pm[i + 1] * k;
      d[i + 2] = pm[i + 2] * k;
    } else {
      d[i] = d[i + 1] = d[i + 2] = 0;
    }
    d[i + 3] = a;
  }
}

function boxH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const base = y * w * 4;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let i = -r; i <= r; i++) {
      const p = base + clamp(i, 0, w - 1) * 4;
      s0 += src[p];
      s1 += src[p + 1];
      s2 += src[p + 2];
      s3 += src[p + 3];
    }
    for (let x = 0; x < w; x++) {
      const o = base + x * 4;
      dst[o] = s0 * k;
      dst[o + 1] = s1 * k;
      dst[o + 2] = s2 * k;
      dst[o + 3] = s3 * k;
      const a = base + Math.min(x + r + 1, w - 1) * 4;
      const b = base + Math.max(x - r, 0) * 4;
      s0 += src[a] - src[b];
      s1 += src[a + 1] - src[b + 1];
      s2 += src[a + 2] - src[b + 2];
      s3 += src[a + 3] - src[b + 3];
    }
  }
}

function boxV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  const k = 1 / (2 * r + 1);
  const row = w * 4;
  const sums = new Float32Array(row);
  for (let i = -r; i <= r; i++) {
    const p = clamp(i, 0, h - 1) * row;
    for (let j = 0; j < row; j++) sums[j] += src[p + j];
  }
  for (let y = 0; y < h; y++) {
    const o = y * row;
    for (let j = 0; j < row; j++) dst[o + j] = sums[j] * k;
    const a = Math.min(y + r + 1, h - 1) * row;
    const b = Math.max(y - r, 0) * row;
    for (let j = 0; j < row; j++) sums[j] += src[a + j] - src[b + j];
  }
}

// Desenfoque ~gaussiano (2 pasadas de caja) de un buffer RGBA de 8 bits; devuelve uno nuevo.
export function blurRGBA(src: Uint8ClampedArray, w: number, h: number, radius: number, passes = 2): Uint8ClampedArray {
  const r = Math.max(1, Math.round(radius));
  let a = new Uint8ClampedArray(src);
  let b = new Uint8ClampedArray(src.length);
  for (let p = 0; p < passes; p++) {
    boxH(a, b, w, h, r);
    boxV(b, a, w, h, r);
  }
  return a;
}

// ---------------------------------------------------------------------------
// Tilt-shift
// ---------------------------------------------------------------------------

export function applyTiltShift(img: PixelData, fx: ImageFx) {
  const amount = num(fx.tiltAmount);
  const satK = num(fx.tiltSat) / 100;
  const d = img.data as Uint8ClampedArray;
  const { width: w, height: h } = img;
  const longest = Math.max(w, h);

  if (amount > 0) {
    const rMax = clamp((amount / 100) * 0.03 * longest, 0, 70);
    if (rMax >= 1) {
      const vertical = fx.tiltVertical === true;
      const dim = vertical ? w : h;
      const pos = clamp(num(fx.tiltPos, 0.5), 0, 1) * dim;
      const half = (clamp(num(fx.tiltWidth, 0.25), 0, 1) * dim) / 2;
      const fall = Math.max(1, 0.3 * dim);
      const pm = toPremult(d);
      const L = 3;
      const lv = [pm];
      for (let k = 1; k <= L; k++) lv.push(blurRGBA(pm, w, h, (rMax * k) / L, 2));
      const out = new Uint8ClampedArray(pm.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const t = smooth(clamp((Math.abs((vertical ? x : y) + 0.5 - pos) - half) / fall, 0, 1)) * L;
          const i0 = Math.min(L - 1, Math.floor(t));
          const f = t - i0;
          const A = lv[i0];
          const B = lv[i0 + 1];
          const o = (y * w + x) * 4;
          out[o] = A[o] + (B[o] - A[o]) * f;
          out[o + 1] = A[o + 1] + (B[o + 1] - A[o + 1]) * f;
          out[o + 2] = A[o + 2] + (B[o + 2] - A[o + 2]) * f;
          out[o + 3] = A[o + 3] + (B[o + 3] - A[o + 3]) * f;
        }
      }
      fromPremult(out, d);
    }
  }

  if (satK > 0) {
    const s = 1 + satK * 0.8;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const l = lum(d[i], d[i + 1], d[i + 2]);
      d[i] = l + (d[i] - l) * s;
      d[i + 1] = l + (d[i + 1] - l) * s;
      d[i + 2] = l + (d[i + 2] - l) * s;
    }
  }
}

// ---------------------------------------------------------------------------
// Desenfoques de movimiento, radial y zoom (muestreo a lo largo de un vector)
// ---------------------------------------------------------------------------

type DirMode = 'motion' | 'radial' | 'zoom';

function directionalBlur(img: PixelData, mode: DirMode, amount: number, angleDeg: number, cx01: number, cy01: number) {
  const d = img.data as Uint8ClampedArray;
  const { width: w, height: h } = img;
  const longest = Math.max(w, h);
  const pm = toPremult(d);
  const out = new Uint8ClampedArray(pm.length);
  const N = 15; // muestras por píxel (tope fijo: coste O(n·N))
  const cx = cx01 * w;
  const cy = cy01 * h;
  const ang = (angleDeg * Math.PI) / 180;
  const L = (amount / 100) * 0.12 * longest; // distancia de movimiento
  const mx = Math.cos(ang) * L;
  const my = Math.sin(ang) * L;
  const zoomK = (amount / 100) * 0.35;
  const spin = (amount / 100) * 0.3; // radianes
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let vx: number;
      let vy: number;
      if (mode === 'motion') {
        vx = mx;
        vy = my;
      } else if (mode === 'zoom') {
        vx = (cx - x) * zoomK;
        vy = (cy - y) * zoomK;
      } else {
        vx = -(y - cy) * spin;
        vy = (x - cx) * spin;
      }
      const o = (y * w + x) * 4;
      if (vx * vx + vy * vy < 0.25) {
        out[o] = pm[o];
        out[o + 1] = pm[o + 1];
        out[o + 2] = pm[o + 2];
        out[o + 3] = pm[o + 3];
        continue;
      }
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let k = 0; k < N; k++) {
        const t = k / (N - 1) - 0.5;
        const sx = clamp(Math.round(x + vx * t), 0, w - 1);
        const sy = clamp(Math.round(y + vy * t), 0, h - 1);
        const p = (sy * w + sx) * 4;
        s0 += pm[p];
        s1 += pm[p + 1];
        s2 += pm[p + 2];
        s3 += pm[p + 3];
      }
      out[o] = s0 / N;
      out[o + 1] = s1 / N;
      out[o + 2] = s2 / N;
      out[o + 3] = s3 / N;
    }
  }
  fromPremult(out, d);
}

export function applyMotionBlur(img: PixelData, fx: ImageFx) {
  const a = num(fx.motionDist);
  if (a > 0) directionalBlur(img, 'motion', a, num(fx.motionAngle), 0.5, 0.5);
}
export function applyRadialBlur(img: PixelData, fx: ImageFx) {
  const a = num(fx.radialAmount);
  if (a > 0) directionalBlur(img, 'radial', a, 0, clamp(num(fx.blurCx, 0.5), 0, 1), clamp(num(fx.blurCy, 0.5), 0, 1));
}
export function applyZoomBlur(img: PixelData, fx: ImageFx) {
  const a = num(fx.zoomAmount);
  if (a > 0) directionalBlur(img, 'zoom', a, 0, clamp(num(fx.blurCx, 0.5), 0, 1), clamp(num(fx.blurCy, 0.5), 0, 1));
}

// ---------------------------------------------------------------------------
// Aberración cromática y glitch
// ---------------------------------------------------------------------------

export function applyChromatic(img: PixelData, amount: number, angleDeg: number) {
  if (amount <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const { width: w, height: h } = img;
  const shift = (amount / 100) * 0.02 * Math.max(w, h);
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.round(Math.cos(a) * shift);
  const dy = Math.round(Math.sin(a) * shift);
  if (dx === 0 && dy === 0) return;
  const src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const pr = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4;
      const pb = (clamp(y - dy, 0, h - 1) * w + clamp(x - dx, 0, w - 1)) * 4;
      d[o] = src[pr];
      d[o + 2] = src[pb + 2];
    }
  }
}

// Bandas horizontales desplazadas y con canales separados; determinista por semilla.
export function applyGlitch(img: PixelData, intensity: number, seed: number) {
  if (intensity <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const { width: w, height: h } = img;
  const k = clamp(intensity, 0, 100) / 100;
  const rnd = mulberry32((seed | 0) * 2654435761 + 0x9e3779b9);
  const src = new Uint8ClampedArray(d);
  const bands = Math.round(3 + k * 14);
  for (let b = 0; b < bands; b++) {
    const y0 = Math.floor(rnd() * h);
    const bh = Math.max(1, Math.round((0.004 + rnd() * 0.05) * h * (0.4 + k)));
    const shift = Math.round((rnd() - 0.5) * 2 * k * 0.3 * w);
    const split = Math.round((rnd() - 0.5) * k * 0.04 * w);
    for (let y = y0; y < Math.min(h, y0 + bh); y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const xr = (((x - shift - split) % w) + w) % w;
        const xg = (((x - shift) % w) + w) % w;
        const xb = (((x - shift + split) % w) + w) % w;
        const row = y * w;
        d[o] = src[(row + xr) * 4];
        d[o + 1] = src[(row + xg) * 4 + 1];
        d[o + 2] = src[(row + xb) * 4 + 2];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Halftone (trama de medios tonos)
// ---------------------------------------------------------------------------

export function applyHalftone(img: PixelData, size: number, angleDeg: number, color: boolean) {
  if (size <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const { width: w, height: h } = img;
  const cell = Math.max(3, (size * Math.max(w, h)) / 600);
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const src = new Uint8ClampedArray(d);
  const q = cell * 0.25;
  const samp = (u: number, v: number, c: number) => {
    // (u,v) en espacio de la trama → píxel
    const x = clamp(Math.round(u * ca - v * sa), 0, w - 1);
    const y = clamp(Math.round(u * sa + v * ca), 0, h - 1);
    return src[(y * w + x) * 4 + c];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (src[o + 3] === 0) continue;
      const u = x * ca + y * sa;
      const v = -x * sa + y * ca;
      const iu = Math.floor(u / cell);
      const iv = Math.floor(v / cell);
      const cu = (iu + 0.5) * cell;
      const cv = (iv + 0.5) * cell;
      let r = 0;
      let g = 0;
      let b = 0;
      const pts: [number, number][] = [
        [cu, cv],
        [cu - q, cv - q],
        [cu + q, cv - q],
        [cu - q, cv + q],
        [cu + q, cv + q],
      ];
      for (const [pu, pv] of pts) {
        r += samp(pu, pv, 0);
        g += samp(pu, pv, 1);
        b += samp(pu, pv, 2);
      }
      r /= 5;
      g /= 5;
      b /= 5;
      const dark = 1 - lum(r, g, b) / 255;
      const rad = cell * 0.72 * Math.sqrt(dark);
      const dist = Math.hypot(u - cu, v - cv);
      const cover = clamp(rad - dist + 0.5, 0, 1); // borde antialias
      if (color) {
        // Puntos del color de la celda, saturados, sobre papel blanco.
        const l = lum(r, g, b);
        const pr = clamp(l + (r - l) * 1.25, 0, 255);
        const pg = clamp(l + (g - l) * 1.25, 0, 255);
        const pb = clamp(l + (b - l) * 1.25, 0, 255);
        d[o] = 255 + (pr * 0.85 - 255) * cover;
        d[o + 1] = 255 + (pg * 0.85 - 255) * cover;
        d[o + 2] = 255 + (pb * 0.85 - 255) * cover;
      } else {
        const v8 = 255 - 235 * cover;
        d[o] = d[o + 1] = d[o + 2] = v8;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Lápiz y cómic
// ---------------------------------------------------------------------------

// Magnitud de Sobel (0..1) sobre luminancia, muestreando a distancia `t` (más grueso).
function edgeMap(L: Uint8Array, w: number, h: number, t: number): Float32Array {
  const out = new Float32Array(w * h);
  const at = (x: number, y: number) => L[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = at(x - t, y - t);
      const b = at(x, y - t);
      const c = at(x + t, y - t);
      const dd = at(x - t, y);
      const f = at(x + t, y);
      const g = at(x - t, y + t);
      const hh = at(x, y + t);
      const i = at(x + t, y + t);
      const gx = c + 2 * f + i - a - 2 * dd - g;
      const gy = g + 2 * hh + i - a - 2 * b - c;
      out[y * w + x] = Math.min(1, Math.hypot(gx, gy) / 1020);
    }
  }
  return out;
}

export function applySketch(img: PixelData, mode: 'pencil' | 'comic', amount: number) {
  if (amount <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const { width: w, height: h } = img;
  const longest = Math.max(w, h);
  const mix = clamp(amount, 0, 100) / 100;
  const L = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) L[p] = lum(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);

  if (mode === 'pencil') {
    const edges = edgeMap(L, w, h, Math.max(1, Math.round(longest / 1200)));
    const per = Math.max(3, Math.round(longest / 220));
    const lw = Math.max(1, Math.round(per / 3));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const o = p * 4;
        if (d[o + 3] === 0) continue;
        const dark = 1 - L[p] / 255;
        const e = clamp(edges[p] * 3.2, 0, 1);
        let hatch = 0;
        if (dark > 0.25 && (x + y) % per < lw) hatch += 0.45 * smooth(clamp((dark - 0.25) / 0.2, 0, 1));
        if (dark > 0.5 && (x - y + h * 4) % per < lw) hatch += 0.4 * smooth(clamp((dark - 0.5) / 0.2, 0, 1));
        if (dark > 0.72 && y % per < lw) hatch += 0.4 * smooth(clamp((dark - 0.72) / 0.15, 0, 1));
        const ink = Math.min(1, e + hatch);
        const pr = 246 + (38 - 246) * ink;
        const pg = 243 + (38 - 243) * ink;
        const pb = 235 + (42 - 235) * ink;
        d[o] += (pr - d[o]) * mix;
        d[o + 1] += (pg - d[o + 1]) * mix;
        d[o + 2] += (pb - d[o + 2]) * mix;
      }
    }
    return;
  }

  // Cómic: colores planos (posterizado) + contorno grueso negro.
  const edges = edgeMap(L, w, h, Math.max(1, Math.round(longest / 700)));
  const levels = 4;
  const qz = (c: number) => Math.round((clamp((c - 128) * 1.12 + 128, 0, 255) / 255) * (levels - 1)) * (255 / (levels - 1));
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    if (d[o + 3] === 0) continue;
    const ink = smooth(clamp((edges[p] - 0.1) / 0.18, 0, 1));
    const l = lum(d[o], d[o + 1], d[o + 2]);
    const sat = 1.3;
    const r = qz(clamp(l + (d[o] - l) * sat, 0, 255)) * (1 - ink) + 18 * ink;
    const g = qz(clamp(l + (d[o + 1] - l) * sat, 0, 255)) * (1 - ink) + 18 * ink;
    const b = qz(clamp(l + (d[o + 2] - l) * sat, 0, 255)) * (1 - ink) + 22 * ink;
    d[o] += (r - d[o]) * mix;
    d[o + 1] += (g - d[o + 1]) * mix;
    d[o + 2] += (b - d[o + 2]) * mix;
  }
}

// ---------------------------------------------------------------------------
// Mezclas (compartidas por la doble exposición y las texturas)
// ---------------------------------------------------------------------------

function blendCh(a: number, b: number, mode: FxBlend): number {
  switch (mode) {
    case 'multiply':
      return a * b;
    case 'screen':
      return 1 - (1 - a) * (1 - b);
    case 'softlight':
      return (1 - 2 * b) * a * a + 2 * b * a;
    default:
      return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
  }
}

// Mezcla `ov` (RGBA del mismo tamaño que la imagen) sobre `img`.
export function blendPixels(img: PixelData, ov: Uint8ClampedArray, mode: FxBlend, opacity: number) {
  const k = clamp(opacity, 0, 1);
  if (k <= 0) return;
  const d = img.data as Uint8ClampedArray;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      const a = d[i + c] / 255;
      const b = ov[i + c] / 255;
      d[i + c] = (a + (blendCh(a, b, mode) - a) * k) * 255;
    }
  }
}

// Cambia de tamaño un buffer RGBA con interpolación bilinear.
function resizeRGBA(src: Uint8ClampedArray, sw: number, sh: number, w: number, h: number): Uint8ClampedArray {
  if (sw === w && sh === h) return src;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const fy = h > 1 ? (y * (sh - 1)) / (h - 1) : 0;
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = w > 1 ? (x * (sw - 1)) / (w - 1) : 0;
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[(y0 * sw + x0) * 4 + c] * (1 - tx) + src[(y0 * sw + x1) * 4 + c] * tx;
        const bot = src[(y1 * sw + x0) * 4 + c] * (1 - tx) + src[(y1 * sw + x1) * 4 + c] * tx;
        out[o + c] = top * (1 - ty) + bot * ty;
      }
    }
  }
  return out;
}

// Texturas procedurales: se generan a ≤1024 px y se escalan (una entrada de caché).
let texCache: { key: string; data: Uint8ClampedArray; w: number; h: number } | null = null;
export function applyTexture(img: PixelData, fx: ImageFx) {
  const amount = num(fx.texAmount);
  if (amount <= 0) return;
  const kind = fx.texKind ?? 'paper';
  const mode = fx.texMode ?? 'overlay';
  const seed = Math.round(num(fx.texSeed, 1));
  const scale = clamp(num(fx.texScale, 1), 0.5, 3);
  const { width: w, height: h } = img;
  const k = Math.min(1, 1024 / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * k));
  const th = Math.max(1, Math.round(h * k));
  const key = `${kind}|${seed}|${scale}|${tw}x${th}`;
  if (!texCache || texCache.key !== key) texCache = { key, data: generateTexture(kind, tw, th, seed, scale), w: tw, h: th };
  blendPixels(img, resizeRGBA(texCache.data, tw, th, w, h), mode, amount);
}

// ---------------------------------------------------------------------------
// Doble exposición (la segunda imagen llega por caché precargada)
// ---------------------------------------------------------------------------

const fxImages = new Map<string, HTMLImageElement>();

// Precarga las imágenes que necesitan los efectos (doble exposición). Llamar antes de
// processImage en rutas asíncronas (exportación) para que el resultado sea idéntico.
export function preloadFxImages(adj: ImageAdjust | undefined): Promise<void> {
  const src = adj?.fx?.dblSrc;
  if (!src || fxImages.has(src) || typeof Image === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const el = new Image();
    el.onload = () => {
      if (fxImages.size > 8) fxImages.clear();
      fxImages.set(src, el);
      resolve();
    };
    el.onerror = () => resolve();
    el.src = src;
  });
}

export function fxImagesReady(adj: ImageAdjust | undefined): boolean {
  const src = adj?.fx?.dblSrc;
  return !src || fxImages.has(src);
}

// Reduce una imagen a ≤ maxSide y la devuelve como dataURL JPEG (para guardarla en el ajuste).
export function shrinkToDataUrl(src: string, maxSide = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => {
      const k = Math.min(1, maxSide / Math.max(el.naturalWidth, el.naturalHeight, 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(el.naturalWidth * k));
      c.height = Math.max(1, Math.round(el.naturalHeight * k));
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(el, 0, 0, c.width, c.height);
      try {
        resolve(c.toDataURL('image/jpeg', 0.85));
      } catch (e) {
        reject(e);
      }
    };
    el.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    el.src = src;
  });
}

let dblCache: { key: string; data: Uint8ClampedArray } | null = null;
function applyDoubleExposure(img: PixelData, fx: ImageFx) {
  const src = fx.dblSrc;
  const op = num(fx.dblOpacity);
  if (!src || op <= 0 || typeof document === 'undefined') return;
  const el = fxImages.get(src);
  if (!el) return; // aún sin decodificar: se reintenta cuando llegue (ver useFxImages)
  const { width: w, height: h } = img;
  const key = `${src.length}|${src.slice(-40)}|${w}x${h}`;
  if (!dblCache || dblCache.key !== key) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    // «cover»: rellena toda la capa recortando lo que sobre.
    const s = Math.max(w / el.naturalWidth, h / el.naturalHeight);
    const dw = el.naturalWidth * s;
    const dh = el.naturalHeight * s;
    ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
    dblCache = { key, data: ctx.getImageData(0, 0, w, h).data };
  }
  blendPixels(img, dblCache.data, fx.dblMode ?? 'screen', op);
}

// ---------------------------------------------------------------------------
// Ojos rojos
// ---------------------------------------------------------------------------

// Solo toca el canal R, y solo donde el rojo domina, dentro de los círculos marcados.
export function applyRedEye(img: PixelData, fx: ImageFx) {
  const pts = fx.redEyes;
  if (!pts || pts.length === 0) return;
  const d = img.data as Uint8ClampedArray;
  const { width: w, height: h } = img;
  const longest = Math.max(w, h);
  for (const pt of pts) {
    const cx = pt.x * w;
    const cy = pt.y * h;
    const r = Math.max(1, pt.r * longest);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (dist >= 1) continue;
        const wt = dist < 0.7 ? 1 : 1 - (dist - 0.7) / 0.3;
        const o = (y * w + x) * 4;
        if (d[o + 3] === 0) continue;
        const R = d[o];
        const m = Math.max(d[o + 1], d[o + 2], 1);
        if (R < 40 || R < m * 1.2) continue;
        const dom = clamp((R / m - 1.2) / 0.6, 0, 1);
        const target = (d[o + 1] + d[o + 2]) / 2;
        d[o] = R + (target - R) * wt * dom;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Suavizar piel (detección por YCbCr, suavizado ponderado por máscara y rango)
// ---------------------------------------------------------------------------

// Probabilidad 0..1 de que el color sea piel (rangos clásicos de Cb/Cr, con margen suave).
export function skinMask(r: number, g: number, b: number): number {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 40 || y > 250) return 0;
  const edge = (v: number, lo: number, hi: number, m: number) => clamp(Math.min(v - (lo - m), hi + m - v) / m, 0, 1);
  return edge(cb, 77, 127, 6) * edge(cr, 133, 173, 6);
}

export function applySkinSmooth(img: PixelData, strength: number) {
  if (strength <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const { width: w, height: h } = img;
  const n = w * h;
  const mask = new Float32Array(n);
  let any = false;
  const pmBuf = new Uint8ClampedArray(n * 4); // r·m, g·m, b·m, m
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    const m = d[o + 3] < 16 ? 0 : skinMask(d[o], d[o + 1], d[o + 2]);
    mask[p] = m;
    if (m > 0) {
      any = true;
      pmBuf[o] = d[o] * m;
      pmBuf[o + 1] = d[o + 1] * m;
      pmBuf[o + 2] = d[o + 2] * m;
      pmBuf[o + 3] = 255 * m;
    }
  }
  if (!any) return;
  const k = clamp(strength, 0, 100) / 100;
  const radius = clamp(Math.round(0.0045 * Math.max(w, h) * (0.6 + k)), 1, 24);
  const bl = blurRGBA(pmBuf, w, h, radius, 2);
  const sigma = 14 + 40 * k; // tolerancia de diferencia: protege bordes y detalle fuerte
  const inv = 1 / (2 * sigma * sigma);
  for (let p = 0; p < n; p++) {
    const m = mask[p];
    if (m <= 0) continue;
    const o = p * 4;
    const wm = bl[o + 3];
    if (wm < 8) continue;
    const s = 255 / wm;
    const br = bl[o] * s;
    const bg = bl[o + 1] * s;
    const bb = bl[o + 2] * s;
    const dr = br - d[o];
    const dg = bg - d[o + 1];
    const db = bb - d[o + 2];
    const range = Math.exp(-(dr * dr + dg * dg + db * db) * inv);
    const t = m * k * (0.35 + 0.65 * range);
    d[o] += dr * t;
    d[o + 1] += dg * t;
    d[o + 2] += db * t;
  }
}

// ---------------------------------------------------------------------------
// Mapa de degradado
// ---------------------------------------------------------------------------

export const GRADIENT_MAP_PRESETS: { id: string; label: string; gradient: Gradient }[] = [
  { id: 'duo-navy', label: 'Duotono azul', gradient: { angle: 0, stops: [{ offset: 0, color: '#0b1a3a' }, { offset: 1, color: '#f5d9a8' }] } },
  { id: 'duo-wine', label: 'Duotono vino', gradient: { angle: 0, stops: [{ offset: 0, color: '#2a0a24' }, { offset: 1, color: '#ffc9b5' }] } },
  { id: 'duo-green', label: 'Duotono verde', gradient: { angle: 0, stops: [{ offset: 0, color: '#06221a' }, { offset: 1, color: '#d9f2c4' }] } },
  { id: 'tri-sunset', label: 'Trítono atardecer', gradient: { angle: 0, stops: [{ offset: 0, color: '#1b1038' }, { offset: 0.5, color: '#c2395a' }, { offset: 1, color: '#ffe3a1' }] } },
  { id: 'tri-ocean', label: 'Trítono océano', gradient: { angle: 0, stops: [{ offset: 0, color: '#04101f' }, { offset: 0.5, color: '#1d7a8c' }, { offset: 1, color: '#f4f1de' }] } },
  { id: 'mono', label: 'Negro a blanco', gradient: { angle: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] } },
];

// Tabla de 256 colores (RGB) a partir de las paradas del degradado.
export function gradientLut(g: Gradient): Uint8ClampedArray {
  const stops = g.stops
    .map((s) => ({ o: clamp(s.offset, 0, 1), c: parseColor(s.color) }))
    .filter((s): s is { o: number; c: NonNullable<ReturnType<typeof parseColor>> } => !!s.c)
    .sort((a, b) => a.o - b.o);
  const lut = new Uint8ClampedArray(256 * 3);
  if (stops.length === 0) {
    for (let i = 0; i < 256; i++) lut[i * 3] = lut[i * 3 + 1] = lut[i * 3 + 2] = i;
    return lut;
  }
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s].o && t <= stops[s + 1].o) {
        a = stops[s];
        b = stops[s + 1];
        break;
      }
    }
    const span = b.o - a.o;
    const f = t <= a.o ? 0 : t >= b.o || span <= 0 ? 1 : (t - a.o) / span;
    lut[i * 3] = a.c.r + (b.c.r - a.c.r) * f;
    lut[i * 3 + 1] = a.c.g + (b.c.g - a.c.g) * f;
    lut[i * 3 + 2] = a.c.b + (b.c.b - a.c.b) * f;
  }
  return lut;
}

export function applyGradientMap(img: PixelData, g: Gradient | undefined, amount: number) {
  if (!g || amount <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const lut = gradientLut(g);
  const k = clamp(amount, 0, 100) / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const l = Math.round(lum(d[i], d[i + 1], d[i + 2]));
    const li = clamp(l, 0, 255) * 3;
    d[i] += (lut[li] - d[i]) * k;
    d[i + 1] += (lut[li + 1] - d[i + 1]) * k;
    d[i + 2] += (lut[li + 2] - d[i + 2]) * k;
  }
}

// ---------------------------------------------------------------------------
// Resplandor (bloom)
// ---------------------------------------------------------------------------

export function applyGlow(img: PixelData, amount: number, radius: number, color?: string) {
  if (amount <= 0) return;
  const d = img.data as Uint8ClampedArray;
  const { width: w, height: h } = img;
  const n = w * h;
  const bright = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (d[o + 3] === 0) continue;
    const k = clamp((lum(d[o], d[o + 1], d[o + 2]) - 120) / 135, 0, 1);
    bright[o] = d[o] * k;
    bright[o + 1] = d[o + 1] * k;
    bright[o + 2] = d[o + 2] * k;
    bright[o + 3] = 255;
  }
  const r = clamp(Math.round((clamp(radius, 0, 100) / 100) * 0.05 * Math.max(w, h)), 2, 90);
  const bl = blurRGBA(bright, w, h, r, 3);
  const tint = color ? parseColor(color) : null;
  const k = (clamp(amount, 0, 100) / 100) * 1.3;
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (d[o + 3] === 0) continue;
    let gr = bl[o] / 255;
    let gg = bl[o + 1] / 255;
    let gb = bl[o + 2] / 255;
    if (tint) {
      const l = lum(gr, gg, gb);
      gr = (l * tint.r) / 255;
      gg = (l * tint.g) / 255;
      gb = (l * tint.b) / 255;
    }
    // Screen del brillo suave sobre la imagen.
    d[o] = 255 * (1 - (1 - d[o] / 255) * (1 - clamp(gr * k, 0, 1)));
    d[o + 1] = 255 * (1 - (1 - d[o + 1] / 255) * (1 - clamp(gg * k, 0, 1)));
    d[o + 2] = 255 * (1 - (1 - d[o + 2] / 255) * (1 - clamp(gb * k, 0, 1)));
  }
}

// ---------------------------------------------------------------------------
// Color medio (para la «sombra de color»)
// ---------------------------------------------------------------------------

// Color medio ponderado por opacidad y saturación (un blanco/gris puro no domina).
export function averageColor(img: PixelData): string {
  const d = img.data;
  const total = img.width * img.height;
  const stride = Math.max(1, Math.floor(total / 40000));
  let r = 0;
  let g = 0;
  let b = 0;
  let wsum = 0;
  for (let p = 0; p < total; p += stride) {
    const o = p * 4;
    const a = d[o + 3] / 255;
    if (a < 0.1) continue;
    const mx = Math.max(d[o], d[o + 1], d[o + 2]);
    const mn = Math.min(d[o], d[o + 1], d[o + 2]);
    const wt = a * (0.15 + (mx > 0 ? (mx - mn) / mx : 0));
    r += d[o] * wt;
    g += d[o + 1] * wt;
    b += d[o + 2] * wt;
    wsum += wt;
  }
  if (wsum === 0) return '#000000';
  const hex = (v: number) => Math.round(clamp(v / wsum, 0, 255)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ---------------------------------------------------------------------------
// Punto de entrada: lo único que llama processImage
// ---------------------------------------------------------------------------

export function applyImageEffects(img: PixelData, fx: ImageFx | undefined) {
  if (!fx || !hasImageFx(fx)) return;
  applyRedEye(img, fx);
  applySkinSmooth(img, num(fx.skin));
  applyTiltShift(img, fx);
  applyMotionBlur(img, fx);
  applyRadialBlur(img, fx);
  applyZoomBlur(img, fx);
  applyGlow(img, num(fx.glowAmount), num(fx.glowRadius, 40), fx.glowColor || undefined);
  applyGradientMap(img, fx.gradMap, num(fx.gradMapAmount));
  applyHalftone(img, num(fx.htSize), num(fx.htAngle, 45), fx.htColor === true);
  applySketch(img, fx.sketchMode ?? 'pencil', num(fx.sketchAmount));
  applyTexture(img, fx);
  applyDoubleExposure(img, fx);
  applyChromatic(img, num(fx.chroma), num(fx.chromaAngle));
  applyGlitch(img, num(fx.glitch), num(fx.glitchSeed, 1));
}
