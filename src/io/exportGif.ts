import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from './export';

// Crea un GIF animado: cada página es un fotograma.
export async function exportPagesToGif(
  pages: Doc[],
  opts: { maxSize?: number; delay?: number } = {},
): Promise<Blob> {
  const { maxSize = 800, delay = 800 } = opts;
  const gif = GIFEncoder();
  for (const page of pages) {
    const scale = Math.min(1, maxSize / Math.max(page.width, page.height));
    // GIF tiene transparencia limitada → fondo blanco para evitar artefactos.
    const canvas = await renderDocToCanvas(page, scale, '#ffffff');
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay });
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}
