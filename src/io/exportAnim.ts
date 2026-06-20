import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Doc } from '../editor/core/types';
import { animTotalFor } from '../editor/core/animations';
import { renderDocToCanvas } from './export';

// Exporta la animación (entrada + salida) de la página actual como GIF animado.
export async function exportAnimatedGif(
  doc: Doc,
  opts: { maxSize?: number; fps?: number } = {},
): Promise<Blob> {
  const { maxSize = 600, fps = 18 } = opts;
  const total = animTotalFor(doc.layers);
  const scale = Math.min(1, maxSize / Math.max(doc.width, doc.height));
  const frames = Math.max(2, Math.round(total * fps));
  const delay = Math.round(1000 / fps);

  const gif = GIFEncoder();
  for (let i = 0; i < frames; i++) {
    const t = (i / (frames - 1)) * total;
    const canvas = await renderDocToCanvas(doc, scale, '#ffffff', t, total);
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
