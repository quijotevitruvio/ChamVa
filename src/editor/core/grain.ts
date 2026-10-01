import type { BgGrain } from './types';

// Grano de fondo y «suavizado» (dither) de degradados. El ruido es determinista
// (semilla fija): el lienzo, la exportación a imagen y el SVG dibujan lo mismo.

export const GRAIN_CELLS = 96; // celdas por lado de la baldosa de grano
export const DEFAULT_GRAIN: BgGrain = { amount: 30, size: 1 };
const SEED_GRAIN = 0x9e3779b1;
const SEED_DITHER = 0x85ebca6b;

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function normalizeGrain(g: Partial<BgGrain> | undefined): BgGrain {
  return {
    amount: clamp(Math.round(Number(g?.amount ?? DEFAULT_GRAIN.amount)), 0, 100),
    size: clamp(Math.round((Number(g?.size ?? DEFAULT_GRAIN.size)) * 2) / 2, 1, 6),
  };
}

/** Un grano en 0 no se dibuja. */
export const grainActive = (g: BgGrain | undefined): g is BgGrain => !!g && g.amount > 0;

/** Opacidad máxima del grano para un valor 0..100 (sube suave, nunca tapa el fondo). */
export const grainMaxAlpha = (amount: number): number => (clamp(amount, 0, 100) / 100) * 0.5;

/** Opacidad máxima del tramado contra bandas: ≈ ±5/255, invisible a simple vista. */
export const DITHER_ALPHA = 0.02;

// PRNG determinista (mulberry32).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n×n celdas RGBA: cada una blanca o negra con alfa aleatorio ≤ maxAlpha. Mismo seed → mismos datos. */
export function noiseCells(n: number, maxAlpha: number, seed: number): Uint8ClampedArray {
  const rnd = mulberry32(seed);
  const out = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    const a = Math.round(rnd() * maxAlpha * 255);
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = a;
  }
  return out;
}

// ---------- Canvas 2D ----------

function noiseCanvas(n: number, cellPx: number, maxAlpha: number, seed: number): HTMLCanvasElement {
  const small = document.createElement('canvas');
  small.width = n;
  small.height = n;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(n, n);
  img.data.set(noiseCells(n, maxAlpha, seed));
  sctx.putImageData(img, 0, 0);
  if (cellPx <= 1) return small;
  const big = document.createElement('canvas');
  big.width = n * cellPx;
  big.height = n * cellPx;
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(small, 0, 0, big.width, big.height);
  return big;
}

/** Baldosa de grano a resolución `k` (px por px del documento). `ps` = escala del patrón para medir `size`. */
export function renderGrainTile(spec: BgGrain, k: number): { canvas: HTMLCanvasElement; ps: number } {
  const g = normalizeGrain(spec);
  const cellPx = clamp(Math.round(g.size * Math.max(1, k)), 1, 16);
  return { canvas: noiseCanvas(GRAIN_CELLS, cellPx, grainMaxAlpha(g.amount), SEED_GRAIN), ps: g.size / cellPx };
}

/** Baldosa de tramado: 1 celda = 1 px de pantalla/exportación; `ps` = 1/k. */
let ditherCanvas: HTMLCanvasElement | null = null; // el ruido es el mismo a cualquier escala: se crea una vez
export function renderDitherTile(k: number): { canvas: HTMLCanvasElement; ps: number } {
  ditherCanvas ??= noiseCanvas(GRAIN_CELLS, 1, DITHER_ALPHA, SEED_DITHER);
  return { canvas: ditherCanvas, ps: 1 / Math.max(1, k) };
}

function fillWithTile(
  ctx: CanvasRenderingContext2D,
  tile: { canvas: HTMLCanvasElement; ps: number },
  w: number,
  h: number,
) {
  const pat = ctx.createPattern(tile.canvas, 'repeat');
  if (!pat) return;
  pat.setTransform(new DOMMatrix().scale(tile.ps, tile.ps));
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
}

/** Grano sobre todo el documento (la exportación ya tiene ctx.scale(scale)). */
export function fillGrain(ctx: CanvasRenderingContext2D, spec: BgGrain, w: number, h: number, scale: number) {
  if (!grainActive(spec)) return;
  ctx.save();
  fillWithTile(ctx, renderGrainTile(spec, scale), w, h);
  ctx.restore();
}

/** Tramado contra bandas sobre la caja w×h (si hace falta, recorta antes con clip()). */
export function fillDither(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number) {
  ctx.save();
  fillWithTile(ctx, renderDitherTile(scale), w, h);
  ctx.restore();
}

// ---------- SVG ----------

/** <pattern> con el grano como imagen embebida (raster: SVG no tiene ruido determinista portátil). */
export function svgGrainDef(id: string, spec: BgGrain): string {
  const g = normalizeGrain(spec);
  const { canvas } = renderGrainTile(g, 2);
  const side = GRAIN_CELLS * g.size; // lado de la baldosa en px del documento
  return (
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${side}" height="${side}">` +
    `<image width="${side}" height="${side}" href="${canvas.toDataURL('image/png')}"/></pattern>`
  );
}
