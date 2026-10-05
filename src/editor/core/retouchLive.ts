// Estado en vivo de las sesiones de retoque (solo interfaz, no entra en el documento).
// Mientras se pinta, el lienzo muestra el búfer de la sesión; al soltar se guarda en la capa y el
// documento pasa a ser la fuente de verdad. «Antes/después»: mantener pulsado enseña la fuente sin retoque.
import { useSyncExternalStore } from 'react';

export interface LiveEntry {
  canvas: HTMLCanvasElement;
  baseSrc: string;
  /** Último `retouch.src` guardado en el documento por esta sesión. */
  committedSrc: string | undefined;
  /** Hay trazos aún sin guardar en el documento. */
  pending: boolean;
}

const live = new Map<string, LiveEntry>();
const revs = new Map<string, number>();
let before = false;
let beforeRev = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const subscribeLive = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export function setLive(id: string, e: LiveEntry | null) {
  if (e) live.set(id, e);
  else live.delete(id);
  revs.set(id, (revs.get(id) ?? 0) + 1);
  emit();
}
export const getLive = (id: string): LiveEntry | undefined => live.get(id);

/** Avisa al lienzo de que el búfer cambió (repintar / recalcular ajustes). */
export function bumpLive(id: string) {
  revs.set(id, (revs.get(id) ?? 0) + 1);
  emit();
}

export function setShowBefore(v: boolean) {
  if (before === v) return;
  before = v;
  beforeRev++;
  emit();
}
export const showingBefore = () => before;

/** Revisión (para dependencias de hooks) de la sesión en vivo de una capa. */
export function useLiveRev(id: string): number {
  return useSyncExternalStore(subscribeLive, () => (revs.get(id) ?? 0) * 2 + beforeRev * 1000003);
}

// Guardado pendiente de la sesión de retoque (lo registra retouchSession para que la exportación y el
// guardado esperen a que el último trazo esté en el documento sin importar el módulo del editor).
let flusher: (() => Promise<void>) | null = null;
export const registerRetouchFlusher = (f: (() => Promise<void>) | null) => {
  flusher = f;
};
export const flushRetouch = (): Promise<void> => (flusher ? flusher() : Promise.resolve());
