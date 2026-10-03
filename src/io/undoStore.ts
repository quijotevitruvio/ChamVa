// Deshacer que sobrevive al cierre: los últimos pasos del historial de la página
// actual se guardan en IndexedDB (clave `undo:<id del diseño>`) y se recuperan al
// reabrir el MISMO diseño.
//
// Compactación: los pasos del historial comparten por referencia las capas que no
// cambiaron entre un paso y el siguiente (el store es inmutable). Se guarda un
// «pool» de capas distintas y cada paso es solo la lista de índices al pool +
// los campos del documento. Así 20 pasos pesan casi lo que 1 documento + las
// capas que de verdad cambiaron. Las imágenes se deshidratan por hash (assets.ts)
// como en el autoguardado, y gcAssets mira estas claves.
//
// Coherencia: junto a los pasos se guarda una huella del documento actual. Al
// restaurar, si la huella no coincide con el documento que se abrió (otro
// esquema, documento cambiado fuera, otra página), el historial se descarta en
// silencio.
import type { Doc, Layer } from '../editor/core/types';
import { idbDelete, idbGet, idbKeys, idbSet } from './idb';
import { dehydrateDocs, rehydrateDocs } from './assets';

export const UNDO_SCHEMA = 1;
export const UNDO_STEPS = 20;
export const UNDO_DEBOUNCE_MS = 2500;
const KEY_PREFIX = 'undo:';
const INDEX_KEY = 'undoIndex'; // designId → savedAt (para limpiar los viejos)
const KEEP_DESIGNS = 15;
const MAX_AGE_MS = 30 * 86_400_000;

// ---- compactación (pura) ----

export interface CompactHistory {
  pool: Layer[];
  steps: { doc: Omit<Doc, 'layers'>; l: number[] }[];
}

/** Docs (más antiguo primero) → pool de capas únicas por referencia + pasos. */
export function compactDocs(docs: Doc[]): CompactHistory {
  const pool: Layer[] = [];
  const idx = new Map<Layer, number>();
  const steps: CompactHistory['steps'] = [];
  for (const d of docs) {
    const { layers, ...rest } = d;
    const l = layers.map((layer) => {
      let i = idx.get(layer);
      if (i === undefined) {
        i = pool.length;
        pool.push(layer);
        idx.set(layer, i);
      }
      return i;
    });
    steps.push({ doc: rest, l });
  }
  return { pool, steps };
}

/** Inverso de compactDocs. Devuelve null si los índices no cuadran (dato dañado). */
export function expandDocs(c: CompactHistory): Doc[] | null {
  if (!c || !Array.isArray(c.pool) || !Array.isArray(c.steps)) return null;
  const out: Doc[] = [];
  for (const s of c.steps) {
    if (!s || !Array.isArray(s.l) || !s.doc) return null;
    const layers: Layer[] = [];
    for (const i of s.l) {
      const layer = c.pool[i];
      if (!layer) return null;
      layers.push(layer);
    }
    out.push({ ...s.doc, layers } as Doc);
  }
  return out;
}

function stable(v: unknown): string {
  if (v === undefined) return '';
  if (Array.isArray(v)) return '[' + v.map((x) => stable(x) || 'null').join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return (
      '{' +
      Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + stable(o[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(v) ?? '';
}

/** Huella (FNV-1a de 32 bits + longitud) del documento, insensible al orden de claves. */
export function docFingerprint(doc: Doc): string {
  const s = stable(doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${s.length}`;
}

export interface UndoRecord {
  schema: number;
  designId: string;
  pageId: string; // id de la página a la que pertenece el historial
  savedAt: number;
  fp: string; // huella del documento actual (último paso)
  hist: CompactHistory; // pasos anteriores + el actual al final
}

/** Construye el registro a guardar (pasos recortados a los últimos UNDO_STEPS). */
export function buildRecord(designId: string, past: Doc[], doc: Doc, now = Date.now()): UndoRecord | null {
  if (past.length === 0) return null;
  const steps = past.slice(-UNDO_STEPS);
  return {
    schema: UNDO_SCHEMA,
    designId,
    pageId: doc.id,
    savedAt: now,
    fp: docFingerprint(doc),
    hist: compactDocs([...steps, doc]),
  };
}

/**
 * Pasos recuperables para `doc` (el documento recién abierto) o null si el
 * registro no es coherente. Los pasos devueltos NO incluyen el actual.
 */
export function pastFromRecord(rec: UndoRecord | null | undefined, designId: string, doc: Doc): Doc[] | null {
  if (!rec || rec.schema !== UNDO_SCHEMA || rec.designId !== designId || rec.pageId !== doc.id) return null;
  const docs = expandDocs(rec.hist);
  if (!docs || docs.length < 2) return null;
  const last = docs[docs.length - 1];
  if (docFingerprint(last) !== rec.fp || docFingerprint(last) !== docFingerprint(doc)) return null;
  return docs.slice(0, -1).slice(-UNDO_STEPS);
}

/** Qué diseños del índice se descartan (los más viejos o pasados de edad). */
export function staleDesigns(index: Record<string, number>, now: number): string[] {
  const entries = Object.entries(index).sort((a, b) => b[1] - a[1]);
  return entries.filter(([, ts], i) => i >= KEEP_DESIGNS || now - ts > MAX_AGE_MS).map(([id]) => id);
}

// =====================================================================
// Persistencia (IndexedDB) y enganche con el store
// =====================================================================

/** Parte mínima del store que usamos (se inyecta para no importar el store aquí). */
export interface UndoStoreApi {
  getState: () => {
    doc: Doc;
    pages: Doc[];
    pageIndex: number;
    past: Doc[];
    designId?: string; // identidad estable del diseño (store); sin ella, la antigua
  };
  subscribe: (fn: (s: { past: Doc[] }, prev: { past: Doc[] }) => void) => () => void;
  restoreHistory: (past: Doc[], docId: string) => void;
}

/**
 * Diseño al que pertenece el historial. Con `designId` (store actual) es ese, que
 * no cambia al reordenar ni borrar páginas. Sin él (API antigua) se usa el id de la
 * primera página, que es el valor con el que se guardaron los `undo:<id>` antiguos.
 */
export const designIdOf = (s: ReturnType<UndoStoreApi['getState']>) =>
  s.designId || (s.pageIndex === 0 ? s.doc.id : s.pages[0]?.id ?? s.doc.id);

async function mapPool(pool: Layer[], fn: (docs: Doc[]) => Promise<Doc[]>): Promise<Layer[]> {
  // Reutiliza la (des)hidratación de imágenes de assets.ts con un «documento» de un solo lote.
  const out = await fn([{ layers: pool } as unknown as Doc]);
  return out[0].layers;
}

async function readIndex(): Promise<Record<string, number>> {
  return (await idbGet<Record<string, number>>(INDEX_KEY)) ?? {};
}

let suspended = 0;

async function persistNow(store: UndoStoreApi): Promise<void> {
  if (suspended > 0) return;
  const s = store.getState();
  const designId = designIdOf(s);
  const key = KEY_PREFIX + designId;
  const rec = buildRecord(designId, s.past, s.doc);
  if (!rec) {
    // Sin pasos: si lo guardado ya no corresponde a este documento, se borra.
    // Solo si es de ESTA página: al pasar a otra página sin pasos, el historial
    // guardado de la anterior se conserva (sigue siendo válido para ella).
    const old = await idbGet<UndoRecord>(key);
    if (old && old.pageId === s.doc.id && old.fp !== docFingerprint(s.doc)) {
      await idbDelete(key);
      const idx = await readIndex();
      delete idx[designId];
      await idbSet(INDEX_KEY, idx);
    }
    return;
  }
  rec.hist.pool = await mapPool(rec.hist.pool, dehydrateDocs);
  if (await idbSet(key, rec)) {
    const idx = await readIndex();
    idx[designId] = rec.savedAt;
    await idbSet(INDEX_KEY, idx);
  }
}

/**
 * Tras abrir un diseño (loadPages): recupera sus últimos pasos de deshacer si son
 * coherentes con el documento abierto. Nunca lanza.
 */
export async function restoreUndoFor(store: UndoStoreApi): Promise<boolean> {
  suspended++;
  try {
    const s = store.getState();
    const designId = designIdOf(s);
    const rec = await idbGet<UndoRecord>(KEY_PREFIX + designId);
    if (!rec || rec.schema !== UNDO_SCHEMA) return false;
    // Las capas del registro vienen deshidratadas; la huella se calculó sobre el
    // documento en memoria, así que se rehidrata antes de comparar.
    const pool = await mapPool(rec.hist.pool, rehydrateDocs);
    const past = pastFromRecord({ ...rec, hist: { ...rec.hist, pool } }, designId, s.doc);
    // El documento pudo cambiar mientras se leía: se comprueba otra vez.
    const now = store.getState();
    if (!past || now.doc !== s.doc || designIdOf(now) !== designId) return false;
    store.restoreHistory(past, s.doc.id);
    return true;
  } catch {
    return false; // historial descartado sin ruido
  } finally {
    suspended--;
  }
}

let pendingFlush: (() => void) | null = null;

/**
 * Si hay una escritura del historial esperando su retardo, la hace YA con el estado
 * actual (se lee antes del primer await). Se llama antes de cambiar de pestaña: si no,
 * al vencer el retardo se leería la pestaña nueva y los últimos pasos de la saliente
 * no quedarían guardados. Sin nada pendiente no hace nada (no cambia el ritmo).
 */
export function flushUndo(): void {
  pendingFlush?.();
}

/** Empieza a guardar el historial (escritura diferida). Devuelve la función que lo detiene. */
export function startUndoPersistence(store: UndoStoreApi): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    persistNow(store).catch(() => {});
  };
  const flushIfPending = () => {
    if (timer) flush();
  };
  pendingFlush = flushIfPending;
  const unsub = store.subscribe((s, prev) => {
    if (s.past === prev.past) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, UNDO_DEBOUNCE_MS);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden' && timer) flush();
  };
  document.addEventListener('visibilitychange', onHide);

  // Limpieza de historiales viejos (una vez, sin prisa).
  const clean = setTimeout(async () => {
    try {
      const idx = await readIndex();
      const gone = staleDesigns(idx, Date.now());
      const keys = await idbKeys(KEY_PREFIX);
      const orphans = keys.filter((k) => !(k.slice(KEY_PREFIX.length) in idx));
      for (const id of gone) {
        await idbDelete(KEY_PREFIX + id);
        delete idx[id];
      }
      for (const k of orphans) await idbDelete(k);
      if (gone.length) await idbSet(INDEX_KEY, idx);
    } catch {
      /* limpieza opcional */
    }
  }, 45_000);

  return () => {
    unsub();
    clearTimeout(timer);
    clearTimeout(clean);
    if (pendingFlush === flushIfPending) pendingFlush = null;
    document.removeEventListener('visibilitychange', onHide);
  };
}

/** Borra el historial guardado de un diseño (p. ej. al borrarlo del todo). */
export async function dropUndoOf(designId: string): Promise<void> {
  await idbDelete(KEY_PREFIX + designId);
}
