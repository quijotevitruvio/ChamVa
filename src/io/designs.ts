// Galería de diseños recientes + copias de seguridad del autoguardado.
// Todo vive en IndexedDB (idb.ts); las miniaturas son dataURL JPEG pequeños.
import type { Doc } from '../editor/core/types';
import { idbGet, idbSet } from './idb';

export interface SavedDesign {
  id: string; // id del doc de la primera página
  name: string;
  updatedAt: number; // epoch ms
  pageIndex: number;
  pages: Doc[];
  thumb: string; // dataURL de la primera página
}

export interface Backup {
  ts: number; // epoch ms
  pageIndex: number;
  pages: Doc[];
}

const DESIGNS_KEY = 'designs';
const BACKUPS_KEY = 'autosave.history';
const MAX_DESIGNS = 12;
const MAX_BACKUPS = 5;
const BACKUP_MIN_GAP_MS = 2 * 60 * 1000; // una copia cada 2 min como máximo

export async function loadDesigns(): Promise<SavedDesign[]> {
  return (await idbGet<SavedDesign[]>(DESIGNS_KEY)) ?? [];
}

// Inserta/actualiza el diseño (identificado por el id de su primera página).
export async function upsertDesign(d: SavedDesign): Promise<void> {
  const list = await loadDesigns();
  const rest = list.filter((x) => x.id !== d.id);
  await idbSet(DESIGNS_KEY, [d, ...rest].slice(0, MAX_DESIGNS));
}

export async function removeDesign(id: string): Promise<SavedDesign[]> {
  const list = (await loadDesigns()).filter((x) => x.id !== id);
  await idbSet(DESIGNS_KEY, list);
  return list;
}

export async function loadBackups(): Promise<Backup[]> {
  return (await idbGet<Backup[]>(BACKUPS_KEY)) ?? [];
}

// Guarda una copia de seguridad como máximo cada 2 minutos (últimas 5).
export async function pushBackup(pages: Doc[], pageIndex: number): Promise<void> {
  const list = await loadBackups();
  const now = Date.now();
  if (list[0] && now - list[0].ts < BACKUP_MIN_GAP_MS) return;
  await idbSet(BACKUPS_KEY, [{ ts: now, pageIndex, pages }, ...list].slice(0, MAX_BACKUPS));
}
