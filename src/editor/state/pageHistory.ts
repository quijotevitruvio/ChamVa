import type { Doc } from '../core/types';

// Historial de deshacer POR PÁGINA (lógica pura, sin el store).
//
// El store solo tiene `past/future` de la página abierta. Al salir de una página
// se «aparca» su historial aquí, con la página tal como quedó (`base`). Al volver
// se recupera SOLO si la página sigue siendo exactamente el mismo objeto
// (igualdad de referencia): si otra operación la cambió por fuera (buscar y
// reemplazar, recolorear, maestra, clasificador), sus pasos ya no casan con lo
// que hay y se descartan. Así nunca se deshace hacia un estado incoherente.
//
// Se conservan como mucho PAGE_HIST_MAX páginas (las usadas más recientemente).

export interface PageHistEntry {
  past: Doc[];
  future: Doc[];
  base: Doc; // la página cuando se aparcó su historial
  seq: number; // orden de uso (mayor = más reciente)
}

export type PageHist = Record<string, PageHistEntry>;

export const PAGE_HIST_MAX = 12;

/** Quita la entrada de una página (sin copiar si no estaba). */
export function dropPage(hist: PageHist, pageId: string): PageHist {
  if (!(pageId in hist)) return hist;
  const next = { ...hist };
  delete next[pageId];
  return next;
}

/**
 * Aparca el historial de la página `page`. Si no tiene pasos se quita la entrada
 * (no hay nada que conservar). Expulsa las páginas menos usadas por encima de `max`.
 */
export function stash(hist: PageHist, page: Doc, past: Doc[], future: Doc[], max = PAGE_HIST_MAX): PageHist {
  if (!past.length && !future.length) return dropPage(hist, page.id);
  let seq = 0;
  for (const e of Object.values(hist)) seq = Math.max(seq, e.seq);
  const next: PageHist = { ...hist, [page.id]: { past, future, base: page, seq: seq + 1 } };
  const ids = Object.keys(next);
  if (ids.length > max) {
    ids
      .sort((a, b) => next[a].seq - next[b].seq)
      .slice(0, ids.length - max)
      .forEach((id) => delete next[id]);
  }
  return next;
}

/** Historial guardado de `page`, o vacío si no hay o si la página cambió desde entonces. */
export function restore(hist: PageHist, page: Doc): { past: Doc[]; future: Doc[] } {
  const e = hist[page.id];
  if (!e || e.base !== page) return { past: [], future: [] };
  return { past: e.past, future: e.future };
}

/**
 * Cambio de página completo: aparca el de la que sale y recupera el de la que
 * entra (si se recupera, su entrada sale del mapa: mientras está abierta su
 * historial vive en `past/future`). Si la que entra es la misma que sale
 * (mismo objeto), no cambia nada.
 */
export function swap(
  hist: PageHist,
  leaving: { doc: Doc; past: Doc[]; future: Doc[] },
  entering: Doc,
): { pageHist: PageHist; past: Doc[]; future: Doc[] } {
  if (entering === leaving.doc) return { pageHist: hist, past: leaving.past, future: leaving.future };
  const parked = stash(hist, leaving.doc, leaving.past, leaving.future);
  const e = parked[entering.id];
  if (!e || e.base !== entering) {
    // Sin historial válido: se deja la entrada (si la hay) por si vuelve ESA versión
    // exacta de la página (p. ej. deshacer «restaurar versión», que reusa los ids).
    return { pageHist: parked, past: [], future: [] };
  }
  return { pageHist: dropPage(parked, entering.id), past: e.past, future: e.future };
}
