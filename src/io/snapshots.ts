// Instantáneas con nombre («versiones»): copia del documento completo (todas
// las páginas) guardada en IndexedDB bajo la clave 'snapshots', agrupada por
// diseño (id de la primera página). Las imágenes van por referencia (assets.ts)
// y gcAssets ya revisa esta clave, así que no se pierden ni quedan huérfanas.
import type { Doc } from '../editor/core/types';
import { idbGet, idbSet } from './idb';
import { dehydrateDocs, rehydrateDocs } from './assets';

export interface Snapshot {
  id: string;
  name: string;
  ts: number; // epoch ms
  pageIndex: number;
  pages: Doc[]; // ligeros (imágenes por referencia)
  thumb?: string;
  // Versiones automáticas (io/autoVersions.ts): viven aparte de las con nombre.
  auto?: boolean;
  size?: number; // peso aproximado (caracteres JSON) para el límite de espacio
}

export const MAX_SNAPSHOTS = 20;
const KEY = 'snapshots';

type Store = Record<string, Snapshot[]>;

async function loadAll(): Promise<Store> {
  return (await idbGet<Store>(KEY)) ?? {};
}

export async function listSnapshots(designId: string): Promise<Snapshot[]> {
  return (await loadAll())[designId] ?? [];
}

// Añade una instantánea (la más nueva primero) y descarta las que pasen de 20.
export function addToList(list: Snapshot[], snap: Snapshot, max = MAX_SNAPSHOTS): Snapshot[] {
  return [snap, ...list].slice(0, max);
}

export async function saveSnapshot(
  designId: string,
  name: string,
  pages: Doc[],
  pageIndex: number,
  thumb?: string,
): Promise<Snapshot[]> {
  const all = await loadAll();
  const snap: Snapshot = {
    id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || 'Versión sin nombre',
    ts: Date.now(),
    pageIndex,
    pages: await dehydrateDocs(pages),
    thumb,
  };
  all[designId] = addToList(all[designId] ?? [], snap);
  await idbSet(KEY, all);
  return all[designId];
}

export async function deleteSnapshot(designId: string, id: string): Promise<Snapshot[]> {
  const all = await loadAll();
  all[designId] = (all[designId] ?? []).filter((s) => s.id !== id);
  if (all[designId].length === 0) delete all[designId];
  await idbSet(KEY, all);
  return all[designId] ?? [];
}

// Quita todas las instantáneas de los diseños dados (al borrarlos de verdad).
export async function dropSnapshotsOf(designIds: string[]): Promise<void> {
  if (designIds.length === 0) return;
  // Las versiones automáticas (clave aparte) se van con su diseño.
  const autos = await idbGet<Store>('autoVersions');
  if (autos && designIds.some((id) => autos[id])) {
    for (const id of designIds) delete autos[id];
    await idbSet('autoVersions', autos);
  }
  const all = await loadAll();
  let changed = false;
  for (const id of designIds) {
    if (all[id]) {
      delete all[id];
      changed = true;
    }
  }
  if (changed) await idbSet(KEY, all);
}

// Páginas listas para cargar en el editor (imágenes ya resueltas).
export async function snapshotPages(s: Snapshot): Promise<Doc[]> {
  return rehydrateDocs(s.pages);
}
