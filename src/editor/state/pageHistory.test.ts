import { describe, expect, it } from 'vitest';
import type { Doc } from '../core/types';
import { PAGE_HIST_MAX, dropPage, restore, stash, swap, type PageHist } from './pageHistory';

const page = (id: string, v = 0): Doc =>
  ({ id, name: id, width: 10, height: 10, background: { type: 'transparent' }, layers: [], version: v }) as unknown as Doc;

describe('pageHistory', () => {
  it('restaura solo si la página es el MISMO objeto que se aparcó', () => {
    const a = page('a');
    const h = stash({}, a, [page('a', 1)], []);
    expect(restore(h, a).past.length).toBe(1);
    expect(restore(h, { ...a }).past).toEqual([]); // copia igual pero otro objeto: se descarta
    expect(restore(h, page('b')).past).toEqual([]);
  });

  it('sin pasos no guarda nada (y quita lo que hubiera)', () => {
    const a = page('a');
    const h = stash({}, a, [page('a', 1)], []);
    expect(stash(h, a, [], [])).toEqual({});
    const empty: PageHist = {};
    expect(stash(empty, a, [], [])).toBe(empty);
  });

  it('conserva también los pasos de rehacer', () => {
    const a = page('a');
    const h = stash({}, a, [], [page('a', 2)]);
    expect(restore(h, a).future.length).toBe(1);
  });

  it('LRU: la 13.ª página expulsa a la usada hace más tiempo', () => {
    let h: PageHist = {};
    const pages = Array.from({ length: PAGE_HIST_MAX + 1 }, (_, i) => page(`p${i}`));
    pages.slice(0, PAGE_HIST_MAX).forEach((p) => (h = stash(h, p, [page(p.id, 1)], [])));
    expect(Object.keys(h).length).toBe(PAGE_HIST_MAX);
    h = stash(h, pages[0], [page('p0', 9)], []); // p0 vuelve a usarse: ahora la más vieja es p1
    h = stash(h, pages[PAGE_HIST_MAX], [page('x', 1)], []);
    expect(Object.keys(h).length).toBe(PAGE_HIST_MAX);
    expect(h.p1).toBeUndefined();
    expect(h.p0).toBeDefined();
    expect(h[`p${PAGE_HIST_MAX}`]).toBeDefined();
  });

  it('ids con forma de número no alteran el orden LRU', () => {
    let h: PageHist = {};
    h = stash(h, page('5'), [page('5', 1)], [], 2);
    h = stash(h, page('1'), [page('1', 1)], [], 2);
    h = stash(h, page('9'), [page('9', 1)], [], 2);
    expect(Object.keys(h).sort()).toEqual(['1', '9']);
  });

  it('swap: aparca la que sale, recupera la que entra y la saca del mapa', () => {
    const a = page('a');
    const b = page('b');
    let h = stash({}, b, [page('b', 1)], []);
    const r = swap(h, { doc: a, past: [page('a', 1), page('a', 2)], future: [] }, b);
    expect(r.past.length).toBe(1);
    expect(r.pageHist.b).toBeUndefined();
    expect(r.pageHist.a.past.length).toBe(2);
    h = r.pageHist;
    const back = swap(h, { doc: b, past: r.past, future: [] }, a);
    expect(back.past.length).toBe(2);
  });

  it('swap a la misma página (mismo objeto) no toca nada', () => {
    const a = page('a');
    const past = [page('a', 1)];
    const h: PageHist = {};
    const r = swap(h, { doc: a, past, future: [] }, a);
    expect(r.pageHist).toBe(h);
    expect(r.past).toBe(past);
  });

  it('swap a otra versión de la misma página: vacío, pero conserva lo aparcado por si vuelve', () => {
    const a1 = page('a', 1);
    const a2 = page('a', 2); // p. ej. «restaurar versión» reusa el id de página
    const r = swap({}, { doc: a1, past: [page('a', 0)], future: [] }, a2);
    expect(r.past).toEqual([]);
    expect(restore(r.pageHist, a1).past.length).toBe(1);
  });

  it('dropPage no copia si no hay nada que quitar', () => {
    const h: PageHist = {};
    expect(dropPage(h, 'x')).toBe(h);
  });
});
