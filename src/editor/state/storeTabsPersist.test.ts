import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Doc, Layer } from '../core/types';

// Pestañas guardadas de punta a punta contra el store REAL y el autoguardado REAL
// (io/autosave.ts + io/tabsStore.ts) sobre un IndexedDB falso en memoria. «Recargar» =
// leer con loadTabs() y restaurar con restoreTabs(), como hace App.tsx al arrancar.
const db = new Map<string, unknown>();
vi.mock('../../io/idb', () => ({
  idbGet: async (k: string) => db.get(k) ?? null,
  idbSet: async (k: string, v: unknown) => (db.set(k, structuredClone(v)), true),
  idbDelete: async (k: string) => void db.delete(k),
  idbKeys: async (prefix = '') => [...db.keys()].filter((k) => k.startsWith(prefix)),
  setStorageErrorHandler: () => {},
}));
vi.mock('../../io/export', () => ({ renderDocToCanvas: async () => ({ toDataURL: () => 'thumb' }) }));
vi.mock('../../io/autoVersions', () => ({ maybeSaveAutoVersion: () => {} }));

type Store = typeof import('./store').useEditor;
let useEditor: Store;
let stopAutosave: () => void = () => {};
let loadTabs: typeof import('../../io/tabsStore').loadTabs;
let gcAssets: typeof import('../../io/assets').gcAssets;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeAll(async () => {
  const ctx = new Proxy({}, { get: () => () => ({ width: 10 }) });
  const g = globalThis as Record<string, unknown>;
  g.document ??= {
    createElement: () => ({ getContext: () => ctx }),
    fonts: { load: async () => [] },
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: 'visible',
  };
  const ls = new Map<string, string>();
  g.localStorage ??= {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k),
  };
  useEditor = (await import('./store')).useEditor;
  const autosave = await import('../../io/autosave');
  ({ loadTabs } = await import('../../io/tabsStore'));
  ({ gcAssets } = await import('../../io/assets'));
  stopAutosave = autosave.startAutosave({ getState: () => useEditor.getState(), subscribe: (fn) => useEditor.subscribe(fn) });
});
afterAll(() => stopAutosave());

const shape = (id: string): Layer =>
  ({ id, type: 'shape', kind: 'rect', x: 0, y: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, name: id, fill: '#000' }) as unknown as Layer;
const img = (id: string): Layer =>
  ({ id, type: 'image', name: id, src: PNG, naturalWidth: 1, naturalHeight: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false }) as unknown as Layer;
const page = (id: string, layers: Layer[] = []): Doc =>
  ({ id, name: `Pág ${id}`, width: 100, height: 100, background: { type: 'solid', color: '#fff' }, layers, version: 1 }) as Doc;
const st = () => useEditor.getState();
const flush = async () => (await import('../../io/autosave')).flushSave();

async function reload() {
  const r = await loadTabs();
  expect(r).not.toBeNull();
  expect(st().restoreTabs(r!.tabs, r!.activeId)).toBe(true);
  return r!;
}

describe('pestañas: guardar, recargar, cerrar', () => {
  it('3 pestañas vuelven con su contenido, su orden y la activa; una imagen solo en una aparcada sobrevive al GC', async () => {
    st().loadPages([page('A1', [shape('a')])], 0, { designId: 'A', name: 'Diseño A' });
    st().newTab();
    st().loadPages([page('B1', [img('foto')]), page('B2')], 1, { designId: 'B' });
    st().newTab();
    st().loadPages([page('C1', [shape('c')])], 0, { designId: 'C' });
    const order = st().tabs.map((t) => t.id);
    expect(order).toHaveLength(3);
    st().switchTab(order[0]); // aparca C (la escribe) y vuelve a A
    expect(await flush()).toBe(true);
    // Se espera a los «guardar ya» de cada aparcamiento.
    await new Promise((r) => setTimeout(r, 0));

    // La foto de B solo está en la pestaña aparcada (autosave = A, sin imágenes).
    expect(JSON.stringify(db.get('autosave'))).not.toContain('asset:');
    db.delete('designs'); // ni siquiera la galería: solo `tab:<B>` la referencia
    await gcAssets();
    expect([...db.keys()].some((k) => k.startsWith('asset:'))).toBe(true);

    // «Recargar»: se parte de otro estado y se restaura desde IDB.
    st().loadPages([page('Z')], 0, { designId: 'Z' });
    stopAutosave(); // como una app recién abierta: aún no autoguarda
    const r = await reload();
    expect(r.dropped).toEqual([]);
    expect(st().tabs.map((t) => t.id)).toEqual(order);
    expect(st().activeTabId).toBe(order[0]);
    expect(st().designId).toBe('A');
    expect(st().designName).toBe('Diseño A');
    const b = st().parked[order[1]];
    expect(b.designId).toBe('B');
    expect(b.pageIndex).toBe(1);
    expect((b.pages[0].layers[0] as { src: string }).src).toBe(PNG); // imagen rehidratada
    expect(st().parked[order[2]].designId).toBe('C');

    // Cerrar una pestaña y recargar: no vuelve; las demás sí.
    const autosave = await import('../../io/autosave');
    stopAutosave = autosave.startAutosave({ getState: () => useEditor.getState(), subscribe: (fn) => useEditor.subscribe(fn) });
    expect(await st().closeTab(order[2])).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(db.has('tab:' + order[2])).toBe(false);
    await reload();
    expect(st().tabs.map((t) => t.id)).toEqual(order.slice(0, 2));
    expect(st().activeTabId).toBe(order[0]);
  });
});
