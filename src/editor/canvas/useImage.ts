import { useEffect, useState } from 'react';

// Carga un src en un HTMLImageElement para usarlo en Konva.
export function useImage(src: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    const onLoad = () => setImage(img);
    img.addEventListener('load', onLoad);
    return () => img.removeEventListener('load', onLoad);
  }, [src]);

  return image;
}

// Patrón de tablero (checkerboard) que indica transparencia. Es un <canvas>,
// no una imagen: está listo al instante y Konva lo dibuja en el primer render
// (con una <img> sin cargar el lienzo transparente se veía negro).
let checkerCache: HTMLCanvasElement | null = null;
export function getCheckerboard(): HTMLCanvasElement {
  if (checkerCache) return checkerCache;
  const size = 20;
  const c = document.createElement('canvas');
  c.width = size * 2;
  c.height = size * 2;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size * 2, size * 2);
  ctx.fillStyle = '#d9d9d6';
  ctx.fillRect(0, 0, size, size);
  ctx.fillRect(size, size, size, size);
  checkerCache = c;
  return c;
}
