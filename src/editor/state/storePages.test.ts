import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Layer } from '../core/types';
import { loadDesigns, upsertDesign } from '../../io/designs';
import { listSnapshots, saveSnapshot } from '../../io/snapshots';
import { listAutoVersions, maybeSaveAutoVersion } from '../../io/autoVersions';
import { buildRecord, designIdOf, restoreUndoFor, type UndoStoreApi } from '../../io/undoStore';
import { collectRefs, dehydrateDocs, gcAssets, GC_KEYS, isAssetRef } from '../../io/assets';
import { designTitle, readDesignMeta } from './designIdentity';

// Pruebas del store REAL (no de una copia de la lógica). El módulo del store toca el
// DOM al importarse (canvas de medida, localStorage, IndexedDB), así que se le dan
// sustitutos mínimos antes de importarlo. Nada de esto llega a dibujar.
const db = new Map<string, unknown>();
vi.mock('../../io/idb', () => ({
  idbGet: async (k: string) => db.get(k) ?? null,
  idbSet: async (k: string, v: unknown) => (db.set(k, v), true),
  idbDelete: async (k: string) => void db.delete(k),
  idbKeys: async (prefix = '') => [...db.keys()].filter((k) => k.startsWith(prefix)),
  setStorageErrorHandler: () => {},
}));

type Store = typeof import('./store').useEditor;
let useEditor: Store;

beforeAll(async () => {
  const ctx = new Proxy({}, { get: () => () => ({ width: 10 }) });
  const g = globalThis as Record<string, unknown>;
  g.document ??= {
    createElement: () => ({ getContext: () => ctx }),
    fonts: { load: async () => [] },
  };
  const ls = new Map<string, string>();
  g.localStorage ??= {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k),
  };
  useEditor = (await import('./store')).useEditor;
});

const shape = (id: string, x = 0): Layer =>
  ({ id, type: 'shape', kind: 'rect', x, y: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, name: id, fill: '#000' }) as unknown as Layer;
const page = (id: string, layers: Layer[] = []): Doc =>
  ({ id, name: `Pág ${id}`, width: 100, height: 100, background: { type: 'solid', color: '#fff' }, layers, version: 1 }) as Doc;

const st = () => useEditor.getState();
const synced = () => st().pages.map((p, i) => (i === st().pageIndex ? st().doc : p));
const ids = () => synced().map((p) => p.id);
const editX = (x: number) => st().editDoc((d) => ({ ...d, layers: [shape('l', x)] }));

describe('identidad del diseño (designId)', () => {
  beforeEach(() => db.clear());

  it('un diseño antiguo sin designId se abre con el id de su primera página (el de siempre)', () => {
    st().loadPages([page('P1'), page('P2')], 1);
    expect(st().designId).toBe('P1');
    expect(st().designName).toBeNull();
    expect(st().pageIndex).toBe(1);
  });

  it('con meta se respeta el id guardado aunque ya no sea el de la primera página', () => {
    st().loadPages([page('P2'), page('P1')], 0, { designId: 'P1', name: 'Mi cartel' });
    expect(st().designId).toBe('P1');
    expect(st().designName).toBe('Mi cartel');
  });

  it('meta vacía o rara no rompe nada: se usa la identidad antigua', () => {
    st().loadPages([page('A')], 0, { designId: '', name: '   ' });
    expect(st().designId).toBe('A');
    expect(st().designName).toBeNull();
  });

  it('reordenar páginas y borrar la primera NO cambia el designId', () => {
    st().loadPages([page('P1'), page('P2'), page('P3')], 0);
    st().reorderPages(0, 2);
    expect(ids()).toEqual(['P2', 'P3', 'P1']);
    expect(st().designId).toBe('P1');
    st().deletePage(0);
    expect(ids()).toEqual(['P3', 'P1']);
    expect(st().designId).toBe('P1');
    st().deletePage(1); // borra P1, la página que dio el id
    expect(ids()).toEqual(['P3']);
    expect(st().designId).toBe('P1');
  });

  it('aplicar una plantilla (cambia el id de la página) no cambia el designId', () => {
    st().loadPages([page('P1')], 0);
    st().applyTemplate(page('T', [shape('t')]));
    expect(st().doc.id).not.toBe('P1');
    expect(st().designId).toBe('P1');
  });

  it('diseño nuevo: designId propio, y se queda aunque se borre su página inicial', () => {
    st().newDesign({ width: 200, height: 100 });
    const id = st().designId;
    expect(id).toBe(st().doc.id);
    st().addPage();
    st().deletePage(0);
    expect(st().designId).toBe(id);
    expect(st().doc.id).not.toBe(id);
  });

  it('setDesignName pone y quita el nombre propio', () => {
    st().loadPages([page('P1')], 0);
    st().setDesignName('  Folleto  ');
    expect(st().designName).toBe('Folleto');
    st().setDesignName('');
    expect(st().designName).toBeNull();
  });
});

describe('deshacer por página', () => {
  beforeEach(() => db.clear());

  it('sobrevive a ir a otra página y volver (ida y vuelta, varias veces)', () => {
    st().loadPages([page('A'), page('B')], 0);
    editX(1);
    editX(2);
    expect(st().past.length).toBe(2);
    st().switchPage(1);
    expect(st().past.length).toBe(0); // B no tiene pasos
    editX(7);
    st().switchPage(0);
    expect(st().past.length).toBe(2);
    st().switchPage(1);
    expect(st().past.length).toBe(1);
    st().switchPage(0);
    st().undo();
    expect((st().doc.layers[0] as { x: number }).x).toBe(1);
    st().undo();
    expect(st().doc.layers.length).toBe(0);
    st().redo();
    expect((st().doc.layers[0] as { x: number }).x).toBe(1);
    // B conserva lo suyo
    st().switchPage(1);
    st().undo();
    expect(st().doc.layers.length).toBe(0);
  });

  it('si otra operación cambió la página por fuera, su historial se descarta (no deshace a algo incoherente)', () => {
    st().loadPages([page('A', [shape('l', 0)]), page('B')], 0);
    editX(5);
    st().switchPage(1);
    st().patchOtherPages([{ page: 0, id: 'l', patch: { x: 99 } as Partial<Layer> }]);
    st().switchPage(0);
    expect(st().past.length).toBe(0);
    expect((st().doc.layers[0] as { x: number }).x).toBe(99);
  });

  it('reordenar conserva el deshacer de la página abierta', () => {
    st().loadPages([page('A'), page('B'), page('C')], 0);
    editX(3);
    st().reorderPages(0, 2);
    expect(st().past.length).toBe(1);
    expect(st().doc.id).toBe('A');
  });

  it('borrar una página se deshace con Ctrl+Z y vuelve con su historial', () => {
    st().loadPages([page('A'), page('B'), page('C')], 1);
    editX(4);
    st().deletePage(1); // borra la abierta (B)
    expect(ids()).toEqual(['A', 'C']);
    st().undo(); // primero se deshace el borrado
    expect(ids()).toEqual(['A', 'B', 'C']);
    expect(st().doc.id).toBe('B');
    expect(st().past.length).toBe(1);
    st().undo(); // luego el paso de B
    expect(st().doc.layers.length).toBe(0);
  });

  it('borrar OTRA página: Ctrl+Z la devuelve y la abierta conserva sus pasos', () => {
    st().loadPages([page('A'), page('B')], 0);
    editX(1);
    st().deletePage(1);
    expect(st().past.length).toBe(1);
    st().undo();
    expect(ids()).toEqual(['A', 'B']);
    expect(st().past.length).toBe(1);
    expect((st().doc.layers[0] as { x: number }).x).toBe(1);
  });

  it('el deshacer «de proyecto» no revierte lo hecho después en otras páginas', () => {
    st().loadPages([page('A'), page('B'), page('C')], 0);
    st().deletePage(2);
    st().switchPage(1);
    editX(8);
    st().switchPage(0);
    st().undo(); // ya no debe resucitar C a costa de perder la edición de B
    expect(ids()).toEqual(['A', 'B']);
    expect(synced()[1].layers.length).toBe(1);
  });

  it('abrir otro diseño no arrastra historiales de páginas del anterior', () => {
    st().loadPages([page('A'), page('B')], 0);
    editX(1);
    st().switchPage(1);
    st().loadPages([page('A'), page('B')], 0);
    expect(st().past.length).toBe(0);
    expect(st().pageHist).toEqual({});
  });

  it('addPage(después de) y duplicatePage(i) insertan en su sitio y conservan el deshacer de la que se deja', () => {
    st().loadPages([page('A'), page('B')], 0);
    editX(2);
    st().addPage(0);
    expect(st().pageIndex).toBe(1);
    expect(synced()[0].id).toBe('A');
    expect(synced()[2].id).toBe('B');
    st().duplicatePage(0);
    expect(st().pageIndex).toBe(1);
    expect(synced()[1].layers.length).toBe(1); // copia de A
    st().switchPage(0);
    expect(st().past.length).toBe(1);
    // onClick={addPage} pasaría un evento: se ignora y va al final
    st().addPage({} as unknown as number);
    expect(st().pageIndex).toBe(synced().length - 1);
  });
});

// ---- Persistencia: lo que hace el autoguardado de App con la identidad del store ----

// Réplica del bloque de autoguardado de App.tsx (mismos campos).
async function autosaveLikeApp() {
  const s = st();
  const snapshot = s.pages.map((p, i) => (i === s.pageIndex ? s.doc : p));
  const light = await dehydrateDocs(snapshot);
  db.set('autosave', { pages: light, index: s.pageIndex, designId: s.designId });
  await upsertDesign({ id: s.designId, name: designTitle(s.designName, snapshot), updatedAt: Date.now(), pageIndex: s.pageIndex, pages: light, thumb: '' });
}

const UNDO_API: UndoStoreApi = {
  getState: () => useEditor.getState(),
  subscribe: (fn) => useEditor.subscribe(fn),
  restoreHistory: (past, id) => useEditor.getState().restoreHistory(past, id),
};

describe('recientes, versiones y deshacer guardado siguen al diseño', () => {
  beforeEach(() => db.clear());

  it('reordenar y borrar la primera NO duplica el diseño en recientes', async () => {
    st().loadPages([page('P1', [shape('a')]), page('P2'), page('P3')], 0);
    await autosaveLikeApp();
    st().reorderPages(0, 2);
    await autosaveLikeApp();
    st().deletePage(0);
    await autosaveLikeApp();
    const list = await loadDesigns();
    expect(list.map((d) => d.id)).toEqual(['P1']);
    expect(list[0].pages.map((p) => p.id)).toEqual(['P3', 'P1']);
  });

  it('un diseño guardado por v0.5 (id = su primera página) se abre y se guarda con su mismo id', async () => {
    db.set('designs', [{ id: 'P1', name: 'Viejo', updatedAt: 1, pageIndex: 0, pages: [page('P1'), page('P2')], thumb: '', folder: 'Marca' }]);
    const [d] = await loadDesigns();
    st().loadPages(d.pages, d.pageIndex, { designId: d.id, name: d.designName }); // = openDesign de App
    st().reorderPages(1, 0);
    await autosaveLikeApp();
    const list = await loadDesigns();
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ id: 'P1', name: 'Pág P2', folder: 'Marca' }); // carpeta conservada
    expect(list[0].designName).toBeUndefined();
  });

  it('la recuperación lee designId del autoguardado nuevo, y del antiguo usa la primera página', () => {
    st().loadPages([page('P2'), page('P1')], 0, readDesignMeta({ pages: [], index: 0, designId: 'P1' }));
    expect(st().designId).toBe('P1');
    st().loadPages([page('X1'), page('X2')], 0, readDesignMeta({ pages: [], index: 0 }));
    expect(st().designId).toBe('X1');
  });

  it('versiones con nombre y automáticas siguen asociadas tras reordenar y borrar la primera', async () => {
    st().loadPages([page('P1', [shape('a')]), page('P2')], 0);
    await saveSnapshot(st().designId, 'Antes', synced(), 0);
    await maybeSaveAutoVersion(st().designId, synced(), 0);
    st().reorderPages(0, 1);
    st().deletePage(1); // borra P1
    expect((await listSnapshots(st().designId)).map((s) => s.name)).toEqual(['Antes']);
    expect((await listAutoVersions(st().designId)).length).toBe(1);
  });

  it('el deshacer guardado (undo:<id>) se recupera tras reordenar', async () => {
    st().loadPages([page('P1'), page('P2')], 1);
    editX(1);
    editX(2);
    st().reorderPages(1, 0); // P2 (abierta) pasa a ser la primera
    expect(designIdOf(st())).toBe('P1');
    db.set('undo:P1', buildRecord(designIdOf(st()), st().past, st().doc)!);
    // Reabrir: mismas páginas, con su id guardado.
    st().loadPages(synced(), 0, { designId: 'P1' });
    expect(st().past.length).toBe(0);
    expect(await restoreUndoFor(UNDO_API)).toBe(true);
    expect(st().past.length).toBe(2);
  });

  it('designIdOf sin designId (API antigua) sigue dando el id de la primera página', () => {
    const a = page('A');
    const b = page('B');
    expect(designIdOf({ doc: b, pages: [a, b], pageIndex: 1, past: [] })).toBe('A');
    expect(designIdOf({ doc: b, pages: [a, b], pageIndex: 1, past: [], designId: 'Z' })).toBe('Z');
  });
});

describe('gcAssets con identidad nueva e historial por página', () => {
  beforeEach(() => db.clear());
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const img = (id: string, src: string): Layer =>
    ({ id, type: 'image', name: id, src, naturalWidth: 1, naturalHeight: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false }) as unknown as Layer;

  it('recorre los campos nuevos de autosave, copias, recientes y undo:<designId>', async () => {
    expect(GC_KEYS).toEqual(expect.arrayContaining(['autosave', 'autosave.history', 'designs', 'snapshots', 'autoVersions']));
    for (const r of ['asset:a1', 'asset:b2', 'asset:c3', 'asset:d4', 'asset:zz']) db.set(r, 'data:x');
    db.set('autosave', { pages: [page('P2', [img('i', 'asset:a1')])], index: 0, designId: 'P1', designName: 'N' });
    db.set('autosave.history', [{ ts: 1, pageIndex: 0, pages: [page('P2', [img('i', 'asset:b2')])], designId: 'P1' }]);
    db.set('designs', [{ id: 'P1', name: 'N', designName: 'N', updatedAt: 1, pageIndex: 0, pages: [page('P2', [img('i', 'asset:c3')])], thumb: '' }]);
    db.set('undo:P1', { schema: 1, designId: 'P1', pageId: 'P2', savedAt: 1, fp: 'x', hist: { pool: [img('i', 'asset:d4')], steps: [] } });
    expect(await gcAssets()).toBe(1);
    expect(db.has('asset:zz')).toBe(false);
    for (const r of ['asset:a1', 'asset:b2', 'asset:c3', 'asset:d4']) expect(db.has(r)).toBe(true);
  });

  it('una imagen que solo vive en el historial de OTRA página no se pierde: vuelve al deshacer y se guarda de nuevo', async () => {
    st().loadPages([page('A'), page('B')], 0);
    st().editDoc((d) => ({ ...d, layers: [img('foto', PNG)] }));
    st().editDoc((d) => ({ ...d, layers: [] })); // la borra: solo queda en el historial de A
    st().switchPage(1);
    await autosaveLikeApp();
    const live = new Set<string>();
    collectRefs(db.get('autosave'), live);
    expect(live.size).toBe(0); // lo guardado ya no la referencia
    await gcAssets(); // y el GC puede quitarla del almacén
    expect([...db.keys()].some((k) => isAssetRef(k))).toBe(false);
    // En memoria el historial conserva la imagen completa (dataURL, no referencia).
    st().switchPage(0);
    st().undo();
    expect((st().doc.layers[0] as { src: string }).src).toBe(PNG);
    await autosaveLikeApp(); // y el autoguardado la vuelve a guardar
    const back = new Set<string>();
    collectRefs(db.get('autosave'), back);
    expect(back.size).toBe(1);
    expect(db.get([...back][0])).toBe(PNG);
  });
});
