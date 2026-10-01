// Utilidades comunes de las herramientas de geometría de imagen (perspectiva, enderezar,
// censurar, mockups): hornear la capa a un lienzo y volver a escribirla como nueva `src`.
import type { ImageLayer } from '../editor/core/types';
import { useEditor } from '../editor/state/store';
import { needsProcessing, processImage } from '../editor/core/imageProcessing';

export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

// Imagen de la capa con filtros, ajustes y volteo ya aplicados, a su resolución natural.
export async function bakedCanvas(layer: ImageLayer): Promise<HTMLCanvasElement> {
  const img = await loadImg(layer.src);
  const processed = needsProcessing(layer) ? processImage(img, layer) : img;
  const c = document.createElement('canvas');
  c.width = layer.naturalWidth;
  c.height = layer.naturalHeight;
  c.getContext('2d')!.drawImage(processed, 0, 0, c.width, c.height);
  return c;
}

// Reduce un lienzo si su lado mayor supera `max`. Devuelve el factor aplicado (≤ 1).
export function limitCanvas(c: HTMLCanvasElement, max = 4096): { canvas: HTMLCanvasElement; k: number } {
  const longest = Math.max(c.width, c.height);
  if (longest <= max) return { canvas: c, k: 1 };
  const k = max / longest;
  const o = document.createElement('canvas');
  o.width = Math.max(1, Math.round(c.width * k));
  o.height = Math.max(1, Math.round(c.height * k));
  o.getContext('2d')!.drawImage(c, 0, 0, o.width, o.height);
  return { canvas: o, k };
}

// Sustituye la imagen de la capa por `canvas` (transformación de píxeles, destructiva) dejando
// el centro en su sitio. `density` = píxeles de la nueva imagen por píxel de la anterior
// (1 = misma densidad); la escala de la capa se ajusta para que no cambie de tamaño aparente.
export function commitCanvas(layerId: string, canvas: HTMLCanvasElement, density = 1): void {
  const st = useEditor.getState();
  const cur = st.doc.layers.find((l) => l.id === layerId);
  if (!cur || cur.type !== 'image') return;
  const rad = (cur.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rot = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const c0 = rot((cur.scaleX * cur.naturalWidth) / 2, (cur.scaleY * cur.naturalHeight) / 2);
  const cx = cur.x + c0.x;
  const cy = cur.y + c0.y;
  const sx = cur.scaleX / density;
  const sy = cur.scaleY / density;
  const c1 = rot((sx * canvas.width) / 2, (sy * canvas.height) / 2);
  st.beginBatch();
  st.replaceLayerImage(layerId, {
    src: canvas.toDataURL('image/png'),
    naturalWidth: canvas.width,
    naturalHeight: canvas.height,
    x: cx - c1.x,
    y: cy - c1.y,
  });
  if (density !== 1) st.updateLayer(layerId, { scaleX: sx, scaleY: sy });
  st.endBatch();
}

// Convierte coordenadas de ratón a píxeles de un lienzo mostrado con CSS.
export function toCanvasPoint(
  e: { clientX: number; clientY: number },
  el: HTMLElement,
  w: number,
  h: number,
): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * w,
    y: ((e.clientY - r.top) / r.height) * h,
  };
}
