import { describe, expect, it } from 'vitest';
import { applyRetention, autoVersionDue, enforceBudget, retainedTimestamps } from './autoVersions';

const MIN = 60_000;
const DAY = 86_400_000;
// Mediodía local, para que ±horas no cambien de día.
const NOW = new Date(2026, 5, 20, 12, 0, 0).getTime();

describe('autoVersionDue', () => {
  it('cada 10 minutos', () => {
    expect(autoVersionDue(0, NOW)).toBe(true);
    expect(autoVersionDue(NOW - 9 * MIN, NOW)).toBe(false);
    expect(autoVersionDue(NOW - 10 * MIN, NOW)).toBe(true);
  });
});

describe('retainedTimestamps', () => {
  it('conserva las 10 últimas', () => {
    const stamps = Array.from({ length: 15 }, (_, i) => NOW - i * MIN); // todas hoy
    const keep = retainedTimestamps(stamps, NOW);
    // 10 recientes + la más nueva de hoy (ya incluida)
    expect(keep.size).toBe(10);
    expect(keep.has(NOW)).toBe(true);
    expect(keep.has(NOW - 14 * MIN)).toBe(false);
  });

  it('añade la más nueva de cada día de los últimos 7', () => {
    const today = Array.from({ length: 12 }, (_, i) => NOW - i * MIN);
    const old = [1, 2, 3, 6].flatMap((d) => [NOW - d * DAY, NOW - d * DAY - 3_600_000]);
    const tooOld = [NOW - 8 * DAY, NOW - 9 * DAY];
    const keep = retainedTimestamps([...today, ...old, ...tooOld], NOW);
    for (const d of [1, 2, 3, 6]) {
      expect(keep.has(NOW - d * DAY)).toBe(true); // la más nueva del día
      expect(keep.has(NOW - d * DAY - 3_600_000)).toBe(false); // la otra del mismo día
    }
    for (const t of tooOld) expect(keep.has(t)).toBe(false);
    expect(keep.size).toBe(10 + 4);
  });

  it('lista vacía o corta', () => {
    expect(retainedTimestamps([], NOW).size).toBe(0);
    expect(retainedTimestamps([NOW - 20 * DAY], NOW).size).toBe(1); // entra entre las 10 recientes
  });
});

describe('applyRetention', () => {
  it('devuelve la lista ordenada, más nueva primero', () => {
    const list = [{ ts: NOW - 5 * MIN }, { ts: NOW }, { ts: NOW - 2 * DAY }];
    expect(applyRetention(list, NOW).map((x) => x.ts)).toEqual([NOW, NOW - 5 * MIN, NOW - 2 * DAY]);
  });
});

describe('enforceBudget', () => {
  const v = (id: string, ts: number, size: number) => ({ id, ts, size, name: '', pageIndex: 0, pages: [] });
  it('no toca nada bajo el límite', () => {
    const s = { a: [v('1', 1, 10)] };
    expect(enforceBudget(s, 100)).toBe(s);
  });
  it('descarta las más antiguas de todos los diseños', () => {
    const s = { a: [v('a2', 5, 40), v('a1', 1, 40)], b: [v('b1', 3, 40)] };
    const out = enforceBudget(s, 80);
    expect(out.a.map((x) => x.id)).toEqual(['a2']);
    expect(out.b.map((x) => x.id)).toEqual(['b1']);
    expect(Object.keys(enforceBudget({ a: [v('a1', 1, 40)] }, 10))).toEqual([]);
  });
});
