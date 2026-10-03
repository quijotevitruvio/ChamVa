// Lógica pura del riel «Proyectos»: decidir si abrir otro diseño pide confirmación
// y qué texto de resumen lleva cada tarjeta. Sin DOM ni IndexedDB.
import type { SaveState } from '../../io/saveStatus';

/**
 * Abrir otro diseño reemplaza el del lienzo. Si el guardado del actual falló
 * (almacenamiento lleno o bloqueado) se pide confirmación: lo no guardado se perdería.
 */
export function needsOpenConfirm(state: SaveState): boolean {
  return state === 'error';
}

/** ¿Es el diseño que ya está abierto en el editor? */
export const isCurrentDesign = (id: string, currentId: string): boolean => id === currentId;

/** «3 págs.» / «1 pág.» */
export function pagesLabel(n: number): string {
  return n === 1 ? '1 pág.' : `${n} págs.`;
}

/** Fecha corta para la tarjeta: hora si es de hoy, día y mes si no. */
export function shortDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Resumen de una línea: «3 págs. · 12 may». */
export function projectSummary(d: { pages: unknown[]; updatedAt: number }, now = Date.now()): string {
  return `${pagesLabel(d.pages.length)} · ${shortDate(d.updatedAt, now)}`;
}
