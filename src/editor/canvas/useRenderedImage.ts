import { useEffect, useMemo, useState } from 'react';
import type { ImageLayer } from '../core/types';
import { hasPixelOps, needsProcessing, processImage, processImageAsync, processImageBase } from '../core/imageProcessing';

/** Lado de la vista previa «inmediata» en baja resolución (se refina después a `maxSize`). */
export const LOW_PREVIEW = 512;

// Imagen de la capa con sus ajustes. Sin cálculos por píxel: síncrono como siempre (rápido).
// Con ellos (ruido, neblina, curvas, efectos…): primero un resultado inmediato (etapa de
// canvas + vista previa en baja resolución del worker), después el refinado a `maxSize`; si el
// usuario sigue cambiando algo, el trabajo anterior se CANCELA y se descarta.
export function useRenderedImage(
  image: CanvasImageSource | null,
  layer: ImageLayer,
  maxSize: number,
  deps: unknown[],
  label = 'Procesando imagen',
): CanvasImageSource | null {
  const heavy = !!image && needsProcessing(layer) && hasPixelOps(layer.adjust ?? ({} as never));

  const quick = useMemo<CanvasImageSource | null>(() => {
    if (!image) return null;
    if (!needsProcessing(layer)) return image;
    return heavy ? processImageBase(image, layer, maxSize) : processImage(image, layer, maxSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const [refined, setRefined] = useState<{ img: CanvasImageSource; of: CanvasImageSource } | null>(null);

  useEffect(() => {
    if (!heavy || !image) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    (async () => {
      try {
        const low = await processImageAsync(image, layer, Math.min(LOW_PREVIEW, maxSize), { signal, priority: 0 });
        if (signal.aborted) return;
        setRefined({ img: low, of: image });
        const hi = await processImageAsync(image, layer, maxSize, { signal, priority: 0, label });
        if (signal.aborted) return;
        setRefined({ img: hi, of: image });
      } catch (e) {
        if ((e as Error)?.name === 'AbortError' || signal.aborted) return;
        console.warn('Procesado en worker falló; se usa el hilo principal', e);
        setRefined({ img: processImage(image, layer, maxSize), of: image });
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  if (heavy && refined && refined.of === image) return refined.img;
  return quick;
}
