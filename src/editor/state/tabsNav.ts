import { MAX_TABS, type TabMeta } from './sessions';

// Lógica PURA de la tira de pestañas (sin store ni React).

/** ¿Se puede abrir otra pestaña? */
export function canAddTab(count: number): boolean {
  return count < MAX_TABS;
}

/** Pestaña siguiente (+1) o anterior (-1), con vuelta al otro extremo. null = no hay otra. */
export function neighborTab(tabs: TabMeta[], activeId: string, dir: 1 | -1): string | null {
  if (tabs.length < 2) return null;
  const i = tabs.findIndex((t) => t.id === activeId);
  if (i < 0) return tabs[0].id;
  return tabs[(i + dir + tabs.length) % tabs.length].id;
}

/** Índices (from, to) para mover una pestaña un puesto; null si ya está en el borde. */
export function moveTabBy(tabs: TabMeta[], id: string, dir: 1 | -1): { from: number; to: number } | null {
  const from = tabs.findIndex((t) => t.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= tabs.length) return null;
  return { from, to };
}

/** Rótulo de una pestaña: el nombre del diseño, el de su primera página o «Sin título». */
export function tabLabel(designName: string | null | undefined, firstPageName?: string | null): string {
  const a = designName?.trim();
  if (a) return a;
  const b = firstPageName?.trim();
  return b || 'Sin título';
}
