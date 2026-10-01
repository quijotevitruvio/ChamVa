// Miniaturas en caché de la galería de subidas.
// Las subidas viven en memoria como dataURL a tamaño completo; pintar decenas
// de ellas en la galería obliga a decodificar MB de imagen. Aquí se guarda una
// miniatura (≤ 256 px, WebP/JPEG) por subida en IndexedDB (almacén `kv`, clave
// `thumb:<id>`; no hace falta subir la versión de la base de datos) y la
// galería la usa en lugar de la imagen completa.
import { idbDelete, idbGet, idbKeys, idbSet } from './idb';

export const THUMB_MAX = 256;
const PREFIX = 'thumb:';

export const thumbKey = (id: string) => PREFIX + id;

// Tamaño de la miniatura conservando la proporción (nunca agranda).
export function thumbSize(w: number, h: number, max = THUMB_MAX): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 1, height: 1 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

// Si la imagen ya es pequeña, se usa tal cual (no se guarda miniatura).
export const needsThumb = (w: number, h: number, max = THUMB_MAX) => Math.max(w, h) > max;

// ¿Qué claves de miniatura ya no corresponden a ninguna subida?
export function orphanThumbKeys(keys: string[], liveIds: Iterable<string>): string[] {
  const live = new Set(Array.from(liveIds, thumbKey));
  return keys.filter((k) => k.startsWith(PREFIX) && !live.has(k));
}

// ---- parte con DOM / IndexedDB ----

const mem = new Map<string, string>(); // id → dataURL de la miniatura (sesión)
const MEM_MAX = 400;

function remember(id: string, url: string) {
  if (mem.size >= MEM_MAX) {
    const first = mem.keys().next().value;
    if (first !== undefined) mem.delete(first);
  }
  mem.set(id, url);
}

export const cachedThumb = (id: string): string | undefined => mem.get(id);

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

// Genera la miniatura. WebP (con alfa); si el motor no lo soporta cae a PNG/JPEG.
export async function makeThumb(src: string, w: number, h: number): Promise<string> {
  const img = await loadImg(src);
  const { width, height } = thumbSize(w || img.naturalWidth, h || img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  const webp = c.toDataURL('image/webp', 0.8);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
}

// Generación en segundo plano, de una en una (no compite con la edición).
let chain: Promise<unknown> = Promise.resolve();
const inFlight = new Map<string, Promise<string>>();

// Devuelve la miniatura de una subida: memoria → IndexedDB → se genera y se guarda.
export function getThumb(u: { id: string; src: string; naturalWidth: number; naturalHeight: number }): Promise<string> {
  const hit = mem.get(u.id);
  if (hit) return Promise.resolve(hit);
  if (!needsThumb(u.naturalWidth, u.naturalHeight)) return Promise.resolve(u.src);
  const running = inFlight.get(u.id);
  if (running) return running;
  const p = (chain = chain.then(async () => {
    const stored = await idbGet<string>(thumbKey(u.id));
    if (stored) {
      remember(u.id, stored);
      return stored;
    }
    // Deja respirar al hilo principal antes del trabajo pesado.
    await new Promise((r) => setTimeout(r, 0));
    const url = await makeThumb(u.src, u.naturalWidth, u.naturalHeight);
    remember(u.id, url);
    void idbSet(thumbKey(u.id), url);
    return url;
  })
    .catch(() => u.src)
    .finally(() => inFlight.delete(u.id))) as Promise<string>;
  inFlight.set(u.id, p);
  return p;
}

// Borra miniaturas de subidas que ya no existen (una vez por sesión).
let pruned = false;
export async function pruneThumbs(liveIds: string[]) {
  if (pruned) return;
  pruned = true;
  try {
    const keys = await idbKeys(PREFIX);
    for (const k of orphanThumbKeys(keys, liveIds)) await idbDelete(k);
  } catch {
    /* sin limpieza: no es crítico */
  }
}
