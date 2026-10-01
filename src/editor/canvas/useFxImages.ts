import { useEffect, useState } from 'react';
import type { ImageAdjust } from '../core/types';
import { fxImagesReady, preloadFxImages } from '../core/imageEffects';

// Devuelve un número que cambia cuando termina de decodificarse la imagen de la doble
// exposición, para que el lienzo vuelva a procesar la capa (processImage es síncrono).
export function useFxImagesVersion(adj: ImageAdjust | undefined): number {
  const [v, setV] = useState(0);
  const src = adj?.fx?.dblSrc;
  useEffect(() => {
    if (!src || fxImagesReady(adj)) return;
    let on = true;
    preloadFxImages(adj).then(() => on && setV((n) => n + 1));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return v;
}
