import { useEffect, useState } from 'react';
import type { TextLayer } from '../core/types';
import { preloadTextFxImages, textFxImagesReady } from '../core/textFx';

// Devuelve un número que cambia cuando termina de decodificarse la imagen del relleno
// de texto, para que el lienzo vuelva a dibujar la capa (el dibujo es síncrono).
export function useTextFxImagesVersion(layer: TextLayer): number {
  const [v, setV] = useState(0);
  const src = layer.imageFill?.src;
  useEffect(() => {
    if (!src || textFxImagesReady(layer)) return;
    let on = true;
    preloadTextFxImages(layer).then(() => on && setV((n) => n + 1));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return v;
}
