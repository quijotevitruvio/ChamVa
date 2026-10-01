import type { Doc, Layer } from './types';
import { resizeLayer } from './constraints';

// Página maestra: una página marcada (isMaster) cuyas capas (logo, pie, número de
// página…) se muestran DETRÁS de las de las páginas que la usan (masterId), en solo
// lectura. `docWithMaster` devuelve el documento "efectivo" con las capas de la
// maestra antepuestas; lo usan la exportación (PNG/SVG/PDF…), las miniaturas, la
// presentación y el lienzo (como imagen de fondo no editable).

export function masterOf(doc: Doc, pages: Doc[]): Doc | null {
  if (!doc.masterId || doc.isMaster) return null;
  const m = pages.find((p) => p.id === doc.masterId && p.id !== doc.id);
  return m ?? null;
}

// Capas visibles de la maestra, adaptadas al tamaño de la página (si difiere).
export function masterLayers(doc: Doc, master: Doc): Layer[] {
  const same = master.width === doc.width && master.height === doc.height;
  const from = { width: master.width, height: master.height };
  const to = { width: doc.width, height: doc.height };
  return master.layers
    .filter((l) => l.visible)
    .map((l) => {
      const adapted = same ? l : resizeLayer(l, from, to);
      return { ...adapted, id: `master:${l.id}`, locked: true, folderId: undefined, groupId: undefined } as Layer;
    });
}

export function docWithMaster(doc: Doc, pages: Doc[]): Doc {
  const master = masterOf(doc, pages);
  if (!master) return doc;
  const behind = masterLayers(doc, master);
  if (!behind.length) return doc;
  const eff: Doc = { ...doc, layers: [...behind, ...doc.layers] };
  delete eff.masterId; // idempotente: aplicarlo dos veces no duplica las capas
  return eff;
}

// Capas SOLO de la maestra (para dibujarlas aparte en el editor). Null si no aplica.
export function masterOnlyDoc(doc: Doc, pages: Doc[]): Doc | null {
  const master = masterOf(doc, pages);
  if (!master) return null;
  const behind = masterLayers(doc, master);
  if (!behind.length) return null;
  return { ...doc, background: { type: 'transparent' }, layers: behind, masterId: undefined };
}

// Páginas que pueden elegirse como maestra desde `index`.
export function masterCandidates(pages: Doc[], index: number): { index: number; doc: Doc }[] {
  return pages.map((doc, i) => ({ index: i, doc })).filter((x) => x.doc.isMaster && x.index !== index);
}

// Proveedor global de las páginas actuales (lo registra el store) para que
// renderDocToCanvas / exportDocToSvg resuelvan la maestra sin importar el store.
let pagesProvider: (() => Doc[]) | null = null;
export function registerMasterPages(fn: () => Doc[]) {
  pagesProvider = fn;
}
export function withRegisteredMaster(doc: Doc): Doc {
  if (!doc.masterId || !pagesProvider) return doc;
  return docWithMaster(doc, pagesProvider());
}

// Cambios de maestra sobre un Doc (devuelven copias).
export function setIsMaster(doc: Doc, value: boolean): Doc {
  const next = { ...doc };
  if (value) {
    next.isMaster = true;
    delete next.masterId; // una maestra no usa otra maestra
  } else delete next.isMaster;
  return next;
}
export function setMasterId(doc: Doc, masterId: string | undefined): Doc {
  const next = { ...doc };
  if (masterId && masterId !== doc.id) next.masterId = masterId;
  else delete next.masterId;
  return next;
}
// Quita la referencia a una maestra que ya no lo es / se ha borrado.
export function clearMasterRefs(pages: Doc[], masterId: string): Doc[] {
  return pages.map((p) => (p.masterId === masterId ? setMasterId(p, undefined) : p));
}

// Número que cambia cuando cambian las capas de la maestra (identidad de la lista, barato).
const revisions = new WeakMap<object, number>();
let revCounter = 0;
export function masterRevision(master: Doc): number {
  let r = revisions.get(master.layers);
  if (r === undefined) {
    r = ++revCounter;
    revisions.set(master.layers, r);
  }
  return r * 1000 + master.width + master.height;
}
