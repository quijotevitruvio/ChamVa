import type { Doc } from '../core/types';
import type { PageHist } from './pageHistory';
import type { EditorState } from './store';

// Pestañas de documentos: lógica PURA de «aparcar y desaparcar» (sin el store).
//
// La pestaña ACTIVA vive en los campos planos de siempre (`doc`, `pages`, `past`…):
// así las ~300 llamadas a `useEditor` no cambian y ningún componente sabe que hay
// pestañas. Las inactivas se guardan «aparcadas» (`parked[tabId]`) con EXACTAMENTE
// los mismos objetos (por referencia): aparcar y desaparcar no copia ni clona nada,
// así que el deshacer por página (`pageHist`, que compara por referencia) sigue
// valiendo al volver.
//
// Defensa contra «un campo por sesión olvidado» (que se filtraría entre pestañas):
// TODA clave de datos de `EditorState` debe estar clasificada en STATE_CLASS. El tipo
// `Record<DataKey, …>` hace fallar `tsc` si falta o sobra una, y la prueba
// `storeSessions.test.ts` lo comprueba también contra el store real en ejecución.

/** Claves de `EditorState` que son datos (no acciones). */
export type DataKey = {
  [K in keyof EditorState]: EditorState[K] extends (...args: never[]) => unknown ? never : K;
}[keyof EditorState];

/**
 * - `session`: pertenece al documento abierto; se aparca y vuelve tal cual.
 * - `global`: es de la app (biblioteca, marca, preferencias, registro de pestañas); no cambia.
 * - `transient`: estado de una interacción en curso; se reinicia al cambiar de pestaña.
 */
export type StateClass = 'session' | 'global' | 'transient';

export const STATE_CLASS = {
  // --- sesión: el documento y todo lo que solo tiene sentido con él ---
  doc: 'session',
  pages: 'session',
  pageIndex: 'session',
  past: 'session',
  future: 'session',
  structUndo: 'session', // deshacer «de proyecto entero» (compara por referencia con doc)
  pageHist: 'session', // deshacer de las demás páginas (P1)
  selectedId: 'session',
  selectedIds: 'session',
  zoom: 'session', // como en Canva: cada diseño recuerda su zoom
  designId: 'session', // identidad estable (P1): galería, versiones, undo:<id>
  designName: 'session',
  pageView: 'session', // sencilla / apilada (P5); la preferencia guardada es la de la pestaña nueva

  // --- global: biblioteca, kits de marca, preferencias de vista ---
  uploads: 'global',
  templates: 'global',
  customFonts: 'global',
  recentColors: 'global',
  brandColors: 'global',
  brandLogos: 'global',
  brandFonts: 'global',
  brandKits: 'global',
  activeBrandKitId: 'global',
  showRespect: 'global',
  showRulers: 'global',
  showGrid: 'global',
  showGuides: 'global',
  snapToGrid: 'global',
  showNotes: 'global',
  showLayout: 'global',
  textEditNonce: 'global', // contadores que solo deben crecer (un efecto mira su cambio)
  animPlayNonce: 'global',
  // Escala real del lienzo: la deriva fit() del área visible, el tamaño y el zoom, y se
  // recalcula cuando cambian. Ponerla a 1 sería peor: con el mismo tamaño y zoom fit()
  // no vuelve a correr y el % mostrado quedaría mal.
  viewScale: 'global',
  // Registro de pestañas.
  tabs: 'global',
  activeTabId: 'global',
  parked: 'global',

  // --- transitorio: se cierra antes de cambiar de pestaña ---
  cropMode: 'transient',
  cropRect: 'transient',
  cropAspect: 'transient',
  editingTextId: 'transient', // el editor en línea se confirma (blur) ANTES de aparcar
  textSel: 'transient',
  selRect: 'transient',
  pixelSel: 'transient', // selección de píxeles (varita/lazo): no cruza a otra pestaña
  maskEditId: 'transient',
  maskView: 'transient',
} as const satisfies Record<DataKey, StateClass>; // falta o sobra una clave -> error de tsc

type Classified = typeof STATE_CLASS;
export type SessionKey = { [K in keyof Classified]: Classified[K] extends 'session' ? K : never }[keyof Classified];

export const SESSION_KEYS = (Object.keys(STATE_CLASS) as (keyof Classified)[]).filter(
  (k) => STATE_CLASS[k] === 'session',
) as SessionKey[];

/** Deshacer «de proyecto entero» del store (structUndo). */
export type StructUndo = { pages: Doc[]; pageIndex: number; docAfter: Doc; pageIndexAfter: number };

/**
 * Lo que se aparca de una pestaña inactiva: exactamente sus campos de sesión. Se escribe
 * a mano (no con Pick<EditorState>) porque `parked` forma parte de EditorState; las dos
 * comprobaciones de abajo exigen que coincida con STATE_CLASS y con los tipos del store.
 */
export interface SessionSnapshot {
  doc: Doc;
  pages: Doc[];
  pageIndex: number;
  past: Doc[];
  future: Doc[];
  structUndo: StructUndo | null;
  pageHist: PageHist;
  selectedId: string | null;
  selectedIds: string[];
  zoom: number;
  designId: string;
  designName: string | null;
  pageView: 'single' | 'stack';
}
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Si alguien clasifica una clave nueva como 'session', debe añadirla también aquí (y viceversa).
export const SNAPSHOT_MATCHES_CLASS: Same<SessionKey, keyof SessionSnapshot> = true;
export const SNAPSHOT_MATCHES_STORE: Same<Pick<EditorState, SessionKey>, SessionSnapshot> = true;

/** Valores con que quedan las claves transitorias tras un cambio de pestaña. */
export const TRANSIENT_RESET = {
  cropMode: false,
  cropRect: null,
  cropAspect: null,
  editingTextId: null,
  textSel: null,
  selRect: null,
  pixelSel: null,
  maskEditId: null,
  maskView: false,
} satisfies { [K in keyof Classified as Classified[K] extends 'transient' ? K : never]: EditorState[K] };

/** Estado de guardado de una pestaña aparcada (lo último que se escribió al aparcarla). */
export type TabSave = 'saved' | 'pending' | 'error';
export interface TabMeta {
  id: string;
  save: TabSave;
}

export const MAX_TABS = 8; // cada aparcada mantiene sus imágenes y su deshacer en memoria

/** Copia los campos de sesión (mismas referencias, sin clonar). */
export function park(s: SessionSnapshot): SessionSnapshot {
  const out = {} as Record<SessionKey, unknown>;
  for (const k of SESSION_KEYS) out[k] = s[k];
  return out as SessionSnapshot;
}

/** Campos a fijar en el store para activar una sesión aparcada (mismas referencias). */
export function unpark(snap: SessionSnapshot): SessionSnapshot {
  return park(snap);
}

/** Sesión de un diseño recién creado o abierto (sin historial). */
export function freshSession(
  pages: Doc[],
  index: number,
  ident: { designId: string; designName: string | null },
  pageView: EditorState['pageView'],
): SessionSnapshot {
  const pageIndex = pages[index] ? index : 0;
  return {
    doc: pages[pageIndex],
    pages,
    pageIndex,
    past: [],
    future: [],
    structUndo: null,
    pageHist: {},
    selectedId: null,
    selectedIds: [],
    zoom: 1,
    designId: ident.designId,
    designName: ident.designName,
    pageView,
  };
}

/** designId de cada pestaña: la activa lo lee del estado vivo, las demás de su aparcamiento. */
export function findTabByDesign(
  s: { tabs: TabMeta[]; activeTabId: string; designId: string; parked: Record<string, SessionSnapshot> },
  designId: string,
): string | null {
  if (!designId) return null;
  if (s.designId === designId) return s.activeTabId;
  for (const t of s.tabs) if (t.id !== s.activeTabId && s.parked[t.id]?.designId === designId) return t.id;
  return null;
}

/**
 * Qué pestaña queda activa al cerrar `closingId`: si no era la activa, la misma; si lo
 * era, la vecina de la derecha y, si no hay, la de la izquierda. null = no queda ninguna.
 */
export function nextActiveAfterClose(tabs: TabMeta[], activeId: string, closingId: string): string | null {
  const i = tabs.findIndex((t) => t.id === closingId);
  if (i < 0) return activeId;
  if (closingId !== activeId) return activeId;
  return tabs[i + 1]?.id ?? tabs[i - 1]?.id ?? null;
}

/**
 * Sesión «vacía» (se puede reutilizar o cerrar sin preguntar): una página sin capas,
 * sin notas, sin historial de ningún tipo y sin nombre propio.
 */
export function isBlankSession(s: SessionSnapshot): boolean {
  if (s.pages.length !== 1) return false;
  const d = s.doc;
  return (
    d.layers.length === 0 &&
    !d.notes?.length &&
    !d.speakerNotes &&
    s.past.length === 0 &&
    s.future.length === 0 &&
    !s.structUndo &&
    Object.keys(s.pageHist).length === 0 &&
    !s.designName
  );
}

/** Mueve una pestaña (arrastrar en la tira). Índices fuera de rango: sin cambios. */
export function reorderTabList(tabs: TabMeta[], from: number, to: number): TabMeta[] {
  if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) return tabs;
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
