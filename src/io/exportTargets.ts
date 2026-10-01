// Lógica pura de la exportación: tamaños múltiples, peso objetivo y recorte.
// (Sin DOM: la parte que toca canvas está en runExport.ts.)

export interface ScaleSpec {
  scale: number;
  label: string; // «2x», «0.5x», «1200w»: es la variable {escala} del nombre
}

export const SCALE_CHOICES = [0.5, 1, 2, 3];
export const MAX_CUSTOM_WIDTHS = 6;
export const MAX_EXPORT_SIDE = 16384; // límite práctico del canvas

const trimNum = (n: number) => String(Math.round(n * 1000) / 1000);

export function scaleLabel(scale: number): string {
  return `${trimNum(scale)}x`;
}

// «800, 1600 3200» → [800, 1600, 3200] (enteros entre 16 y 16 384, sin repetir).
export function parseWidths(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const n = Math.round(Number(part));
    if (Number.isFinite(n) && n >= 16 && n <= MAX_EXPORT_SIDE && !out.includes(n)) out.push(n);
    if (out.length >= MAX_CUSTOM_WIDTHS) break;
  }
  return out;
}

// Lista final de tamaños: el principal primero, luego las casillas y los anchos
// personalizados; sin repetir escalas iguales.
export function buildScaleSpecs(
  docWidth: number,
  main: number,
  extras: number[],
  customWidths: number[],
): ScaleSpec[] {
  const specs: ScaleSpec[] = [{ scale: main, label: scaleLabel(main) }];
  const has = (s: number) => specs.some((x) => Math.abs(x.scale - s) < 1e-4);
  for (const s of extras) if (!has(s)) specs.push({ scale: s, label: scaleLabel(s) });
  for (const w of customWidths) {
    const s = w / Math.max(1, docWidth);
    if (!has(s)) specs.push({ scale: s, label: `${w}w` });
  }
  return specs;
}

export interface BisectResult {
  quality: number;
  size: number;
  fits: boolean; // ¿cabe en el peso pedido?
  evals: number; // renders usados
  cancelled: boolean;
}

// Busca por bisección la mayor calidad cuyo archivo pese ≤ maxBytes.
// `sizeAt(q)` devuelve el peso en bytes con esa calidad. Hace como mucho
// `maxEvals` pruebas (por defecto 8). Si ni con la calidad mínima cabe,
// devuelve `fits: false` con la calidad mínima.
export async function bisectQuality(
  sizeAt: (q: number) => Promise<number>,
  maxBytes: number,
  opts: { minQ?: number; maxQ?: number; maxEvals?: number; isCancelled?: () => boolean } = {},
): Promise<BisectResult> {
  const minQ = opts.minQ ?? 0.05;
  const maxQ = opts.maxQ ?? 1;
  const maxEvals = opts.maxEvals ?? 8;
  const cancelled = () => opts.isCancelled?.() ?? false;
  let evals = 0;
  const probe = async (q: number) => {
    evals++;
    return sizeAt(q);
  };

  const top = await probe(maxQ);
  if (top <= maxBytes) return { quality: maxQ, size: top, fits: true, evals, cancelled: false };
  if (cancelled()) return { quality: maxQ, size: top, fits: false, evals, cancelled: true };
  const bottom = await probe(minQ);
  if (bottom > maxBytes) return { quality: minQ, size: bottom, fits: false, evals, cancelled: false };

  let lo = minQ; // cabe
  let loSize = bottom;
  let hi = maxQ; // no cabe
  while (evals < maxEvals) {
    if (cancelled()) return { quality: lo, size: loSize, fits: true, evals, cancelled: true };
    const mid = (lo + hi) / 2;
    const s = await probe(mid);
    if (s <= maxBytes) {
      lo = mid;
      loSize = s;
    } else hi = mid;
  }
  return { quality: Math.round(lo * 1000) / 1000, size: loSize, fits: true, evals, cancelled: false };
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Caja mínima de los píxeles con alfa > 0 en datos RGBA. null si está vacío.
export function alphaBounds(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Bounds | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Cuántos archivos saldrán: decide si hace falta ZIP.
export function countOutputs(pages: number, scales: number): number {
  return Math.max(1, pages) * Math.max(1, scales);
}
