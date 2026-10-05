// Sesión de retoque de una capa de imagen (DOM + store). Mantiene en memoria, mientras la herramienta
// está activa, la fuente original (`base`), el resultado en curso (`work`) y un lienzo en vivo que
// muestra el lienzo del editor. Cada trazo se guarda en el documento como UN paso de deshacer
// (`layer.retouch`, PNG con solo los píxeles cambiados); Ctrl+Z / Ctrl+Y son los del documento y, si
// la capa cambia por fuera, la sesión se descarta y se reconstruye desde el documento.
import { create } from 'zustand';
import { useEditor } from './store';
import type { Doc, ImageLayer, Layer } from '../core/types';
import {
  clonePix,
  diffBounds,
  extractPatch,
  overPatch,
  unionRect,
  validRetouch,
  type DodgeRange,
  type Pix,
  type Rect,
} from '../core/retouch';
import { loadImageEl } from '../core/retouchRender';
import { registerRetouchFlusher, setLive } from '../core/retouchLive';
import { currentSel } from './pixelOps';
import { sourceMapper, type Limit } from '../core/retouch';

// ---------------------------------------------------------------------------
// Opciones (solo interfaz; se recuerdan en este equipo)
// ---------------------------------------------------------------------------

export interface RetouchOpts {
  size: number; // diámetro en px del documento
  hardness: number;
  opacity: number; // opacidad (clonar/curar) o fuerza (resto)
  aligned: boolean; // clonar: origen alineado (si no, fijo)
  sampleAll: boolean; // clonar/curar: muestrear todas las capas (si no, la capa actual)
  healMode: 'brush' | 'patch'; // curar: pincel corrector o parche con selección
  range: DodgeRange;
  exposure: number; // esquivar/quemar 0..1
}

const LS = 'chamva.retouch';
function load(): Partial<RetouchOpts> {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}');
  } catch {
    return {};
  }
}

export const useRetouchOpts = create<{ o: RetouchOpts; set: (p: Partial<RetouchOpts>) => void }>((set, get) => ({
  o: { size: 60, hardness: 0.7, opacity: 1, aligned: true, sampleAll: false, healMode: 'brush', range: 'midtones', exposure: 0.5, ...load() },
  set: (p) => {
    set((s) => ({ o: { ...s.o, ...p } }));
    try {
      localStorage.setItem(LS, JSON.stringify(get().o));
    } catch {
      /* sin almacenamiento */
    }
  },
}));

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

export interface RetouchSession {
  layerId: string;
  baseSrc: string;
  w: number;
  h: number;
  base: Pix;
  work: Pix;
  canvas: HTMLCanvasElement;
  imageData: ImageData;
  /** Caja de todo lo retocado (incluye lo que ya traía la capa). */
  bbox: Rect | null;
  committedSrc: string | undefined;
  rev: number;
  committedRev: number;
  committing: Promise<void> | null;
  again: boolean;
}

const sessions = new Map<string, RetouchSession>();
const building = new Map<string, Promise<RetouchSession | null>>();

const layerNow = (id: string): ImageLayer | null => {
  const l = useEditor.getState().doc.layers.find((x) => x.id === id);
  return l && l.type === 'image' ? l : null;
};

export const getSession = (id: string): RetouchSession | undefined => sessions.get(id);

function publish(s: RetouchSession, pending: boolean) {
  setLive(s.layerId, { canvas: s.canvas, baseSrc: s.baseSrc, committedSrc: s.committedSrc, pending });
}

function valid(s: RetouchSession, l: ImageLayer): boolean {
  return s.baseSrc === l.src && (s.committing !== null || s.rev !== s.committedRev || s.committedSrc === validRetouch(l.retouch)?.src);
}

/** Sesión vigente de la capa (la crea o reconstruye si hace falta). */
export async function ensureSession(layerId: string): Promise<RetouchSession | null> {
  const l = layerNow(layerId);
  if (!l || !l.src) return null;
  const cur = sessions.get(layerId);
  if (cur && valid(cur, l)) return cur;
  const pend = building.get(layerId);
  if (pend) return pend;
  const p = (async () => {
    try {
      const img = await loadImageEl(l.src);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return null;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const baseData = ctx.getImageData(0, 0, w, h);
      const base: Pix = { data: baseData.data, w, h };
      let work = clonePix(base);
      let bbox: Rect | null = null;
      const ref = validRetouch(l.retouch);
      if (ref) {
        try {
          const pimg = await loadImageEl(ref.src);
          const pc = document.createElement('canvas');
          pc.width = pimg.naturalWidth;
          pc.height = pimg.naturalHeight;
          const pctx = pc.getContext('2d', { willReadFrequently: true })!;
          pctx.drawImage(pimg, 0, 0);
          const kx = w / ref.bw;
          const ky = h / ref.bh;
          const rc: Rect = { x: Math.round(ref.x * kx), y: Math.round(ref.y * ky), w: Math.max(1, Math.round(ref.w * kx)), h: Math.max(1, Math.round(ref.h * ky)) };
          let pix: Pix = { data: pctx.getImageData(0, 0, pc.width, pc.height).data, w: pc.width, h: pc.height };
          if (pc.width !== rc.w || pc.height !== rc.h) {
            const sc = document.createElement('canvas');
            sc.width = rc.w;
            sc.height = rc.h;
            const sctx = sc.getContext('2d', { willReadFrequently: true })!;
            sctx.drawImage(pc, 0, 0, rc.w, rc.h);
            pix = { data: sctx.getImageData(0, 0, rc.w, rc.h).data, w: rc.w, h: rc.h };
          }
          work = overPatch(base, pix.data, rc);
          bbox = rc;
        } catch (e) {
          console.warn('Retoque ilegible; se empieza desde la fuente', e);
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const imageData = new ImageData(work.data, w, h);
      canvas.getContext('2d')!.putImageData(imageData, 0, 0);
      const s: RetouchSession = {
        layerId,
        baseSrc: l.src,
        w,
        h,
        base,
        work,
        canvas,
        imageData,
        bbox,
        committedSrc: ref?.src,
        rev: 0,
        committedRev: 0,
        committing: null,
        again: false,
      };
      sessions.set(layerId, s);
      publish(s, false);
      return s;
    } catch {
      return null;
    } finally {
      building.delete(layerId);
    }
  })();
  building.set(layerId, p);
  return p;
}

/** Vuelca al lienzo en vivo la región tocada del búfer de trabajo. */
export function flushRegion(s: RetouchSession, rc: Rect) {
  const x = Math.max(0, rc.x);
  const y = Math.max(0, rc.y);
  const w = Math.min(s.w, rc.x + rc.w) - x;
  const h = Math.min(s.h, rc.y + rc.h) - y;
  if (w <= 0 || h <= 0) return;
  s.canvas.getContext('2d')!.putImageData(s.imageData, 0, 0, x, y, w, h);
}

/** Anota un trazo terminado (región tocada) y lo guarda en el documento. */
export function strokeDone(s: RetouchSession, dirty: Rect | null) {
  if (!dirty) return;
  s.bbox = unionRect(s.bbox, dirty);
  s.rev++;
  publish(s, true);
  void commitSession(s.layerId);
}

function toBlobUrl(c: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => {
      if (!b) return reject(new Error('No se pudo codificar el retoque'));
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(b);
    }, 'image/png');
  });
}

async function doCommit(s: RetouchSession) {
  const l = layerNow(s.layerId);
  if (!l || l.src !== s.baseSrc) return;
  const rev = s.rev;
  const rc = s.bbox ? diffBounds(s.base, s.work, s.bbox) : null;
  if (!rc) {
    if (l.retouch) {
      s.committedSrc = undefined;
      useEditor.getState().updateLayer(s.layerId, { retouch: undefined } as Partial<Layer>);
    }
    s.committedRev = rev;
    return;
  }
  const patch = extractPatch(s.base, s.work, rc);
  const pc = document.createElement('canvas');
  pc.width = rc.w;
  pc.height = rc.h;
  pc.getContext('2d')!.putImageData(new ImageData(patch, rc.w, rc.h), 0, 0);
  const src = await toBlobUrl(pc);
  s.bbox = rc;
  s.committedSrc = src;
  s.committedRev = rev;
  useEditor.getState().updateLayer(s.layerId, { retouch: { src, x: rc.x, y: rc.y, w: rc.w, h: rc.h, bw: s.w, bh: s.h } } as Partial<Layer>);
}

export function commitSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return Promise.resolve();
  if (s.committing) {
    s.again = true;
    return s.committing;
  }
  if (s.rev === s.committedRev) return Promise.resolve(); // nada pendiente
  s.committing = (async () => {
    await null; // asegura que `committing` ya está asignado antes de que corra el `finally`
    try {
      do {
        s.again = false;
        if (s.rev !== s.committedRev) await doCommit(s);
      } while (s.again || s.rev !== s.committedRev);
    } catch (e) {
      console.warn('No se pudo guardar el retoque', e);
    } finally {
      s.committing = null;
      publish(s, false);
    }
  })();
  return s.committing;
}

/** Espera a que todos los trazos pendientes estén en el documento (exportar, guardar). */
export async function flushAll(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => commitSession(id)));
}
registerRetouchFlusher(flushAll);

/** Cierra la sesión (al salir de la herramienta o cambiar de capa): guarda lo pendiente y libera memoria. */
export async function closeSession(id: string) {
  await commitSession(id);
  const s = sessions.get(id);
  if (s && !s.committing) {
    sessions.delete(id);
    setLive(id, null);
  }
}

export async function closeAllSessions() {
  await Promise.all([...sessions.keys()].map((id) => closeSession(id)));
}

/** Quita todo el retoque de la capa (un paso de deshacer). */
export async function clearRetouch(id: string) {
  await closeSession(id);
  useEditor.getState().updateLayer(id, { retouch: undefined } as Partial<Layer>);
}

// ---------------------------------------------------------------------------
// Selección de píxeles como límite del efecto
// ---------------------------------------------------------------------------

/** Límite 0..1 por píxel de la fuente a partir de la selección de píxeles vigente (null = sin selección). */
export function selectionLimit(l: ImageLayer, w: number, h: number): Limit {
  const sel = currentSel();
  if (!sel) return null;
  const m = sourceMapper(l, w, h);
  if (!m) return null;
  const { data, w: sw, h: sh, scale } = sel;
  return (x, y) => {
    const [dx, dy] = m.fromSrc(x + 0.5, y + 0.5);
    const ix = Math.floor(dx * scale);
    const iy = Math.floor(dy * scale);
    if (ix < 0 || iy < 0 || ix >= sw || iy >= sh) return 0;
    return data[iy * sw + ix] / 255;
  };
}

/** Capa de imagen visible y sin bloquear más alta bajo el punto del documento (o null). */
export function imageLayerAt(doc: Doc, dx: number, dy: number, prefer?: string | null): ImageLayer | null {
  const hit = (l: ImageLayer): boolean => localHit(l, dx, dy);
  const pref = prefer ? doc.layers.find((l) => l.id === prefer && l.type === 'image') : null;
  if (pref && pref.type === 'image' && hit(pref)) return pref;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.type === 'image' && l.visible && !l.locked && hit(l)) return l;
  }
  return null;
}

function localHit(l: ImageLayer, dx: number, dy: number): boolean {
  const r = (l.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const vx = dx - l.x;
  const vy = dy - l.y;
  const lx = (cos * vx + sin * vy) / (l.scaleX || 1);
  const ly = (-sin * vx + cos * vy) / (l.scaleY || 1);
  return lx >= 0 && ly >= 0 && lx <= l.naturalWidth && ly <= l.naturalHeight;
}

