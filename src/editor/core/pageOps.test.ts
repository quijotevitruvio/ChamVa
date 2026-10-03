import { describe, expect, it } from 'vitest';
import type { Doc } from './types';
import {
  deleteIndices,
  duplicateIndices,
  exportableIndices,
  exportablePages,
  insertAt,
  isLayerLocked,
  moveIndicesTo,
  patchTouchesGeometry,
  reorderOne,
} from './pageOps';

const page = (id: string, isMaster = false): Doc =>
  ({ id, name: id, width: 10, height: 10, background: { type: 'transparent' }, layers: [{ id: `${id}-l` }], version: 1, ...(isMaster ? { isMaster } : {}) }) as unknown as Doc;
const ids = (ps: Doc[]) => ps.map((p) => p.id);
const P = () => ['a', 'b', 'c', 'd'].map((id) => page(id));

describe('pageOps', () => {
  it('insertAt: principio, medio, final y fuera de rango', () => {
    const x = page('x');
    expect(ids(insertAt(P(), 0, x))).toEqual(['x', 'a', 'b', 'c', 'd']);
    expect(ids(insertAt(P(), 2, x))).toEqual(['a', 'b', 'x', 'c', 'd']);
    expect(ids(insertAt(P(), 4, x))).toEqual(['a', 'b', 'c', 'd', 'x']);
    expect(ids(insertAt(P(), 99, x))).toEqual(['a', 'b', 'c', 'd', 'x']);
    expect(ids(insertAt(P(), -3, x))).toEqual(['x', 'a', 'b', 'c', 'd']);
    expect(ids(insertAt(P(), NaN, x))).toEqual(['a', 'b', 'c', 'd', 'x']);
    const src = P();
    insertAt(src, 1, x);
    expect(ids(src)).toEqual(['a', 'b', 'c', 'd']); // no muta
  });

  it('reorderOne mueve una y deja igual (mismo array) lo inválido', () => {
    expect(ids(reorderOne(P(), 0, 3))).toEqual(['b', 'c', 'd', 'a']);
    expect(ids(reorderOne(P(), 3, 0))).toEqual(['d', 'a', 'b', 'c']);
    const src = P();
    expect(reorderOne(src, 1, 1)).toBe(src);
    expect(reorderOne(src, -1, 2)).toBe(src);
    expect(reorderOne(src, 0, 4)).toBe(src);
  });

  it('moveIndicesTo conserva el orden relativo', () => {
    expect(ids(moveIndicesTo(P(), [3, 1], 'start'))).toEqual(['b', 'd', 'a', 'c']);
    expect(ids(moveIndicesTo(P(), [0, 2], 'end'))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('duplicateIndices: copia detrás del original, ids nuevos y sin maestra', () => {
    let n = 0;
    const out = duplicateIndices([page('a', true), page('b')], [0], () => `n${n++}`);
    expect(ids(out)).toEqual(['a', 'n0', 'b']);
    expect(out[1].name).toBe('a (copia)');
    expect(out[1].layers[0].id).toBe('n1');
    expect(out[1].isMaster).toBeUndefined();
    expect(out[0].isMaster).toBe(true);
  });

  it('deleteIndices nunca deja el proyecto sin páginas', () => {
    expect(ids(deleteIndices(P(), [0, 2]))).toEqual(['b', 'd']);
    const src = P();
    expect(deleteIndices(src, [0, 1, 2, 3])).toBe(src);
  });
});

describe('páginas ocultas y bloqueadas', () => {
  const withHidden = (hiddenIds: string[]) => P().map((p) => (hiddenIds.includes(p.id) ? { ...p, hidden: true } : p));

  it('exportablePages descarta las ocultas y conserva el orden', () => {
    expect(ids(exportablePages(withHidden(['b', 'd'])))).toEqual(['a', 'c']);
    expect(ids(exportablePages(P()))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('exportablePages: todas ocultas → []', () => {
    expect(exportablePages(withHidden(['a', 'b', 'c', 'd']))).toEqual([]);
    expect(exportableIndices(withHidden(['a', 'b', 'c', 'd']))).toEqual([]);
  });

  it('exportableIndices conserva el índice original', () => {
    expect(exportableIndices(withHidden(['a', 'c']))).toEqual([1, 3]);
  });

  it('isLayerLocked: candado de la capa o de la página', () => {
    expect(isLayerLocked({}, {})).toBe(false);
    expect(isLayerLocked({ locked: false }, { locked: false })).toBe(false);
    expect(isLayerLocked({}, { locked: true })).toBe(true);
    expect(isLayerLocked({ locked: true }, { locked: false })).toBe(true);
    expect(isLayerLocked({ locked: true }, {})).toBe(true);
  });

  it('patchTouchesGeometry distingue mover/transformar de otros cambios', () => {
    expect(patchTouchesGeometry({ x: 3 })).toBe(true);
    expect(patchTouchesGeometry({ rotation: 5, opacity: 1 })).toBe(true);
    expect(patchTouchesGeometry({ opacity: 0.5 })).toBe(false);
    expect(patchTouchesGeometry({ locked: false })).toBe(false);
  });
});
