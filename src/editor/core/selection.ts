// Selección de píxeles (lógica pura, sin DOM): varita mágica, lazo, rango de color, combinación,
// invertir, expandir/contraer, suavizar y desvanecer.
//
// Una selección es un plano de 8 bits (0 = fuera, 255 = dentro, intermedio = parcial) en el espacio
// del DOCUMENTO a `scale` píxeles por px del documento (1 salvo lienzos enormes). Es transitoria
// (como `selRect`): no entra en el documento ni en el deshacer; lo que se HACE con ella sí.
import { featherAlpha } from './layerMask';

export interface PixelSelection {
  w: number;
  h: number;
  scale: number; // píxeles de selección por px del documento
  data: Uint8Array;
}

export type SelCombine = 'replace' | 'add' | 'subtract' | 'intersect';

/** Tope de píxeles de la selección (16 MP): lienzos más grandes se seleccionan a menos resolución. */
export const SEL_MAX_PIXELS = 16_000_000;

export function selectionScale(docW: number, docH: number): number {
  const px = Math.max(1, docW * docH);
  return px > SEL_MAX_PIXELS ? Math.sqrt(SEL_MAX_PIXELS / px) : 1;
}

export function emptySelection(docW: number, docH: number): PixelSelection {
  const scale = selectionScale(docW, docH);
  const w = Math.max(1, Math.round(docW * scale));
  const h = Math.max(1, Math.round(docH * scale));
  return { w, h, scale, data: new Uint8Array(w * h) };
}

/** Modo según las teclas: Mayús = sumar, Alt = restar, Mayús+Alt = intersección. */
export function combineFromKeys(shift: boolean, alt: boolean): SelCombine {
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return 'replace';
}

/** Combina `next` sobre `prev` (mismo tamaño). Sin `prev` o con 'replace' devuelve `next`. */
export function combine(prev: Uint8Array | null, next: Uint8Array, mode: SelCombine): Uint8Array {
  if (!prev || mode === 'replace' || prev.length !== next.length) return next;
  const out = new Uint8Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (mode === 'add') out[i] = a > b ? a : b;
    else if (mode === 'subtract') out[i] = Math.round((a * (255 - b)) / 255);
    else out[i] = Math.round((a * b) / 255);
  }
  return out;
}

export function invertSel(a: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = 255 - a[i];
  return out;
}

export function isEmptySel(a: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i]) return false;
  return true;
}

export function countSelected(a: Uint8Array, threshold = 128): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] >= threshold) n++;
  return n;
}

/** Caja de los píxeles con valor > 0 (null = vacía). */
export function selBounds(a: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (a[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------------------------------------------------------------------------
// Varita mágica y rango de color
// ---------------------------------------------------------------------------

/** Diferencia entre dos píxeles RGBA: el canal que más difiere (0..255), como Photoshop. */
function pixelDiff(d: ArrayLike<number>, i: number, r: number, g: number, b: number, a: number): number {
  const dr = Math.abs(d[i] - r);
  const dg = Math.abs(d[i + 1] - g);
  const db = Math.abs(d[i + 2] - b);
  const da = Math.abs(d[i + 3] - a);
  return Math.max(dr, dg, db, da);
}

export interface WandOpts {
  tolerance: number; // 0..255
  contiguous: boolean;
  antiAlias: boolean;
}

/**
 * Varita: píxeles cuyo color difiere del de (sx, sy) como mucho `tolerance` (por canal, alfa incluido).
 * Contigua = solo los conectados (4 vecinos) con el punto; global = todos los de la imagen.
 * Antialias = suaviza el borde (1 px) sin tocar el interior.
 */
export function magicWand(rgba: ArrayLike<number>, w: number, h: number, sx: number, sy: number, o: WandOpts): Uint8Array {
  const out = new Uint8Array(w * h);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return out;
  const si = (y0 * w + x0) * 4;
  const r = rgba[si];
  const g = rgba[si + 1];
  const b = rgba[si + 2];
  const a = rgba[si + 3];
  const tol = Math.max(0, Math.min(255, o.tolerance));
  const ok = (p: number) => pixelDiff(rgba, p * 4, r, g, b, a) <= tol;
  if (!o.contiguous) {
    for (let p = 0; p < w * h; p++) if (ok(p)) out[p] = 255;
  } else {
    // Relleno por líneas (scanline) con pila explícita: sin recursión, O(píxeles).
    const stack: number[] = [x0, y0];
    while (stack.length) {
      const y = stack.pop()!;
      let x = stack.pop()!;
      const row = y * w;
      while (x >= 0 && !out[row + x] && ok(row + x)) x--;
      x++;
      let up = false;
      let down = false;
      while (x < w && !out[row + x] && ok(row + x)) {
        out[row + x] = 255;
        if (y > 0) {
          const q = row - w + x;
          const can = !out[q] && ok(q);
          if (can && !up) {
            stack.push(x, y - 1);
            up = true;
          } else if (!can) up = false;
        }
        if (y < h - 1) {
          const q = row + w + x;
          const can = !out[q] && ok(q);
          if (can && !down) {
            stack.push(x, y + 1);
            down = true;
          } else if (!can) down = false;
        }
        x++;
      }
    }
  }
  return o.antiAlias ? antiAliasEdges(out, w, h) : out;
}

/**
 * Rango de color: selección SUAVE por parecido al color dado (255 idéntico → 0 a `fuzziness`).
 * Es la versión global y graduada de la varita.
 */
export function colorRange(rgba: ArrayLike<number>, w: number, h: number, color: [number, number, number], fuzziness: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const f = Math.max(1, Math.min(255, fuzziness));
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (rgba[i + 3] === 0) continue;
    const d = Math.max(Math.abs(rgba[i] - color[0]), Math.abs(rgba[i + 1] - color[1]), Math.abs(rgba[i + 2] - color[2]));
    if (d < f) out[p] = Math.round(255 * (1 - d / f));
  }
  return out;
}

/** Suaviza solo el borde de una selección binaria (media 3×3 en los píxeles con vecinos distintos). */
export function antiAliasEdges(sel: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(sel);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = sel[i];
      let sum = 0;
      let n = 0;
      let mixed = false;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = sel[yy * w + xx];
          if (q !== v) mixed = true;
          sum += q;
          n++;
        }
      }
      // Solo se suaviza hacia fuera del borde de lo seleccionado: el interior y el fondo no cambian.
      if (mixed && v === 255) out[i] = Math.round((sum / n + 255) / 2);
      else if (mixed && v === 0) out[i] = Math.round(sum / n / 2);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lazo / polígono
// ---------------------------------------------------------------------------

/**
 * Rasteriza un polígono cerrado (puntos [x0,y0,x1,y1,…] en píxeles del plano) con la regla par-impar.
 * Sin antialias: un píxel entra si su CENTRO está dentro (resultado exacto y predecible).
 * Con antialias: 4 subfilas por píxel y cobertura horizontal fraccionaria en los extremos del tramo.
 */
export function rasterizePolygon(pts: number[], w: number, h: number, antiAlias = false): Uint8Array {
  const out = new Uint8Array(w * h);
  const n = Math.floor(pts.length / 2);
  if (n < 3) return out;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, pts[i * 2 + 1]);
    maxY = Math.max(maxY, pts[i * 2 + 1]);
  }
  const sub = antiAlias ? 4 : 1;
  const acc = antiAlias ? new Float32Array(w * h) : null;
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = yStart; y <= yEnd; y++) {
    for (let s = 0; s < sub; s++) {
      const sy = y + (s + 0.5) / sub;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2];
        const ay = pts[i * 2 + 1];
        const bx = pts[((i + 1) % n) * 2];
        const by = pts[((i + 1) % n) * 2 + 1];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      const row = y * w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = xs[k];
        const xb = xs[k + 1];
        if (!acc) {
          // Centros dentro: x + 0.5 ∈ [xa, xb).
          const i0 = Math.max(0, Math.ceil(xa - 0.5));
          const i1 = Math.min(w - 1, Math.ceil(xb - 0.5) - 1);
          for (let x = i0; x <= i1; x++) out[row + x] = 255;
        } else {
          const ca = Math.max(0, xa);
          const cb = Math.min(w, xb);
          if (cb <= ca) continue;
          const ia = Math.floor(ca);
          const ib = Math.min(w - 1, Math.floor(cb - 1e-9));
          for (let x = ia; x <= ib; x++) {
            const cov = Math.min(cb, x + 1) - Math.max(ca, x);
            if (cov > 0) acc[row + x] += cov / sub;
          }
        }
      }
    }
  }
  if (acc) for (let i = 0; i < acc.length; i++) out[i] = Math.round(Math.min(1, acc[i]) * 255);
  return out;
}

/** Suaviza un trazo de lazo (Chaikin, `passes` pasadas) sin moverlo de su sitio. Polígono cerrado. */
export function smoothPolygon(pts: number[], passes = 2): number[] {
  let p = pts.slice();
  for (let k = 0; k < passes; k++) {
    const n = p.length / 2;
    if (n < 3) return p;
    const q: number[] = [];
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2];
      const ay = p[i * 2 + 1];
      const bx = p[((i + 1) % n) * 2];
      const by = p[((i + 1) % n) * 2 + 1];
      q.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
    }
    p = q;
  }
  return p;
}

/** Quita puntos casi repetidos del lazo a mano alzada (a menos de `minDist` del anterior). */
export function simplifyPath(pts: number[], minDist = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const n = out.length;
    if (n >= 2 && Math.hypot(pts[i] - out[n - 2], pts[i + 1] - out[n - 1]) < minDist) continue;
    out.push(pts[i], pts[i + 1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Modificar: expandir, contraer, suavizar, desvanecer
// ---------------------------------------------------------------------------

const INF = 1e20;

// Transformada de distancia 1D al cuadrado (Felzenszwalb y Huttenlocher).
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distancia euclídea al cuadrado de cada píxel al píxel «semilla» más cercano (seed[i] = true). */
export function distanceSq(seed: (i: number) => boolean, w: number, h: number): Float64Array {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = seed(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[row + x] = d[x];
  }
  return grid;
}

/** Expandir (r > 0) o contraer (r < 0) `r` píxeles, con distancia euclídea (bordes redondos). */
export function growShrink(sel: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!r) return new Uint8Array(sel);
  if (r > 0) {
    const d = distanceSq((i) => sel[i] >= 128, w, h);
    const r2 = r * r;
    for (let i = 0; i < out.length; i++) out[i] = d[i] <= r2 ? 255 : 0;
  } else {
    const rr = -r;
    const d = distanceSq((i) => sel[i] < 128, w, h);
    const r2 = rr * rr;
    // Los bordes del plano cuentan como «fuera» (contraer no deja nada pegado al borde).
    for (let i = 0; i < out.length; i++) {
      const x = i % w;
      const y = (i / w) | 0;
      const edge = Math.min(x + 1, y + 1, w - x, h - y);
      out[i] = d[i] > r2 && edge * edge > r2 ? 255 : 0;
    }
  }
  return out;
}

/** Suavizar: redondea esquinas y quita dientes (desenfoque de radio r y umbral al 50 %). */
export function smoothSel(sel: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return new Uint8Array(sel);
  const b = featherAlpha(sel, w, h, r * 2);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = b[i] >= 128 ? 255 : 0;
  return out;
}

/** Desvanecer: borde suave de radio r (el mismo desenfoque que las máscaras). */
export function featherSel(sel: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return featherAlpha(sel, w, h, r);
}

// ---------------------------------------------------------------------------
// Bordes para las «hormigas marchantes»
// ---------------------------------------------------------------------------

/**
 * Segmentos del contorno (umbral 50 %) en píxeles del plano, unidos por filas/columnas:
 * [x0,y0,x1,y1, …]. `max` limita los segmentos (selecciones con mucho ruido).
 */
export function selectionEdges(sel: Uint8Array, w: number, h: number, max = 200_000): number[] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && sel[y * w + x] >= 128;
  const segs: number[] = [];
  // Horizontales: entre la fila y-1 y la y.
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && on(x, y - 1) !== on(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        segs.push(start, y, x, y);
        start = -1;
        if (segs.length >= max * 4) return segs;
      }
    }
  }
  // Verticales: entre la columna x-1 y la x.
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && on(x - 1, y) !== on(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        segs.push(x, start, x, y);
        start = -1;
        if (segs.length >= max * 4) return segs;
      }
    }
  }
  return segs;
}

// ---------------------------------------------------------------------------
// Selección ↔ máscara de capa
// ---------------------------------------------------------------------------

/**
 * Muestrea la selección (espacio del documento) sobre la rejilla de una máscara local:
 * para cada píxel de máscara (u, v) → punto local del rect → documento (matriz m) → bilineal.
 * `m` = matriz local→documento [a,b,c,d,e,f] de la capa.
 */
export function selectionToPlane(
  sel: PixelSelection,
  m: [number, number, number, number, number, number],
  rect: { x: number; y: number; w: number; h: number },
  mw: number,
  mh: number,
): Uint8Array {
  const out = new Uint8Array(mw * mh);
  const [a, b, c, d, e, f] = m;
  const s = sel.scale;
  const W = sel.w;
  const H = sel.h;
  const data = sel.data;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[y * W + x]);
  for (let v = 0; v < mh; v++) {
    const ly = rect.y + ((v + 0.5) / mh) * rect.h;
    for (let u = 0; u < mw; u++) {
      const lx = rect.x + ((u + 0.5) / mw) * rect.w;
      const dx = (a * lx + c * ly + e) * s - 0.5;
      const dy = (b * lx + d * ly + f) * s - 0.5;
      const x0 = Math.floor(dx);
      const y0 = Math.floor(dy);
      const tx = dx - x0;
      const ty = dy - y0;
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out[v * mw + u] = Math.round(top * (1 - ty) + bot * ty);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trabajos (los mismos en el hilo principal y en el worker de píxeles)
// ---------------------------------------------------------------------------

export type SelJob =
  | { kind: 'wand'; x: number; y: number; tolerance: number; contiguous: boolean; antiAlias: boolean } // buffer = RGBA
  | { kind: 'range'; color: [number, number, number]; fuzziness: number } // buffer = RGBA
  | { kind: 'grow'; r: number } // buffer = selección
  | { kind: 'smooth'; r: number }
  | { kind: 'feather'; r: number }
  // buffer = selección (w×h); devuelve el plano mw×mh de la máscara local (selectionToPlane)
  | { kind: 'toPlane'; scale: number; m: [number, number, number, number, number, number]; rect: { x: number; y: number; w: number; h: number }; mw: number; mh: number };

/** Ejecuta un trabajo de selección sobre `buf` (RGBA o plano según el tipo). Devuelve el plano nuevo. */
export function runSelJob(job: SelJob, buf: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  switch (job.kind) {
    case 'wand':
      return magicWand(buf, w, h, job.x, job.y, job);
    case 'range':
      return colorRange(buf, w, h, job.color, job.fuzziness);
    case 'grow':
      return growShrink(buf as Uint8Array, w, h, job.r);
    case 'smooth':
      return smoothSel(buf as Uint8Array, w, h, job.r);
    case 'feather':
      return featherSel(buf as Uint8Array, w, h, job.r);
    case 'toPlane':
      return selectionToPlane({ w, h, scale: job.scale, data: buf as Uint8Array }, job.m, job.rect, job.mw, job.mh);
  }
}
