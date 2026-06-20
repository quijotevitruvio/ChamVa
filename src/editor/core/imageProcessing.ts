import { DEFAULT_ADJUST, type ImageLayer } from './types';
import { applyOverlayDuotone, cssFor, getFilter } from './filters';

// String de filtro CSS (ajustes + filtro con nombre). Lo usan igual editor y export.
export function buildFilterString(layer: ImageLayer): string {
  return cssFor(getFilter(layer.filter), layer.adjust);
}

// ¿La capa tiene algún ajuste/filtro/volteo aplicado?
export function needsProcessing(layer: ImageLayer): boolean {
  const a = layer.adjust ?? DEFAULT_ADJUST;
  return (
    a.brightness !== 1 ||
    a.contrast !== 1 ||
    a.saturate !== 1 ||
    (!!layer.filter && layer.filter !== 'none') ||
    layer.flipX ||
    layer.flipY
  );
}

// Devuelve un canvas con filtros, tinte/duotono y volteo ya aplicados.
// maxSize limita la resolución (vista previa del editor); en export = Infinity.
export function processImage(
  img: CanvasImageSource,
  layer: ImageLayer,
  maxSize = Infinity,
): HTMLCanvasElement {
  const nw = layer.naturalWidth;
  const nh = layer.naturalHeight;
  const longest = Math.max(nw, nh);
  const scale = longest > maxSize ? maxSize / longest : 1;
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const def = getFilter(layer.filter);
  ctx.filter = cssFor(def, layer.adjust);
  ctx.translate(layer.flipX ? w : 0, layer.flipY ? h : 0);
  ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  ctx.drawImage(img, 0, 0, w, h);

  // Tinte/duotono se aplican sobre los píxeles ya dibujados.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  applyOverlayDuotone(ctx, w, h, def);

  return canvas;
}
