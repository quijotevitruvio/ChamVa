// Render de las páginas del proyecto como APNG / WebP animado (cada página = un fotograma).
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from './export';
import { buildApng, buildAnimatedWebp } from './exportApng';

export type AnimFormat = 'apng' | 'webp';

function toBlob(c: HTMLCanvasElement, mime: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob falló'))), mime, q));
}

// Cada página es un fotograma, todas al tamaño de la primera (encajadas, sin deformar).
export async function exportPagesToApngOrWebp(
  pages: Doc[],
  format: AnimFormat,
  opts: { maxSize?: number; delay?: number; loops?: number; onProgress?: (i: number, n: number) => void; isCancelled?: () => boolean } = {},
): Promise<Blob | null> {
  const { maxSize = 800, delay = 800, loops = 0 } = opts;
  const first = pages[0];
  const scale = Math.min(1, maxSize / Math.max(first.width, first.height));
  const w = Math.max(1, Math.round(first.width * scale));
  const h = Math.max(1, Math.round(first.height * scale));
  const mime = format === 'apng' ? 'image/png' : 'image/webp';
  const frames: Uint8Array[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (opts.isCancelled?.()) return null;
    opts.onProgress?.(i, pages.length);
    const p = pages[i];
    const s = Math.min(w / p.width, h / p.height);
    const src = await renderDocToCanvas(p, s);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, Math.round((w - src.width) / 2), Math.round((h - src.height) / 2));
    const blob = await toBlob(c, mime, format === 'webp' ? 0.92 : undefined);
    if (blob.type !== mime) throw new Error(`Este navegador no puede codificar ${format === 'apng' ? 'PNG' : 'WebP'}`);
    frames.push(new Uint8Array(await blob.arrayBuffer()));
    await new Promise((r) => setTimeout(r, 0));
  }
  const delays = frames.map(() => delay);
  const bytes = format === 'apng' ? buildApng(frames, delays, loops) : buildAnimatedWebp(frames, delays, loops);
  return new Blob([bytes as BlobPart], { type: mime });
}
