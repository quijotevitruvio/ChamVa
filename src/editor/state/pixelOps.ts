// Acciones de selección de píxeles y de máscaras de capa (sobre el store). La lógica de píxeles es
// pura (core/selection.ts, core/layerMask.ts); aquí se muestrea el lienzo, se llama al worker si
// hace falta y se aplica el resultado al documento con UN paso de deshacer por acción.
import { create } from 'zustand';
import { useEditor } from './store';
import { useTool } from './toolStore';
import type { Doc, ImageLayer, Layer } from '../core/types';
import { DEFAULT_ADJUST, NO_SHADOW } from '../core/types';
import {
  combine,
  emptySelection,
  invertSel,
  isEmptySel,
  rasterizePolygon,
  selBounds,
  selectionToPlane,
  smoothPolygon,
  type PixelSelection,
  type SelCombine,
  type SelJob,
} from '../core/selection';
import { runSelJobAsync } from '../core/selectionAsync';
import {
  editableAlpha,
  layerMatrix,
  rasterMask,
  rasterResolution,
  solidMask,
  vectorMask,
  withAlpha,
  type LayerMask,
  type MaskRect,
  type VectorMaskShape,
} from '../core/layerMask';
import {
  drawImageBody,
  drawMaskedLayer,
  drawShapeBody,
  drawStrokeBody,
  drawTextBody,
  contentBounds,
  layerLocalBox,
  maskCanvasesNow,
  maskPlaneFinal,
  prepareMask,
} from '../core/maskRender';
import { cropPixelRect } from '../core/imageCrop';
import { needsProcessing, processImageAsync } from '../core/imageProcessing';
import { preloadFxImages } from '../core/imageEffects';
import { preloadTextFxImages } from '../core/textFx';
import { defaultFields } from '../core/textMacros';
import { renderDocToCanvas, downloadBlob } from '../../io/export';
import { toast } from '../../ui/toast';

// ---------------------------------------------------------------------------
// Opciones de las herramientas (solo interfaz; se recuerdan en este equipo)
// ---------------------------------------------------------------------------

export interface SelOpts {
  tolerance: number; // 0..255
  contiguous: boolean;
  antiAlias: boolean;
  sampleAll: boolean; // muestrear todo el diseño (si no, la capa seleccionada)
  lassoPoly: boolean; // lazo poligonal (clic por clic)
  lassoSmooth: boolean;
  rangeColor: string;
  rangeFuzz: number;
}
export interface MaskBrushOpts {
  size: number; // diámetro en px del documento
  hardness: number;
  opacity: number;
}
interface OptsState {
  sel: SelOpts;
  brush: MaskBrushOpts;
  setSel: (p: Partial<SelOpts>) => void;
  setBrush: (p: Partial<MaskBrushOpts>) => void;
}
const LS = 'chamva.pixelSel';
function loadOpts(): { sel?: Partial<SelOpts>; brush?: Partial<MaskBrushOpts> } {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}');
  } catch {
    return {};
  }
}
const saved = loadOpts();
export const usePixelOpts = create<OptsState>((set, get) => ({
  sel: {
    tolerance: 32,
    contiguous: true,
    antiAlias: true,
    sampleAll: false,
    lassoPoly: false,
    lassoSmooth: false,
    rangeColor: '#ffffff',
    rangeFuzz: 40,
    ...saved.sel,
  },
  brush: { size: 60, hardness: 0.7, opacity: 1, ...saved.brush },
  setSel: (p) => {
    set((s) => ({ sel: { ...s.sel, ...p } }));
    persist(get());
  },
  setBrush: (p) => {
    set((s) => ({ brush: { ...s.brush, ...p } }));
    persist(get());
  },
}));
function persist(s: OptsState) {
  try {
    localStorage.setItem(LS, JSON.stringify({ sel: s.sel, brush: s.brush }));
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const st = () => useEditor.getState();
const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

function fieldsNow() {
  const s = st();
  return defaultFields({ pagina: String(s.pageIndex + 1), total: String(s.pages.length), diseno: s.doc.name });
}

export function selectedLayer(): Layer | null {
  const s = st();
  return s.doc.layers.find((l) => l.id === s.selectedId) ?? null;
}

/** Selección vigente de ESTE documento (una de otra página/diseño no vale). */
export function currentSel(): (PixelSelection & { docId?: string }) | null {
  const s = st();
  const sel = s.pixelSel as (PixelSelection & { docId?: string }) | null;
  if (!sel || (sel.docId && sel.docId !== s.doc.id)) return null;
  const e = emptySelection(s.doc.width, s.doc.height);
  if (e.w !== sel.w || e.h !== sel.h) return null;
  return sel;
}

function setSel(data: Uint8Array | null) {
  const s = st();
  if (!data || isEmptySel(data)) {
    s.setPixelSel(null);
    return;
  }
  const e = emptySelection(s.doc.width, s.doc.height);
  s.setPixelSel({ ...e, data, docId: s.doc.id } as PixelSelection);
}

function applyCombine(next: Uint8Array, mode: SelCombine) {
  const prev = currentSel()?.data ?? null;
  setSel(combine(prev, next, mode));
}

// Muestra RGBA del documento (o de una capa sola) a la resolución de la selección. Se guarda la última.
let sampleCache: { key: unknown[]; data: Uint8ClampedArray } | null = null;
async function sampleRGBA(doc: Doc, layerId: string | null): Promise<{ data: Uint8ClampedArray; w: number; h: number; scale: number }> {
  const e = emptySelection(doc.width, doc.height);
  const key = [doc.layers, doc.background, layerId, e.w, e.h];
  if (sampleCache && sampleCache.key.length === key.length && sampleCache.key.every((k, i) => k === key[i]))
    return { data: sampleCache.data, w: e.w, h: e.h, scale: e.scale };
  const only: Doc = layerId
    ? { ...doc, masterId: undefined, background: { type: 'transparent' }, layers: doc.layers.filter((l) => l.id === layerId) }
    : doc;
  const c = await renderDocToCanvas(only, e.scale);
  const data = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, e.w, e.h).data;
  sampleCache = { key, data };
  return { data, w: e.w, h: e.h, scale: e.scale };
}

function sampleTarget(): string | null {
  if (usePixelOpts.getState().sel.sampleAll) return null;
  return selectedLayer()?.id ?? null;
}

// ---------------------------------------------------------------------------
// Crear selecciones
// ---------------------------------------------------------------------------

/** Varita en un punto del documento. */
export async function wandAt(docX: number, docY: number, mode: SelCombine) {
  const o = usePixelOpts.getState().sel;
  const s = await sampleRGBA(st().doc, sampleTarget());
  const job: SelJob = { kind: 'wand', x: docX * s.scale, y: docY * s.scale, tolerance: o.tolerance, contiguous: o.contiguous, antiAlias: o.antiAlias };
  const out = await runSelJobAsync(job, s.data, s.w, s.h);
  applyCombine(out, mode);
}

/** Selección por rango de color (global y suave). */
export async function colorRangeSelect(mode: SelCombine = 'replace') {
  const o = usePixelOpts.getState().sel;
  const hex = o.rangeColor.replace('#', '');
  const color: [number, number, number] = [parseInt(hex.slice(0, 2), 16) || 0, parseInt(hex.slice(2, 4), 16) || 0, parseInt(hex.slice(4, 6), 16) || 0];
  const s = await sampleRGBA(st().doc, sampleTarget());
  const out = await runSelJobAsync({ kind: 'range', color, fuzziness: o.rangeFuzz }, s.data, s.w, s.h);
  applyCombine(out, mode);
}

/** Lazo/polígono: puntos [x,y,…] en coordenadas del documento. */
export function lassoSelect(docPts: number[], mode: SelCombine) {
  const o = usePixelOpts.getState().sel;
  const e = emptySelection(st().doc.width, st().doc.height);
  let pts = docPts.map((v) => v * e.scale);
  if (o.lassoSmooth) pts = smoothPolygon(pts, 2);
  applyCombine(rasterizePolygon(pts, e.w, e.h, o.antiAlias), mode);
}

export function selectAllPixels() {
  const s = st();
  const e = emptySelection(s.doc.width, s.doc.height);
  setSel(new Uint8Array(e.w * e.h).fill(255));
}
export const deselectPixels = () => st().setPixelSel(null);
export function invertPixels() {
  const s = st();
  const sel = currentSel();
  const e = emptySelection(s.doc.width, s.doc.height);
  setSel(sel ? invertSel(sel.data) : new Uint8Array(e.w * e.h).fill(255));
}

/** Expandir (+r) / contraer (−r), suavizar o desvanecer la selección (r en px del documento). */
export async function modifySelection(kind: 'grow' | 'smooth' | 'feather', rDoc: number) {
  const sel = currentSel();
  if (!sel) return toast('No hay ninguna selección.', 'info');
  const r = rDoc * sel.scale;
  const out = await runSelJobAsync({ kind, r } as SelJob, sel.data, sel.w, sel.h);
  setSel(out);
}

// ---------------------------------------------------------------------------
// Máscaras de capa
// ---------------------------------------------------------------------------

/** Píxeles de máscara por px local: imagen = sus píxeles; el resto, según lo grande que se ve. */
export function maskK(l: Layer): number {
  if (l.type === 'image') return 1;
  return Math.min(4, Math.max(1, Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY))));
}

export function maskRectFor(l: Layer): MaskRect {
  const b = layerLocalBox(l, fieldsNow());
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

function setMask(id: string, mask: LayerMask | undefined) {
  st().updateLayer(id, { mask } as Partial<Layer>);
}

/** Contenido de la capa sola (sin máscara ni sombra) sobre la rejilla w×h que cubre `rect` local. */
async function renderLayerLocal(l: Layer, rect: MaskRect, w: number, h: number): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(w / rect.w, 0, 0, h / rect.h, (-rect.x * w) / rect.w, (-rect.y * h) / rect.h);
  if (l.type === 'image') {
    const img = await loadImg(l.src);
    await preloadFxImages(l.adjust);
    const src = needsProcessing(l) ? await processImageAsync(img, l, Math.max(w, h) * 1.01, { label: 'Máscara' }) : img;
    drawImageBody(ctx, src, l.naturalWidth, l.naturalHeight, l.maskShape);
  } else if (l.type === 'shape') drawShapeBody(ctx, l, 1);
  else if (l.type === 'text') {
    await preloadTextFxImages(l);
    drawTextBody(ctx, l, fieldsNow());
  } else drawStrokeBody(ctx, l);
  return c;
}

export type AddMaskKind = 'white' | 'black' | 'selection' | 'alpha' | 'ellipse' | 'rect' | 'linear' | 'radial';

export async function addMask(kind: AddMaskKind, layerId?: string) {
  const l = layerId ? st().doc.layers.find((x) => x.id === layerId) : selectedLayer();
  if (!l) return toast('Selecciona una capa.', 'info');
  const rect = maskRectFor(l);
  const k = maskK(l);
  let mask: LayerMask;
  if (kind === 'white' || kind === 'black') mask = solidMask(rect, kind === 'white' ? 255 : 0, k);
  else if (kind === 'selection') {
    const sel = currentSel();
    if (!sel) return toast('Primero haz una selección (varita o lazo).', 'info');
    const { w, h } = rasterResolution(rect, k);
    mask = rasterMask(rect, w, h, await selToPlaneAsync(sel, l, rect, w, h), 0);
  } else if (kind === 'alpha') {
    const { w, h } = rasterResolution(rect, k);
    const c = await renderLayerLocal(l, rect, w, h);
    const d = c.getContext('2d')!.getImageData(0, 0, w, h).data;
    const a = new Uint8Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    mask = rasterMask(rect, w, h, a, 0);
  } else {
    const shape: VectorMaskShape =
      kind === 'ellipse'
        ? { type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.42, ry: 0.42 }
        : kind === 'rect'
          ? { type: 'rect', cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4 }
          : kind === 'linear'
            ? { type: 'linear', x0: 0.5, y0: 1, x1: 0.5, y1: 0.45 }
            : { type: 'radial', cx: 0.5, cy: 0.5, r0: 0.25, r1: 0.55 };
    const feather = kind === 'ellipse' || kind === 'rect' ? Math.round(Math.min(rect.w, rect.h) * 0.04) : 0;
    mask = vectorMask(rect, shape, feather);
  }
  if (l.mask) toast('La máscara anterior se ha sustituido (Ctrl+Z la recupera).', 'info');
  setMask(l.id, mask);
  st().setMaskEdit(l.id);
}

export function patchMask(id: string, patch: Partial<LayerMask>, live = false) {
  const l = st().doc.layers.find((x) => x.id === id);
  if (!l?.mask) return;
  const mask = { ...l.mask, ...patch } as LayerMask;
  for (const k of Object.keys(patch) as (keyof LayerMask)[]) if (patch[k] === undefined) delete mask[k];
  if (live) st().updateLayerLive(id, { mask } as Partial<Layer>);
  else setMask(id, mask);
}

export const toggleMaskEnabled = (id: string) => {
  const l = st().doc.layers.find((x) => x.id === id);
  if (l?.mask) patchMask(id, { enabled: l.mask.enabled === false ? undefined : false });
};
export const invertMask = (id: string) => {
  const l = st().doc.layers.find((x) => x.id === id);
  if (l?.mask) patchMask(id, { invert: l.mask.invert ? undefined : true, ...(l.mask.kind === 'raster' ? {} : {}) });
};
export const removeMask = (id: string) => {
  if (st().maskEditId === id) st().setMaskEdit(null);
  setMask(id, undefined);
};

/** Máscara → selección (Ctrl+clic en la miniatura en otros programas). */
export async function maskToSelection(id: string) {
  const l = st().doc.layers.find((x) => x.id === id);
  if (!l?.mask) return;
  const p = await maskPlaneFinal(l.mask);
  if (!p) return;
  const doc = st().doc;
  const e = emptySelection(doc.width, doc.height);
  // Muestreo inverso: documento → local con la matriz inversa de la capa.
  const c = document.createElement('canvas');
  c.width = e.w;
  c.height = e.h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const [a, b, cc, d, ee, f] = layerMatrix(l);
  ctx.setTransform(a * e.scale, b * e.scale, cc * e.scale, d * e.scale, ee * e.scale, f * e.scale);
  if (p.outside === 255) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(-1e6, -1e6, 2e6, 2e6);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(maskCanvasesNow(l.mask)!.inverse, l.mask.rect.x, l.mask.rect.y, l.mask.rect.w, l.mask.rect.h);
  } else ctx.drawImage(maskCanvasesNow(l.mask)!.normal, l.mask.rect.x, l.mask.rect.y, l.mask.rect.w, l.mask.rect.h);
  const data = ctx.getImageData(0, 0, e.w, e.h).data;
  const out = new Uint8Array(e.w * e.h);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3];
  setSel(out);
}

/**
 * Multiplica la máscara VISIBLE de la capa por (1 − selección): lo seleccionado queda oculto.
 * Sin máscara crea una blanca (todo visible) y le resta la selección. Devuelve la máscara nueva.
 */
async function maskMinusSelection(l: Layer, sel: PixelSelection): Promise<LayerMask> {
  const base = l.mask ?? solidMask(maskRectFor(l), 255, maskK(l));
  const ed = editableAlpha(base, maskK(l))!;
  const s = await selToPlaneAsync(sel, l, base.rect, ed.w, ed.h);
  const out = new Uint8Array(ed.alpha.length);
  for (let i = 0; i < out.length; i++) {
    const keep = 255 - s[i];
    // Con la máscara invertida el valor visible es 255 − alfa.
    out[i] = base.invert ? 255 - Math.round(((255 - ed.alpha[i]) * keep) / 255) : Math.round((ed.alpha[i] * keep) / 255);
  }
  return withAlpha(base, ed.w, ed.h, out);
}

/** Selección → plano de la máscara local (en el worker si es grande: a 12 MP pasa de 50 ms). */
function selToPlaneAsync(sel: PixelSelection, l: Layer, rect: MaskRect, mw: number, mh: number): Promise<Uint8Array> {
  if (mw * mh < 1_000_000) return Promise.resolve(selectionToPlane(sel, layerMatrix(l), rect, mw, mh));
  return runSelJobAsync({ kind: 'toPlane', scale: sel.scale, m: layerMatrix(l), rect, mw, mh }, sel.data, sel.w, sel.h, { label: 'Máscara' });
}

/** Convierte la selección en máscara de la capa seleccionada (sustituye la que tuviera). */
export const selectionToMask = () => addMask('selection');

// ---------------------------------------------------------------------------
// Acciones con la selección
// ---------------------------------------------------------------------------

/** Píxeles visibles de lo seleccionado (una capa, o todo el diseño) recortados a la selección. */
async function selectedPixels(sourceId: string | null): Promise<{ canvas: HTMLCanvasElement; x: number; y: number } | null> {
  const sel = currentSel();
  if (!sel) {
    toast('No hay ninguna selección.', 'info');
    return null;
  }
  const doc = st().doc;
  const only: Doc = sourceId
    ? { ...doc, masterId: undefined, background: { type: 'transparent' }, layers: doc.layers.filter((l) => l.id === sourceId) }
    : doc;
  const full = await renderDocToCanvas(only, 1);
  // Selección como alfa a resolución del documento.
  const sc = document.createElement('canvas');
  sc.width = sel.w;
  sc.height = sel.h;
  const sctx = sc.getContext('2d')!;
  const img = sctx.createImageData(sel.w, sel.h);
  for (let i = 0; i < sel.data.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = sel.data[i];
  }
  sctx.putImageData(img, 0, 0);
  const fctx = full.getContext('2d')!;
  fctx.globalCompositeOperation = 'destination-in';
  fctx.drawImage(sc, 0, 0, full.width, full.height);
  const b = selBounds(sel.data, sel.w, sel.h);
  if (!b) return null;
  const x = Math.max(0, Math.floor(b.x / sel.scale));
  const y = Math.max(0, Math.floor(b.y / sel.scale));
  const w = Math.min(full.width - x, Math.ceil((b.x + b.w) / sel.scale) - x);
  const h = Math.min(full.height - y, Math.ceil((b.y + b.h) / sel.scale) - y);
  if (w < 1 || h < 1) return null;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(full, x, y, w, h, 0, 0, w, h);
  return { canvas: out, x, y };
}

function imageLayerAt(src: string, x: number, y: number, w: number, h: number, name: string): ImageLayer {
  return {
    id: uid(),
    type: 'image',
    name,
    src,
    naturalWidth: w,
    naturalHeight: h,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    adjust: { ...DEFAULT_ADJUST },
    filter: 'none',
    flipX: false,
    flipY: false,
    ...NO_SHADOW,
  };
}

/** Copiar (o cortar) lo seleccionado a una capa nueva encima. Cortar oculta esos píxeles en la capa
 *  original con su máscara (no destructivo). Un solo paso de deshacer. */
export async function copySelectionToLayer(cut = false) {
  const src = usePixelOpts.getState().sel.sampleAll ? null : selectedLayer();
  if (cut && !src) return toast('Para cortar, selecciona la capa de la que se corta.', 'info');
  const px = await selectedPixels(src?.id ?? null);
  if (!px) return;
  const sel = currentSel()!;
  const layer = imageLayerAt(px.canvas.toDataURL('image/png'), px.x, px.y, px.canvas.width, px.canvas.height, cut ? 'Recorte' : 'Copia de selección');
  const newMask = cut && src ? await maskMinusSelection(src, sel) : null;
  st().editDoc((d) => {
    const layers = d.layers.map((l) => (newMask && l.id === src!.id ? ({ ...l, mask: newMask } as Layer) : l));
    const idx = src ? layers.findIndex((l) => l.id === src.id) : layers.length - 1;
    layers.splice(idx + 1, 0, layer);
    return { ...d, layers };
  });
  st().selectLayer(layer.id);
}

/** Borrar lo seleccionado de la capa: lo oculta con su máscara (no destructivo). */
export async function deleteSelectionInLayer() {
  const l = selectedLayer();
  const sel = currentSel();
  if (!l || !sel) return toast('Selecciona una capa y una zona.', 'info');
  const m = await maskMinusSelection(l, sel);
  // La capa pudo cambiar mientras tanto (otro gesto): solo si sigue siendo la misma.
  if (st().doc.layers.find((x) => x.id === l.id) === l) setMask(l.id, m);
}

/** Rellena la selección con un color en una capa nueva. */
export function fillSelection(color: string) {
  const sel = currentSel();
  if (!sel) return toast('No hay ninguna selección.', 'info');
  const b = selBounds(sel.data, sel.w, sel.h);
  if (!b) return;
  const c = document.createElement('canvas');
  c.width = b.w;
  c.height = b.h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, b.w, b.h);
  const img = ctx.getImageData(0, 0, b.w, b.h);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) img.data[(y * b.w + x) * 4 + 3] = sel.data[(b.y + y) * sel.w + b.x + x];
  ctx.putImageData(img, 0, 0);
  const s = sel.scale;
  const layer = imageLayerAt(c.toDataURL('image/png'), b.x / s, b.y / s, b.w, b.h, 'Relleno');
  layer.scaleX = layer.scaleY = 1 / s;
  const cur = selectedLayer();
  st().editDoc((d) => {
    const layers = [...d.layers];
    const idx = cur ? layers.findIndex((l) => l.id === cur.id) : layers.length - 1;
    layers.splice(idx + 1, 0, layer);
    return { ...d, layers };
  });
  st().selectLayer(layer.id);
}

/** Descarga lo seleccionado como PNG (con transparencia). */
export async function exportSelection() {
  const src = usePixelOpts.getState().sel.sampleAll ? null : selectedLayer();
  const px = await selectedPixels(src?.id ?? null);
  if (!px) return;
  const blob = await new Promise<Blob | null>((r) => px.canvas.toBlob(r, 'image/png'));
  if (blob) await downloadBlob(blob, `${(st().doc.name || 'chamva').replace(/[^\w-]+/g, '_')}-seleccion.png`);
}

// ---------------------------------------------------------------------------
// Aplicar (hornear) la máscara
// ---------------------------------------------------------------------------

/**
 * Imagen: multiplica el alfa de `src` por la máscara (mismos ajustes, que siguen editables) y quita
 * la máscara. Otras capas: se convierten en imagen con la máscara aplicada (ya no son editables como
 * texto/forma; Ctrl+Z lo deshace).
 */
export async function applyMask(id: string) {
  const l = st().doc.layers.find((x) => x.id === id);
  if (!l?.mask) return;
  await prepareMask(l.mask);
  const mc = maskCanvasesNow(l.mask);
  if (!mc) return toast('La máscara no está disponible.', 'error');
  const r = l.mask.rect;
  if (l.type === 'image') {
    const img = await loadImg(l.src);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    // Marco local (recortado y volteado) → píxeles de la fuente.
    const cr = cropPixelRect(l.crop, W, H) ?? { x: 0, y: 0, w: W, h: H };
    const kx = cr.w / l.naturalWidth;
    const ky = cr.h / l.naturalHeight;
    ctx.setTransform(l.flipX ? -kx : kx, 0, 0, l.flipY ? -ky : ky, l.flipX ? cr.x + cr.w : cr.x, l.flipY ? cr.y + cr.h : cr.y);
    ctx.globalCompositeOperation = mc.outside === 0 ? 'destination-in' : 'destination-out';
    if (mc.outside === 0) ctx.drawImage(mc.normal, r.x, r.y, r.w, r.h);
    else ctx.drawImage(mc.inverse, r.x, r.y, r.w, r.h);
    if (st().maskEditId === id) st().setMaskEdit(null);
    st().updateLayer(id, { src: c.toDataURL('image/png'), mask: undefined } as Partial<Layer>);
    return;
  }
  // Rasterizar: contenido + máscara en su caja local, a la resolución con que se ve (×2 como mínimo).
  const B = contentBounds(l, fieldsNow());
  const k = Math.min(4, Math.max(2, Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY)) * 2));
  const w = Math.max(1, Math.ceil(B.w * k));
  const h = Math.max(1, Math.ceil(B.h * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, -B.x * k, -B.y * k);
  if (l.type === 'text') await preloadTextFxImages(l);
  const fields = fieldsNow();
  drawMaskedLayer(ctx, {
    mask: l.mask,
    bounds: B,
    maxSide: 16384,
    body: (b) => {
      if (l.type === 'shape') drawShapeBody(b, l, k);
      else if (l.type === 'text') drawTextBody(b, l, fields);
      else if (l.type === 'stroke') drawStrokeBody(b, l);
    },
  });
  const [a, bb, cc, d, e, f] = layerMatrix(l);
  const img = imageLayerAt(c.toDataURL('image/png'), a * B.x + cc * B.y + e, bb * B.x + d * B.y + f, w, h, l.name);
  Object.assign(img, {
    id: l.id,
    rotation: l.rotation,
    scaleX: (l.scaleX * B.w) / w,
    scaleY: (l.scaleY * B.h) / h,
    opacity: l.opacity,
    blendMode: l.blendMode,
    groupId: l.groupId,
    folderId: l.folderId,
    anim: l.anim,
    animOut: l.animOut,
    animDuration: l.animDuration,
    ...(l.type === 'shape' ? { shadow: l.shadow, shadowColor: l.shadowColor, shadowBlur: l.shadowBlur, shadowX: l.shadowX, shadowY: l.shadowY } : {}),
  });
  if (st().maskEditId === id) st().setMaskEdit(null);
  st().editDoc((dd) => ({ ...dd, layers: dd.layers.map((x) => (x.id === id ? img : x)) }));
}

/** Herramientas de selección activas. */
export const isSelTool = (t: string) => t === 'wand' || t === 'lasso';
export const activateTool = (t: 'wand' | 'lasso') => useTool.getState().setTool(t);
