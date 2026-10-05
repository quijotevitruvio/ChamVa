// Recorte no destructivo de capas de imagen (lógica pura, sin DOM).
//
// Modelo: la capa conserva `src` entero y guarda `crop` = región visible en fracciones 0..1 de la
// imagen completa, en coordenadas de la FUENTE (sin volteo). `naturalWidth/Height` pasan a ser las
// del trozo visible, así todo lo que mide la capa (caja, transformador, restricciones, informes)
// sigue igual. Al dibujar, `processImage` toma solo esa región de la fuente y luego voltea.
//
// Unidades «naturales completas»: el sistema en que la imagen entera mide fullSize(layer). El
// editor de recorte trabaja en el marco LOCAL de la capa, ya volteado («display»): el punto (0,0)
// es la esquina de la imagen completa tal y como se ve, y la capa se dibuja desde crop.x/crop.y.
import type { ImageCrop, ImageLayer } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  w: number;
  h: number;
}

const EPS = 1e-6;

// Quita el error de coma flotante cuando el valor es casi entero (4000/0.37*0.37 → 4000).
export function snap(v: number): number {
  const r = Math.round(v);
  return Math.abs(v - r) < EPS * Math.max(1, Math.abs(v)) ? r : v;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Recorte guardado válido (o undefined): números finitos, dentro de 0..1, con área y sin cubrir
// toda la imagen. Tolera el error de redondeo en los bordes.
export function validCrop(c: unknown): ImageCrop | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const { x, y, w, h } = c as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return undefined;
  if (x < -EPS || y < -EPS || w <= EPS || h <= EPS) return undefined;
  if (x + w > 1 + EPS || y + h > 1 + EPS) return undefined;
  const cx = Math.max(0, x);
  const cy = Math.max(0, y);
  const cw = Math.min(w, 1 - cx);
  const ch = Math.min(h, 1 - cy);
  if (cx < EPS && cy < EPS && cw > 1 - EPS && ch > 1 - EPS) return undefined;
  return { x: cx, y: cy, w: cw, h: ch };
}

type CropLike = Pick<ImageLayer, 'naturalWidth' | 'naturalHeight' | 'crop'>;

// Tamaño de la imagen completa en unidades naturales (sin recorte = naturalWidth/Height).
export function fullSize(l: CropLike): Size {
  const c = validCrop(l.crop);
  if (!c) return { w: l.naturalWidth, h: l.naturalHeight };
  return { w: snap(l.naturalWidth / c.w), h: snap(l.naturalHeight / c.h) };
}

// Región visible en unidades naturales completas, coordenadas de la fuente (sin volteo).
export function sourceBox(l: CropLike): Box {
  const c = validCrop(l.crop);
  if (!c) return { x: 0, y: 0, w: l.naturalWidth, h: l.naturalHeight };
  const f = fullSize(l);
  return { x: snap(c.x * f.w), y: snap(c.y * f.h), w: l.naturalWidth, h: l.naturalHeight };
}

// Fuente ↔ marco visto (volteado). Es su propia inversa.
export function flipBox(b: Box, full: Size, flipX: boolean, flipY: boolean): Box {
  return {
    x: flipX ? snap(full.w - b.x - b.w) : b.x,
    y: flipY ? snap(full.h - b.y - b.h) : b.y,
    w: b.w,
    h: b.h,
  };
}

// Recorte actual en el marco local volteado (lo que el editor de recorte precarga).
export function displayBox(l: CropLike & Pick<ImageLayer, 'flipX' | 'flipY'>): Box {
  return flipBox(sourceBox(l), fullSize(l), !!l.flipX, !!l.flipY);
}

// Intersección con la imagen completa; null si queda vacía (recorte fuera de límites).
export function clampBox(b: Box, full: Size): Box | null {
  if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) return null;
  const x0 = Math.max(0, Math.min(b.x, b.x + b.w));
  const y0 = Math.max(0, Math.min(b.y, b.y + b.h));
  const x1 = Math.min(full.w, Math.max(b.x, b.x + b.w));
  const y1 = Math.min(full.h, Math.max(b.y, b.y + b.h));
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Mueve una caja (sin cambiar su tamaño, salvo que no quepa) para que quede dentro de la imagen.
export function moveInside(b: Box, full: Size): Box {
  const w = Math.min(Math.abs(b.w), full.w);
  const h = Math.min(Math.abs(b.h), full.h);
  const x = Math.max(0, Math.min(full.w - w, Number.isFinite(b.x) ? b.x : 0));
  const y = Math.max(0, Math.min(full.h - h, Number.isFinite(b.y) ? b.y : 0));
  return { x, y, w, h };
}

// Bordes a píxel entero (de las unidades naturales completas) dentro de la imagen; mínimo 1.
export function snapBox(b: Box, full: Size): Box {
  const fx = Math.max(1, Math.floor(full.w));
  const fy = Math.max(1, Math.floor(full.h));
  let x0 = Math.min(Math.max(0, Math.round(b.x)), fx - 1);
  let y0 = Math.min(Math.max(0, Math.round(b.y)), fy - 1);
  let x1 = Math.round(b.x + b.w);
  let y1 = Math.round(b.y + b.h);
  // El borde que toca el final de la imagen va al final exacto (imágenes de tamaño no entero).
  const right = x1 >= fx ? full.w : Math.max(x0 + 1, x1);
  const bottom = y1 >= fy ? full.h : Math.max(y0 + 1, y1);
  x1 = right;
  y1 = bottom;
  if (x1 - x0 < 1) x0 = Math.max(0, x1 - 1);
  if (y1 - y0 < 1) y0 = Math.max(0, y1 - 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Ajusta la caja a una proporción VISTA (ancho/alto en pantalla, con la escala de la capa).
export function fitAspect(b: Box, aspect: number, scaleX: number, scaleY: number, full: Size): Box {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return b;
  const k = Math.abs(scaleX || 1) / Math.abs(scaleY || 1); // unidades locales: alto = ancho·k/aspect
  let w = b.w;
  let h = (w * k) / aspect;
  if (h > full.h) {
    h = full.h;
    w = (h * aspect) / k;
  }
  if (w > full.w) {
    w = full.w;
    h = (w * k) / aspect;
  }
  return moveInside({ x: b.x, y: b.y, w, h }, full);
}

// Nueva posición del origen de la capa cuando el recorte visto pasa de `from` a `to`: el origen
// local es la esquina del recorte, así que se desplaza (to-from) en el marco girado y escalado
// de la capa (Konva: T(x,y)·R(rot)·S(sx,sy)). La imagen no se mueve en el lienzo.
export function originFor(
  l: Pick<ImageLayer, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>,
  from: Box,
  to: Box,
): { x: number; y: number } {
  const lx = (to.x - from.x) * l.scaleX;
  const ly = (to.y - from.y) * l.scaleY;
  const r = ((l.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: l.x + lx * cos - ly * sin, y: l.y + lx * sin + ly * cos };
}

export interface CropPatch {
  crop: ImageCrop | undefined;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
}

// Cambios de la capa para dejar visible `disp` (marco local volteado, unidades naturales completas).
// null si el recorte queda vacío. `crop: undefined` = imagen entera (restablecer).
export function cropPatch(
  l: CropLike & Pick<ImageLayer, 'flipX' | 'flipY' | 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>,
  disp: Box,
): CropPatch | null {
  const full = fullSize(l);
  const clamped = clampBox(disp, full);
  if (!clamped) return null;
  const d = snapBox(clamped, full);
  const src = flipBox(d, full, !!l.flipX, !!l.flipY);
  const whole = d.x === 0 && d.y === 0 && d.w === full.w && d.h === full.h;
  const crop = whole
    ? undefined
    : validCrop({ x: src.x / full.w, y: src.y / full.h, w: src.w / full.w, h: src.h / full.h });
  const pos = originFor(l, displayBox(l), d);
  return {
    crop,
    naturalWidth: crop ? d.w : full.w,
    naturalHeight: crop ? d.h : full.h,
    x: pos.x,
    y: pos.y,
  };
}

// Rectángulo de origen en píxeles reales de la imagen cargada (drawImage). null = imagen entera.
export function cropPixelRect(crop: ImageCrop | undefined, imgW: number, imgH: number): Box | null {
  const c = validCrop(crop);
  if (!c || !(imgW > 0) || !(imgH > 0)) return null;
  return { x: snap(c.x * imgW), y: snap(c.y * imgH), w: Math.max(EPS, snap(c.w * imgW)), h: Math.max(EPS, snap(c.h * imgH)) };
}

// Tamaño real de cualquier CanvasImageSource (img, canvas, bitmap, vídeo).
export function sourcePixels(img: unknown): Size {
  const o = img as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: unknown; height?: unknown };
  const w = o.naturalWidth || o.videoWidth || (typeof o.width === 'number' ? o.width : 0);
  const h = o.naturalHeight || o.videoHeight || (typeof o.height === 'number' ? o.height : 0);
  return { w: w || 0, h: h || 0 };
}

// Migración idempotente al abrir un proyecto: quita recortes inválidos sin tocar nada más.
export function normalizeImageCrops<T extends { layers: { type: string }[] }>(doc: T): T {
  for (const l of doc.layers) {
    if (l.type !== 'image' || !('crop' in l)) continue;
    const il = l as unknown as ImageLayer;
    const c = validCrop(il.crop);
    if (c) il.crop = c;
    else delete il.crop;
  }
  return doc;
}
