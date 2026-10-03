// Galería de diseños recientes + copias de seguridad del autoguardado.
// Todo vive en IndexedDB (idb.ts); las miniaturas son dataURL JPEG pequeños.
import type { Doc } from '../editor/core/types';
import { idbGet, idbSet } from './idb';
import { dropSnapshotsOf } from './snapshots';
import { purgeExpired, isTrashed, cleanFolderName, setTagsOf } from '../editor/core/libraryMeta';

export interface SavedDesign {
  // Identidad estable del diseño (designId del store). En los diseños guardados por
  // versiones anteriores es el id de su primera página de entonces: se conserva tal
  // cual al abrirlos, así que versiones y deshacer guardado siguen asociados.
  id: string;
  name: string; // nombre visible (el propio o el de la primera página)
  designName?: string; // nombre propio puesto al diseño (opcional; sin él, el de la primera página)
  updatedAt: number; // epoch ms
  pageIndex: number;
  pages: Doc[];
  thumb: string; // dataURL de la primera página
  // Biblioteca (opcionales: un diseño antiguo sigue siendo válido).
  folder?: string;
  tags?: string[];
  deletedAt?: number; // epoch ms: en la papelera hasta TRASH_DAYS días
}

export interface Backup {
  ts: number; // epoch ms
  pageIndex: number;
  pages: Doc[];
  designId?: string; // opcionales: las copias antiguas no los traen
  designName?: string;
}

const DESIGNS_KEY = 'designs';
const BACKUPS_KEY = 'autosave.history';
const FOLDERS_KEY = 'designFolders';
export const MAX_DESIGNS = 40; // solo cuentan los diseños fuera de la papelera
const MAX_BACKUPS = 5;
const BACKUP_MIN_GAP_MS = 2 * 60 * 1000; // una copia cada 2 min como máximo

// Lee la lista y, de paso, vacía lo que lleva más de 30 días en la papelera.
// Las imágenes que solo usaban esos diseños las limpia gcAssets (io/assets.ts).
export async function loadDesigns(): Promise<SavedDesign[]> {
  const list = (await idbGet<SavedDesign[]>(DESIGNS_KEY)) ?? [];
  const kept = purgeExpired(list);
  if (kept.length !== list.length) {
    await idbSet(DESIGNS_KEY, kept);
    const gone = new Set(kept.map((d) => d.id));
    await dropSnapshotsOf(list.filter((d) => !gone.has(d.id)).map((d) => d.id));
  }
  return kept;
}

// Inserta/actualiza el diseño (identificado por su designId estable).
// Conserva carpeta y etiquetas del guardado anterior; editar un diseño lo
// saca de la papelera.
export async function upsertDesign(d: SavedDesign): Promise<void> {
  const list = await loadDesigns();
  const prev = list.find((x) => x.id === d.id);
  const merged: SavedDesign = { ...d };
  if (prev?.folder && merged.folder === undefined) merged.folder = prev.folder;
  if (prev?.tags && merged.tags === undefined) merged.tags = prev.tags;
  delete merged.deletedAt;
  const rest = list.filter((x) => x.id !== d.id);
  const live = [merged, ...rest.filter((x) => !isTrashed(x))].slice(0, MAX_DESIGNS);
  await idbSet(DESIGNS_KEY, [...live, ...rest.filter(isTrashed)]);
}

// Borrado definitivo de un diseño (desde la papelera).
export async function removeDesign(id: string): Promise<SavedDesign[]> {
  const list = (await loadDesigns()).filter((x) => x.id !== id);
  await idbSet(DESIGNS_KEY, list);
  await dropSnapshotsOf([id]);
  return list;
}

async function patchDesign(id: string, fn: (d: SavedDesign) => SavedDesign): Promise<SavedDesign[]> {
  const list = (await loadDesigns()).map((d) => (d.id === id ? fn(d) : d));
  await idbSet(DESIGNS_KEY, list);
  return list;
}

// «Quitar de recientes»: a la papelera (recuperable 30 días).
export const trashDesign = (id: string) => patchDesign(id, (d) => ({ ...d, deletedAt: Date.now() }));

export const restoreDesign = (id: string) =>
  patchDesign(id, (d) => {
    const { deletedAt: _x, ...rest } = d;
    void _x;
    return rest;
  });

// «Vaciar papelera»: borra de verdad todo lo que está en ella.
export async function emptyTrash(): Promise<SavedDesign[]> {
  const all = await loadDesigns();
  const list = all.filter((d) => !isTrashed(d));
  await idbSet(DESIGNS_KEY, list);
  await dropSnapshotsOf(all.filter(isTrashed).map((d) => d.id));
  return list;
}

export const moveDesignToFolder = (id: string, folder: string | undefined) =>
  patchDesign(id, (d) => {
    const { folder: _f, ...rest } = d;
    void _f;
    return folder ? { ...rest, folder } : rest;
  });

export const setDesignTags = (id: string, tags: string) => patchDesign(id, (d) => setTagsOf(d, tags));

// ---- carpetas (una lista aparte, para que existan aunque estén vacías) ----

export async function loadFolders(): Promise<string[]> {
  return (await idbGet<string[]>(FOLDERS_KEY)) ?? [];
}

export async function addFolder(name: string): Promise<string[]> {
  const clean = cleanFolderName(name);
  const list = await loadFolders();
  if (!clean || list.some((f) => f.toLowerCase() === clean.toLowerCase())) return list;
  const next = [...list, clean];
  await idbSet(FOLDERS_KEY, next);
  return next;
}

// Renombra la carpeta y reasigna sus diseños.
export async function renameFolder(from: string, to: string): Promise<{ folders: string[]; designs: SavedDesign[] }> {
  const clean = cleanFolderName(to);
  const folders = await loadFolders();
  if (!clean || clean === from) return { folders, designs: await loadDesigns() };
  const next = [...new Set(folders.map((f) => (f === from ? clean : f)))];
  await idbSet(FOLDERS_KEY, next);
  const designs = (await loadDesigns()).map((d) => (d.folder === from ? { ...d, folder: clean } : d));
  await idbSet(DESIGNS_KEY, designs);
  return { folders: next, designs };
}

// Borra la carpeta; sus diseños pasan a «sin carpeta» (no se pierde ninguno).
export async function deleteFolder(name: string): Promise<{ folders: string[]; designs: SavedDesign[] }> {
  const folders = (await loadFolders()).filter((f) => f !== name);
  await idbSet(FOLDERS_KEY, folders);
  const designs = (await loadDesigns()).map((d) => {
    if (d.folder !== name) return d;
    const { folder: _f, ...rest } = d;
    void _f;
    return rest;
  });
  await idbSet(DESIGNS_KEY, designs);
  return { folders, designs };
}

export async function loadBackups(): Promise<Backup[]> {
  return (await idbGet<Backup[]>(BACKUPS_KEY)) ?? [];
}

// Guarda una copia de seguridad como máximo cada 2 minutos (últimas 5).
export async function pushBackup(
  pages: Doc[],
  pageIndex: number,
  meta?: { designId?: string; designName?: string | null },
): Promise<void> {
  const list = await loadBackups();
  const now = Date.now();
  if (list[0] && now - list[0].ts < BACKUP_MIN_GAP_MS) return;
  const b: Backup = { ts: now, pageIndex, pages };
  if (meta?.designId) b.designId = meta.designId;
  if (meta?.designName) b.designName = meta.designName;
  await idbSet(BACKUPS_KEY, [b, ...list].slice(0, MAX_BACKUPS));
}
