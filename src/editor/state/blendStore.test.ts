import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Doc, Layer } from '../core/types';

// Fusión sobre el store REAL: un gesto = un paso de deshacer; vista previa que revierte;
// grupos; teclas con pausa. Mismos sustitutos mínimos del DOM que storePages.test.ts.
vi.mock('../../io/idb', () => ({
  idbGet: async () => null,
  idbSet: async () => true,
  idbDelete: async () => {},
  idbKeys: async () => [],
  setStorageErrorHandler: () => {},
}));

type Store = typeof import('./store').useEditor;
let useEditor: Store;
let keys: typeof import('./blendKeys');

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
  keys = await import('./blendKeys');
});

const L = (id: string, extra: object = {}): Layer =>
  ({ id, type: 'shape', kind: 'rect', x: 0, y: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, name: id, fill: '#000', ...extra }) as unknown as Layer;
const st = () => useEditor.getState();
const mode = (id: string) => (st().doc.layers.find((l) => l.id === id) as Layer & { blendMode?: string }).blendMode;

function setup(layers: Layer[], selected: string[]) {
  const doc = { id: 'P', name: 'P', width: 100, height: 100, background: { type: 'solid', color: '#fff' }, layers, version: 1 } as Doc;
  st().loadPages([doc], 0);
  useEditor.setState({ selectedIds: selected, selectedId: selected[selected.length - 1] ?? null, past: [], future: [] });
}

afterEach(() => {
  keys._resetBlendKeys();
  vi.useRealTimers();
});

describe('fusión en el store', () => {
  it('varias capas a la vez en UN paso de deshacer', () => {
    setup([L('a', { blendMode: 'normal' }), L('b', { blendMode: 'normal' }), L('c', { blendMode: 'normal' })], ['a', 'b']);
    st().setBlendMode('multiply');
    expect([mode('a'), mode('b'), mode('c')]).toEqual(['multiply', 'multiply', 'normal']);
    expect(st().past).toHaveLength(1);
    st().undo();
    expect([mode('a'), mode('b')]).toEqual(['normal', 'normal']);
  });
  it('un grupo se trata entero aunque solo haya una capa seleccionada', () => {
    setup([L('a', { groupId: 'G', blendMode: 'normal' }), L('b', { groupId: 'G', blendMode: 'normal' }), L('c', { blendMode: 'normal' })], ['a']);
    st().setBlendMode('screen');
    expect([mode('a'), mode('b'), mode('c')]).toEqual(['screen', 'screen', 'normal']);
  });
  it('la vista previa no toca el historial y se revierte', () => {
    setup([L('a', { blendMode: 'overlay' })], ['a']);
    st().previewBlendMode('difference');
    st().previewBlendMode('hue');
    expect(mode('a')).toBe('hue');
    expect(st().past).toHaveLength(0);
    st().cancelBlendPreview();
    expect(mode('a')).toBe('overlay');
    expect(st().past).toHaveLength(0);
  });
  it('confirmar tras la vista previa deja UN paso cuyo «antes» es el original', () => {
    setup([L('a', { blendMode: 'overlay' })], ['a']);
    st().previewBlendMode('difference');
    st().previewBlendMode('hue');
    st().setBlendMode('hue');
    expect(mode('a')).toBe('hue');
    expect(st().past).toHaveLength(1);
    st().undo();
    expect(mode('a')).toBe('overlay');
  });
  it('confirmar el mismo modo que ya tenía no añade pasos', () => {
    setup([L('a', { blendMode: 'overlay' })], ['a']);
    st().previewBlendMode('hue');
    st().setBlendMode('overlay');
    expect(mode('a')).toBe('overlay');
    expect(st().past).toHaveLength(0);
  });
  it('un diseño antiguo (sin blendMode) acepta el cambio y deshace a «sin modo»', () => {
    setup([L('a')], ['a']);
    expect(mode('a')).toBeUndefined();
    st().setBlendMode('multiply');
    st().undo();
    expect(mode('a')).toBeUndefined();
  });
  it('opacidad en vivo de toda la selección con un checkpoint', () => {
    setup([L('a'), L('b')], ['a', 'b']);
    st().checkpoint();
    st().setOpacityLive(0.4);
    st().setOpacityLive(0.3);
    expect(st().doc.layers.map((l) => l.opacity)).toEqual([0.3, 0.3]);
    expect(st().past).toHaveLength(1);
  });
  it('seleccionar todo omite ocultas y bloqueadas', () => {
    setup([L('a'), L('b', { visible: false }), L('c', { locked: true }), L('d')], []);
    st().selectAll();
    expect(st().selectedIds).toEqual(['a', 'd']);
  });
});

describe('teclas de fusión', () => {
  it('pulsaciones seguidas = un solo paso de deshacer, tras la pausa', () => {
    vi.useFakeTimers();
    setup([L('a', { blendMode: 'normal' })], ['a']);
    expect(keys.applyBlendKey('next')).toBe(true); // darken
    keys.applyBlendKey('next'); // multiply
    keys.applyBlendKey('next'); // burn
    expect(mode('a')).toBe('burn');
    expect(st().past).toHaveLength(0);
    vi.advanceTimersByTime(800);
    expect(mode('a')).toBe('burn');
    expect(st().past).toHaveLength(1);
    st().undo();
    expect(mode('a')).toBe('normal');
  });
  it('Alt+Shift+N vuelve a Normal y deshacer antes de la pausa confirma primero', () => {
    vi.useFakeTimers();
    setup([L('a', { blendMode: 'multiply' })], ['a']);
    keys.applyBlendKey('normal');
    expect(mode('a')).toBe('normal');
    keys.flushBlendKey();
    st().undo();
    expect(mode('a')).toBe('multiply');
  });
  it('sin selección no hace nada', () => {
    setup([L('a')], []);
    expect(keys.applyBlendKey('next')).toBe(false);
  });
  it('anterior desde Normal va al último modo', () => {
    vi.useFakeTimers();
    setup([L('a', { blendMode: 'normal' })], ['a']);
    keys.applyBlendKey('prev');
    keys.flushBlendKey();
    expect(mode('a')).toBe('luminosity');
  });
});
