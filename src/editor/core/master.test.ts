import { describe, expect, it } from 'vitest';
import type { Doc, Layer } from './types';
import {
  clearMasterRefs,
  docWithMaster,
  masterCandidates,
  masterOnlyDoc,
  setIsMaster,
  setMasterId,
} from './master';
import { deleteIndices, duplicateIndices, moveIndicesTo, reorderOne } from './pageOps';

const layer = (id: string, extra: Record<string, unknown> = {}): Layer =>
  ({
    id, name: id, type: 'shape', shape: 'rect', x: 10, y: 10, width: 20, height: 20, scaleX: 1, scaleY: 1,
    rotation: 0, opacity: 1, blendMode: 'normal', visible: true, locked: false, fill: '#000', stroke: '#000',
    strokeWidth: 0, cornerRadius: 0, shadow: false, shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0,
    ...extra,
  }) as Layer;
const page = (id: string, layers: Layer[], extra: Partial<Doc> = {}): Doc => ({
  id, name: id, width: 100, height: 100, background: { type: 'transparent' }, layers, version: 1, ...extra,
});

describe('página maestra', () => {
  const master = page('m', [layer('logo'), layer('oculta', { visible: false })], { isMaster: true });
  const p1 = page('p1', [layer('a')], { masterId: 'm' });
  const p2 = page('p2', [layer('b')]);
  const pages = [master, p1, p2];

  it('antepone las capas visibles de la maestra, bloqueadas y con id propio', () => {
    const eff = docWithMaster(p1, pages);
    expect(eff.layers.map((l) => l.id)).toEqual(['master:logo', 'a']);
    expect(eff.layers[0].locked).toBe(true);
    expect(p1.layers).toHaveLength(1); // no muta la página
  });
  it('páginas sin maestra, la propia maestra o referencias rotas quedan iguales', () => {
    expect(docWithMaster(p2, pages)).toBe(p2);
    expect(docWithMaster(master, pages)).toBe(master);
    const roto = page('r', [layer('x')], { masterId: 'nada' });
    expect(docWithMaster(roto, pages)).toBe(roto);
    expect(docWithMaster(p1, [p1])).toBe(p1);
  });
  it('adapta la maestra si la página tiene otro tamaño', () => {
    const big = page('big', [], { masterId: 'm', width: 200, height: 200 });
    const eff = docWithMaster(big, [master, big]);
    expect(eff.layers[0].scaleX).toBe(2);
    expect(eff.layers[0].x).toBe(20);
  });
  it('masterOnlyDoc solo trae las capas de la maestra', () => {
    const only = masterOnlyDoc(p1, pages)!;
    expect(only.layers.map((l) => l.id)).toEqual(['master:logo']);
    expect(only.background.type).toBe('transparent');
    expect(masterOnlyDoc(p2, pages)).toBeNull();
  });
  it('marcar / elegir / limpiar', () => {
    expect(setIsMaster(p2, true).isMaster).toBe(true);
    expect(setIsMaster(setIsMaster(p1, true), true).masterId).toBeUndefined();
    expect('isMaster' in setIsMaster(master, false)).toBe(false);
    expect(setMasterId(p2, 'm').masterId).toBe('m');
    expect(setMasterId(p2, 'p2').masterId).toBeUndefined();
    expect(clearMasterRefs(pages, 'm')[1].masterId).toBeUndefined();
    expect(masterCandidates(pages, 1).map((c) => c.index)).toEqual([0]);
    expect(masterCandidates(pages, 0)).toEqual([]);
  });
});

describe('operaciones de páginas', () => {
  const ps = ['a', 'b', 'c', 'd'].map((id) => page(id, [layer(id + '1')]));
  const ids = (l: Doc[]) => l.map((p) => p.id).join('');
  it('mover al principio / final conserva el orden relativo', () => {
    expect(ids(moveIndicesTo(ps, [2, 3], 'start'))).toBe('cdab');
    expect(ids(moveIndicesTo(ps, [0, 2], 'end'))).toBe('bdac');
  });
  it('reordenar arrastrando', () => {
    expect(ids(reorderOne(ps, 0, 2))).toBe('bcad');
    expect(reorderOne(ps, 1, 1)).toBe(ps);
    expect(reorderOne(ps, 9, 0)).toBe(ps);
  });
  it('duplicar da ids nuevos a página y capas, y la copia no es maestra', () => {
    let n = 0;
    const withM = [page('a', [layer('a1')], { isMaster: true }), ps[1]];
    const out = duplicateIndices(withM, [0], () => `n${++n}`);
    expect(out).toHaveLength(3);
    expect(out[1].id).toBe('n1');
    expect(out[1].layers[0].id).toBe('n2');
    expect(out[1].isMaster).toBeUndefined();
    expect(out[0].isMaster).toBe(true);
  });
  it('borrar deja siempre una página', () => {
    expect(ids(deleteIndices(ps, [1, 2]))).toBe('ad');
    expect(deleteIndices(ps, [0, 1, 2, 3])).toBe(ps);
  });
});
