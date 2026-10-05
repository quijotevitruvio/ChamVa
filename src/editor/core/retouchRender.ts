// Composición de la capa de retoque sobre la fuente (DOM). La usan IGUAL el lienzo, la exportación
// (PNG/JPG/PDF/SVG), las miniaturas y las páginas apiladas: `composeRetouch` es la única función que
// une «fuente + retoque»; después se aplican recorte, volteo, ajustes, máscara y forma como siempre.
import { validRetouch, type RetouchRef } from './retouch';

const cache = new Map<string, Promise<HTMLImageElement>>();

/** Carga (con caché corta) una imagen por src. */
export function loadImageEl(src: string): Promise<HTMLImageElement> {
  const hit = cache.get(src);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      cache.delete(src);
      reject(new Error('No se pudo cargar la imagen'));
    };
    img.src = src;
  });
  if (cache.size >= 6) cache.delete(cache.keys().next().value as string);
  cache.set(src, p);
  return p;
}

const dims = (s: CanvasImageSource): { w: number; h: number } => {
  const o = s as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return { w: o.naturalWidth || (o.width as number) || 0, h: o.naturalHeight || (o.height as number) || 0 };
};

/** Fuente + retoque en un lienzo del tamaño de la fuente. */
export function composeRetouch(base: CanvasImageSource, patch: CanvasImageSource, ref: RetouchRef): HTMLCanvasElement {
  const { w, h } = dims(base);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  const kx = w / ref.bw;
  const ky = h / ref.bh;
  if (kx === 1 && ky === 1) ctx.drawImage(patch, ref.x, ref.y);
  else {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(patch, ref.x * kx, ref.y * ky, ref.w * kx, ref.h * ky);
  }
  return c;
}

/** Imagen de la capa con su retoque (o la misma imagen si no tiene). */
export async function applyRetouch(base: CanvasImageSource, layer: { retouch?: unknown }): Promise<CanvasImageSource> {
  const ref = validRetouch(layer.retouch);
  if (!ref) return base;
  try {
    return composeRetouch(base, await loadImageEl(ref.src), ref);
  } catch {
    return base; // retoque ilegible: la capa se ve sin él en lugar de fallar
  }
}
