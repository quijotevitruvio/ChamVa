// Versiones automáticas del diseño: mientras se edita, cada ~10 min se guarda
// una copia del proyecto completo (todas las páginas) con `auto: true`.
// Política de retención: las 10 más recientes + la más nueva de cada uno de los
// últimos 7 días. Viven en la clave 'autoVersions' (aparte de las versiones con
// nombre de snapshots.ts, que el usuario guarda a mano y no se mezclan).
// Las imágenes van por referencia (assets.ts) y gcAssets mira esta clave.
import type { Doc } from '../editor/core/types';
import { idbGet, idbSet } from './idb';
import { dehydrateDocs } from './assets';
import type { Snapshot } from './snapshots';

export const AUTO_INTERVAL_MS = 10 * 60 * 1000;
export const KEEP_RECENT = 10;
export const KEEP_DAYS = 7;
/** Tope de espacio para TODAS las versiones automáticas (caracteres JSON ≈ bytes). */
export const AUTO_BUDGET = 40_000_000;

const KEY = 'autoVersions';
type Store = Record<string, Snapshot[]>;

// ---- política (pura) ----

const dayKey = (ts: number) => {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

/** ¿Toca guardar otra versión? (`last` = marca de la última, 0 si no hay) */
export const autoVersionDue = (last: number, now: number, interval = AUTO_INTERVAL_MS) =>
  !last || now - last >= interval;

/**
 * Dada la lista de marcas de tiempo de las versiones de un diseño, devuelve las
 * que se conservan: las `recent` más nuevas + la más nueva de cada día de los
 * últimos `days` días (contando hoy).
 */
export function retainedTimestamps(
  stamps: number[],
  now: number,
  recent = KEEP_RECENT,
  days = KEEP_DAYS,
): Set<number> {
  const sorted = [...stamps].sort((a, b) => b - a);
  const keep = new Set<number>(sorted.slice(0, recent));
  const allowed = new Set<number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    allowed.add(dayKey(d.getTime()));
  }
  const seen = new Set<number>();
  for (const ts of sorted) {
    const k = dayKey(ts);
    if (allowed.has(k) && !seen.has(k)) {
      seen.add(k);
      keep.add(ts);
    }
  }
  return keep;
}

/** Aplica la retención a una lista de versiones (más nueva primero). */
export function applyRetention<T extends { ts: number }>(list: T[], now: number): T[] {
  const keep = retainedTimestamps(list.map((x) => x.ts), now);
  return list.filter((x) => keep.has(x.ts)).sort((a, b) => b.ts - a.ts);
}

/** Si el total pasa del presupuesto, descarta las versiones más antiguas de todos los diseños. */
export function enforceBudget(store: Store, max = AUTO_BUDGET): Store {
  const all: { id: string; ts: number; size: number; vid: string }[] = [];
  for (const [id, list] of Object.entries(store)) {
    for (const s of list) all.push({ id, ts: s.ts, size: s.size ?? 0, vid: s.id });
  }
  let total = all.reduce((n, x) => n + x.size, 0);
  if (total <= max) return store;
  const drop = new Set<string>();
  for (const x of all.sort((a, b) => a.ts - b.ts)) {
    if (total <= max) break;
    drop.add(x.vid);
    total -= x.size;
  }
  const out: Store = {};
  for (const [id, list] of Object.entries(store)) {
    const kept = list.filter((s) => !drop.has(s.id));
    if (kept.length) out[id] = kept;
  }
  return out;
}

// ---- almacenamiento ----

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function loadAll(): Promise<Store> {
  return (await idbGet<Store>(KEY)) ?? {};
}

export async function listAutoVersions(designId: string): Promise<Snapshot[]> {
  return (await loadAll())[designId] ?? [];
}

const lastTry = new Map<string, number>();

/**
 * Llamar tras cada autoguardado: guarda una versión si han pasado ≥10 min desde
 * la última y el contenido cambió. `pages` ya van ligeros (imágenes por referencia).
 */
export function maybeSaveAutoVersion(
  designId: string,
  pages: Doc[],
  pageIndex: number,
  thumb?: string,
): Promise<void> {
  const now = Date.now();
  const tried = lastTry.get(designId);
  if (tried && !autoVersionDue(tried, now)) return Promise.resolve();
  return serial(async () => {
    const all = await loadAll();
    const list = all[designId] ?? [];
    const last = list[0]?.ts ?? 0;
    if (!autoVersionDue(last, now)) {
      lastTry.set(designId, last);
      return;
    }
    lastTry.set(designId, now);
    const light = await dehydrateDocs(pages);
    const json = JSON.stringify(light);
    // Sin cambios desde la última versión: no se duplica.
    if (list[0] && JSON.stringify(list[0].pages) === json) return;
    const snap: Snapshot = {
      id: `auto-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'Automática',
      ts: now,
      pageIndex,
      pages: light,
      thumb,
      auto: true,
      size: json.length + (thumb?.length ?? 0),
    };
    all[designId] = applyRetention([snap, ...list], now);
    await idbSet(KEY, enforceBudget(all));
  });
}

export function deleteAutoVersion(designId: string, id: string): Promise<Snapshot[]> {
  return serial(async () => {
    const all = await loadAll();
    const next = (all[designId] ?? []).filter((s) => s.id !== id);
    if (next.length) all[designId] = next;
    else delete all[designId];
    await idbSet(KEY, all);
    return next;
  });
}

export function clearAutoVersions(designId: string): Promise<void> {
  return serial(async () => {
    const all = await loadAll();
    if (!all[designId]) return;
    delete all[designId];
    await idbSet(KEY, all);
    lastTry.delete(designId);
  });
}
