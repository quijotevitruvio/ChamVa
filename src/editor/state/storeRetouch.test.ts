import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Doc, ImageLayer, Layer } from '../core/types';
import { DEFAULT_ADJUST } from '../core/types';

// Retoque de píxeles (campo `retouch`) contra el store REAL.
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
  g.document ??= { createElement: () => ({ getContext: () => ctx }), fonts: { load: async () => [] } };
  const ls = new Map<string, string>();
  g.localStorage ??= {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k),
  };
  useEditor = (await import('./store')).useEditor;
});

const SRC = 'data:image/png;base64,AAAA';
const RET = { src: 'data:image/png;base64,BBBB', x: 1, y: 2, w: 10, h: 10, bw: 100, bh: 80 };
const photo = (o: Partial<ImageLayer> = {}): ImageLayer =>
  ({
    id: 'f', type: 'image', name: 'f', src: SRC, naturalWidth: 100, naturalHeight: 80, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
    opacity: 1, visible: true, locked: false, adjust: { ...DEFAULT_ADJUST }, filter: 'none', flipX: false, flipY: false,
    shadow: false, shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0, ...o,
  }) as ImageLayer;
const page = (layers: Layer[]): Doc => ({ id: 'P', name: 'P', width: 500, height: 500, background: { type: 'solid', color: '#fff' }, layers, version: 1 }) as Doc;
const st = () => useEditor.getState();
const cur = () => st().doc.layers[0] as ImageLayer;

describe('retoque en el store', () => {
  it('un diseño sin retoque no gana ningún campo nuevo', () => {
    st().loadPages([page([photo()])], 0);
    expect('retouch' in cur()).toBe(false);
    st().updateLayer('f', { x: 5 });
    expect('retouch' in cur()).toBe(false);
  });

  it('guardar el retoque es un paso de deshacer y no toca src', () => {
    st().loadPages([page([photo()])], 0);
    const before = st().past.length;
    st().updateLayer('f', { retouch: RET } as Partial<Layer>);
    expect(cur().retouch).toEqual(RET);
    expect(cur().src).toBe(SRC);
    expect(st().past.length).toBe(before + 1);
    st().undo();
    expect(cur().retouch).toBeUndefined();
    st().redo();
    expect(cur().retouch).toEqual(RET);
  });

  it('cambiar src (quitar fondo, perspectiva…) descarta el retoque; conservarlo es explícito', () => {
    st().loadPages([page([photo({ retouch: RET })])], 0);
    st().updateLayer('f', { src: 'data:image/png;base64,CCCC' });
    expect(cur().retouch).toBeUndefined();
    st().loadPages([page([photo({ retouch: RET })])], 0);
    st().updateLayer('f', { src: 'data:image/png;base64,CCCC', retouch: RET } as Partial<Layer>);
    expect(cur().retouch).toEqual(RET);
  });
});
