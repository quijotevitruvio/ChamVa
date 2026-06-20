import { create } from 'zustand';
import {
  DEFAULT_ADJUST,
  NO_SHADOW,
  TRANSPARENT_BG,
  type Background,
  type Doc,
  type ImageLayer,
  type Layer,
  type TextLayer,
  canvasFont,
  transformText,
  type ShapeKind,
  type ShapeLayer,
  type UploadedImage,
  type SavedTemplate,
} from '../core/types';
import { loadStoredFonts } from '../core/fonts';
import { idbGet, idbSet } from '../../io/idb';

// Subidos y plantillas se guardan en IndexedDB (idb.ts), hidratados al iniciar.

// Persistencia simple del Kit de Marca y colores recientes.
const LS_BRAND = 'chamva.brandColors';
const LS_RECENT = 'chamva.recentColors';
function loadColors(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function saveColors(key: string, colors: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(colors));
  } catch {
    /* noop */
  }
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const HISTORY_LIMIT = 80;

// Caja aproximada (sin rotación) de una capa, para alinear/distribuir.
const measureCtx = document.createElement('canvas').getContext('2d')!;
function layerBox(l: Layer): { x: number; y: number; w: number; h: number } {
  if (l.type === 'image')
    return { x: l.x, y: l.y, w: l.naturalWidth * l.scaleX, h: l.naturalHeight * l.scaleY };
  if (l.type === 'shape')
    return { x: l.x, y: l.y, w: l.width * l.scaleX, h: l.height * l.scaleY };
  measureCtx.font = canvasFont(l);
  const lines = transformText(l.text, l.textTransform).split('\n');
  const w = Math.max(0, ...lines.map((s) => measureCtx.measureText(s).width)) * l.scaleX;
  return { x: l.x, y: l.y, w, h: lines.length * l.fontSize * l.scaleY };
}

function emptyDoc(): Doc {
  return {
    id: uid(),
    name: 'Diseño sin título',
    width: 1080,
    height: 1080,
    background: TRANSPARENT_BG, // transparente por defecto (sin restricciones)
    layers: [],
    version: 1,
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignKind =
  | 'left'
  | 'centerH'
  | 'right'
  | 'top'
  | 'centerV'
  | 'bottom';

interface EditorState {
  doc: Doc;
  selectedId: string | null;
  selectedIds: string[];
  past: Doc[];
  future: Doc[];
  brandColors: string[];
  recentColors: string[];
  customFonts: string[];
  uploads: UploadedImage[];
  templates: SavedTemplate[];
  cropMode: boolean;
  cropRect: Rect | null;
  cropAspect: number | null; // ancho/alto fijo, null = libre
  textEditNonce: number;
  animPlayNonce: number;
  selRect: { left: number; top: number; width: number } | null;
  zoom: number; // multiplicador de zoom del usuario (1 = ajustar)
  viewScale: number; // escala aplicada real (para mostrar %)
  pages: Doc[];
  pageIndex: number;

  // documento / lienzo
  setCanvasSize: (width: number, height: number) => void;
  setBackground: (background: Background) => void;
  setDocName: (name: string) => void;
  loadDoc: (doc: Doc) => void;

  // páginas
  addPage: () => void;
  addResizedPage: (width: number, height: number) => void;
  switchPage: (i: number) => void;
  deletePage: (i: number) => void;
  reorderPages: (from: number, to: number) => void;
  loadPages: (pages: Doc[], index: number) => void;

  // colores
  addBrandColor: (color: string) => void;
  removeBrandColor: (color: string) => void;

  // fuentes propias
  addCustomFont: (family: string) => void;

  // galería de subidos
  hydrate: () => void;
  addUpload: (img: UploadedImage) => void;
  removeUpload: (id: string) => void;

  // plantillas
  addTemplate: (t: SavedTemplate) => void;
  removeTemplate: (id: string) => void;
  applyTemplate: (doc: Doc) => void;

  // capas
  addImageLayer: (img: {
    src: string;
    naturalWidth: number;
    naturalHeight: number;
    name?: string;
    iconName?: string;
  }) => void;
  addTextLayer: (preset?: {
    text: string;
    fontSize: number;
    bold: boolean;
  }) => void;
  addShapeLayer: (kind: ShapeKind) => void;
  reorderLayers: (orderBottomFirst: string[]) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  updateLayerLive: (id: string, patch: Partial<Layer>) => void; // sin historial
  checkpoint: () => void; // guarda un punto de deshacer antes de una edición en vivo
  addProcessedLayer: (sourceId: string, newSrc: string, name: string) => void;
  replaceLayerImage: (
    id: string,
    img: { src: string; naturalWidth: number; naturalHeight: number; x: number; y: number },
  ) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  pasteLayer: (layer: Layer) => void;
  selectLayer: (id: string | null) => void;
  clickSelect: (id: string, additive: boolean) => void;
  removeSelected: () => void;
  requestTextEdit: (id: string) => void;
  playAnimations: () => void;
  setSelRect: (r: { left: number; top: number; width: number } | null) => void;
  setZoom: (z: number) => void;
  setViewScale: (s: number) => void;
  moveLayer: (id: string, dir: 'up' | 'down') => void;
  alignLayer: (id: string, kind: AlignKind) => void;
  alignSelected: (kind: AlignKind) => void;
  distributeSelected: (axis: 'h' | 'v') => void;

  // recorte
  beginCrop: () => void;
  setCropRect: (rect: Rect) => void;
  setCropAspect: (aspect: number | null) => void;
  cancelCrop: () => void;

  // historial
  undo: () => void;
  redo: () => void;
}

// Helper: aplica un cambio al documento registrándolo en el historial.
function commit(s: EditorState, newDoc: Doc): Partial<EditorState> {
  if (newDoc === s.doc) return {};
  return {
    doc: newDoc,
    past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
    future: [],
  };
}

const FIRST_DOC = emptyDoc();

export const useEditor = create<EditorState>((set) => ({
  doc: FIRST_DOC,
  selectedId: null,
  selectedIds: [],
  past: [],
  future: [],
  brandColors: loadColors(LS_BRAND),
  recentColors: loadColors(LS_RECENT),
  customFonts: loadStoredFonts(),
  uploads: [],
  templates: [],
  cropMode: false,
  cropRect: null,
  cropAspect: null,
  textEditNonce: 0,
  animPlayNonce: 0,
  selRect: null,
  zoom: 1,
  viewScale: 1,
  pages: [FIRST_DOC],
  pageIndex: 0,

  setCanvasSize: (width, height) =>
    set((s) => commit(s, { ...s.doc, width, height })),

  setBackground: (background) =>
    set((s) => {
      const base = commit(s, { ...s.doc, background });
      if (background.type === 'solid') {
        const recent = [
          background.color,
          ...s.recentColors.filter((c) => c !== background.color),
        ].slice(0, 12);
        saveColors(LS_RECENT, recent);
        return { ...base, recentColors: recent };
      }
      return base;
    }),

  addBrandColor: (color) =>
    set((s) => {
      if (s.brandColors.includes(color)) return {};
      const brand = [...s.brandColors, color].slice(0, 24);
      saveColors(LS_BRAND, brand);
      return { brandColors: brand };
    }),

  removeBrandColor: (color) =>
    set((s) => {
      const brand = s.brandColors.filter((c) => c !== color);
      saveColors(LS_BRAND, brand);
      return { brandColors: brand };
    }),

  addCustomFont: (family) =>
    set((s) =>
      s.customFonts.includes(family)
        ? {}
        : { customFonts: [...s.customFonts, family] },
    ),

  hydrate: async () => {
    const uploads = (await idbGet<UploadedImage[]>('uploads')) ?? [];
    const templates = (await idbGet<SavedTemplate[]>('templates')) ?? [];
    set({ uploads, templates });
  },

  addUpload: (img) =>
    set((s) => {
      const uploads = [img, ...s.uploads].slice(0, 40);
      idbSet('uploads', uploads);
      return { uploads };
    }),

  removeUpload: (id) =>
    set((s) => {
      const uploads = s.uploads.filter((u) => u.id !== id);
      idbSet('uploads', uploads);
      return { uploads };
    }),

  addTemplate: (t) =>
    set((s) => {
      const templates = [t, ...s.templates].slice(0, 30);
      idbSet('templates', templates);
      return { templates };
    }),

  removeTemplate: (id) =>
    set((s) => {
      const templates = s.templates.filter((t) => t.id !== id);
      idbSet('templates', templates);
      return { templates };
    }),

  applyTemplate: (doc) =>
    set((s) => {
      const clone = JSON.parse(JSON.stringify(doc)) as Doc;
      clone.id = uid();
      return {
        ...commit(s, clone),
        selectedId: null,
      };
    }),

  setDocName: (name) => set((s) => commit(s, { ...s.doc, name })),

  loadDoc: (doc) =>
    set({ doc, pages: [doc], pageIndex: 0, selectedId: null, past: [], future: [] }),

  addPage: () =>
    set((s) => {
      const synced = s.pages.map((p, i) => (i === s.pageIndex ? s.doc : p));
      const blank: Doc = {
        ...emptyDoc(),
        width: s.doc.width,
        height: s.doc.height,
        name: `Página ${synced.length + 1}`,
      };
      return {
        pages: [...synced, blank],
        doc: blank,
        pageIndex: synced.length,
        selectedId: null,
        past: [],
        future: [],
        cropMode: false,
        cropRect: null,
      };
    }),

  addResizedPage: (width, height) =>
    set((s) => {
      const synced = s.pages.map((p, i) => (i === s.pageIndex ? s.doc : p));
      const cur = s.doc;
      const factor = Math.min(width / cur.width, height / cur.height);
      const offX = (width - cur.width * factor) / 2;
      const offY = (height - cur.height * factor) / 2;
      const scaled = JSON.parse(JSON.stringify(cur)) as Doc;
      scaled.id = uid();
      scaled.width = width;
      scaled.height = height;
      scaled.name = `${cur.name} ${width}×${height}`;
      scaled.layers = scaled.layers.map((l) => ({
        ...l,
        x: l.x * factor + offX,
        y: l.y * factor + offY,
        scaleX: l.scaleX * factor,
        scaleY: l.scaleY * factor,
      }));
      return {
        pages: [...synced, scaled],
        doc: scaled,
        pageIndex: synced.length,
        selectedId: null,
        selectedIds: [],
        past: [],
        future: [],
      };
    }),

  switchPage: (i) =>
    set((s) => {
      if (i === s.pageIndex || i < 0 || i >= s.pages.length) return {};
      const synced = s.pages.map((p, idx) => (idx === s.pageIndex ? s.doc : p));
      return {
        pages: synced,
        doc: synced[i],
        pageIndex: i,
        selectedId: null,
        past: [],
        future: [],
        cropMode: false,
        cropRect: null,
      };
    }),

  deletePage: (i) =>
    set((s) => {
      if (s.pages.length <= 1) return {};
      const synced = s.pages.map((p, idx) => (idx === s.pageIndex ? s.doc : p));
      const pages = synced.filter((_, idx) => idx !== i);
      const idx = Math.min(
        i < s.pageIndex ? s.pageIndex - 1 : s.pageIndex,
        pages.length - 1,
      );
      return {
        pages,
        doc: pages[idx],
        pageIndex: idx,
        selectedId: null,
        past: [],
        future: [],
      };
    }),

  reorderPages: (from, to) =>
    set((s) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= s.pages.length ||
        to >= s.pages.length
      )
        return {};
      const synced = s.pages.map((p, idx) => (idx === s.pageIndex ? s.doc : p));
      const arr = [...synced];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      const current = synced[s.pageIndex];
      const newIndex = arr.indexOf(current);
      return { pages: arr, pageIndex: newIndex, doc: arr[newIndex] };
    }),

  loadPages: (pages, index) =>
    set({
      pages,
      doc: pages[index] ?? pages[0],
      pageIndex: pages[index] ? index : 0,
      selectedId: null,
      past: [],
      future: [],
    }),

  addImageLayer: ({ src, naturalWidth, naturalHeight, name, iconName }) =>
    set((s) => {
      const fit = Math.min(
        1,
        (s.doc.width * 0.8) / naturalWidth,
        (s.doc.height * 0.8) / naturalHeight,
      );
      const layer: ImageLayer = {
        id: uid(),
        type: 'image',
        name: name ?? `Imagen ${s.doc.layers.length + 1}`,
        src,
        naturalWidth,
        naturalHeight,
        x: (s.doc.width - naturalWidth * fit) / 2,
        y: (s.doc.height - naturalHeight * fit) / 2,
        scaleX: fit,
        scaleY: fit,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
        adjust: { ...DEFAULT_ADJUST },
        filter: 'none',
        flipX: false,
        flipY: false,
        iconName,
        ...NO_SHADOW,
      };
      return {
        ...commit(s, { ...s.doc, layers: [...s.doc.layers, layer] }),
        selectedId: layer.id,
      };
    }),

  addTextLayer: (preset) =>
    set((s) => {
      const fontSize = preset?.fontSize ?? 48;
      const layer: TextLayer = {
        id: uid(),
        type: 'text',
        name: preset?.text ?? 'Texto',
        text: preset?.text ?? 'Escribe aquí',
        fontFamily: 'Arial',
        fontSize,
        fill: '#ffffff',
        align: 'left',
        bold: preset?.bold ?? false,
        italic: false,
        textTransform: 'none',
        letterSpacing: 0,
        strokeColor: '#000000',
        strokeWidth: 0,
        shadow: false,
        shadowColor: '#000000',
        shadowBlur: 6,
        shadowX: 2,
        shadowY: 2,
        x: s.doc.width * 0.15,
        y: s.doc.height / 2 - fontSize / 2,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
      };
      return {
        ...commit(s, { ...s.doc, layers: [...s.doc.layers, layer] }),
        selectedId: layer.id,
      };
    }),

  addShapeLayer: (kind) =>
    set((s) => {
      const stroke = kind === 'line' || kind === 'arrow';
      const w = Math.round(s.doc.width * (stroke ? 0.4 : 0.3));
      const h = stroke ? Math.round(s.doc.height * 0.06) : w;
      const layer: ShapeLayer = {
        id: uid(),
        type: 'shape',
        name:
          kind === 'rect'
            ? 'Rectángulo'
            : kind === 'ellipse'
              ? 'Círculo'
              : kind === 'triangle'
                ? 'Triángulo'
                : kind === 'star'
                  ? 'Estrella'
                  : kind === 'line'
                    ? 'Línea'
                    : 'Flecha',
        shape: kind,
        width: w,
        height: h,
        fill: '#6c8cff',
        stroke: '#ffffff',
        strokeWidth: stroke ? 6 : 0,
        cornerRadius: kind === 'rect' ? 0 : 0,
        x: (s.doc.width - w) / 2,
        y: (s.doc.height - h) / 2,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
        ...NO_SHADOW,
      };
      return {
        ...commit(s, { ...s.doc, layers: [...s.doc.layers, layer] }),
        selectedId: layer.id,
      };
    }),

  reorderLayers: (orderBottomFirst) =>
    set((s) => {
      const map = new Map(s.doc.layers.map((l) => [l.id, l]));
      const layers = orderBottomFirst
        .map((id) => map.get(id))
        .filter((l): l is Layer => !!l);
      if (layers.length !== s.doc.layers.length) return {};
      return commit(s, { ...s.doc, layers });
    }),

  updateLayer: (id, patch) =>
    set((s) =>
      commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((l) =>
          l.id === id ? ({ ...l, ...patch } as Layer) : l,
        ),
      }),
    ),

  updateLayerLive: (id, patch) =>
    set((s) => ({
      doc: {
        ...s.doc,
        layers: s.doc.layers.map((l) =>
          l.id === id ? ({ ...l, ...patch } as Layer) : l,
        ),
      },
    })),

  checkpoint: () =>
    set((s) => ({ past: [...s.past, s.doc].slice(-HISTORY_LIMIT), future: [] })),

  addProcessedLayer: (sourceId, newSrc, name) =>
    set((s) => {
      const src = s.doc.layers.find((l) => l.id === sourceId);
      if (!src || src.type !== 'image') return {};
      // Recorte limpio: sin filtros/volteo heredados.
      const layer: ImageLayer = {
        ...src,
        id: uid(),
        src: newSrc,
        originalSrc: src.src, // para poder "Restaurar" lo borrado de más
        name,
        adjust: { ...DEFAULT_ADJUST },
        filter: 'none',
        flipX: false,
        flipY: false,
      };
      const idx = s.doc.layers.findIndex((l) => l.id === sourceId);
      // Ocultar la original (no destructivo) y poner la recortada encima.
      const layers = s.doc.layers.map((l) =>
        l.id === sourceId ? { ...l, visible: false } : l,
      );
      layers.splice(idx + 1, 0, layer);
      return {
        ...commit(s, { ...s.doc, layers }),
        selectedId: layer.id,
      };
    }),

  replaceLayerImage: (id, img) =>
    set((s) =>
      commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((l) =>
          l.id === id && l.type === 'image'
            ? {
                ...l,
                src: img.src,
                originalSrc: undefined, // el recorte cambia dimensiones; ya no alinea
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
                x: img.x,
                y: img.y,
                adjust: { ...DEFAULT_ADJUST },
                filter: 'none',
                flipX: false,
                flipY: false,
              }
            : l,
        ),
      }),
    ),

  removeLayer: (id) =>
    set((s) => ({
      ...commit(s, {
        ...s.doc,
        layers: s.doc.layers.filter((l) => l.id !== id),
      }),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  duplicateLayer: (id) =>
    set((s) => {
      const l = s.doc.layers.find((x) => x.id === id);
      if (!l) return {};
      const copy = { ...l, id: uid(), x: l.x + 24, y: l.y + 24 } as Layer;
      const idx = s.doc.layers.findIndex((x) => x.id === id);
      const layers = [...s.doc.layers];
      layers.splice(idx + 1, 0, copy);
      return { ...commit(s, { ...s.doc, layers }), selectedId: copy.id };
    }),

  pasteLayer: (layer) =>
    set((s) => {
      const copy = { ...layer, id: uid(), x: layer.x + 24, y: layer.y + 24 } as Layer;
      return {
        ...commit(s, { ...s.doc, layers: [...s.doc.layers, copy] }),
        selectedId: copy.id,
      };
    }),

  selectLayer: (id) =>
    set({ selectedId: id, selectedIds: id ? [id] : [] }),

  clickSelect: (id, additive) =>
    set((s) => {
      if (!additive) return { selectedId: id, selectedIds: [id] };
      const has = s.selectedIds.includes(id);
      const selectedIds = has
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id];
      return {
        selectedIds,
        selectedId: selectedIds[selectedIds.length - 1] ?? null,
      };
    }),

  removeSelected: () =>
    set((s) => {
      const ids = s.selectedIds.length
        ? s.selectedIds
        : s.selectedId
          ? [s.selectedId]
          : [];
      if (!ids.length) return {};
      return {
        ...commit(s, {
          ...s.doc,
          layers: s.doc.layers.filter((l) => !ids.includes(l.id)),
        }),
        selectedId: null,
        selectedIds: [],
      };
    }),

  requestTextEdit: (id) =>
    set((s) => ({ selectedId: id, textEditNonce: s.textEditNonce + 1 })),

  playAnimations: () =>
    set((s) => ({ animPlayNonce: s.animPlayNonce + 1 })),

  setSelRect: (r) => set({ selRect: r }),

  setZoom: (z) => set({ zoom: Math.max(0.1, Math.min(5, z)) }),
  setViewScale: (s) => set({ viewScale: s }),

  moveLayer: (id, dir) =>
    set((s) => {
      const idx = s.doc.layers.findIndex((l) => l.id === id);
      if (idx < 0) return {};
      const target = dir === 'up' ? idx + 1 : idx - 1;
      if (target < 0 || target >= s.doc.layers.length) return {};
      const layers = [...s.doc.layers];
      [layers[idx], layers[target]] = [layers[target], layers[idx]];
      return commit(s, { ...s.doc, layers });
    }),

  alignLayer: (id, kind) =>
    set((s) => {
      const l = s.doc.layers.find((x) => x.id === id);
      if (!l || l.type !== 'image') return {};
      const w = l.naturalWidth * l.scaleX;
      const h = l.naturalHeight * l.scaleY;
      let { x, y } = l;
      if (kind === 'left') x = 0;
      else if (kind === 'centerH') x = (s.doc.width - w) / 2;
      else if (kind === 'right') x = s.doc.width - w;
      else if (kind === 'top') y = 0;
      else if (kind === 'centerV') y = (s.doc.height - h) / 2;
      else if (kind === 'bottom') y = s.doc.height - h;
      return commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((x2) => (x2.id === id ? { ...x2, x, y } : x2)),
      });
    }),

  alignSelected: (kind) =>
    set((s) => {
      const items = s.selectedIds
        .map((id) => s.doc.layers.find((l) => l.id === id))
        .filter((l): l is Layer => !!l);
      if (items.length < 2) return {};
      const boxes = items.map(layerBox);
      const minX = Math.min(...boxes.map((b) => b.x));
      const maxX = Math.max(...boxes.map((b) => b.x + b.w));
      const minY = Math.min(...boxes.map((b) => b.y));
      const maxY = Math.max(...boxes.map((b) => b.y + b.h));
      const cX = (minX + maxX) / 2;
      const cY = (minY + maxY) / 2;
      const pos = new Map<string, { x?: number; y?: number }>();
      items.forEach((l, i) => {
        const b = boxes[i];
        if (kind === 'left') pos.set(l.id, { x: minX });
        else if (kind === 'right') pos.set(l.id, { x: maxX - b.w });
        else if (kind === 'centerH') pos.set(l.id, { x: cX - b.w / 2 });
        else if (kind === 'top') pos.set(l.id, { y: minY });
        else if (kind === 'bottom') pos.set(l.id, { y: maxY - b.h });
        else if (kind === 'centerV') pos.set(l.id, { y: cY - b.h / 2 });
      });
      return commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((l) =>
          pos.has(l.id) ? ({ ...l, ...pos.get(l.id) } as Layer) : l,
        ),
      });
    }),

  distributeSelected: (axis) =>
    set((s) => {
      const items = s.selectedIds
        .map((id) => s.doc.layers.find((l) => l.id === id))
        .filter((l): l is Layer => !!l);
      if (items.length < 3) return {};
      const withBox = items.map((l) => ({ l, b: layerBox(l) }));
      withBox.sort((p, q) =>
        axis === 'h'
          ? p.b.x + p.b.w / 2 - (q.b.x + q.b.w / 2)
          : p.b.y + p.b.h / 2 - (q.b.y + q.b.h / 2),
      );
      const f = withBox[0];
      const lst = withBox[withBox.length - 1];
      const c0 = axis === 'h' ? f.b.x + f.b.w / 2 : f.b.y + f.b.h / 2;
      const c1 = axis === 'h' ? lst.b.x + lst.b.w / 2 : lst.b.y + lst.b.h / 2;
      const step = (c1 - c0) / (withBox.length - 1);
      const pos = new Map<string, { x?: number; y?: number }>();
      withBox.forEach((it, i) => {
        if (i === 0 || i === withBox.length - 1) return;
        const center = c0 + step * i;
        if (axis === 'h') pos.set(it.l.id, { x: center - it.b.w / 2 });
        else pos.set(it.l.id, { y: center - it.b.h / 2 });
      });
      return commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((l) =>
          pos.has(l.id) ? ({ ...l, ...pos.get(l.id) } as Layer) : l,
        ),
      });
    }),

  beginCrop: () =>
    set((s) => {
      const l = s.doc.layers.find((x) => x.id === s.selectedId);
      if (!l || l.type !== 'image') return {};
      return {
        cropMode: true,
        cropAspect: null,
        cropRect: {
          x: l.x,
          y: l.y,
          width: l.naturalWidth * l.scaleX,
          height: l.naturalHeight * l.scaleY,
        },
      };
    }),

  setCropRect: (rect) => set({ cropRect: rect }),

  setCropAspect: (aspect) =>
    set((s) => {
      if (!s.cropRect || !aspect) return { cropAspect: aspect };
      // Reajusta el rect actual al nuevo aspecto, conservando el ancho.
      const width = s.cropRect.width;
      return {
        cropAspect: aspect,
        cropRect: { ...s.cropRect, height: width / aspect },
      };
    }),

  cancelCrop: () => set({ cropMode: false, cropRect: null, cropAspect: null }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const previous = s.past[s.past.length - 1];
      return {
        doc: previous,
        past: s.past.slice(0, -1),
        future: [s.doc, ...s.future].slice(0, HISTORY_LIMIT),
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[0];
      return {
        doc: next,
        past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
      };
    }),
}));
