import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Doc, ImageLayer, Layer } from '../core/types';
import { DEFAULT_ADJUST } from '../core/types';
import { cropPatch, displayBox } from '../core/imageCrop';

// Recorte no destructivo contra el store REAL (mismos sustitutos mínimos que storePages.test.ts).
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

const SRC = 'data:image/jpeg;base64,/9j/AAAA';
const photo = (o: Partial<ImageLayer> = {}): ImageLayer => ({
  id: 'f', type: 'image', name: 'f', src: SRC, naturalWidth: 4000, naturalHeight: 3000,
  x: 10, y: 20, scaleX: 0.2, scaleY: 0.2, rotation: 30, opacity: 1, visible: true, locked: false,
  adjust: { ...DEFAULT_ADJUST, brightness: 1.3, vignette: 0.4 }, filter: 'sepia', flipX: true, flipY: false,
  maskShape: 'circle', shadow: false, shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0,
  ...o,
} as ImageLayer);
const page = (layers: Layer[]): Doc =>
  ({ id: 'P', name: 'P', width: 1000, height: 1000, background: { type: 'solid', color: '#fff' }, layers, version: 1 }) as Doc;
const st = () => useEditor.getState();
const cur = () => st().doc.layers[0] as ImageLayer;

describe('recorte no destructivo en el store', () => {
  it('aplicar: src intacto, ajustes/filtro/volteo/máscara conservados, un paso de deshacer, reabre precargado', () => {
    st().loadPages([page([photo()])], 0);
    st().selectLayer('f');
    const before = st().past.length;
    st().updateLayer('f', cropPatch(cur(), { x: 1000, y: 500, w: 1600, h: 900 })!);
    const l = cur();
    expect(l.src).toBe(SRC);
    expect(l.adjust.brightness).toBe(1.3);
    expect(l.filter).toBe('sepia');
    expect(l.flipX).toBe(true);
    expect(l.maskShape).toBe('circle');
    expect(l.rotation).toBe(30);
    expect(l.naturalWidth).toBe(1600);
    expect(st().past.length).toBe(before + 1);
    // El paso de historial solo difiere en 4 números + tamaño y origen (mismo `src`, sin blob nuevo).
    const prev = st().past[st().past.length - 1].layers[0] as ImageLayer;
    expect(prev.src).toBe(l.src);
    st().beginCrop();
    expect(st().cropRect).toEqual({ x: 1000, y: 500, width: 1600, height: 900 });
    st().cancelCrop();
    st().undo();
    expect(cur().crop).toBeUndefined();
    expect(cur().naturalWidth).toBe(4000);
    expect(displayBox(cur())).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
  });

  it('un tamaño natural nuevo sin crop (otra gráfica / imagen) quita el recorte; con crop explícito se respeta', () => {
    st().loadPages([page([photo({ crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, naturalWidth: 2000 })])], 0);
    st().updateLayer('f', { naturalWidth: 800, naturalHeight: 600 } as Partial<Layer>);
    expect(cur().crop).toBeUndefined();
    st().updateLayer('f', { crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, naturalWidth: 400, naturalHeight: 300 } as Partial<Layer>);
    expect(cur().crop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    st().updateLayer('f', { src: 'data:image/png;base64,BBBB' } as Partial<Layer>); // recolor / quitar fondo: mismo encuadre
    expect(cur().crop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  });

  it('replaceLayerImage (perspectiva, enderezar, mockup: imagen ya horneada) quita el recorte', () => {
    st().loadPages([page([photo({ crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, naturalWidth: 2000 })])], 0);
    st().replaceLayerImage('f', { src: 'data:image/png;base64,CCCC', naturalWidth: 2000, naturalHeight: 3000, x: 0, y: 0 });
    expect(cur().crop).toBeUndefined();
  });

  it('proporción fija: cuadrada EN PANTALLA aunque la capa tenga escala no uniforme', () => {
    st().loadPages([page([photo({ scaleX: 0.4, scaleY: 0.2, flipX: false })])], 0);
    st().selectLayer('f');
    st().beginCrop();
    st().setCropAspect(1);
    const r = st().cropRect!;
    expect(r.width * 0.4).toBeCloseTo(r.height * 0.2, 6);
    expect(r.height).toBeLessThanOrEqual(3000);
    st().cancelCrop();
  });
});
