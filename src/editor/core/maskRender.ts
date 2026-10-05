// Dibujo de capas CON máscara (DOM). Lo usan IGUAL el lienzo (Konva, MaskedLayerNode) y la
// exportación (renderDocToCanvas → PNG/JPG/WebP/PDF/miniaturas/PageStill/lote): la misma función
// `drawMaskedLayer` con el mismo contenido y la misma máscara; solo cambia la resolución.
//
// Método: el contenido de la capa se dibuja en su marco LOCAL sobre un lienzo auxiliar alineado con
// los píxeles del destino (escala = la del contexto), se recorta con la máscara (destination-in, o
// destination-out con la inversa si fuera del rect es visible) y se compone de una vez sobre el
// destino con la opacidad, el modo de fusión y la sombra de la capa. Así la sombra sale de lo
// visible, igual que en el SVG (<g sombra><g mask>…</g></g>).
//
// Las capas SIN máscara no pasan por aquí: se dibujan exactamente como antes.
import type { Layer, LayerShadow, ShapeKind, ShapeLayer, StrokeLayer, TextLayer } from './types';
import { maskActive, maskPlane, decodeAlpha, planeScale, type LayerMask, type MaskPlane } from './layerMask';
import { featherAlphaAsync } from './selectionAsync';
import { canvasGradient } from './gradients';
import { fillDither } from './grain';
import { isStrokeOnly, shapePath } from './shapes';
import { drawStroke } from './brush';
import { drawCurvedText, measureCurved } from './curvedText';
import { drawStyledText, measureStyledText } from './styledText';
import { hasPathText } from './textFx';
import type { FieldValues } from './textMacros';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Contenido de cada tipo de capa (marco local, SIN sombra de imagen/forma)
// ---------------------------------------------------------------------------

/** Forma: mismo dibujo que la exportación (relleno, degradado, tramado, contorno). */
export function drawShapeBody(ctx: CanvasRenderingContext2D, layer: ShapeLayer, ditherScale: number) {
  shapePath(ctx, layer.shape, layer.width, layer.height, layer.cornerRadius);
  if (!isStrokeOnly(layer.shape)) {
    ctx.fillStyle = layer.fillGradient ? canvasGradient(ctx, layer.fillGradient, layer.width, layer.height) : layer.fill;
    ctx.fill();
  }
  if (layer.fillGradient?.dither && !isStrokeOnly(layer.shape)) {
    ctx.save();
    ctx.clip();
    fillDither(ctx, layer.width, layer.height, ditherScale);
    ctx.restore();
  }
  if (layer.strokeWidth > 0 || isStrokeOnly(layer.shape)) {
    ctx.strokeStyle = layer.strokeGradient ? canvasGradient(ctx, layer.strokeGradient, layer.width, layer.height) : layer.stroke;
    ctx.lineWidth = isStrokeOnly(layer.shape) ? Math.max(2, layer.strokeWidth) : layer.strokeWidth;
    ctx.stroke();
  }
}

/** Texto: el mismo dibujo de la exportación (con su propia sombra y efectos). */
export function drawTextBody(ctx: CanvasRenderingContext2D, layer: TextLayer, fields?: Partial<FieldValues>) {
  if ((layer.curve && layer.curve !== 0) || hasPathText(layer)) {
    const cm = measureCurved(ctx, layer);
    drawCurvedText(ctx, layer, cm.width, cm.height);
    return;
  }
  drawStyledText(ctx, layer, fields);
}

export function drawStrokeBody(ctx: CanvasRenderingContext2D, layer: StrokeLayer) {
  drawStroke(ctx, layer);
}

/** Imagen ya procesada (filtros, recorte, volteo), con su recorte a forma si lo tiene. */
export function drawImageBody(ctx: CanvasRenderingContext2D, source: CanvasImageSource, w: number, h: number, maskShape?: ShapeKind) {
  if (maskShape) {
    ctx.save();
    shapePath(ctx, maskShape, w, h, 0);
    ctx.clip();
    ctx.drawImage(source, 0, 0, w, h);
    ctx.restore();
  } else ctx.drawImage(source, 0, 0, w, h);
}

const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

/** Caja local «de la capa» (la que se usa para crear su máscara): la del transformador. */
export function layerLocalBox(layer: Layer, fields?: Partial<FieldValues>): Box {
  if (layer.type === 'image') return { x: 0, y: 0, w: layer.naturalWidth, h: layer.naturalHeight };
  if (layer.type === 'shape' || layer.type === 'stroke') return { x: 0, y: 0, w: layer.width, h: layer.height };
  const ctx = measureCtx!;
  if ((layer.curve && layer.curve !== 0) || hasPathText(layer)) {
    const m = measureCurved(ctx, layer);
    return { x: 0, y: 0, w: Math.max(1, m.width), h: Math.max(1, m.height) };
  }
  const m = measureStyledText(ctx, layer, fields);
  return { x: 0, y: 0, w: Math.max(1, m.width), h: Math.max(1, m.height) };
}

/** Caja local que cubre TODO lo que la capa puede pintar (contorno, sombra del texto, efectos). */
export function contentBounds(layer: Layer, fields?: Partial<FieldValues>): Box {
  const b = layerLocalBox(layer, fields);
  let m = 2;
  if (layer.type === 'shape') m += Math.max(2, layer.strokeWidth);
  if (layer.type === 'text') {
    m += layer.fontSize * 0.6 + layer.strokeWidth * 2;
    if (layer.shadow) m += Math.abs(layer.shadowX) + Math.abs(layer.shadowY) + layer.shadowBlur * 2;
    if (layer.extrude) m += layer.extrude.depth;
    for (const o of layer.outlines ?? []) m += o.width;
  }
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
}

// ---------------------------------------------------------------------------
// Planos y lienzos de máscara (con caché)
// ---------------------------------------------------------------------------

interface Entry {
  plane: MaskPlane;
  full: boolean; // ya desvanecida (si hacía falta)
  normal?: HTMLCanvasElement; // blanco con alfa = máscara
  inverse?: HTMLCanvasElement; // blanco con alfa = 255 − máscara
}

const cache = new Map<string, Entry>();
const CACHE_MAX = 8;
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

/** Avisos de «una máscara terminó de calcularse» (el lienzo se repinta). */
export function onMaskReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const maskVersion = () => version;
function notify() {
  version++;
  for (const fn of listeners) fn();
}

export function maskKey(m: LayerMask): string {
  const flags = `${m.invert ? 1 : 0}|${m.outside ?? 0}|${m.feather ?? 0}`;
  if (m.kind === 'vector') return `v|${flags}|${m.rect.w}x${m.rect.h}|${JSON.stringify(m.shape)}`;
  return `r|${flags}|${m.w}x${m.h}|${m.data?.length ?? 0}|${m.data}`;
}

function remember(key: string, e: Entry) {
  cache.delete(key);
  cache.set(key, e);
  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

/** ¿Hay que desenfocar en un worker (máscara grande con feather)? */
function needsAsyncFeather(m: LayerMask): boolean {
  return m.kind === 'raster' && (m.feather ?? 0) > 0 && (m.w ?? 0) * (m.h ?? 0) >= 2_000_000;
}

function planeCanvas(p: MaskPlane, inverse: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = p.w;
  c.height = p.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(p.w, p.h);
  const d = img.data;
  for (let i = 0; i < p.alpha.length; i++) {
    const o = i * 4;
    d[o] = d[o + 1] = d[o + 2] = 255;
    d[o + 3] = inverse ? 255 - p.alpha[i] : p.alpha[i];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Máscaras «en vivo» mientras se pintan (MaskPaintOverlay): alfa sin desenfocar, se repinta por zonas.
interface Live {
  mask: LayerMask;
  w: number;
  h: number;
  alpha: Uint8Array;
  canvas: HTMLCanvasElement; // alfa visible (con inversión)
  inv: HTMLCanvasElement; // su inversa
  img: ImageData;
  imgInv: ImageData;
}
const live = new Map<string, Live>();

/** Empieza la vista en vivo de la máscara de una capa (el plano `alpha` se comparte, no se copia). */
export function setLiveMask(layerId: string, mask: LayerMask, w: number, h: number, alpha: Uint8Array) {
  const canvas = document.createElement('canvas');
  const inv = document.createElement('canvas');
  canvas.width = inv.width = w;
  canvas.height = inv.height = h;
  const img = canvas.getContext('2d')!.createImageData(w, h);
  const imgInv = inv.getContext('2d')!.createImageData(w, h);
  const l: Live = { mask, w, h, alpha, canvas, inv, img, imgInv };
  live.set(layerId, l);
  updateLiveMask(layerId, { x: 0, y: 0, w, h });
}

/** Repinta la zona `r` (píxeles del plano) de la vista en vivo. */
export function updateLiveMask(layerId: string, r: Box) {
  const l = live.get(layerId);
  if (!l) return;
  const inv = !!l.mask.invert;
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(l.w, r.x + r.w);
  const y1 = Math.min(l.h, r.y + r.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * l.w + x;
      const v = inv ? 255 - l.alpha[i] : l.alpha[i];
      const o = i * 4;
      l.img.data[o] = l.img.data[o + 1] = l.img.data[o + 2] = 255;
      l.img.data[o + 3] = v;
      l.imgInv.data[o] = l.imgInv.data[o + 1] = l.imgInv.data[o + 2] = 255;
      l.imgInv.data[o + 3] = 255 - v;
    }
  }
  if (x1 > x0 && y1 > y0) {
    l.canvas.getContext('2d')!.putImageData(l.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
    l.inv.getContext('2d')!.putImageData(l.imgInv, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }
}

export function clearLiveMask(layerId: string) {
  live.delete(layerId);
}

export interface MaskCanvases {
  w: number;
  h: number;
  outside: number;
  normal: HTMLCanvasElement;
  inverse: HTMLCanvasElement;
  plane: MaskPlane | null; // null en la vista en vivo
}

/**
 * Lienzos de la máscara, YA, sin esperar (para el lienzo de Konva). Si la versión final aún se está
 * calculando (desvanecido grande en el worker) devuelve la provisional sin desenfocar y avisa al
 * terminar (onMaskReady). null = no se puede (datos sin hidratar).
 */
export function maskCanvasesNow(mask: LayerMask, layerId?: string): MaskCanvases | null {
  const lv = layerId ? live.get(layerId) : undefined;
  if (lv) {
    const outside = mask.invert ? 255 - (mask.outside ?? 0) : mask.outside ?? 0;
    return { w: lv.w, h: lv.h, outside, normal: lv.canvas, inverse: lv.inv, plane: null };
  }
  const key = maskKey(mask);
  let e = cache.get(key);
  if (!e) {
    if (needsAsyncFeather(mask)) {
      const quick = maskPlane(mask, undefined, true);
      if (!quick) return null;
      e = { plane: quick, full: false };
      remember(key, e);
      void prepareMask(mask);
    } else {
      const p = maskPlane(mask);
      if (!p) return null;
      e = { plane: p, full: true };
      remember(key, e);
    }
  }
  if (!e.normal) e.normal = planeCanvas(e.plane, false);
  if (!e.inverse) e.inverse = planeCanvas(e.plane, true);
  return { w: e.plane.w, h: e.plane.h, outside: e.plane.outside, normal: e.normal, inverse: e.inverse, plane: e.plane };
}

/** Deja calculada la versión FINAL de la máscara (la exportación la espera antes de dibujar). */
export function prepareMask(mask: LayerMask): Promise<void> {
  const key = maskKey(mask);
  const e = cache.get(key);
  if (e?.full) return Promise.resolve();
  const p0 = pending.get(key);
  if (p0) return p0;
  const job = (async () => {
    try {
      let plane: MaskPlane | null;
      if (needsAsyncFeather(mask)) {
        const w = mask.w!;
        const h = mask.h!;
        const base = decodeAlpha(mask.data, w, h);
        if (!base) return;
        const blurred = await featherAlphaAsync(base, w, h, (mask.feather ?? 0) * planeScale(mask, w, h), { label: 'Desvanecer máscara' });
        // Ya desenfocada: el plano final solo invierte (sin volver a desenfocar).
        plane = maskPlane({ ...mask, feather: 0 }, blurred);
      } else plane = maskPlane(mask);
      if (!plane) return;
      remember(key, { plane, full: true });
      notify();
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}

/** Plano final (esperando el cálculo si hace falta), p. ej. para «Aplicar» o para la selección. */
export async function maskPlaneFinal(mask: LayerMask): Promise<MaskPlane | null> {
  await prepareMask(mask);
  const e = cache.get(maskKey(mask));
  return e?.full ? e.plane : maskPlane(mask);
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------

let scratchA: HTMLCanvasElement | null = null;
let scratchB: HTMLCanvasElement | null = null;
const scratch = (which: 'a' | 'b', w: number, h: number) => {
  let c = which === 'a' ? scratchA : scratchB;
  if (!c) {
    c = document.createElement('canvas');
    if (which === 'a') scratchA = c;
    else scratchB = c;
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  } else c.getContext('2d')!.clearRect(0, 0, w, h);
  return c;
};

export interface MaskedDrawOpts {
  mask: LayerMask;
  layerId?: string; // para la vista en vivo mientras se pinta
  bounds: Box; // caja local del contenido
  body: (c: CanvasRenderingContext2D) => void; // dibuja el contenido en coordenadas locales
  shadow?: Pick<LayerShadow, 'shadow' | 'shadowColor' | 'shadowBlur' | 'shadowX' | 'shadowY'>; // imagen/forma
  flipSign?: { x: number; y: number }; // signo de la escala de la capa (para la sombra)
  maxSide?: number; // tope del lienzo auxiliar (editor 4096, exportación 16384)
  overlay?: boolean; // editor: rojo donde la máscara oculta
  canvases?: MaskCanvases | null; // ya obtenidos (si no, maskCanvasesNow)
}

/**
 * Dibuja una capa enmascarada en `ctx`, cuyo transform ya está en el marco local de la capa y cuyo
 * globalAlpha / globalCompositeOperation son los de la capa. Devuelve false si la máscara no está
 * disponible (el llamador no dibuja nada: mejor oculto que mostrado de más).
 */
export function drawMaskedLayer(ctx: CanvasRenderingContext2D, o: MaskedDrawOpts): boolean {
  const mc = o.canvases ?? maskCanvasesNow(o.mask, o.layerId);
  if (!mc) return false;
  const r = o.mask.rect;
  // Fuera del rect oculto: solo hace falta lo que cae dentro.
  let B = o.bounds;
  if (mc.outside === 0) {
    const x0 = Math.max(B.x, r.x);
    const y0 = Math.max(B.y, r.y);
    const x1 = Math.min(B.x + B.w, r.x + r.w);
    const y1 = Math.min(B.y + B.h, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) return true; // nada visible
    B = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const T = ctx.getTransform();
  const axis = Math.abs(T.b) < 1e-9 && Math.abs(T.c) < 1e-9;
  let kx = axis ? Math.abs(T.a) : Math.hypot(T.a, T.b);
  let ky = axis ? Math.abs(T.d) : Math.hypot(T.c, T.d);
  if (!(kx > 0) || !(ky > 0)) return true;
  const maxSide = o.maxSide ?? 4096;
  let aligned = axis;
  const lim = Math.min(1, maxSide / Math.max(1, B.w * kx), maxSide / Math.max(1, B.h * ky));
  if (lim < 1) {
    kx *= lim;
    ky *= lim;
    aligned = false;
  }
  // Sin giro: el lienzo auxiliar se alinea con los píxeles del destino (sin remuestreo al componer).
  let bx = B.x;
  let by = B.y;
  let pw: number;
  let ph: number;
  if (aligned) {
    const dx0 = T.a * B.x + T.e;
    const dy0 = T.d * B.y + T.f;
    const dx1 = T.a * (B.x + B.w) + T.e;
    const dy1 = T.d * (B.y + B.h) + T.f;
    const left = Math.floor(Math.min(dx0, dx1));
    const top = Math.floor(Math.min(dy0, dy1));
    const right = Math.ceil(Math.max(dx0, dx1));
    const bottom = Math.ceil(Math.max(dy0, dy1));
    pw = Math.max(1, right - left);
    ph = Math.max(1, bottom - top);
    // Origen local que cae justo en la esquina (left/top) del destino, con el signo de la escala.
    bx = ((T.a > 0 ? left : right) - T.e) / T.a;
    by = ((T.d > 0 ? top : bottom) - T.f) / T.d;
  } else {
    pw = Math.max(1, Math.ceil(B.w * kx));
    ph = Math.max(1, Math.ceil(B.h * ky));
  }
  const lw = pw / kx; // tamaño local del lienzo auxiliar
  const lh = ph / ky;
  // Marco del auxiliar: su píxel (0,0) = punto local (ox,oy), el mínimo de la caja local cubierta
  // (con escala negativa ese punto cae en el borde derecho/inferior del destino, que es entero).
  const ox = bx;
  const oy = by;

  const A = scratch('a', pw, ph);
  const ac = A.getContext('2d')!;
  ac.setTransform(kx, 0, 0, ky, -ox * kx, -oy * ky);
  ac.imageSmoothingEnabled = true;
  ac.imageSmoothingQuality = 'high';
  o.body(ac);
  // Máscara.
  ac.globalCompositeOperation = mc.outside === 0 ? 'destination-in' : 'destination-out';
  ac.drawImage(mc.outside === 0 ? mc.normal : mc.inverse, r.x, r.y, r.w, r.h);
  ac.globalCompositeOperation = 'source-over';
  ac.setTransform(1, 0, 0, 1, 0, 0);

  ctx.save();
  if (o.shadow?.shadow) {
    const fx = o.flipSign?.x ?? 1;
    const fy = o.flipSign?.y ?? 1;
    const tx = Math.hypot(T.a, T.b);
    const ty = Math.hypot(T.c, T.d);
    ctx.shadowColor = o.shadow.shadowColor;
    ctx.shadowBlur = o.shadow.shadowBlur * Math.min(tx, ty);
    ctx.shadowOffsetX = o.shadow.shadowX * tx * fx;
    ctx.shadowOffsetY = o.shadow.shadowY * ty * fy;
  }
  ctx.drawImage(A, ox, oy, lw, lh);
  ctx.restore();

  if (o.overlay) {
    const Bc = scratch('b', pw, ph);
    const bc = Bc.getContext('2d')!;
    bc.setTransform(kx, 0, 0, ky, -ox * kx, -oy * ky);
    if (mc.outside === 0) {
      bc.fillStyle = '#ff2020';
      bc.fillRect(ox, oy, lw, lh);
      bc.globalCompositeOperation = 'destination-out';
      bc.drawImage(mc.normal, r.x, r.y, r.w, r.h);
    } else {
      bc.drawImage(mc.inverse, r.x, r.y, r.w, r.h);
      bc.globalCompositeOperation = 'source-in';
      bc.fillStyle = '#ff2020';
      bc.fillRect(ox, oy, lw, lh);
    }
    bc.globalCompositeOperation = 'source-over';
    bc.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(Bc, ox, oy, lw, lh);
    ctx.restore();
  }
  return true;
}

/** ¿La capa tiene una máscara que aplicar? (atajo para los nodos y la exportación) */
export function layerHasMask(l: Layer): boolean {
  return maskActive(l.mask);
}

/** PNG (blanco con alfa = máscara final) para el <mask> del SVG. */
export async function maskPngDataUrl(mask: LayerMask): Promise<{ url: string; outside: number } | null> {
  const p = await maskPlaneFinal(mask);
  if (!p) return null;
  return { url: planeCanvas(p, false).toDataURL('image/png'), outside: p.outside };
}
