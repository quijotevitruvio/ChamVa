import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Layer } from '../core/types';
import { STATE_CLASS, SESSION_KEYS, MAX_TABS } from './sessions';

// Pestañas contra el store REAL (como storePages.test.ts: sustitutos mínimos del DOM).
// El autoguardado y el deshacer persistente se sustituyen por espías que apuntan QUÉ
// estado leen en el momento de la llamada: así se comprueba que guardan la pestaña
// saliente y no la entrante.
const db = new Map<string, unknown>();
vi.mock('../../io/idb', () => ({
  idbGet: async (k: string) => db.get(k) ?? null,
  idbSet: async (k: string, v: unknown) => (db.set(k, v), true),
  idbDelete: async (k: string) => void db.delete(k),
  idbKeys: async (prefix = '') => [...db.keys()].filter((k) => k.startsWith(prefix)),
  setStorageErrorHandler: () => {},
}));
const saved: { designId: string; doc: Doc }[] = [];
const undoFlushes: string[] = [];
let saveResult = true;
vi.mock('../../io/autosave', () => ({
  flushSave: () => {
    const s = useEditor.getState();
    saved.push({ designId: s.designId, doc: s.doc });
    return Promise.resolve(saveResult);
  },
}));
vi.mock('../../io/undoStore', () => ({
  flushUndo: () => void undoFlushes.push(useEditor.getState().designId),
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
const editX = (x: number) => st().editDoc((d) => ({ ...d, layers: [shape('l', x)] }));

// Deja el store con UNA pestaña y un diseño A con contenido.
async function reset() {
  for (const t of st().tabs.filter((t) => t.id !== st().activeTabId)) await st().closeTab(t.id, { force: true });
  st().loadPages([page('A1', [shape('a')]), page('A2')], 0, { designId: 'A', name: 'Diseño A' });
  saved.length = 0;
  undoFlushes.length = 0;
  saveResult = true;
}

describe('toda clave del estado está clasificada (sesión / global / transitoria)', () => {
  it('las claves de datos del store real son exactamente las de STATE_CLASS', () => {
    const s = st() as unknown as Record<string, unknown>;
    const data = Object.keys(s).filter((k) => typeof s[k] !== 'function');
    // Si falla: se añadió una clave a EditorState sin clasificarla en sessions.ts (o se quitó).
    expect(data.sort()).toEqual(Object.keys(STATE_CLASS).sort());
  });
});

describe('pestañas en el store', () => {
  beforeEach(reset);

  it('una sola pestaña de partida', () => {
    expect(st().tabs).toHaveLength(1);
    expect(st().parked).toEqual({});
  });

  it('newTab → switchTab devuelve la sesión con los MISMOS objetos y lo global intacto', () => {
    editX(5);
    st().switchPage(1);
    st().editDoc((d) => ({ ...d, layers: [shape('p2')] })); // deshacer en la página 2
    st().selectLayer('p2');
    st().setZoom(2);
    const before = Object.fromEntries(SESSION_KEYS.map((k) => [k, st()[k]]));
    const globals = { uploads: st().uploads, templates: st().templates, brandKits: st().brandKits, recentColors: st().recentColors, showRulers: st().showRulers, customFonts: st().customFonts };
    const a = st().activeTabId;

    const b = st().newTab({ width: 300, height: 200 })!;
    expect(b).toBeTruthy();
    expect(st().activeTabId).toBe(b);
    expect(st().pages).toHaveLength(1);
    expect(st().doc.width).toBe(300);
    expect(st().past).toEqual([]);
    expect(st().selectedId).toBeNull();
    expect(st().zoom).toBe(1);
    expect(st().designId).not.toBe('A');
    expect(st().designName).toBeNull();

    expect(st().switchTab(a)).toBe(true);
    for (const k of SESSION_KEYS) expect(st()[k], k).toBe(before[k]);
    expect(st().uploads).toBe(globals.uploads);
    expect(st().templates).toBe(globals.templates);
    expect(st().brandKits).toBe(globals.brandKits);
    expect(st().recentColors).toBe(globals.recentColors);
    expect(st().showRulers).toBe(globals.showRulers);
    expect(st().customFonts).toBe(globals.customFonts);
    // Y el deshacer por página sigue: volver a la página 1 recupera su paso.
    st().undo();
    expect(st().doc.layers).toEqual([]);
    st().switchPage(0);
    st().undo();
    expect(st().doc.layers.map((l) => l.id)).toEqual(['a']);
  });

  it('nada se mezcla: editar y deshacer en B no toca A', () => {
    editX(1);
    const aDoc = st().doc;
    const a = st().activeTabId;
    const b = st().newTab()!;
    editX(99);
    editX(100);
    st().undo();
    expect(st().doc.layers[0].x).toBe(99);
    st().switchTab(a);
    expect(st().doc).toBe(aDoc);
    expect(st().designId).toBe('A');
    st().undo();
    expect(st().doc.layers.map((l) => l.id)).toEqual(['a']); // el paso de A, no el de B
    st().switchTab(b);
    expect(st().doc.layers[0].x).toBe(99);
    expect(st().future).toHaveLength(1);
  });

  it('guarda la pestaña SALIENTE antes de cambiar (autoguardado y deshacer)', () => {
    editX(7);
    const aDoc = st().doc;
    const b = st().newTab()!;
    expect(saved[saved.length - 1]).toEqual({ designId: 'A', doc: aDoc });
    expect(undoFlushes[undoFlushes.length - 1]).toBe('A');
    const bId = st().designId;
    editX(3);
    st().switchTab(st().tabs[0].id);
    expect(saved[saved.length - 1]?.designId).toBe(bId);
    expect(st().tabs.find((t) => t.id === b)?.save).toBe('pending');
  });

  it('cerrar recorte, lote y selección de texto al cambiar (transitorio)', () => {
    useEditor.setState({ cropMode: true, cropRect: { x: 0, y: 0, width: 1, height: 1 }, editingTextId: null, textSel: { id: 'a', start: 0, end: 1 }, selRect: { left: 0, top: 0, width: 1 } });
    st().beginBatch();
    const a = st().activeTabId;
    st().newTab();
    expect(st()).toMatchObject({ cropMode: false, cropRect: null, cropAspect: null, editingTextId: null, textSel: null, selRect: null });
    st().switchTab(a);
    // El lote se cerró: el siguiente cambio en A es su propio paso de deshacer.
    const n = st().past.length;
    editX(42);
    expect(st().past.length).toBe(n + 1);
  });

  it('cerrar la activa elige la vecina derecha; si no hay, la izquierda', async () => {
    const t1 = st().activeTabId;
    const t2 = st().newTab()!;
    const t3 = st().newTab()!;
    st().switchTab(t2);
    expect(await st().closeTab(t2)).toBe(true);
    expect(st().activeTabId).toBe(t3);
    expect(st().tabs.map((t) => t.id)).toEqual([t1, t3]);
    expect(st().parked[t2]).toBeUndefined();
    expect(await st().closeTab(t3)).toBe(true);
    expect(st().activeTabId).toBe(t1);
    expect(st().designId).toBe('A');
    expect(st().parked).toEqual({});
  });

  it('cerrar una aparcada no cambia la activa', async () => {
    const t1 = st().activeTabId;
    const t2 = st().newTab()!;
    expect(await st().closeTab(t1)).toBe(true);
    expect(st().activeTabId).toBe(t2);
    expect(st().tabs.map((t) => t.id)).toEqual([t2]);
    expect(st().parked).toEqual({});
  });

  it('la última pestaña no se cierra: queda un diseño vacío', async () => {
    const t1 = st().activeTabId;
    expect(await st().closeTab(t1)).toBe(true);
    expect(st().tabs).toHaveLength(1);
    expect(st().activeTabId).not.toBe(t1);
    expect(st().doc.layers).toEqual([]);
    expect(st().designId).not.toBe('A');
  });

  it('si no se pudo guardar, la pestaña NO se pierde: vuelve aparcada con error', async () => {
    editX(8);
    const aDoc = st().doc;
    const t1 = st().activeTabId;
    const t2 = st().newTab()!;
    st().switchTab(t1);
    saveResult = false;
    expect(await st().closeTab(t1)).toBe(false);
    expect(st().activeTabId).toBe(t2);
    expect(st().tabs.map((t) => t.id)).toEqual([t1, t2]);
    expect(st().tabs[0].save).toBe('error');
    expect(st().parked[t1].doc).toBe(aDoc);
    // Una aparcada cuyo guardado falló tampoco se cierra sin forzar.
    expect(await st().closeTab(t1)).toBe(false);
    expect(await st().closeTab(t1, { force: true })).toBe(true);
    expect(st().tabs.map((t) => t.id)).toEqual([t2]);
  });

  it('openDesignInTab: el mismo diseño nunca en dos pestañas', () => {
    const t1 = st().activeTabId;
    expect(st().openDesignInTab([page('A1')], 0, { designId: 'A' })).toEqual({ status: 'active', tabId: t1 });
    const r = st().openDesignInTab([page('B1', [shape('b')])], 0, { designId: 'B' });
    expect(r.status).toBe('opened');
    expect(st().designId).toBe('B');
    expect(st().openDesignInTab([page('A1')], 0, { designId: 'A' })).toEqual({ status: 'focused', tabId: t1 });
    expect(st().activeTabId).toBe(t1);
    expect(st().doc.layers.map((l) => l.id)).toEqual(['a']); // la de memoria, no la de la galería
    expect(st().tabs).toHaveLength(2);
  });

  it('openDesignInTab reutiliza la pestaña activa si está vacía', () => {
    st().newTab();
    const blankTab = st().activeTabId;
    const r = st().openDesignInTab([page('C1', [shape('c')])], 0, { designId: 'C', name: 'Ce' });
    expect(r).toEqual({ status: 'reused', tabId: blankTab });
    expect(st().tabs).toHaveLength(2);
    expect(st().designId).toBe('C');
    expect(st().designName).toBe('Ce');
  });

  it(`límite de ${MAX_TABS} pestañas`, () => {
    while (st().tabs.length < MAX_TABS) expect(st().newTab()).toBeTruthy();
    expect(st().newTab()).toBeNull();
    editX(1); // la activa deja de estar vacía
    expect(st().openDesignInTab([page('Z1')], 0, { designId: 'Z' }).status).toBe('limit');
  });

  it('reorderTabs mueve pestañas sin tocar la activa', () => {
    const t1 = st().activeTabId;
    const t2 = st().newTab()!;
    st().reorderTabs(1, 0);
    expect(st().tabs.map((t) => t.id)).toEqual([t2, t1]);
    expect(st().activeTabId).toBe(t2);
  });

  it('switchTab a sí misma o a una inexistente: nada', () => {
    const before = st().doc;
    expect(st().switchTab(st().activeTabId)).toBe(false);
    expect(st().switchTab('nope')).toBe(false);
    expect(st().doc).toBe(before);
    expect(saved).toHaveLength(0);
  });
});
