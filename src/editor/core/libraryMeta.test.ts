import { describe, it, expect } from 'vitest';
import {
  filterDesigns, purgeExpired, trashDaysLeft, allTags, mergeFolders, resizeDocTo, uniqueTargets,
  TRASH_DAYS, type LibraryDesign,
} from './libraryMeta';
import type { Doc } from './types';

const DAY = 86_400_000;
const mk = (id: string, extra: Partial<LibraryDesign> = {}): LibraryDesign => ({
  id, name: `Diseño ${id}`, updatedAt: 1, ...extra,
});

describe('papelera', () => {
  const now = 100 * DAY;
  it('purga a los 30 días y conserva el resto', () => {
    const list = [mk('a'), mk('b', { deletedAt: now - 29 * DAY }), mk('c', { deletedAt: now - 31 * DAY })];
    expect(purgeExpired(list, now).map((d) => d.id)).toEqual(['a', 'b']);
  });
  it('días restantes', () => {
    expect(trashDaysLeft(mk('x', { deletedAt: now }), now)).toBe(TRASH_DAYS);
    expect(trashDaysLeft(mk('x', { deletedAt: now - 29.5 * DAY }), now)).toBe(1);
    expect(trashDaysLeft(mk('x', { deletedAt: now - 40 * DAY }), now)).toBe(0);
  });
});

describe('filtros de la biblioteca', () => {
  const list = [
    mk('1', { folder: 'Clientes', tags: ['Boda', 'rosa'] }),
    mk('2', { folder: 'Clientes' }),
    mk('3', { tags: ['boda'] }),
    mk('4', { deletedAt: 5, folder: 'Clientes' }),
  ];
  it('todos excluye papelera; carpeta y papelera filtran', () => {
    expect(filterDesigns(list, { kind: 'all' }).map((d) => d.id)).toEqual(['1', '2', '3']);
    expect(filterDesigns(list, { kind: 'folder', folder: 'Clientes' }).map((d) => d.id)).toEqual(['1', '2']);
    expect(filterDesigns(list, { kind: 'trash' }).map((d) => d.id)).toEqual(['4']);
  });
  it('texto y etiqueta', () => {
    expect(filterDesigns(list, { kind: 'all' }, 'cliente').map((d) => d.id)).toEqual(['1', '2']);
    expect(filterDesigns(list, { kind: 'all' }, '', 'BODA').map((d) => d.id)).toEqual(['1', '3']);
  });
  it('etiquetas y carpetas', () => {
    expect(allTags(list)).toEqual(['Boda', 'rosa']);
    expect(mergeFolders(['Vacía'], list)).toEqual(['Clientes', 'Vacía']);
  });
});

describe('redimensionar a varios formatos', () => {
  const cur = {
    id: 'd', name: 'Mi', width: 1000, height: 1000, version: 1,
    background: { type: 'solid', color: '#fff' },
    layers: [{ id: 'l', type: 'shape', x: 100, y: 200, scaleX: 1, scaleY: 1 }],
  } as unknown as Doc;
  it('mantiene proporción y centra', () => {
    const r = resizeDocTo(cur, { width: 2000, height: 1000, label: 'Banner' }, () => 'nuevo');
    expect(r.id).toBe('nuevo');
    expect(r.layers[0].x).toBe(100 + 500);
    expect(r.layers[0].scaleX).toBe(1);
    const r2 = resizeDocTo(cur, { width: 500, height: 500, label: 'S' }, () => 'n2');
    expect(r2.layers[0].x).toBe(50);
    expect(r2.layers[0].scaleX).toBe(0.5);
    expect(cur.layers[0].x).toBe(100); // no muta el original
  });
  it('descarta el tamaño actual y los repetidos', () => {
    const s = [
      { width: 1000, height: 1000, label: 'a' },
      { width: 1080, height: 1920, label: 'b' },
      { width: 1080, height: 1920, label: 'c' },
    ];
    expect(uniqueTargets(s, cur).map((x) => x.label)).toEqual(['b']);
  });
});
