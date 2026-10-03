// Estado del autoguardado para el indicador de la barra superior.
// Almacén mínimo (sin dependencias) compatible con useSyncExternalStore.
//   idle → nada pendiente · pending → cambio sin guardar · saving → escribiendo
//   saved → guardado · error → la escritura falló (almacenamiento lleno o bloqueado)
import { useSyncExternalStore } from 'react';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface SaveStatus {
  state: SaveState;
  savedAt: number | null; // última vez que se guardó bien (ms)
}

let status: SaveStatus = { state: 'idle', savedAt: null };
const listeners = new Set<() => void>();

function set(next: SaveStatus) {
  if (next.state === status.state && next.savedAt === status.savedAt) return;
  status = next; // objeto nuevo en cada cambio: getSnapshot estable entre cambios
  listeners.forEach((fn) => fn());
}

export const getSaveStatus = (): SaveStatus => status;

export function subscribeSaveStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const markPending = () => set({ ...status, state: 'pending' });
export const markSaving = () => set({ ...status, state: 'saving' });
export const markSaved = (now = Date.now()) => set({ state: 'saved', savedAt: now });
export const markError = () => set({ ...status, state: 'error' });
export const resetSaveStatus = () => set({ state: 'idle', savedAt: null });

export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(subscribeSaveStatus, getSaveStatus, getSaveStatus);
}
