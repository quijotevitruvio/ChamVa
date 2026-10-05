// Remuestreo de calidad de imágenes RGBA (lógica pura, sin DOM; corre en el hilo principal o en
// el worker). En vez de un `drawImage` simple:
//  - núcleos a elegir: bilineal, bicúbico (Catmull-Rom) y Lanczos de 3 lóbulos;
//  - al REDUCIR, el núcleo se ensancha con la razón de reducción (filtro de área: sin aliasing);
//  - reducción por pasos: mientras la razón sea ≥ 2 se promedia por mitades (caja 2×2) y solo el
//    último tramo (< 2×) usa el núcleo elegido (rápido y sin aliasing aunque sea 1/8);
//  - se trabaja con alfa premultiplicado, para que los bordes transparentes no sangren.

export type ResampleMethod = 'bilinear' | 'bicubic' | 'lanczos';

export const RESAMPLE_METHODS: { id: ResampleMethod; label: string; hint: string }[] = [
  { id: 'bicubic', label: 'Bicúbico', hint: 'Equilibrado: nítido sin halos. Recomendado.' },
  { id: 'lanczos', label: 'Lanczos', hint: 'El más nítido al reducir; puede dar un halo leve.' },
  { id: 'bilinear', label: 'Bilineal', hint: 'Rápido y suave; menos nítido.' },
];

export function isResampleMethod(v: unknown): v is ResampleMethod {
  return v === 'bilinear' || v === 'bicubic' || v === 'lanczos';
}

// Radio (en píxeles de origen, a escala 1) de cada núcleo.
export function kernelSupport(m: ResampleMethod): number {
  return m === 'bilinear' ? 1 : m === 'bicubic' ? 2 : 3;
}

// Valor del núcleo en x (distancia al centro, en píxeles).
export function kernelValue(m: ResampleMethod, x: number): number {
  const ax = Math.abs(x);
  if (m === 'bilinear') return ax < 1 ? 1 - ax : 0;
  if (m === 'bicubic') {
    // Catmull-Rom (a = -0,5): interpola exacto en los nudos y no emborrona.
    if (ax < 1) return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1;
    if (ax < 2) return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4 * ax + 2;
    return 0;
  }
  // Lanczos3
  if (ax < 1e-9) return 1;
  if (ax >= 3) return 0;
  const px = Math.PI * ax;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

export interface Weights {
  /** primer píxel de origen de cada píxel de destino */
  start: Int32Array;
  /** nº de coeficientes de cada destino */
  count: Int32Array;
  /** coeficientes de cada destino, en bloques de `stride` */
  coef: Float64Array;
  stride: number;
}

// Coeficientes de una dimensión: para cada índice de destino, qué píxeles de origen y con qué peso.
// Cada fila suma 1 (se renormaliza, también en los bordes recortados).
export function buildWeights(srcLen: number, dstLen: number, m: ResampleMethod): Weights {
  const scale = srcLen / dstLen;
  const fscale = Math.max(1, scale); // al reducir, el núcleo se ensancha
  const support = kernelSupport(m) * fscale;
  const stride = Math.ceil(support) * 2 + 2;
  const start = new Int32Array(dstLen);
  const count = new Int32Array(dstLen);
  const coef = new Float64Array(dstLen * stride);
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) * scale - 0.5; // posición en coordenadas de centro de píxel
    let lo = Math.floor(center - support) + 1;
    let hi = Math.floor(center + support);
    if (lo < 0) lo = 0;
    if (hi > srcLen - 1) hi = srcLen - 1;
    let sum = 0;
    let k = 0;
    for (let x = lo; x <= hi; x++, k++) {
      const w = kernelValue(m, (x - center) / fscale);
      coef[i * stride + k] = w;
      sum += w;
    }
    if (k === 0) {
      // destino fuera de rango (no debería): el píxel más cercano
      const x = Math.min(srcLen - 1, Math.max(0, Math.round(center)));
      lo = x;
      coef[i * stride] = 1;
      k = 1;
      sum = 1;
    }
    if (Math.abs(sum) < 1e-12) {
      coef[i * stride] = 1;
      k = 1;
      lo = Math.min(srcLen - 1, Math.max(0, Math.round(center)));
      sum = 1;
    }
    for (let j = 0; j < k; j++) coef[i * stride + j] /= sum;
    start[i] = lo;
    count[i] = k;
  }
  return { start, count, coef, stride };
}

// Promedia por mitades (caja) en cada eje que aún se reduzca ≥ 2 veces. Premultiplicado.
function halve(src: Uint8ClampedArray, w: number, h: number, hx: boolean, hy: boolean) {
  const nw = hx ? Math.floor(w / 2) : w;
  const nh = hy ? Math.floor(h / 2) : h;
  const out = new Uint8ClampedArray(nw * nh * 4);
  const bx = hx ? 2 : 1;
  const by = hy ? 2 : 1;
  const n = bx * by;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < by; dy++) {
        for (let dx = 0; dx < bx; dx++) {
          const i = ((y * by + dy) * w + (x * bx + dx)) * 4;
          const al = src[i + 3];
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += al;
        }
      }
      const o = (y * nw + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / n;
    }
  }
  return { data: out, w: nw, h: nh };
}

export type ResampleProgress = (fraction: number) => void;

/**
 * Remuestrea `src` (RGBA, sw×sh) a dw×dh. Devuelve un buffer nuevo; `src` no se modifica.
 * `onProgress(0..1)` solo informa.
 */
export function resampleRGBA(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  method: ResampleMethod = 'bicubic',
  onProgress?: ResampleProgress,
): Uint8ClampedArray {
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));
  if (sw === dw && sh === dh) return new Uint8ClampedArray(src);

  // 1) Reducción por pasos (solo en el eje que se reduce al menos a la mitad).
  let cur = src;
  let w = sw;
  let h = sh;
  let steps = 0;
  const plan: { hx: boolean; hy: boolean }[] = [];
  {
    let pw = sw;
    let ph = sh;
    for (;;) {
      const hx = pw >= dw * 2;
      const hy = ph >= dh * 2;
      if (!hx && !hy) break;
      plan.push({ hx, hy });
      if (hx) pw = Math.floor(pw / 2);
      if (hy) ph = Math.floor(ph / 2);
    }
  }
  const totalStages = plan.length + 2; // pasos de mitades + horizontal + vertical
  for (const p of plan) {
    const r = halve(cur, w, h, p.hx, p.hy);
    cur = r.data;
    w = r.w;
    h = r.h;
    steps++;
    onProgress?.(steps / totalStages);
  }

  // 2) Núcleo elegido: horizontal (w → dw) a un búfer premultiplicado en coma flotante...
  const wx = buildWeights(w, dw, method);
  const wy = buildWeights(h, dh, method);
  const tmp = new Float32Array(dw * h * 4);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    const trow = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const s = wx.start[x];
      const c = wx.count[x];
      const base = x * wx.stride;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < c; k++) {
        const i = row + (s + k) * 4;
        const wt = wx.coef[base + k];
        const al = cur[i + 3] * wt;
        r += cur[i] * al;
        g += cur[i + 1] * al;
        b += cur[i + 2] * al;
        a += al;
      }
      const o = trow + x * 4;
      tmp[o] = r / 255; // color premultiplicado por alfa (0..255)
      tmp[o + 1] = g / 255;
      tmp[o + 2] = b / 255;
      tmp[o + 3] = a; // alfa 0..255
    }
    if (onProgress && (y & 63) === 0) onProgress((steps + (y / h) * 0.5) / totalStages);
  }

  // 3) ...y vertical (h → dh), fila a fila (accesos contiguos), des-premultiplicando al final.
  const out = new Uint8ClampedArray(dw * dh * 4);
  const acc = new Float64Array(dw * 4);
  for (let y = 0; y < dh; y++) {
    acc.fill(0);
    const s = wy.start[y];
    const c = wy.count[y];
    const base = y * wy.stride;
    for (let k = 0; k < c; k++) {
      const wt = wy.coef[base + k];
      const o = (s + k) * dw * 4;
      for (let i = 0; i < dw * 4; i++) acc[i] += tmp[o + i] * wt;
    }
    const orow = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const i = x * 4;
      const a255 = acc[i + 3];
      const a = a255 < 0 ? 0 : a255 > 255 ? 255 : a255;
      if (a > 1e-6) {
        const inv = 255 / a255;
        out[orow + i] = acc[i] * inv;
        out[orow + i + 1] = acc[i + 1] * inv;
        out[orow + i + 2] = acc[i + 2] * inv;
      }
      out[orow + i + 3] = a;
    }
    if (onProgress && (y & 63) === 0) onProgress((steps + 0.5 + (y / dh) * 0.5) / totalStages);
  }
  onProgress?.(1);
  return out;
}
