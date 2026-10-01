// Almacén de imágenes por contenido (content-addressed).
//
// Problema: las capas guardan la imagen como dataURL (base64) dentro del
// documento. Al autoguardar/galería/copias se serializaban MB enteros por cada
// pausa de edición. Solución: cada imagen se guarda UNA vez en IndexedDB bajo
// su hash (`asset:<sha>`), y los documentos persistidos solo llevan la
// referencia. En memoria las capas siguen usando dataURL (nada más cambia).
//
//   dehydrate*  → dataURL  ⇒ "asset:<hash>"   (antes de escribir en IDB)
//   rehydrate*  → "asset:<hash>" ⇒ dataURL    (después de leer de IDB)
import type { Doc, SavedTemplate, UploadedImage } from '../editor/core/types';
import { idbDelete, idbGet, idbKeys, idbSet } from './idb';

const PREFIX = 'asset:';
// Píxel transparente: sustituto si una imagen referenciada ya no existe.
const MISSING =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const isAssetRef = (s: string | undefined): s is string =>
  !!s && s.startsWith(PREFIX);

// Hash → ya está en IDB (evita releer). dataURL → hash (evita rehashear).
const known = new Set<string>();
const hashCache = new Map<string, string>();
const HASH_CACHE_MAX = 300;

async function hashOf(dataUrl: string): Promise<string> {
  const cached = hashCache.get(dataUrl);
  if (cached) return cached;
  const bytes = new TextEncoder().encode(dataUrl);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (hashCache.size >= HASH_CACHE_MAX) {
    const first = hashCache.keys().next().value;
    if (first !== undefined) hashCache.delete(first);
  }
  hashCache.set(dataUrl, hex);
  return hex;
}

// Guarda (si hace falta) y devuelve la referencia. Las URLs que no son data:
// (http, blob) se dejan tal cual.
export async function putAsset(src: string): Promise<string> {
  if (!src.startsWith('data:')) return src;
  const h = await hashOf(src);
  const ref = PREFIX + h;
  if (!known.has(h)) {
    if ((await idbGet<string>(ref)) == null) await idbSet(ref, src);
    known.add(h);
  }
  return ref;
}

const getCache = new Map<string, string>(); // ref → dataURL (sesión)

export async function getAsset(ref: string): Promise<string> {
  if (!isAssetRef(ref)) return ref;
  const c = getCache.get(ref);
  if (c) return c;
  const v = await idbGet<string>(ref);
  if (v == null) {
    console.warn('Imagen no encontrada en el almacén:', ref);
    return MISSING;
  }
  if (getCache.size > 100) getCache.clear();
  getCache.set(ref, v);
  return v;
}

// ---- Documentos ----

export async function dehydrateDocs(pages: Doc[]): Promise<Doc[]> {
  const out: Doc[] = [];
  for (const p of pages) {
    const layers = [];
    for (const l of p.layers) {
      if (l.type === 'image') {
        layers.push({
          ...l,
          src: await putAsset(l.src),
          originalSrc: l.originalSrc ? await putAsset(l.originalSrc) : undefined,
        });
      } else layers.push(l);
    }
    out.push({ ...p, layers });
  }
  return out;
}

export async function rehydrateDocs(pages: Doc[]): Promise<Doc[]> {
  const out: Doc[] = [];
  for (const p of pages) {
    const layers = [];
    for (const l of p.layers) {
      if (l.type === 'image') {
        layers.push({
          ...l,
          src: await getAsset(l.src),
          originalSrc: l.originalSrc ? await getAsset(l.originalSrc) : undefined,
        });
      } else layers.push(l);
    }
    out.push({ ...p, layers });
  }
  return out;
}

// ---- Galería de subidos y plantillas ----

export async function dehydrateUploads(list: UploadedImage[]): Promise<UploadedImage[]> {
  const out: UploadedImage[] = [];
  for (const u of list) out.push({ ...u, src: await putAsset(u.src) });
  return out;
}

export async function rehydrateUploads(list: UploadedImage[]): Promise<UploadedImage[]> {
  const out: UploadedImage[] = [];
  for (const u of list) out.push({ ...u, src: await getAsset(u.src) });
  return out;
}

export async function dehydrateTemplates(list: SavedTemplate[]): Promise<SavedTemplate[]> {
  const out: SavedTemplate[] = [];
  for (const t of list) out.push({ ...t, doc: (await dehydrateDocs([t.doc]))[0] });
  return out;
}

export async function rehydrateTemplates(list: SavedTemplate[]): Promise<SavedTemplate[]> {
  const out: SavedTemplate[] = [];
  for (const t of list) out.push({ ...t, doc: (await rehydrateDocs([t.doc]))[0] });
  return out;
}

// ---- Recolección de basura ----
// Borra las imágenes que ya no referencia nada (autosave, copias, galería de
// diseños, subidos, plantillas). Se llama de vez en cuando, nunca en caliente.

export function collectRefs(value: unknown, into: Set<string>) {
  if (typeof value === 'string') {
    if (isAssetRef(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, into);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectRefs(v, into);
  }
}

// Claves de IndexedDB que referencian imágenes. 'brandKitLogos' (logos de todos
// los kits de marca) sustituye a 'brandLogos' (kit único anterior, que se
// sigue leyendo por si aún no se migró).
export const GC_KEYS = ['autosave', 'autosave.history', 'designs', 'snapshots', 'uploads', 'templates', 'brandLogos', 'brandKitLogos', 'autoVersions'];

export async function gcAssets(): Promise<number> {
  const live = new Set<string>();
  for (const key of GC_KEYS) {
    collectRefs(await idbGet(key), live);
  }
  // Historial de deshacer persistido (io/undoStore.ts): una clave `undo:<diseño>` por diseño.
  for (const key of await idbKeys('undo:')) collectRefs(await idbGet(key), live);
  const keys = await idbKeys(PREFIX);
  let removed = 0;
  for (const k of keys) {
    if (!live.has(k)) {
      await idbDelete(k);
      known.delete(k.slice(PREFIX.length));
      getCache.delete(k);
      removed++;
    }
  }
  return removed;
}
