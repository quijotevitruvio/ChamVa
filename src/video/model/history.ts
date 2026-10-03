// Deshacer / rehacer del editor de video: instantáneas inmutables del proyecto
// (comparten estructura y los Blob, así que cuestan poco). En memoria, como el
// historial del diseño: no se guarda entre sesiones.
import type { VideoProject } from './types';

export const HISTORY_LIMIT = 100;
/** Cambios con la misma `group` separados por menos de esto se funden en un paso (arrastres, deslizadores). */
export const GROUP_WINDOW_MS = 1000;

export interface VideoHistory {
  past: VideoProject[];
  present: VideoProject;
  future: VideoProject[];
  limit: number;
  /** grupo abierto (el último cambio se puede fundir con el siguiente del mismo grupo) */
  group: string | null;
  groupAt: number;
}

export function createHistory(present: VideoProject, limit = HISTORY_LIMIT): VideoHistory {
  return { past: [], present, future: [], limit: Math.max(1, limit), group: null, groupAt: 0 };
}

/**
 * Registra `next` como paso nuevo. Con `group`, si el paso anterior era del mismo
 * grupo y reciente, se sustituye en vez de apilar (un arrastre = un solo paso).
 * Si `next` es el mismo objeto que el presente (operación sin efecto) no cambia nada.
 */
export function commit(h: VideoHistory, next: VideoProject, o: { group?: string; now?: number } = {}): VideoHistory {
  if (next === h.present) return h;
  const now = o.now ?? Date.now();
  if (o.group && h.group === o.group && now - h.groupAt < GROUP_WINDOW_MS && h.past.length) {
    return { ...h, present: next, future: [], groupAt: now };
  }
  const past = [...h.past, h.present];
  if (past.length > h.limit) past.splice(0, past.length - h.limit);
  return { ...h, past, present: next, future: [], group: o.group ?? null, groupAt: now };
}

/** Cierra el grupo abierto (al soltar el ratón): el siguiente cambio será otro paso. */
export function endGroup(h: VideoHistory): VideoHistory {
  return h.group === null ? h : { ...h, group: null };
}

export const canUndo = (h: VideoHistory) => h.past.length > 0;
export const canRedo = (h: VideoHistory) => h.future.length > 0;

export function undo(h: VideoHistory): VideoHistory {
  if (!h.past.length) return h;
  const past = h.past.slice(0, -1);
  return { ...h, past, present: h.past[h.past.length - 1], future: [h.present, ...h.future], group: null };
}

export function redo(h: VideoHistory): VideoHistory {
  if (!h.future.length) return h;
  const [present, ...future] = h.future;
  return { ...h, past: [...h.past, h.present], present, future, group: null };
}

/** Cambia el presente sin crear paso (datos derivados que llegan tarde: duración, miniatura). */
export function replacePresent(h: VideoHistory, next: VideoProject): VideoHistory {
  return next === h.present ? h : { ...h, present: next };
}

/** Aplica `fn` a TODAS las instantáneas (p. ej. la miniatura de un medio, para que no desaparezca al deshacer). */
export function mapHistory(h: VideoHistory, fn: (p: VideoProject) => VideoProject): VideoHistory {
  const present = fn(h.present);
  const past = h.past.map(fn);
  const future = h.future.map(fn);
  const same = present === h.present && past.every((p, i) => p === h.past[i]) && future.every((p, i) => p === h.future[i]);
  return same ? h : { ...h, past, present, future };
}
