// Persistencia de las pestañas de documentos (P8).
//
// Claves de IndexedDB:
//   `tabs`       = { v: 1, order: string[], activeId: string, savedAt }   ← índice
//   `tab:<id>`   = { v: 1, id, pages (deshidratadas), index, designId, designName?, savedAt }
//
// Ritmo: la pestaña ACTIVA la escribe el autoguardado (io/autosave.ts) junto con
// `autosave`; una aparcada se escribió por última vez al aparcarla (flushSave lee el
// estado en el mismo tick, antes de cambiar). Las imágenes van por referencia
// (`asset:<hash>`) y gcAssets recorre `tab:*`: una imagen que solo usa una pestaña
// aparcada NO se borra.
//
// Migración (no destructiva): si no hay `tabs`, App.tsx recupera `autosave` como
// siempre y la primera escritura crea `tabs` y `tab:<id>`. `autosave` NO se borra ni
// deja de escribirse (siempre = pestaña activa): una versión anterior sigue
// recuperando lo último que se editó.
//
// Nunca lanza. Un registro dañado se descarta (con su id en `dropped`) y las demás
// pestañas siguen; nada se borra al leer.
import type { Doc } from '../editor/core/types';
import { idbDelete, idbGet, idbSet } from './idb';
import { rehydrateDocs } from './assets';

export const TABS_KEY = 'tabs';
export const TAB_PREFIX = 'tab:';
export const TABS_SCHEMA = 1;
/** Mismo límite que la tira (editor/state/sessions.ts MAX_TABS); repetido para no importar el store. */
export const MAX_SAVED_TABS = 8;

export const tabKey = (id: string) => TAB_PREFIX + id;

export interface TabsIndex {
  v: number;
  order: string[];
  activeId: string;
  savedAt: number;
}
export interface TabRecord {
  v: number;
  id: string;
  pages: Doc[];
  index: number;
  designId: string;
  designName?: string;
  savedAt: number;
}
/** Lo que se guarda de una pestaña (las páginas ya deshidratadas). */
export interface TabSession {
  pages: Doc[];
  index: number;
  designId: string;
  designName?: string | null;
}
export interface LoadedTab {
  id: string;
  pages: Doc[]; // rehidratadas (dataURL), listas para el store
  index: number;
  designId: string;
  designName: string | null;
}
export interface LoadedTabs {
  tabs: LoadedTab[]; // en el orden guardado; nunca vacía
  activeId: string; // siempre una de `tabs`
  dropped: string[]; // ids listados cuyo registro estaba dañado (o repetía diseño): se avisa
}

// ---- validación (pura) ----

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isDocLike = (v: unknown) => isObj(v) && isStr(v.id) && Array.isArray(v.layers) && isNum(v.width) && isNum(v.height);

/** Índice válido (sin ids repetidos ni vacíos, como mucho MAX_SAVED_TABS) o null. */
export function parseIndex(v: unknown): TabsIndex | null {
  if (!isObj(v) || !Array.isArray(v.order)) return null;
  if (isNum(v.v) && v.v > TABS_SCHEMA) return null; // de una versión más nueva: no se interpreta
  const order: string[] = [];
  for (const id of v.order) if (isStr(id) && !order.includes(id) && order.length < MAX_SAVED_TABS) order.push(id);
  if (!order.length) return null;
  const activeId = isStr(v.activeId) && order.includes(v.activeId) ? v.activeId : order[0];
  return { v: TABS_SCHEMA, order, activeId, savedAt: isNum(v.savedAt) ? v.savedAt : 0 };
}

/** Registro de pestaña válido para `id` o null (dañado, de otra pestaña o vacío). */
export function parseTabRecord(v: unknown, id: string): TabRecord | null {
  if (!isObj(v) || v.id !== id || !Array.isArray(v.pages) || !v.pages.length || !v.pages.every(isDocLike)) return null;
  if (isNum(v.v) && v.v > TABS_SCHEMA) return null;
  const pages = v.pages as Doc[];
  const index = Number.isInteger(v.index) && (v.index as number) >= 0 && (v.index as number) < pages.length ? (v.index as number) : 0;
  return {
    v: TABS_SCHEMA,
    id,
    pages,
    index,
    designId: isStr(v.designId) ? v.designId : pages[0].id,
    ...(isStr(v.designName) && v.designName.trim() ? { designName: v.designName } : {}),
    savedAt: isNum(v.savedAt) ? v.savedAt : 0,
  };
}

// ---- escritura ----
// Dos guardados pueden solaparse (uno con retardo y un «guardar ya»): cada escritura
// lleva el número de la ronda que la produjo y una ronda vieja nunca pisa a una más
// nueva. Una pestaña cerrada no resucita aunque llegue tarde una escritura suya.

let indexSeq = -1;
const tabSeq = new Map<string, number>();
const removed = new Set<string>();

/** Guarda la pestaña `id`. `seq` = ronda del autoguardado (más alta = más nueva). */
export async function saveTab(id: string, session: TabSession, seq?: number): Promise<boolean> {
  if (!id || removed.has(id) || !session.pages.length) return true;
  if (seq !== undefined) {
    if ((tabSeq.get(id) ?? -1) > seq) return true; // ya se escribió algo más nuevo
    tabSeq.set(id, seq);
  }
  const rec: TabRecord = {
    v: TABS_SCHEMA,
    id,
    pages: session.pages,
    index: session.index,
    designId: session.designId,
    ...(session.designName ? { designName: session.designName } : {}),
    savedAt: Date.now(),
  };
  return idbSet(tabKey(id), rec);
}

/** Guarda el orden de la tira y la pestaña activa. */
export async function saveTabsIndex(order: string[], activeId: string, seq?: number): Promise<boolean> {
  if (seq !== undefined) {
    if (indexSeq > seq) return true;
    indexSeq = seq;
  }
  const ids = order.filter((id) => !removed.has(id));
  if (!ids.length) return true;
  const idx: TabsIndex = { v: TABS_SCHEMA, order: ids, activeId: ids.includes(activeId) ? activeId : ids[0], savedAt: Date.now() };
  return idbSet(TABS_KEY, idx);
}

/**
 * Pestaña cerrada: se quita del índice y después se borra su registro (en ese orden: un
 * índice nunca apunta a un registro que ya no existe). El diseño sigue en Inicio
 * (`designs`); solo se llama tras un cierre correcto o forzado.
 */
export async function removeTab(id: string, now?: { order: string[]; activeId: string }): Promise<void> {
  if (!id) return;
  removed.add(id);
  tabSeq.delete(id);
  const idx = parseIndex(await idbGet(TABS_KEY));
  if (idx?.order.includes(id)) {
    // Con el estado actual de la tira (si se da) el índice queda ya al día; si no, solo se quita el id.
    const order = (now?.order ?? idx.order).filter((t) => t !== id && !removed.has(t));
    const active = now?.activeId ?? idx.activeId;
    if (order.length)
      await idbSet(TABS_KEY, { v: TABS_SCHEMA, order, activeId: order.includes(active) ? active : order[0], savedAt: Date.now() });
  }
  await idbDelete(tabKey(id));
}

// ---- lectura ----

/**
 * Pestañas guardadas, con las imágenes ya rehidratadas. null = no hay índice `tabs` (o
 * ninguna pestaña se pudo leer): el llamador recupera `autosave` como siempre.
 * Nunca hay dos pestañas con el mismo diseño: si pasara, gana la activa (o la primera).
 */
export async function loadTabs(): Promise<LoadedTabs | null> {
  try {
    const idx = parseIndex(await idbGet(TABS_KEY));
    if (!idx) return null;
    const recs: TabRecord[] = [];
    const dropped: string[] = [];
    for (const id of idx.order) {
      let raw: unknown;
      try {
        raw = await idbGet(tabKey(id));
      } catch {
        raw = undefined;
      }
      // Sin registro = pestaña nueva que aún no llegó a guardarse (el registro se escribe
      // SIEMPRE antes que el índice): no había nada que perder y no se avisa.
      if (raw == null) continue;
      const rec = parseTabRecord(raw, id);
      if (rec) recs.push(rec);
      else dropped.push(id);
    }
    // Mismo diseño en dos pestañas: se conserva la activa (o la primera); la otra queda
    // en IndexedDB sin tocar y fuera de la tira.
    const active = recs.find((r) => r.id === idx.activeId);
    const seen = new Set<string>(active ? [active.designId] : []);
    const unique = recs.filter((r) => {
      if (r === active) return true;
      if (seen.has(r.designId)) {
        dropped.push(r.id);
        return false;
      }
      seen.add(r.designId);
      return true;
    });
    const tabs: LoadedTab[] = [];
    for (const r of unique) {
      try {
        tabs.push({ id: r.id, pages: await rehydrateDocs(r.pages), index: r.index, designId: r.designId, designName: r.designName ?? null });
      } catch {
        dropped.push(r.id);
      }
    }
    if (!tabs.length) return null;
    const activeId = tabs.some((t) => t.id === idx.activeId) ? idx.activeId : tabs[0].id;
    return { tabs, activeId, dropped };
  } catch {
    return null;
  }
}

/** Solo para pruebas: olvida las rondas y los cierres de esta sesión. */
export function resetTabsStoreForTests() {
  indexSeq = -1;
  tabSeq.clear();
  removed.clear();
}
