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
  type ShapeKind,
  type ShapeLayer,
  type StrokeLayer,
  type BrushStyle,
  type BlendMode,
  type UploadedImage,
  type SavedTemplate,
} from '../core/types';
import { BRUSHES, buildStrokeGeometry } from '../core/brush';
import { displayBox, fitAspect, fullSize } from '../core/imageCrop';
import { jumpInHistory } from './historyLogic';
import { swap, type PageHist } from './pageHistory';
import { resolveDesignMeta, type DesignMeta } from './designIdentity';
import {
  MAX_TABS,
  TRANSIENT_RESET,
  findTabByDesign,
  freshSession,
  isBlankSession,
  nextActiveAfterClose,
  park,
  reorderTabList,
  unpark,
  type SessionSnapshot,
  type StructUndo,
  type TabMeta,
} from './sessions';
import { flushSave } from '../../io/autosave';
import { flushUndo } from '../../io/undoStore';
import { removeTab } from '../../io/tabsStore';
import { insertAt, patchTouchesGeometry } from '../core/pageOps';
import { resizeDocTo, type TargetSize } from '../core/libraryMeta';
import { similarLayerIds, stylePatch } from '../core/layerStyle';
import { NOTE_COLORS } from '../core/layout';
import { applyConstraints, resizeLayer } from '../core/constraints';
import { registerMasterPages } from '../core/master';
import type { StickyNote } from '../core/types';
import { loadStoredFonts } from '../core/fonts';
import {
  activeKit,
  createKit,
  deleteKit,
  duplicateKit,
  migrateKits,
  renameKit,
  updateKit,
  type BrandKit,
} from '../core/brandKits';
import { idbDelete, idbGet, idbSet } from '../../io/idb';
import {
  dehydrateTemplates,
  dehydrateUploads,
  rehydrateTemplates,
  rehydrateUploads,
} from '../../io/assets';
import {
  applySpanStyle,
  remapSpans,
  stripSpanKey,
  type SpanStyle,
} from '../core/richText';
import { measureStyledText } from '../core/styledText';
import type { PixelSelection } from '../core/selection';
import type { Unit } from '../core/units';
import { photoCanvas } from '../core/photoCanvas';
import {
  buildFontPairProps,
  buildTextLayerProps,
  getFontPair,
  getTextPreset,
  type MeasureFn,
} from '../core/textPresets';

// Fuentes de marca (nombres de familia) — pocas cadenas, van en localStorage.
const LS_BRAND_FONTS = 'chamva.brandFonts';
function loadBrandFonts(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_BRAND_FONTS) ?? '[]');
  } catch {
    return [];
  }
}

// Varios kits de marca. Metadatos (nombre, colores, fuentes) en localStorage;
// los logos en IndexedDB ('brandKitLogos': id de kit → logos por referencia).
// El kit único anterior (colores/fuentes/'brandLogos') migra al primer kit.
const LS_BRAND_KITS = 'chamva.brandKits';
const LS_BRAND_ACTIVE = 'chamva.brandKitActive';
function loadBrandKits(): { kits: BrandKit[]; activeId: string } {
  let raw: unknown;
  let activeId: string | null = null;
  try {
    raw = JSON.parse(localStorage.getItem(LS_BRAND_KITS) ?? 'null');
    activeId = localStorage.getItem(LS_BRAND_ACTIVE);
  } catch {
    /* noop */
  }
  const kits = migrateKits(
    raw,
    { colors: loadColors(LS_BRAND), fonts: loadBrandFonts(), logos: [] },
    () => uid(),
  );
  const id = activeKit(kits, activeId).id;
  // Primera vez: fija el id del kit migrado para que sus logos (IDB) lo encuentren.
  if (!Array.isArray(raw)) persistKits(kits, id, false);
  return { kits, activeId: id };
}
function persistKits(kits: BrandKit[], activeId: string, logosChanged: boolean) {
  try {
    localStorage.setItem(
      LS_BRAND_KITS,
      JSON.stringify(kits.map(({ logos: _l, ...meta }) => meta)),
    );
    localStorage.setItem(LS_BRAND_ACTIVE, activeId);
  } catch {
    /* noop */
  }
  if (!logosChanged) return;
  (async () => {
    const byKit: Record<string, UploadedImage[]> = {};
    for (const k of kits) byKit[k.id] = await dehydrateUploads(k.logos);
    await idbSet('brandKitLogos', byKit);
  })();
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

// Aplica un parche a una capa. Si cambia el texto de una capa de texto sin
// traer spans nuevos, reubica los tramos con estilo (negrita por palabra…).
function patchLayer(l: Layer, patch: Partial<Layer>): Layer {
  const p = patch as Partial<TextLayer>;
  if (l.type === 'text' && typeof p.text === 'string' && !('spans' in p)) {
    return { ...l, ...patch, spans: remapSpans(l.spans, l.text, p.text) } as Layer;
  }
  // Imagen recortada que recibe un tamaño natural nuevo sin recorte (otra gráfica, otra imagen):
  // el recorte guardado ya no corresponde y deformaría la capa, así que se quita.
  if (l.type === 'image' && l.crop && ('naturalWidth' in patch || 'naturalHeight' in patch) && !('crop' in patch)) {
    return { ...l, ...patch, crop: undefined } as Layer;
  }
  // Imagen nueva (quitar fondo, perspectiva, censurar…): el retoque se hizo sobre la anterior y ya no
  // alinea. Quien conserve el contenido (subir resolución) pasa `retouch` en el parche.
  if (l.type === 'image' && l.retouch && typeof (patch as { src?: string }).src === 'string' && (patch as { src: string }).src !== l.src && !('retouch' in patch)) {
    return { ...l, ...patch, retouch: undefined } as Layer;
  }
  return { ...l, ...patch } as Layer;
}

// Fusión: capas afectadas (ids dados o la selección, extendida a su grupo) y vista previa temporal.
let blendPreviewOrig: Record<string, BlendMode> | null = null;
function blendTargets(s: { doc: Doc; selectedIds: string[]; selectedId: string | null }, ids?: string[]): Set<string> {
  const base = ids ?? (s.selectedIds.length ? s.selectedIds : s.selectedId ? [s.selectedId] : []);
  const out = new Set(base);
  const groups = new Set(s.doc.layers.filter((l) => out.has(l.id) && l.groupId).map((l) => l.groupId));
  for (const l of s.doc.layers) if (l.groupId && groups.has(l.groupId)) out.add(l.id);
  return out;
}
function restoreBlends(doc: Doc, orig: Record<string, BlendMode>): Doc {
  return {
    ...doc,
    layers: doc.layers.map((l) => (l.id in orig && l.blendMode !== orig[l.id] ? ({ ...l, blendMode: orig[l.id] } as Layer) : l)),
  };
}

// Lote de cambios con UN solo paso de deshacer (arrastrar o transformar un
// grupo actualiza varias capas). Se cierra solo tras 15 s por seguridad.
let batching = false;
let batchTimer: ReturnType<typeof setTimeout> | undefined;
// Un lote abierto no debe cruzar a otra página ni a otro diseño: se cierra antes.
function endBatchNow() {
  batching = false;
  clearTimeout(batchTimer);
}

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
  if (l.type === 'shape' || l.type === 'stroke')
    return { x: l.x, y: l.y, w: l.width * l.scaleX, h: l.height * l.scaleY };
  // Misma medida que el dibujo real (estilo por palabra, fondo, interlineado).
  const m = measureStyledText(measureCtx, l);
  return { x: l.x, y: l.y, w: m.width * l.scaleX, h: m.height * l.scaleY };
}

const layerBox2 = (l: Layer) => {
  const b = layerBox(l);
  return { w: b.w, h: b.h };
};

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

export interface StrokeSpec {
  brush: BrushStyle;
  color: string;
  size: number;
  opacity: number;
  raw: number[]; // [x, y, presión, …] en coordenadas del documento
  seed?: number;
  blendMode?: BlendMode;
  select?: boolean; // por defecto true; el modo dibujo no selecciona cada trazo
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type NewDesignSize = { width: number; height: number; name?: string; unit?: Unit; dpi?: number };

// Página vacía de un diseño nuevo (newDesign y newTab).
function blankDesignDoc(size?: NewDesignSize): Doc {
  const blank = emptyDoc();
  if (size) {
    blank.width = size.width;
    blank.height = size.height;
    if (size.name) blank.name = size.name;
    if (size.unit && size.unit !== 'px') {
      blank.unit = size.unit;
      if (size.dpi) blank.dpi = size.dpi;
    } else if (size.dpi && size.dpi !== 96) blank.dpi = size.dpi;
  }
  return blank;
}

export type AlignKind =
  | 'left'
  | 'centerH'
  | 'right'
  | 'top'
  | 'centerV'
  | 'bottom';

export interface EditorState {
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
  // Estado previo a una operación sobre todo el proyecto (varios formatos,
  // restaurar versión): permite deshacerla de un golpe. Solo vale mientras el
  // documento actual sea el que dejó la operación (docAfter).
  structUndo: StructUndo | null;
  cropMode: boolean;
  cropRect: Rect | null; // marco LOCAL de la capa (unidades naturales de la imagen completa, volteada)
  cropAspect: number | null; // ancho/alto fijo, null = libre
  textEditNonce: number;
  animPlayNonce: number;
  selRect: { left: number; top: number; width: number; height?: number } | null;
  // Selección de píxeles (varita, lazo, rango de color): transitoria como selRect, fuera del documento.
  pixelSel: PixelSelection | null;
  maskEditId: string | null; // capa cuya MÁSCARA se edita (pincel blanco/negro) en vez de la capa
  maskView: boolean; // ver la máscara como superposición roja (solo editor)
  zoom: number; // multiplicador de zoom del usuario (1 = ajustar)
  viewScale: number; // escala aplicada real (para mostrar %)
  showRulers: boolean;
  pageView: 'single' | 'stack'; // clásico (una página) o páginas apiladas
  showGrid: boolean;
  showGuides: boolean;
  snapToGrid: boolean;
  showNotes: boolean; // notas adhesivas visibles (solo editor)
  showLayout: boolean; // márgenes, sangrado y columnas visibles (solo editor)
  pages: Doc[];
  pageIndex: number;
  // Identidad estable del diseño (designIdentity.ts): NO cambia al reordenar ni
  // al borrar páginas. Galería, versiones y deshacer guardado se agrupan por ella.
  designId: string;
  designName: string | null; // nombre propio del diseño; null = el de la primera página
  // Historial de deshacer de las páginas que no están abiertas (pageHistory.ts).
  pageHist: PageHist;
  brandLogos: UploadedImage[]; // logos del kit activo (espejo de brandKits)
  brandFonts: string[]; // fuentes del kit activo
  brandKits: BrandKit[]; // todos los kits (el activo se refleja en brandColors/brandLogos/brandFonts)
  activeBrandKitId: string;
  showRespect: boolean; // zona de respeto de los logos del kit (solo editor)
  editingTextId: string | null; // texto que se está editando sobre el lienzo
  textSel: { id: string; start: number; end: number } | null; // selección dentro del texto
  // Pestañas de documentos (sessions.ts). La ACTIVA vive en los campos de arriba; las
  // demás, aparcadas en `parked` con sus mismos objetos. Toda clave nueva de este
  // estado debe clasificarse en STATE_CLASS (sessions.ts) o tsc y las pruebas fallan.
  tabs: TabMeta[];
  activeTabId: string;
  parked: Record<string, SessionSnapshot>; // no seleccionarlo en componentes (re-render)

  // pestañas (sin UI todavía). Cambiar/cerrar guarda antes la saliente (flushSave).
  newTab: (size?: NewDesignSize) => string | null; // null = límite de MAX_TABS
  switchTab: (id: string) => boolean;
  // false = no se cerró (no se pudo guardar y no se forzó: la pestaña sigue, aparcada).
  closeTab: (id: string, opts?: { force?: boolean }) => Promise<boolean>;
  reorderTabs: (from: number, to: number) => void;
  // Abre un diseño en pestaña: si ya está abierto, activa esa; si la activa está vacía, la reutiliza.
  // 'opened' y 'reused' son diseños recién cargados (el llamador recupera su deshacer guardado).
  openDesignInTab: (
    pages: Doc[],
    index: number,
    meta?: DesignMeta,
  ) => { status: 'active' | 'focused' | 'reused' | 'opened' | 'limit' | 'invalid'; tabId: string | null };
  // Arranque (P8): sustituye TODAS las pestañas por las guardadas (io/tabsStore.ts loadTabs),
  // con sus mismos ids (claves `tab:<id>`). Sin historial; la activa recupera el suyo aparte.
  restoreTabs: (
    list: { id: string; pages: Doc[]; index: number; designId: string; designName: string | null }[],
    activeId: string,
  ) => boolean;

  // documento / lienzo
  setCanvasSize: (width: number, height: number, meta?: { unit?: Unit; dpi?: number }) => void;
  // Organización (carpetas, estilos compartidos, maestra, clasificador): la lógica vive en core/*.ts.
  editDoc: (fn: (doc: Doc) => Doc) => void; // un paso de deshacer
  editPages: (fn: (pages: Doc[], currentId: string) => { pages: Doc[]; currentId: string }) => void;
  setBackground: (background: Background) => void;
  setDocName: (name: string) => void;
  setDesignName: (name: string) => void; // vacío = volver al nombre de la primera página
  loadDoc: (doc: Doc, meta?: DesignMeta) => void;

  // páginas
  addPage: (afterIndex?: number) => void; // sin índice: al final
  duplicatePage: (i?: number) => void; // sin índice: la página actual
  newDesign: (size?: NewDesignSize) => void;
  // Lienzo = medidas de la foto (ver photoCanvas), foto en 0,0 seleccionada.
  newDesignFromImage: (img: { src: string; naturalWidth: number; naturalHeight: number; name: string }) => void;
  addResizedPage: (width: number, height: number) => void;
  // Biblioteca: crea páginas en varios formatos / restaura una instantánea
  // (ambas se deshacen con un solo Ctrl+Z, ver structUndo).
  addResizedPages: (sizes: TargetSize[]) => number;
  restorePages: (pages: Doc[], index: number) => void;
  // Historial de deshacer recuperado tras reabrir el diseño (io/undoStore.ts).
  restoreHistory: (past: Doc[], docId: string) => void;
  setTemplateTags: (id: string, tags: string[]) => void;
  switchPage: (i: number) => void;
  deletePage: (i: number) => void;
  reorderPages: (from: number, to: number) => void;
  // meta: identidad guardada del diseño; sin ella, la de siempre (id de la primera página).
  loadPages: (pages: Doc[], index: number, meta?: DesignMeta) => void;

  // kit de marca
  addBrandColor: (color: string) => void;
  removeBrandColor: (color: string) => void;
  addBrandLogo: (img: UploadedImage) => void;
  removeBrandLogo: (id: string) => void;
  toggleBrandFont: (family: string) => void;
  setActiveBrandKit: (id: string) => void;
  createBrandKit: (name: string) => void;
  duplicateBrandKit: (id: string) => void;
  renameBrandKit: (id: string, name: string) => void;
  deleteBrandKit: (id: string) => void;
  setBrandLogoRespect: (logoId: string, factor: number) => void;
  setShowRespect: (on: boolean) => void;

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
    chart?: ImageLayer['chart'];
    table?: ImageLayer['table'];
  }) => void;
  addTextLayer: (
    preset?: {
      text: string;
      fontSize: number;
      bold: boolean;
    },
    at?: { x: number; y: number }, // punto del documento donde cae el texto (herramienta Texto)
  ) => void;
  addTextPreset: (presetId: string) => Promise<void>; // estilo de texto listo (un paso de deshacer)
  addFontPair: (pairId: string) => Promise<void>; // título + cuerpo (un paso de deshacer)
  addShapeLayer: (kind: ShapeKind, at?: { x: number; y: number; width: number; height: number; rotation?: number }) => void; // `at` = caja arrastrada (herramienta Forma)
  // Pinceles: una pincelada = una capa (brush.ts). `select` false = no cambia la selección.
  addStrokeLayer: (spec: StrokeSpec) => string | null;
  removeLayers: (ids: string[]) => void; // varias capas = un solo paso de deshacer
  reorderLayers: (orderBottomFirst: string[]) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  updateLayerLive: (id: string, patch: Partial<Layer>) => void; // sin historial
  // Fusión sobre la selección (o los ids dados): un gesto = un paso de deshacer.
  setBlendMode: (mode: BlendMode, ids?: string[]) => void;
  /** Vista previa temporal (sin historial): se revierte con cancelBlendPreview. */
  previewBlendMode: (mode: BlendMode, ids?: string[]) => void;
  cancelBlendPreview: () => void;
  /** Opacidad en vivo (sin historial) de la selección y sus grupos; usa checkpoint() antes. */
  setOpacityLive: (v: number, ids?: string[]) => void;
  selectAll: () => void;
  // Rota la capa a `deg` grados girando alrededor de su centro (no de la
  // esquina). live=true no guarda historial (para el arrastre del slider).
  setLayerRotation: (id: string, deg: number, live?: boolean) => void;
  checkpoint: () => void; // guarda un punto de deshacer antes de una edición en vivo
  beginBatch: () => void; // varias actualizaciones = un solo paso de deshacer
  endBatch: () => void;
  // keepSource: no ocultar la original (p. ej. "desenfocar fondo").
  addProcessedLayer: (
    sourceId: string,
    newSrc: string,
    name: string,
    opts?: { keepSource?: boolean },
  ) => void;
  // grupos
  groupSelected: () => void;
  ungroupSelected: () => void;
  // marcos
  addFrame: (kind: ShapeKind) => void;
  fillFrame: (
    frameId: string,
    img: { src: string; naturalWidth: number; naturalHeight: number; name?: string },
  ) => Promise<void>;
  // texto
  setEditingText: (id: string | null) => void;
  setTextSel: (sel: { id: string; start: number; end: number } | null) => void;
  styleTextRange: (id: string, start: number, end: number, patch: SpanStyle) => void;
  // Cambia el estilo de TODO el texto (y lo quita de las palabras sueltas).
  setTextStyleAll: (
    id: string,
    patch: { bold?: boolean; italic?: boolean; underline?: boolean; fill?: string },
  ) => void;
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
  setSelRect: (r: { left: number; top: number; width: number; height?: number } | null) => void;
  setPixelSel: (sel: PixelSelection | null) => void;
  setMaskEdit: (id: string | null) => void;
  setMaskView: (on: boolean) => void;
  setZoom: (z: number) => void;
  setViewScale: (s: number) => void;
  toggleRulers: () => void;
  togglePageView: () => void;
  toggleGrid: () => void;
  toggleGuides: () => void;
  toggleSnapToGrid: () => void;
  // Reemplaza las guías de la página (un paso de deshacer).
  setGuides: (guides: { x: number[]; y: number[] }) => void;
  // Ayudas de lienzo: maquetación, notas internas, notas del orador, similares y formato.
  toggleNotes: () => void;
  toggleLayout: () => void;
  setLayoutAids: (patch: Partial<Pick<Doc, 'margins' | 'bleed' | 'columns'>>) => void;
  addNote: () => void;
  updateNote: (id: string, patch: Partial<Omit<StickyNote, 'id'>>) => void;
  removeNote: (id: string) => void;
  setSpeakerNotes: (text: string) => void;
  selectSimilar: (id: string) => void;
  pasteStyle: (src: Layer) => void;
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
  jumpToHistory: (index: number) => void;
  // Buscar y reemplazar: edita capas de OTRAS páginas (el historial es por página: no se deshace).
  patchOtherPages: (edits: { page: number; id: string; patch: Partial<Layer> }[]) => void;
  // Recolorear diseño (recolor.ts): `live` = vista previa sin historial; si no, un solo paso de deshacer.
  recolorDoc: (doc: Doc, live?: boolean) => void;
  recolorOtherPages: (fn: (d: Doc) => Doc) => void; // las demás páginas (no se deshace)
}

// Helper: aplica un cambio al documento registrándolo en el historial.
function commit(s: EditorState, newDoc: Doc): Partial<EditorState> {
  if (newDoc === s.doc) return {};
  // Dentro de un lote el punto de deshacer ya se guardó en beginBatch.
  if (batching) return { doc: newDoc };
  return {
    doc: newDoc,
    past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
    future: [],
  };
}

const FIRST_DOC = emptyDoc();
const FIRST_TAB = uid();

// ---- pestañas: lo que pasa ANTES de dejar la sesión activa ----

// Resultado del guardado de cada pestaña al aparcarla (closeTab lo espera).
const tabSaves = new Map<string, Promise<boolean>>();

// Nada a medias puede cruzar a otra pestaña: lote de deshacer y editor de texto en línea.
function settleSession() {
  endBatchNow();
  // InlineTextEditor confirma su texto en onBlur: se desenfoca YA (el evento es
  // síncrono) para que lo escrito caiga en ESTA pestaña y no se pierda.
  if (useEditor.getState().editingTextId && typeof document !== 'undefined') {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
  endBatchNow();
}

// Cierra lo pendiente y guarda la sesión activa. flushSave y flushUndo leen el estado
// en este mismo tick, así que se puede aparcar justo después: se guarda la saliente.
function leaveActiveSession() {
  settleSession();
  const tabId = useEditor.getState().activeTabId;
  flushUndo();
  const p = flushSave().catch(() => false);
  tabSaves.set(tabId, p);
  void p.then((ok) => {
    if (tabSaves.get(tabId) !== p) return;
    useEditor.setState((s) =>
      s.tabs.some((t) => t.id === tabId)
        ? { tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, save: ok ? ('saved' as const) : ('error' as const) } : t)) }
        : {},
    );
  });
}

// Pestaña cerrada: fuera del índice `tabs` y sin registro `tab:<id>` (su diseño sigue en
// Inicio). Solo tras un cierre correcto o forzado; si el guardado falló, la pestaña vuelve.
function forgetSavedTab(id: string) {
  const s = useEditor.getState();
  void removeTab(id, { order: s.tabs.map((t) => t.id), activeId: s.activeTabId }).catch(() => {});
}

// Aparca la activa y abre `snap` en una pestaña nueva (al final de la tira).
function enterNewSession(snap: SessionSnapshot): string {
  leaveActiveSession();
  const id = uid();
  useEditor.setState((s) => ({
    ...snap,
    ...TRANSIENT_RESET,
    parked: { ...s.parked, [s.activeTabId]: park(s) },
    activeTabId: id,
    tabs: [...s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, save: 'pending' as const } : t)), { id, save: 'saved' as const }],
  }));
  return id;
}

// Medida real de un texto (para centrar los estilos de texto listos).
let presetMeasureCtx: CanvasRenderingContext2D | null = null;
const measureTextProps: MeasureFn = (props) => {
  presetMeasureCtx ??= document.createElement('canvas').getContext('2d');
  if (!presetMeasureCtx) return { width: (props.text?.length ?? 1) * (props.fontSize ?? 48) * 0.56, height: (props.fontSize ?? 48) };
  const m = measureStyledText(presetMeasureCtx, props as TextLayer);
  return { width: m.width, height: m.height };
};

// Espera (máx. 800 ms) a que las fuentes empaquetadas estén cargadas antes de medir.
async function ensureFonts(families: (string | undefined)[], bold?: boolean) {
  try {
    const loads = families
      .filter((f): f is string => !!f)
      .map((f) => document.fonts.load(`${bold ? 700 : 400} 40px "${f}"`));
    await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 800))]);
  } catch {
    /* sin fuentes: se mide con la de reserva */
  }
}

// Crea la capa con la lógica de addTextLayer y le aplica el estilo del preset.
function placeTextProps(props: Partial<TextLayer>) {
  const st = useEditor.getState();
  st.addTextLayer({ text: props.text ?? 'Texto', fontSize: props.fontSize ?? 48, bold: props.bold ?? false });
  const id = useEditor.getState().selectedId;
  if (id) useEditor.getState().updateLayer(id, props as Partial<Layer>);
}

const VIEW_KEY = 'chamva.view';
interface ViewPrefs {
  rulers: boolean;
  grid: boolean;
  guides: boolean;
  snap: boolean;
  pageView: 'single' | 'stack';
}
function loadView(): ViewPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}');
    return { rulers: !!v.rulers, grid: !!v.grid, guides: v.guides !== false, snap: !!v.snap, pageView: v.pageView === 'stack' ? 'stack' : 'single' };
  } catch {
    return { rulers: false, grid: false, guides: true, snap: false, pageView: 'single' };
  }
}
function saveView(v: ViewPrefs) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

function viewPrefs(s: EditorState): ViewPrefs {
  return { rulers: s.showRulers, grid: s.showGrid, guides: s.showGuides, snap: s.snapToGrid, pageView: s.pageView };
}

// Espejo del kit activo en los campos planos (brandColors/brandLogos/brandFonts).
function mirrorKit(kits: BrandKit[], activeId: string) {
  const k = activeKit(kits, activeId);
  return {
    brandKits: kits,
    activeBrandKitId: k.id,
    brandColors: k.colors,
    brandLogos: k.logos,
    brandFonts: k.fonts,
  };
}
// Aplica un cambio al kit activo y lo persiste.
function kitState(
  s: { brandKits: BrandKit[]; activeBrandKitId: string },
  patch: Partial<BrandKit>,
  logosChanged: boolean,
) {
  const kits = updateKit(s.brandKits, s.activeBrandKitId, patch);
  persistKits(kits, s.activeBrandKitId, logosChanged);
  return mirrorKit(kits, s.activeBrandKitId);
}

const INITIAL_KITS = loadBrandKits();
const INITIAL_KIT = activeKit(INITIAL_KITS.kits, INITIAL_KITS.activeId);

export const useEditor = create<EditorState>((set, get) => ({
  doc: FIRST_DOC,
  selectedId: null,
  selectedIds: [],
  past: [],
  future: [],
  brandColors: INITIAL_KIT.colors,
  recentColors: loadColors(LS_RECENT),
  customFonts: [], // se rellena en hydrate() (las fuentes viven en IndexedDB)
  brandLogos: [],
  brandFonts: INITIAL_KIT.fonts,
  brandKits: INITIAL_KITS.kits,
  activeBrandKitId: INITIAL_KITS.activeId,
  showRespect: false,
  editingTextId: null,
  textSel: null,
  uploads: [],
  templates: [],
  structUndo: null,
  cropMode: false,
  cropRect: null,
  cropAspect: null,
  textEditNonce: 0,
  animPlayNonce: 0,
  selRect: null,
  pixelSel: null,
  maskEditId: null,
  maskView: false,
  zoom: 1,
  viewScale: 1,
  showRulers: loadView().rulers,
  pageView: loadView().pageView,
  showGrid: loadView().grid,
  showGuides: loadView().guides,
  snapToGrid: loadView().snap,
  showNotes: true,
  showLayout: true,
  pages: [FIRST_DOC],
  pageIndex: 0,
  designId: FIRST_DOC.id,
  designName: null,
  pageHist: {},
  tabs: [{ id: FIRST_TAB, save: 'saved' }],
  activeTabId: FIRST_TAB,
  parked: {},

  newTab: (size) => {
    if (get().tabs.length >= MAX_TABS) return null;
    const blank = blankDesignDoc(size);
    return enterNewSession(freshSession([blank], 0, { designId: blank.id, designName: null }, get().pageView));
  },

  switchTab: (id) => {
    const s0 = get();
    if (id === s0.activeTabId || !s0.parked[id]) return false;
    leaveActiveSession();
    set((s) => {
      const { [id]: incoming, ...rest } = s.parked;
      if (!incoming) return {};
      return {
        ...unpark(incoming),
        ...TRANSIENT_RESET,
        parked: { ...rest, [s.activeTabId]: park(s) },
        activeTabId: id,
        tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, save: 'pending' as const } : t)),
      };
    });
    return true;
  },

  closeTab: async (id, opts) => {
    const s0 = get();
    const at = s0.tabs.findIndex((t) => t.id === id);
    if (at < 0) return false;
    const force = !!opts?.force;
    if (id !== s0.activeTabId) {
      // Aparcada: su copia guardada se escribió al aparcarla; se espera a que termine.
      const snap = s0.parked[id];
      if (snap && !force && !isBlankSession(snap)) {
        const ok =
          s0.tabs[at].save !== 'error' && (await (tabSaves.get(id) ?? Promise.resolve(s0.tabs[at].save === 'saved')));
        if (!ok) return false;
      }
      set((s) => {
        if (!s.parked[id]) return {};
        const { [id]: _gone, ...rest } = s.parked;
        void _gone;
        return { parked: rest, tabs: s.tabs.filter((t) => t.id !== id) };
      });
      tabSaves.delete(id);
      forgetSavedTab(id);
      return true;
    }
    // Activa: se guarda (leyendo el estado ya), se cambia a la vecina AL MOMENTO (nada
    // más puede editar la que se cierra) y, si el guardado falló, vuelve como aparcada.
    settleSession();
    const closing = park(get());
    const blank = isBlankSession(closing);
    flushUndo();
    const saving = flushSave().catch(() => false);
    tabSaves.set(id, saving); // el resultado que vale ahora es ESTE (no el de un aparcamiento anterior)
    const next = nextActiveAfterClose(get().tabs, get().activeTabId, id);
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const incoming = next ? s.parked[next] : undefined;
      if (next && incoming) {
        const { [next]: _in, ...rest } = s.parked;
        void _in;
        return { ...unpark(incoming), ...TRANSIENT_RESET, parked: rest, activeTabId: next, tabs };
      }
      // Era la última: no se queda sin pestañas; la sustituye un diseño vacío.
      const doc = blankDesignDoc();
      const nid = uid();
      return {
        ...freshSession([doc], 0, { designId: doc.id, designName: null }, s.pageView),
        ...TRANSIENT_RESET,
        activeTabId: nid,
        tabs: [...tabs, { id: nid, save: 'saved' as const }],
      };
    });
    const ok = await saving;
    if (ok || force || blank) {
      if (tabSaves.get(id) === saving) tabSaves.delete(id);
      forgetSavedTab(id);
      return true;
    }
    // No se pudo guardar: la pestaña no se pierde, vuelve a su sitio (aparcada, con error).
    set((s) => {
      const tabs = [...s.tabs];
      tabs.splice(Math.min(at, tabs.length), 0, { id, save: 'error' });
      return { parked: { ...s.parked, [id]: closing }, tabs };
    });
    return false;
  },

  restoreTabs: (list, activeId) => {
    const valid = list.filter((t, i) => t.id && t.pages.length && list.findIndex((o) => o.id === t.id) === i).slice(0, MAX_TABS);
    const active = valid.find((t) => t.id === activeId) ?? valid[0];
    if (!active) return false;
    endBatchNow();
    set((s) => {
      const parked: Record<string, SessionSnapshot> = {};
      for (const t of valid)
        if (t !== active) parked[t.id] = freshSession(t.pages, t.index, { designId: t.designId, designName: t.designName }, s.pageView);
      return {
        ...freshSession(active.pages, active.index, { designId: active.designId, designName: active.designName }, s.pageView),
        ...TRANSIENT_RESET,
        parked,
        activeTabId: active.id,
        tabs: valid.map((t) => ({ id: t.id, save: 'saved' as const })),
      };
    });
    return true;
  },

  reorderTabs: (from, to) =>
    set((s) => {
      const tabs = reorderTabList(s.tabs, from, to);
      return tabs === s.tabs ? {} : { tabs };
    }),

  openDesignInTab: (pages, index, meta) => {
    if (!pages.length) return { status: 'invalid', tabId: null };
    const ident = resolveDesignMeta(pages, meta);
    const s = get();
    // Nunca dos pestañas con el mismo diseño: se pisarían en galería, undo:<id> y versiones.
    const found = findTabByDesign(s, ident.designId);
    if (found === s.activeTabId) return { status: 'active', tabId: found };
    if (found) {
      get().switchTab(found);
      return { status: 'focused', tabId: found };
    }
    if (isBlankSession(s)) {
      get().loadPages(pages, index, { designId: ident.designId, name: ident.designName ?? undefined });
      return { status: 'reused', tabId: s.activeTabId };
    }
    if (s.tabs.length >= MAX_TABS) return { status: 'limit', tabId: null };
    return { status: 'opened', tabId: enterNewSession(freshSession(pages, index, ident, s.pageView)) };
  },

  setCanvasSize: (width, height, meta) =>
    set((s) => {
      // Las capas con restricciones se recolocan según su anclaje (constraints.ts).
      const from = { width: s.doc.width, height: s.doc.height };
      const layers = s.doc.layers.some((l) => l.constraints)
        ? s.doc.layers.map((l) => applyConstraints(l, from, { width, height }, layerBox2))
        : s.doc.layers;
      return commit(s, { ...s.doc, width, height, layers, ...(meta?.unit ? { unit: meta.unit, dpi: meta.dpi } : {}) });
    }),

  editDoc: (fn) => set((s) => commit(s, fn(s.doc))),

  // Operaciones sobre la lista de páginas (clasificador, maestra). El historial es por
  // página: solo se conserva si la página actual sigue siendo exactamente la misma.
  editPages: (fn) =>
    set((s) => {
      const synced = s.pages.map((p, i) => (i === s.pageIndex ? s.doc : p));
      const r = fn(synced, s.doc.id);
      if (r.pages === synced) return {};
      const idx = Math.max(0, r.pages.findIndex((p) => p.id === r.currentId));
      const doc = r.pages[idx];
      // Las páginas cambiaron: el deshacer «de proyecto entero» ya no vale (devolvería
      // la lista vieja y desharía también este cambio).
      return doc === s.doc
        ? { pages: r.pages, pageIndex: idx, structUndo: null }
        : {
            pages: r.pages,
            doc,
            pageIndex: idx,
            ...swap(s.pageHist, s, doc),
            structUndo: null,
            selectedId: null,
            selectedIds: [],
            cropMode: false,
            cropRect: null,
          };
    }),

  setBackground: (background) =>
    set((s) => {
      const base = commit(s, {
        ...s.doc,
        background,
        ...(background.type === 'solid'
          ? {
              recentColors: [
                background.color,
                ...(s.doc.recentColors ?? []).filter((c) => c !== background.color),
              ].slice(0, 16),
            }
          : {}),
      });
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
      return kitState(s, { colors: [...s.brandColors, color].slice(0, 24) }, false);
    }),

  removeBrandColor: (color) =>
    set((s) => kitState(s, { colors: s.brandColors.filter((c) => c !== color) }, false)),

  addBrandLogo: (img) =>
    set((s) => kitState(s, { logos: [img, ...s.brandLogos].slice(0, 24) }, true)),

  removeBrandLogo: (id) =>
    set((s) => kitState(s, { logos: s.brandLogos.filter((l) => l.id !== id) }, true)),

  toggleBrandFont: (family) =>
    set((s) =>
      kitState(
        s,
        {
          fonts: s.brandFonts.includes(family)
            ? s.brandFonts.filter((f) => f !== family)
            : [...s.brandFonts, family],
        },
        false,
      ),
    ),

  setActiveBrandKit: (id) =>
    set((s) => {
      if (!s.brandKits.some((k) => k.id === id)) return {};
      persistKits(s.brandKits, id, false);
      return mirrorKit(s.brandKits, id);
    }),

  createBrandKit: (name) =>
    set((s) => {
      const id = uid();
      const kits = createKit(s.brandKits, name, id);
      if (kits === s.brandKits) return {};
      persistKits(kits, id, true);
      return mirrorKit(kits, id);
    }),

  duplicateBrandKit: (id) =>
    set((s) => {
      const nid = uid();
      const kits = duplicateKit(s.brandKits, id, nid);
      if (kits === s.brandKits) return {};
      persistKits(kits, nid, true);
      return mirrorKit(kits, nid);
    }),

  renameBrandKit: (id, name) =>
    set((s) => {
      const kits = renameKit(s.brandKits, id, name);
      if (kits === s.brandKits) return {};
      persistKits(kits, s.activeBrandKitId, false);
      return { brandKits: kits };
    }),

  deleteBrandKit: (id) =>
    set((s) => {
      const r = deleteKit(s.brandKits, id, s.activeBrandKitId);
      if (r.kits === s.brandKits) return {};
      persistKits(r.kits, r.activeId, true);
      return mirrorKit(r.kits, r.activeId);
    }),

  setBrandLogoRespect: (logoId, factor) =>
    set((s) => {
      const k = activeKit(s.brandKits, s.activeBrandKitId);
      return kitState(s, { respect: { ...(k.respect ?? {}), [logoId]: Math.max(0, factor) } }, false);
    }),

  setShowRespect: (on) => set({ showRespect: on }),

  addCustomFont: (family) =>
    set((s) =>
      s.customFonts.includes(family)
        ? {}
        : { customFonts: [...s.customFonts, family] },
    ),

  hydrate: async () => {
    // Las imágenes se guardan por referencia (io/assets.ts): rehidratar.
    const uploads = await rehydrateUploads(
      (await idbGet<UploadedImage[]>('uploads')) ?? [],
    );
    const templates = await rehydrateTemplates(
      (await idbGet<SavedTemplate[]>('templates')) ?? [],
    );
    // Logos por kit. Si aún no existe 'brandKitLogos', migra el 'brandLogos' del
    // kit único anterior al primer kit y retira la clave antigua.
    let byKit = await idbGet<Record<string, UploadedImage[]>>('brandKitLogos');
    if (!byKit) {
      const legacy = (await idbGet<UploadedImage[]>('brandLogos')) ?? [];
      byKit = { [get().brandKits[0].id]: legacy };
      if (await idbSet('brandKitLogos', byKit)) await idbDelete('brandLogos');
    }
    const stored = byKit;
    const kitLogos: Record<string, UploadedImage[]> = {};
    for (const k of get().brandKits) kitLogos[k.id] = await rehydrateUploads(stored[k.id] ?? []);
    const customFonts = await loadStoredFonts();
    set((s) => {
      const kits = s.brandKits.map((k) => ({ ...k, logos: kitLogos[k.id] ?? k.logos }));
      return { uploads, templates, customFonts, ...mirrorKit(kits, s.activeBrandKitId) };
    });
  },

  addUpload: (img) =>
    set((s) => {
      const uploads = [img, ...s.uploads].slice(0, 40);
      dehydrateUploads(uploads).then((d) => idbSet('uploads', d));
      return { uploads };
    }),

  removeUpload: (id) =>
    set((s) => {
      const uploads = s.uploads.filter((u) => u.id !== id);
      dehydrateUploads(uploads).then((d) => idbSet('uploads', d));
      return { uploads };
    }),

  addTemplate: (t) =>
    set((s) => {
      const templates = [t, ...s.templates].slice(0, 30);
      dehydrateTemplates(templates).then((d) => idbSet('templates', d));
      return { templates };
    }),

  removeTemplate: (id) =>
    set((s) => {
      const templates = s.templates.filter((t) => t.id !== id);
      dehydrateTemplates(templates).then((d) => idbSet('templates', d));
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

  // Metadato del diseño (no es un paso de deshacer). Vacío = nombre de la primera página.
  setDesignName: (name) => set({ designName: name.trim() || null }),

  loadDoc: (doc, meta) => {
    endBatchNow();
    set({
      doc,
      pages: [doc],
      pageIndex: 0,
      selectedId: null,
      selectedIds: [],
      past: [],
      future: [],
      structUndo: null,
      pageHist: {},
      ...resolveDesignMeta([doc], meta),
    });
  },

  addPage: (afterIndex) =>
    set((s) => {
      endBatchNow();
      const synced = s.pages.map((p, i) => (i === s.pageIndex ? s.doc : p));
      // onClick={addPage} pasa el evento: solo cuenta un índice numérico válido.
      const at = typeof afterIndex === 'number' && afterIndex >= 0 && afterIndex < synced.length ? afterIndex + 1 : synced.length;
      const ref = at === synced.length ? s.doc : synced[at - 1];
      const blank: Doc = {
        ...emptyDoc(),
        width: ref.width,
        height: ref.height,
        name: `Página ${synced.length + 1}`,
      };
      return {
        pages: insertAt(synced, at, blank),
        doc: blank,
        pageIndex: at,
        ...swap(s.pageHist, s, blank),
        structUndo: null,
        selectedId: null,
        selectedIds: [],
        cropMode: false,
        cropRect: null,
      };
    }),

  duplicatePage: (i) =>
    set((s) => {
      endBatchNow();
      const synced = s.pages.map((p, idx) => (idx === s.pageIndex ? s.doc : p));
      const from = typeof i === 'number' && i >= 0 && i < synced.length ? i : s.pageIndex;
      const src = synced[from];
      const copy = JSON.parse(JSON.stringify(src)) as Doc;
      copy.id = uid();
      copy.name = `${src.name} (copia)`;
      delete copy.isMaster; // la copia no es una segunda maestra
      copy.layers = copy.layers.map((l) => ({ ...l, id: uid() }));
      return {
        pages: insertAt(synced, from + 1, copy),
        doc: copy,
        pageIndex: from + 1,
        ...swap(s.pageHist, s, copy),
        structUndo: null,
        selectedId: null,
        selectedIds: [],
        cropMode: false,
        cropRect: null,
      };
    }),

  newDesign: (size) => {
    const blank = blankDesignDoc(size);
    endBatchNow();
    set({
      doc: blank,
      pages: [blank],
      pageIndex: 0,
      selectedId: null,
      selectedIds: [],
      past: [],
      future: [],
      structUndo: null,
      pageHist: {},
      designId: blank.id, // diseño nuevo: id propio que ya no cambia
      designName: null,
      cropMode: false,
      cropRect: null,
    });
  },

  // Diseño nuevo cuyo lienzo mide lo mismo que la foto (límite 16–8000 px), fondo
  // transparente, foto en 0,0 y seleccionada. Es un solo estado inicial (sin deshacer previo).
  newDesignFromImage: (img) => {
    const { canvasW, canvasH, scale } = photoCanvas(img.naturalWidth, img.naturalHeight);
    const blank = emptyDoc();
    blank.width = canvasW;
    blank.height = canvasH;
    blank.name = (img.name || '').replace(/\.[^./\\]+$/, '').trim() || 'Foto';
    const layer: ImageLayer = {
      id: uid(),
      type: 'image',
      name: blank.name,
      src: img.src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      x: 0,
      y: 0,
      scaleX: scale,
      scaleY: scale,
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
    blank.layers = [layer];
    endBatchNow();
    set({
      doc: blank,
      pages: [blank],
      pageIndex: 0,
      selectedId: layer.id,
      selectedIds: [layer.id],
      past: [],
      future: [],
      structUndo: null,
      pageHist: {},
      designId: blank.id,
      designName: null,
      cropMode: false,
      cropRect: null,
    });
  },

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
      delete scaled.isMaster;
      // Con restricciones la capa se recoloca según su anclaje; sin ellas, escala y centra.
      const oldSize = { width: cur.width, height: cur.height };
      scaled.layers = scaled.layers.map((l) =>
        l.constraints
          ? resizeLayer(l, oldSize, { width, height }, layerBox2)
          : {
              ...l,
              x: l.x * factor + offX,
              y: l.y * factor + offY,
              scaleX: l.scaleX * factor,
              scaleY: l.scaleY * factor,
            },
      );
      endBatchNow();
      return {
        pages: [...synced, scaled],
        doc: scaled,
        pageIndex: synced.length,
        ...swap(s.pageHist, s, scaled),
        structUndo: null,
        selectedId: null,
        selectedIds: [],
      };
    }),

  // Crea de una vez una página nueva por formato (mismo cálculo que
  // addResizedPage). Devuelve cuántas creó. Un solo paso de deshacer.
  addResizedPages: (sizes) => {
    let created = 0;
    set((s) => {
      const synced = s.pages.map((p, i) => (i === s.pageIndex ? s.doc : p));
      const fresh = sizes.map((z) => resizeDocTo(s.doc, z, uid));
      created = fresh.length;
      if (!fresh.length) return {};
      const pages = [...synced, ...fresh];
      const doc = fresh[0];
      const pageIndex = synced.length;
      endBatchNow();
      return {
        pages,
        doc,
        pageIndex,
        ...swap(s.pageHist, s, doc),
        selectedId: null,
        selectedIds: [],
        structUndo: { pages: synced, pageIndex: s.pageIndex, docAfter: doc, pageIndexAfter: pageIndex },
      };
    });
    return created;
  },

  // Sustituye todo el proyecto (restaurar una instantánea). Ctrl+Z lo revierte.
  restorePages: (pages, index) =>
    set((s) => {
      if (!pages.length) return {};
      const synced = s.pages.map((p, i) => (i === s.pageIndex ? s.doc : p));
      const pageIndex = pages[index] ? index : 0;
      const doc = pages[pageIndex];
      endBatchNow();
      // El historial de la página que se deja queda aparcado: si Ctrl+Z revierte la
      // restauración, vuelve con ella (ver undo).
      return {
        pages,
        doc,
        pageIndex,
        ...swap(s.pageHist, s, doc),
        selectedId: null,
        selectedIds: [],
        cropMode: false,
        cropRect: null,
        structUndo: { pages: synced, pageIndex: s.pageIndex, docAfter: doc, pageIndexAfter: pageIndex },
      };
    }),

  // Solo se aplica si sigue abierta la misma página y aún no hay historial nuevo.
  restoreHistory: (past, docId) =>
    set((s) => (s.doc.id === docId && s.past.length === 0 && past.length ? { past: past.slice(-HISTORY_LIMIT) } : {})),

  setTemplateTags: (id, tags) =>
    set((s) => {
      const templates = s.templates.map((t) => {
        if (t.id !== id) return t;
        const { tags: _old, ...rest } = t;
        void _old;
        return tags.length ? { ...rest, tags } : rest;
      });
      dehydrateTemplates(templates).then((d) => idbSet('templates', d));
      return { templates };
    }),

  switchPage: (i) =>
    set((s) => {
      if (i === s.pageIndex || i < 0 || i >= s.pages.length) return {};
      endBatchNow();
      const synced = s.pages.map((p, idx) => (idx === s.pageIndex ? s.doc : p));
      // El deshacer de cada página se conserva (pageHistory.ts). El «de proyecto
      // entero» no: al volver revertiría también lo hecho en otras páginas.
      return {
        pages: synced,
        doc: synced[i],
        pageIndex: i,
        ...swap(s.pageHist, s, synced[i]),
        structUndo: null,
        selectedId: null,
        selectedIds: [],
        cropMode: false,
        cropRect: null,
      };
    }),

  deletePage: (i) =>
    set((s) => {
      if (s.pages.length <= 1 || i < 0 || i >= s.pages.length) return {};
      endBatchNow();
      const synced = s.pages.map((p, idx) => (idx === s.pageIndex ? s.doc : p));
      const pages = synced.filter((_, idx) => idx !== i);
      const idx = Math.min(
        i < s.pageIndex ? s.pageIndex - 1 : s.pageIndex,
        pages.length - 1,
      );
      const doc = pages[idx];
      // Ctrl+Z devuelve la página borrada (structUndo). Si la página abierta no era la
      // borrada, conserva su deshacer; si lo era, el suyo queda aparcado por si vuelve.
      // designId NO cambia aunque se borre la primera página.
      return {
        pages,
        doc,
        pageIndex: idx,
        ...swap(s.pageHist, s, doc),
        structUndo: { pages: synced, pageIndex: s.pageIndex, docAfter: doc, pageIndexAfter: idx },
        selectedId: null,
        selectedIds: [],
        cropMode: false,
        cropRect: null,
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
      // Misma página abierta: su deshacer sigue igual. designId no cambia.
      return { pages: arr, pageIndex: newIndex, doc: arr[newIndex], structUndo: null };
    }),

  // Abre otro diseño (galería, recuperación, proyecto, copia). Sin `meta` el diseño
  // conserva la identidad de siempre (id de su primera página): ver designIdentity.ts.
  loadPages: (pages, index, meta) => {
    endBatchNow();
    set({
      pages,
      doc: pages[index] ?? pages[0],
      pageIndex: pages[index] ? index : 0,
      selectedId: null,
      selectedIds: [],
      past: [],
      future: [],
      structUndo: null,
      pageHist: {},
      ...resolveDesignMeta(pages, meta),
    });
  },

  addImageLayer: ({ src, naturalWidth, naturalHeight, name, iconName, chart, table }) =>
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
        chart,
        table,
        ...NO_SHADOW,
      };
      return {
        ...commit(s, { ...s.doc, layers: [...s.doc.layers, layer] }),
        selectedId: layer.id,
      };
    }),

  addTextLayer: (preset, at) =>
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
        x: at ? at.x : s.doc.width * 0.15,
        y: at ? at.y - fontSize / 2 : s.doc.height / 2 - fontSize / 2,
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

  addTextPreset: async (presetId) => {
    const preset = getTextPreset(presetId);
    if (!preset) return;
    await ensureFonts([preset.style.fontFamily], preset.style.bold);
    const doc = get().doc;
    const props = buildTextLayerProps(preset, doc, measureTextProps);
    get().beginBatch();
    try {
      placeTextProps(props);
    } finally {
      get().endBatch();
    }
  },

  addFontPair: async (pairId) => {
    const pair = getFontPair(pairId);
    if (!pair) return;
    await ensureFonts([pair.title.fontFamily, pair.body.fontFamily], pair.title.bold);
    const doc = get().doc;
    const [title, body] = buildFontPairProps(pair, doc, measureTextProps);
    get().beginBatch();
    try {
      placeTextProps(body);
      placeTextProps(title); // el título queda seleccionado
    } finally {
      get().endBatch();
    }
  },

  addStrokeLayer: (spec) => {
    const s0 = get();
    if (s0.doc.locked || spec.raw.length < 3) return null;
    const g = buildStrokeGeometry(spec.raw, spec.brush, spec.size);
    const name = BRUSHES.find((b) => b.id === spec.brush)?.label ?? 'Trazo';
    const layer: StrokeLayer = {
      id: uid(),
      type: 'stroke',
      name: `Trazo · ${name}`,
      brush: spec.brush,
      color: spec.color,
      size: spec.size,
      pts: g.pts,
      seed: spec.seed ?? Math.floor(Math.random() * 2 ** 31),
      width: g.width,
      height: g.height,
      x: g.x,
      y: g.y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: spec.opacity,
      blendMode: spec.blendMode ?? 'normal',
      visible: true,
      locked: false,
    };
    set((s) => ({
      ...commit(s, { ...s.doc, layers: [...s.doc.layers, layer] }),
      ...(spec.select === false ? {} : { selectedId: layer.id, selectedIds: [layer.id] }),
    }));
    return layer.id;
  },

  removeLayers: (ids) =>
    set((s) => {
      if (s.doc.locked || !ids.length) return {};
      const gone = new Set(ids);
      return {
        ...commit(s, { ...s.doc, layers: s.doc.layers.filter((l) => !gone.has(l.id)) }),
        selectedId: s.selectedId && gone.has(s.selectedId) ? null : s.selectedId,
        selectedIds: s.selectedIds.filter((x) => !gone.has(x)),
      };
    }),

  addShapeLayer: (kind, at) =>
    set((s) => {
      const stroke = kind === 'line' || kind === 'arrow';
      const w = at ? Math.round(at.width) : Math.round(s.doc.width * (stroke ? 0.4 : 0.3));
      const h = at ? Math.round(at.height) : stroke ? Math.round(s.doc.height * 0.06) : w;
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
        fill: '#737373',
        stroke: '#ffffff',
        strokeWidth: stroke ? 6 : 0,
        cornerRadius: kind === 'rect' ? 0 : 0,
        x: at ? at.x : (s.doc.width - w) / 2,
        y: at ? at.y : (s.doc.height - h) / 2,
        scaleX: 1,
        scaleY: 1,
        rotation: at?.rotation ?? 0,
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
      // Página bloqueada: no se mueve ni transforma (sí otros cambios, p. ej. el candado de la capa).
      s.doc.locked && patchTouchesGeometry(patch) ? {} : commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((l) => (l.id === id ? patchLayer(l, patch) : l)),
      }),
    ),

  setBlendMode: (mode, ids) =>
    set((s) => {
      const targets = blendTargets(s, ids);
      const restore = blendPreviewOrig; // si hay vista previa, el punto de deshacer parte del original
      blendPreviewOrig = null;
      const base = restore ? restoreBlends(s.doc, restore) : s.doc;
      const layers = base.layers.map((l) => (targets.has(l.id) ? ({ ...l, blendMode: mode } as Layer) : l));
      const changed = layers.some((l, i) => l !== base.layers[i] && base.layers[i].blendMode !== mode);
      if (!changed) return base === s.doc ? {} : { doc: base };
      const doc = { ...base, layers };
      if (batching) return { doc };
      return { doc, past: [...s.past, base].slice(-HISTORY_LIMIT), future: [] };
    }),

  previewBlendMode: (mode, ids) =>
    set((s) => {
      const targets = blendTargets(s, ids);
      if (!blendPreviewOrig) {
        blendPreviewOrig = {};
        for (const l of s.doc.layers) if (targets.has(l.id)) blendPreviewOrig[l.id] = l.blendMode;
      }
      const layers = s.doc.layers.map((l) =>
        targets.has(l.id) && l.blendMode !== mode ? ({ ...l, blendMode: mode } as Layer) : l,
      );
      return { doc: { ...s.doc, layers } };
    }),

  cancelBlendPreview: () =>
    set((s) => {
      if (!blendPreviewOrig) return {};
      const orig = blendPreviewOrig;
      blendPreviewOrig = null;
      return { doc: restoreBlends(s.doc, orig) };
    }),

  setOpacityLive: (v, ids) =>
    set((s) => {
      const targets = blendTargets(s, ids);
      const o = Math.min(1, Math.max(0, v));
      return { doc: { ...s.doc, layers: s.doc.layers.map((l) => (targets.has(l.id) ? ({ ...l, opacity: o } as Layer) : l)) } };
    }),

  selectAll: () =>
    set((s) => {
      const ids = s.doc.layers.filter((l) => l.visible && !l.locked).map((l) => l.id);
      if (!ids.length) return {};
      return { selectedIds: ids, selectedId: ids[ids.length - 1], textSel: null };
    }),

  setLayerRotation: (id, deg, live) =>
    set((s) => {
      if (s.doc.locked) return {};
      const layers = s.doc.layers.map((l) => {
        if (l.id !== id) return l;
        // Mantener fijo el centro: recolocar x,y según la nueva rotación.
        const { w, h } = layerBox(l);
        const spin = (a: number): [number, number] => {
          const r = (a * Math.PI) / 180;
          return [
            (w / 2) * Math.cos(r) - (h / 2) * Math.sin(r),
            (w / 2) * Math.sin(r) + (h / 2) * Math.cos(r),
          ];
        };
        const [ox, oy] = spin(l.rotation);
        const [nx, ny] = spin(deg);
        return { ...l, rotation: deg, x: l.x + ox - nx, y: l.y + oy - ny } as Layer;
      });
      const doc = { ...s.doc, layers };
      return live ? { doc } : commit(s, doc);
    }),

  updateLayerLive: (id, patch) =>
    set((s) => s.doc.locked && patchTouchesGeometry(patch) ? {} : ({
      doc: {
        ...s.doc,
        layers: s.doc.layers.map((l) => (l.id === id ? patchLayer(l, patch) : l)),
      },
    })),

  checkpoint: () =>
    set((s) => ({ past: [...s.past, s.doc].slice(-HISTORY_LIMIT), future: [] })),

  beginBatch: () => {
    if (batching) return;
    set((s) => ({ past: [...s.past, s.doc].slice(-HISTORY_LIMIT), future: [] }));
    batching = true;
    clearTimeout(batchTimer);
    batchTimer = setTimeout(() => (batching = false), 15_000);
  },

  endBatch: () => {
    batching = false;
    clearTimeout(batchTimer);
  },

  addProcessedLayer: (sourceId, newSrc, name, opts) =>
    set((s) => {
      const src = s.doc.layers.find((l) => l.id === sourceId);
      if (!src || src.type !== 'image') return {};
      // Recorte limpio: sin filtros/volteo heredados.
      const layer: ImageLayer = {
        ...src,
        id: uid(),
        src: newSrc,
        originalSrc: src.src, // para poder "Restaurar" lo borrado de más
        retouch: undefined, // el recorte sale de la fuente sin retoque
        name,
        adjust: { ...DEFAULT_ADJUST },
        filter: 'none',
        flipX: false,
        flipY: false,
      };
      const idx = s.doc.layers.findIndex((l) => l.id === sourceId);
      // Ocultar la original (no destructivo) y poner la recortada encima.
      const layers = opts?.keepSource
        ? [...s.doc.layers]
        : s.doc.layers.map((l) => (l.id === sourceId ? { ...l, visible: false } : l));
      layers.splice(idx + 1, 0, layer);
      return {
        ...commit(s, { ...s.doc, layers }),
        selectedId: layer.id,
        selectedIds: [layer.id],
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
                retouch: undefined, // la imagen nueva ya viene horneada
                crop: undefined, // la imagen nueva ya viene horneada (con el recorte incluido)
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
    set((s) => s.doc.locked ? {} : ({
      ...commit(s, {
        ...s.doc,
        layers: s.doc.layers.filter((l) => l.id !== id),
      }),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  duplicateLayer: (id) =>
    set((s) => {
      if (s.doc.locked) return {};
      const l = s.doc.layers.find((x) => x.id === id);
      if (!l) return {};
      const copy = { ...l, id: uid(), x: l.x + 24, y: l.y + 24, groupId: undefined } as Layer;
      const idx = s.doc.layers.findIndex((x) => x.id === id);
      const layers = [...s.doc.layers];
      layers.splice(idx + 1, 0, copy);
      return { ...commit(s, { ...s.doc, layers }), selectedId: copy.id, selectedIds: [copy.id] };
    }),

  pasteLayer: (layer) =>
    set((s) => {
      if (s.doc.locked) return {};
      const copy = { ...layer, id: uid(), x: layer.x + 24, y: layer.y + 24, groupId: undefined } as Layer;
      return {
        ...commit(s, { ...s.doc, layers: [...s.doc.layers, copy] }),
        selectedId: copy.id,
      };
    }),

  selectLayer: (id) =>
    set((s) => ({
      selectedId: id,
      selectedIds: id ? [id] : [],
      textSel: null,
      // El recorte es de la capa seleccionada: si cambia la selección, se cancela.
      ...(s.cropMode && id !== s.selectedId ? { cropMode: false, cropRect: null, cropAspect: null } : {}),
    })),

  // Clic en el lienzo. Un grupo se selecciona entero; si la capa ya forma
  // parte de una selección múltiple se conserva (para poder arrastrar todo).
  // Para entrar a un elemento del grupo: doble clic (selectLayer).
  clickSelect: (id, additive) =>
    set((s) => {
      const l = s.doc.layers.find((x) => x.id === id);
      const members = l?.groupId
        ? s.doc.layers.filter((x) => x.groupId === l.groupId).map((x) => x.id)
        : [id];
      const endCrop = s.cropMode && id !== s.selectedId ? { cropMode: false, cropRect: null, cropAspect: null } : {};
      if (!additive) {
        if (s.selectedIds.length > 1 && s.selectedIds.includes(id))
          return { selectedId: id, ...endCrop };
        return { selectedId: id, selectedIds: members, textSel: null, ...endCrop };
      }
      const has = members.every((m) => s.selectedIds.includes(m));
      const selectedIds = has
        ? s.selectedIds.filter((x) => !members.includes(x))
        : [...new Set([...s.selectedIds, ...members])];
      return {
        selectedIds,
        selectedId: has ? (selectedIds[selectedIds.length - 1] ?? null) : id,
        textSel: null,
      };
    }),

  groupSelected: () =>
    set((s) => {
      if (s.selectedIds.length < 2) return {};
      const gid = uid();
      return commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((l) =>
          s.selectedIds.includes(l.id) ? ({ ...l, groupId: gid } as Layer) : l,
        ),
      });
    }),

  ungroupSelected: () =>
    set((s) => {
      const gids = new Set(
        s.doc.layers
          .filter((l) => s.selectedIds.includes(l.id) && l.groupId)
          .map((l) => l.groupId),
      );
      if (!gids.size) return {};
      return commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((l) =>
          l.groupId && gids.has(l.groupId) ? ({ ...l, groupId: undefined } as Layer) : l,
        ),
      });
    }),

  addFrame: (kind) =>
    set((s) => {
      const size = Math.round(Math.min(s.doc.width, s.doc.height) * 0.45);
      const layer: ShapeLayer = {
        id: uid(),
        type: 'shape',
        frame: true,
        name: 'Marco',
        shape: kind,
        width: size,
        height: size,
        fill: '#d7dce3',
        stroke: '#9aa3b0',
        strokeWidth: 0,
        cornerRadius: 0,
        x: (s.doc.width - size) / 2,
        y: (s.doc.height - size) / 2,
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
        selectedIds: [layer.id],
      };
    }),

  // Pone una foto dentro de un marco: recorta la imagen "cubriendo" el marco
  // (sin deformar, centrada) y la sustituye por una capa de imagen recortada
  // a la forma del marco, en la misma posición, giro y orden.
  fillFrame: async (frameId, img) => {
    const f = get().doc.layers.find((l) => l.id === frameId);
    if (!f || f.type !== 'shape') return;
    const fw = f.width * f.scaleX;
    const fh = f.height * f.scaleY;
    const image = await loadImageEl(img.src);
    const nw = image.naturalWidth || img.naturalWidth;
    const nh = image.naturalHeight || img.naturalHeight;
    const cover = Math.max(fw / nw, fh / nh);
    const cw = Math.max(1, Math.round(fw / cover));
    const ch = Math.max(1, Math.round(fh / cover));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas
      .getContext('2d')!
      .drawImage(image, (nw - cw) / 2, (nh - ch) / 2, cw, ch, 0, 0, cw, ch);
    const png = img.src.startsWith('data:image/png');
    const src = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.92);
    set((s) => {
      const idx = s.doc.layers.findIndex((l) => l.id === frameId);
      if (idx < 0) return {};
      const layer: ImageLayer = {
        id: uid(),
        type: 'image',
        name: img.name ?? 'Foto en marco',
        groupId: f.groupId,
        src,
        naturalWidth: cw,
        naturalHeight: ch,
        x: f.x,
        y: f.y,
        scaleX: fw / cw,
        scaleY: fh / ch,
        rotation: f.rotation,
        opacity: f.opacity,
        blendMode: f.blendMode,
        visible: true,
        locked: false,
        adjust: { ...DEFAULT_ADJUST },
        filter: 'none',
        flipX: false,
        flipY: false,
        maskShape: f.shape,
        shadow: f.shadow,
        shadowColor: f.shadowColor,
        shadowBlur: f.shadowBlur,
        shadowX: f.shadowX,
        shadowY: f.shadowY,
      };
      const layers = [...s.doc.layers];
      layers.splice(idx, 1, layer);
      return {
        ...commit(s, { ...s.doc, layers }),
        selectedId: layer.id,
        selectedIds: [layer.id],
      };
    });
  },

  setEditingText: (id) => set({ editingTextId: id }),

  setTextSel: (sel) => set({ textSel: sel && sel.end > sel.start ? sel : null }),

  styleTextRange: (id, start, end, patch) =>
    set((s) => {
      const l = s.doc.layers.find((x) => x.id === id);
      if (!l || l.type !== 'text' || end <= start) return {};
      const spans = applySpanStyle(l, start, end, patch);
      return commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((x) =>
          x.id === id ? ({ ...x, spans: spans.length ? spans : undefined } as Layer) : x,
        ),
      });
    }),

  setTextStyleAll: (id, patch) =>
    set((s) => {
      const l = s.doc.layers.find((x) => x.id === id);
      if (!l || l.type !== 'text') return {};
      let spans = l.spans;
      const next: Partial<TextLayer> = {};
      if (patch.bold !== undefined) {
        next.bold = patch.bold;
        spans = stripSpanKey(spans, 'bold');
      }
      if (patch.italic !== undefined) {
        next.italic = patch.italic;
        spans = stripSpanKey(spans, 'italic');
      }
      if (patch.underline !== undefined) {
        next.underline = patch.underline;
        spans = stripSpanKey(spans, 'underline');
      }
      if (patch.fill !== undefined) {
        next.fill = patch.fill;
        spans = stripSpanKey(spans, 'color');
      }
      return commit(s, {
        ...s.doc,
        layers: s.doc.layers.map((x) =>
          x.id === id ? ({ ...x, ...next, spans } as Layer) : x,
        ),
      });
    }),

  removeSelected: () =>
    set((s) => {
      if (s.doc.locked) return {};
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
    set((s) => ({
      selectedId: id,
      selectedIds: [id],
      textEditNonce: s.textEditNonce + 1,
    })),

  playAnimations: () =>
    set((s) => ({ animPlayNonce: s.animPlayNonce + 1 })),

  setSelRect: (r) => set({ selRect: r }),
  setPixelSel: (pixelSel) => set({ pixelSel }),
  setMaskEdit: (maskEditId) => set(() => (maskEditId ? { maskEditId } : { maskEditId: null, maskView: false })),
  setMaskView: (maskView) => set({ maskView }),

  setZoom: (z) => set({ zoom: Math.max(0.1, Math.min(5, z)) }),
  setViewScale: (s) => set({ viewScale: s }),
  toggleRulers: () => {
    set({ showRulers: !get().showRulers });
    saveView(viewPrefs(get()));
  },
  togglePageView: () => {
    set({ pageView: get().pageView === 'stack' ? 'single' : 'stack' });
    saveView(viewPrefs(get()));
  },
  toggleGrid: () => {
    set({ showGrid: !get().showGrid });
    saveView(viewPrefs(get()));
  },
  toggleGuides: () => {
    set({ showGuides: !get().showGuides });
    saveView(viewPrefs(get()));
  },
  toggleSnapToGrid: () => {
    set({ snapToGrid: !get().snapToGrid });
    saveView(viewPrefs(get()));
  },
  setGuides: (guides) =>
    set((s) => {
      const cur = s.doc.guides ?? { x: [], y: [] };
      if (JSON.stringify(cur) === JSON.stringify(guides)) return {};
      return commit(s, { ...s.doc, guides });
    }),

  toggleNotes: () => set({ showNotes: !get().showNotes }),
  toggleLayout: () => set({ showLayout: !get().showLayout }),

  setLayoutAids: (patch) =>
    set((s) => {
      const next = { ...s.doc, ...patch } as Doc;
      // Los valores vacíos se quitan del documento (queda idéntico a uno antiguo).
      if (!next.margins) delete next.margins;
      if (!next.bleed) delete next.bleed;
      if (!next.columns) delete next.columns;
      if (JSON.stringify(next) === JSON.stringify(s.doc)) return {};
      return commit(s, next);
    }),

  addNote: () =>
    set((s) => {
      const notes = s.doc.notes ?? [];
      const o = (notes.length % 8) * 24;
      const note: StickyNote = {
        id: uid(),
        x: Math.round(s.doc.width * 0.05) + o,
        y: Math.round(s.doc.height * 0.05) + o,
        text: '',
        color: NOTE_COLORS[0],
      };
      return { ...commit(s, { ...s.doc, notes: [...notes, note] }), showNotes: true };
    }),

  updateNote: (id, patch) =>
    set((s) => {
      const notes = s.doc.notes ?? [];
      if (!notes.some((n) => n.id === id)) return {};
      return commit(s, { ...s.doc, notes: notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
    }),

  removeNote: (id) =>
    set((s) => {
      const notes = (s.doc.notes ?? []).filter((n) => n.id !== id);
      const next = { ...s.doc, notes } as Doc;
      if (!notes.length) delete next.notes;
      return commit(s, next);
    }),

  setSpeakerNotes: (text) =>
    set((s) => {
      if ((s.doc.speakerNotes ?? '') === text) return {};
      const next = { ...s.doc, speakerNotes: text } as Doc;
      if (!text) delete next.speakerNotes;
      return commit(s, next);
    }),

  // Selecciona todas las capas parecidas a la dada (mismo tipo/relleno/fuente).
  selectSimilar: (id) =>
    set((s) => {
      const ids = similarLayerIds(s.doc.layers, id);
      if (!ids.length) return {};
      return { selectedIds: ids, selectedId: id, textSel: null };
    }),

  // Pega solo el formato de `src` en la selección: un único paso de deshacer.
  pasteStyle: (src) =>
    set((s) => {
      const targets = new Set(s.selectedIds.length ? s.selectedIds : s.selectedId ? [s.selectedId] : []);
      let changed = false;
      const layers = s.doc.layers.map((l) => {
        if (!targets.has(l.id) || l.locked) return l;
        changed = true;
        return { ...l, ...stylePatch(src, l) } as Layer;
      });
      if (!changed) return {};
      return commit(s, { ...s.doc, layers });
    }),

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
      if (s.doc.locked) return {};
      const l = s.doc.layers.find((x) => x.id === id);
      if (!l) return {};
      const { w, h } = layerBox(l);
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
      if (s.doc.locked) return {};
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
      if (s.doc.locked) return {};
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
      // Marco local de la capa (unidades naturales de la imagen COMPLETA, ya volteada): el editor
      // se abre sobre la imagen entera con el recorte actual precargado.
      const d = displayBox(l);
      return {
        cropMode: true,
        cropAspect: null,
        cropRect: { x: d.x, y: d.y, width: d.w, height: d.h },
      };
    }),

  setCropRect: (rect) => set({ cropRect: rect }),

  setCropAspect: (aspect) =>
    set((s) => {
      if (!s.cropRect || !aspect) return { cropAspect: aspect };
      // Reajusta el rect actual a la proporción VISTA (con la escala de la capa), conservando el
      // ancho y sin salirse de la imagen.
      const l = s.doc.layers.find((x) => x.id === s.selectedId);
      const r = s.cropRect;
      if (!l || l.type !== 'image') return { cropAspect: aspect, cropRect: { ...r, height: r.width / aspect } };
      const b = fitAspect({ x: r.x, y: r.y, w: r.width, h: r.height }, aspect, l.scaleX, l.scaleY, fullSize(l));
      return {
        cropAspect: aspect,
        cropRect: { x: b.x, y: b.y, width: b.w, height: b.h },
      };
    }),

  cancelCrop: () => set({ cropMode: false, cropRect: null, cropAspect: null }),

  undo: () =>
    set((s) => {
      // Operación de proyecto entero (borrar página, varios formatos, restaurar versión)
      // sin nada hecho después en la página: es lo último, se deshace primero.
      const u = s.structUndo;
      if (u && s.doc === u.docAfter && s.pageIndex === u.pageIndexAfter) {
        const idx = Math.min(u.pageIndex, u.pages.length - 1);
        const doc = u.pages[idx];
        endBatchNow();
        return {
          pages: u.pages,
          doc,
          pageIndex: idx,
          ...swap(s.pageHist, s, doc),
          selectedId: null,
          selectedIds: [],
          structUndo: null,
        };
      }
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

  jumpToHistory: (index) =>
    set((s) => jumpInHistory(s.past, s.doc, s.future, index) ?? {}),

  patchOtherPages: (edits) =>
    set((s) => {
      const pages = s.pages.map((pg, i) => {
        if (i === s.pageIndex) return pg;
        const mine = edits.filter((e) => e.page === i);
        if (!mine.length) return pg;
        return {
          ...pg,
          layers: pg.layers.map((l) => {
            const e = mine.find((x) => x.id === l.id);
            return e ? patchLayer(l, e.patch) : l;
          }),
        };
      });
      return { pages, structUndo: null };
    }),

  recolorDoc: (doc, live) => set((s) => (live ? { doc } : commit(s, doc))),

  recolorOtherPages: (fn) =>
    set((s) => ({ pages: s.pages.map((pg, i) => (i === s.pageIndex ? pg : fn(pg))), structUndo: null })),
}));

// Las capas de la página maestra se resuelven al dibujar/exportar (core/master.ts).
registerMasterPages(() => {
  const s = useEditor.getState();
  return s.pages.map((p, i) => (i === s.pageIndex ? s.doc : p));
});
