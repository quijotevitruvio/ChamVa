// Lógica pura de la biblioteca de diseños: carpetas, etiquetas, papelera,
// filtros y redimensionado a varios formatos. Sin DOM ni IndexedDB.
import type { Doc } from './types';
import { fold, normalizeTags } from './templateMeta';

export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LibraryDesign {
  id: string;
  name: string;
  updatedAt: number;
  folder?: string;
  tags?: string[];
  deletedAt?: number;
}

export type LibraryView = { kind: 'all' } | { kind: 'folder'; folder: string } | { kind: 'trash' };

export const isTrashed = (d: LibraryDesign) => typeof d.deletedAt === 'number';

// Días que le quedan a un diseño en la papelera (mínimo 0).
export function trashDaysLeft(d: LibraryDesign, now = Date.now()): number {
  if (!isTrashed(d)) return TRASH_DAYS;
  return Math.max(0, Math.ceil(((d.deletedAt as number) + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

// Quita de la lista los que llevan más de 30 días en la papelera.
export function purgeExpired<T extends LibraryDesign>(list: T[], now = Date.now()): T[] {
  return list.filter((d) => !isTrashed(d) || now - (d.deletedAt as number) < TRASH_DAYS * DAY_MS);
}

export function filterDesigns<T extends LibraryDesign>(
  list: T[],
  view: LibraryView,
  query = '',
  tag: string | null = null,
): T[] {
  const q = fold(query.trim());
  return list.filter((d) => {
    if (view.kind === 'trash') {
      if (!isTrashed(d)) return false;
    } else {
      if (isTrashed(d)) return false;
      if (view.kind === 'folder' && d.folder !== view.folder) return false;
    }
    if (tag && !(d.tags ?? []).some((x) => fold(x) === fold(tag))) return false;
    if (q) {
      const hay = fold([d.name, d.folder ?? '', ...(d.tags ?? [])].join(' '));
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

// Etiquetas usadas por diseños vivos (únicas, ordenadas).
export function allTags(list: LibraryDesign[]): string[] {
  const map = new Map<string, string>();
  for (const d of list) {
    if (isTrashed(d)) continue;
    for (const t of d.tags ?? []) if (!map.has(fold(t))) map.set(fold(t), t);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b));
}

// Carpetas conocidas: las guardadas + las que ya usa algún diseño.
export function mergeFolders(saved: string[], list: LibraryDesign[]): string[] {
  const out = new Set(saved);
  for (const d of list) if (d.folder && !isTrashed(d)) out.add(d.folder);
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function cleanFolderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 40);
}

export function setTagsOf<T extends LibraryDesign>(d: T, input: string | string[]): T {
  const tags = normalizeTags(input);
  return { ...d, tags: tags.length ? tags : undefined };
}

// ---------- Redimensionar a varios formatos ----------

export interface TargetSize {
  width: number;
  height: number;
  label: string;
}

// Misma lógica que addResizedPage del store: cabe en el nuevo lienzo
// manteniendo proporciones y centrado. `newId` genera el id de la página nueva.
export function resizeDocTo(cur: Doc, size: TargetSize, newId: () => string): Doc {
  const { width, height } = size;
  const factor = Math.min(width / cur.width, height / cur.height);
  const offX = (width - cur.width * factor) / 2;
  const offY = (height - cur.height * factor) / 2;
  const scaled = JSON.parse(JSON.stringify(cur)) as Doc;
  scaled.id = newId();
  scaled.width = width;
  scaled.height = height;
  scaled.name = `${cur.name} · ${size.label} ${width}×${height}`;
  scaled.layers = scaled.layers.map((l) => ({
    ...l,
    x: l.x * factor + offX,
    y: l.y * factor + offY,
    scaleX: l.scaleX * factor,
    scaleY: l.scaleY * factor,
  }));
  return scaled;
}

// Formatos distintos del actual (sin duplicar medidas repetidas).
export function uniqueTargets(sizes: TargetSize[], cur: { width: number; height: number }): TargetSize[] {
  const seen = new Set<string>([`${cur.width}x${cur.height}`]);
  const out: TargetSize[] = [];
  for (const s of sizes) {
    const k = `${s.width}x${s.height}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
