import { describe, expect, it } from 'vitest';
import type { Doc, Layer, ShapeLayer, TextLayer } from './types';
import {
  addFolder,
  buildTree,
  deleteFolder,
  dropLayerOnLayer,
  filterLayers,
  flattenTree,
  folderHidden,
  folderLayerIds,
  isFilterActive,
  moveFolder,
  moveLayersToFolder,
  moveToNewFolder,
  normalizeFolders,
  setFolderFlag,
  type TreeNode,
} from './folders';

const base = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, blendMode: 'normal', visible: true, locked: false } as const;
const shape = (id: string, extra: Partial<ShapeLayer> = {}): Layer =>
  ({ ...base, id, name: id, type: 'shape', shape: 'rect', width: 10, height: 10, fill: '#000', stroke: '#000', strokeWidth: 0, cornerRadius: 0, shadow: false, shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0, ...extra }) as Layer;
const text = (id: string, t: string, extra: Partial<TextLayer> = {}): Layer =>
  ({ ...base, id, name: id, type: 'text', text: t, fontFamily: 'Arial', fontSize: 20, fill: '#000', align: 'left', bold: false, italic: false, textTransform: 'none', letterSpacing: 0, strokeColor: '#000', strokeWidth: 0, shadow: false, shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0, ...extra }) as Layer;
const mk = (layers: Layer[], folders?: Doc['folders']): Doc => ({
  id: 'd', name: 'd', width: 100, height: 100, background: { type: 'transparent' }, layers, version: 1, folders,
});
const names = (nodes: TreeNode[]): string[] =>
  nodes.map((n) => (n.kind === 'layer' ? n.layer.id : `[${n.folder.id}:${names(n.children).join(',')}]`));

describe('árbol de carpetas', () => {
  it('sin carpetas el árbol es la lista de capas de arriba abajo', () => {
    const d = mk([shape('a'), shape('b'), shape('c')]);
    expect(names(buildTree(d))).toEqual(['c', 'b', 'a']);
  });
  it('agrupa por carpeta anidada y respeta el orden relativo', () => {
    let d = mk([shape('a'), shape('b'), shape('c'), shape('d')]);
    d = addFolder(d, 'f1', 'Uno');
    d = addFolder(d, 'f2', 'Dos', 'f1');
    d = moveLayersToFolder(d, ['a'], 'f2');
    d = moveLayersToFolder(d, ['c'], 'f1');
    // d(3) suelta, c(2) en f1, b(1) suelta, a(0) en f2 dentro de f1
    expect(names(buildTree(d))).toEqual(['d', '[f1:c,[f2:a]]', 'b']);
  });
  it('las carpetas vacías van al final y flattenTree respeta el plegado', () => {
    let d = mk([shape('a'), shape('b')]);
    d = addFolder(d, 'vacia', 'V');
    d = addFolder(d, 'f', 'F');
    d = moveLayersToFolder(d, ['a'], 'f');
    expect(names(buildTree(d))).toEqual(['b', '[f:a]', '[vacia:]']);
    d = { ...d, folders: d.folders!.map((f) => (f.id === 'f' ? { ...f, collapsed: true } : f)) };
    const flat = flattenTree(buildTree(d)).map((n) => (n.kind === 'layer' ? n.layer.id : n.folder.id));
    expect(flat).toEqual(['b', 'f', 'vacia']);
  });
  it('mover capas no cambia el orden de dibujo', () => {
    let d = mk([shape('a'), shape('b'), shape('c')]);
    d = addFolder(d, 'f', 'F');
    d = moveLayersToFolder(d, ['a', 'c'], 'f');
    expect(d.layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('operaciones de carpeta', () => {
  it('borrar carpeta no borra capas: suben al padre', () => {
    let d = mk([shape('a'), shape('b')]);
    d = addFolder(d, 'f1', 'Uno');
    d = addFolder(d, 'f2', 'Dos', 'f1');
    d = moveLayersToFolder(d, ['a'], 'f2');
    d = moveLayersToFolder(d, ['b'], 'f1');
    d = deleteFolder(d, 'f2');
    expect(d.layers).toHaveLength(2);
    expect(d.layers.find((l) => l.id === 'a')!.folderId).toBe('f1');
    d = deleteFolder(d, 'f1');
    expect(d.folders).toBeUndefined();
    expect(d.layers.every((l) => !('folderId' in l))).toBe(true);
  });
  it('no permite ciclos al mover carpetas', () => {
    let d = mk([]);
    d = addFolder(d, 'f1', 'Uno');
    d = addFolder(d, 'f2', 'Dos', 'f1');
    expect(moveFolder(d, 'f1', 'f2')).toBe(d);
    expect(moveFolder(d, 'f1', 'f1')).toBe(d);
    const m = moveFolder(d, 'f2', undefined);
    expect(m.folders!.find((f) => f.id === 'f2')!.parentId).toBeUndefined();
  });
  it('moveToNewFolder crea la carpeta con la selección', () => {
    let d = mk([shape('a'), shape('b')]);
    d = moveToNewFolder(d, ['a', 'b'], 'n', '  ');
    expect(d.folders).toEqual([{ id: 'n', name: 'Carpeta' }]);
    expect(folderLayerIds(d, 'n')).toEqual(['a', 'b']);
  });
});

describe('visibilidad y bloqueo heredados', () => {
  it('ocultar una carpeta oculta sus capas y subcarpetas', () => {
    let d = mk([shape('a'), shape('b'), shape('c')]);
    d = addFolder(d, 'f1', 'Uno');
    d = addFolder(d, 'f2', 'Dos', 'f1');
    d = moveLayersToFolder(d, ['a'], 'f2');
    d = moveLayersToFolder(d, ['b'], 'f1');
    d = setFolderFlag(d, 'f1', 'visible', false);
    expect(d.layers.map((l) => l.visible)).toEqual([false, false, true]);
    expect(folderHidden(d.folders!, 'f2')).toBe(true);
    d = setFolderFlag(d, 'f1', 'visible', true);
    expect(d.layers.every((l) => l.visible)).toBe(true);
    expect(d.folders!.every((f) => f.visible === undefined)).toBe(true);
  });
  it('bloquear y que una capa nueva adopte el estado de la carpeta', () => {
    let d = mk([shape('a'), shape('b')]);
    d = addFolder(d, 'f', 'F');
    d = setFolderFlag(d, 'f', 'locked', true);
    d = setFolderFlag(d, 'f', 'visible', false);
    d = moveLayersToFolder(d, ['b'], 'f');
    const b = d.layers.find((l) => l.id === 'b')!;
    expect(b.locked).toBe(true);
    expect(b.visible).toBe(false);
    expect(d.layers.find((l) => l.id === 'a')!.locked).toBe(false);
  });
});

describe('arrastrar capa sobre capa', () => {
  it('queda justo encima del destino y en su carpeta', () => {
    let d = mk([shape('a'), shape('b'), shape('c')]);
    d = addFolder(d, 'f', 'F');
    d = moveLayersToFolder(d, ['a'], 'f');
    const r = dropLayerOnLayer(d, 'c', 'a');
    expect(r.layers.map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect(r.layers.find((l) => l.id === 'c')!.folderId).toBe('f');
  });
});

describe('normalizar', () => {
  it('limpia referencias rotas y ciclos', () => {
    const d = mk([shape('a', { folderId: 'fantasma' }), shape('b', { folderId: 'x' })], [
      { id: 'x', name: '', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' },
      { id: 'z', name: 'Z', parentId: 'nada' },
    ]);
    const n = normalizeFolders(d);
    expect(n.layers[0].folderId).toBeUndefined();
    expect(n.layers[1].folderId).toBe('x');
    expect(n.folders!.find((f) => f.id === 'z')!.parentId).toBeUndefined();
    const ids = n.folders!.filter((f) => f.parentId).length;
    expect(ids).toBeLessThan(2); // el ciclo se rompe
    expect(n.folders!.find((f) => f.id === 'x')!.name).toBe('Carpeta');
    expect(() => buildTree(n)).not.toThrow();
  });
  it('un documento antiguo queda igual', () => {
    const d = mk([shape('a')]);
    const n = normalizeFolders(d);
    expect('folders' in n).toBe(false);
    expect(n.layers).toEqual(d.layers);
  });
});

describe('búsqueda y filtros', () => {
  const d = (() => {
    let doc = mk([
      text('t1', 'Hola Mundo'),
      shape('s1', { visible: false }),
      shape('s2', { locked: true, name: 'Botón' }),
      text('t2', 'Adiós'),
    ]);
    doc = addFolder(doc, 'f', 'F');
    doc = moveLayersToFolder(doc, ['t2', 's2'], 'f');
    return doc;
  })();
  it('busca por texto sin acentos ni mayúsculas, de arriba abajo', () => {
    expect(filterLayers(d, { query: 'adios', kinds: [] }).map((l) => l.id)).toEqual(['t2']);
    expect(filterLayers(d, { query: 'BOTON', kinds: [] }).map((l) => l.id)).toEqual(['s2']);
    expect(filterLayers(d, { query: '', kinds: [] }).map((l) => l.id)).toEqual(['t2', 's2', 's1', 't1']);
  });
  it('filtra por tipo, oculta, bloqueada y carpeta', () => {
    expect(filterLayers(d, { query: '', kinds: ['text'] }).map((l) => l.id)).toEqual(['t2', 't1']);
    expect(filterLayers(d, { query: '', kinds: ['hidden'] }).map((l) => l.id)).toEqual(['s1']);
    expect(filterLayers(d, { query: '', kinds: ['locked'] }).map((l) => l.id)).toEqual(['s2']);
    expect(filterLayers(d, { query: '', kinds: ['shape', 'hidden'], folderId: 'f' }).map((l) => l.id)).toEqual(['s2']);
    expect(isFilterActive({ query: ' ', kinds: [] })).toBe(false);
    expect(isFilterActive({ query: '', kinds: [], folderId: 'f' })).toBe(true);
  });
});
