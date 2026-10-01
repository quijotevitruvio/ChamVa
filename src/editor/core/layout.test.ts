import { describe, expect, it } from 'vitest';
import type { Doc } from './types';
import { columnBands, layoutSnapTargets, normalizeLayoutFields } from './layout';

describe('maquetación', () => {
  it('reparte columnas con margen y medianil', () => {
    const b = columnBands(1000, { count: 4, gutter: 20, margin: 40 });
    expect(b).toHaveLength(4);
    expect(b[0].x).toBe(40);
    expect(b[0].w).toBe(215); // (1000-80-60)/4
    expect(b[3].x + b[3].w).toBeCloseTo(960);
    expect(b[1].x - (b[0].x + b[0].w)).toBe(20);
  });
  it('sin espacio no devuelve bandas', () => {
    expect(columnBands(100, { count: 10, gutter: 50, margin: 0 })).toEqual([]);
  });
  it('objetivos de imán: márgenes y bordes de columna', () => {
    const t = layoutSnapTargets({
      width: 1000,
      height: 500,
      margins: { top: 30, right: 50, bottom: 0, left: 40 },
      columns: { count: 2, gutter: 20, margin: 40 },
    });
    expect(t.y).toEqual([30]);
    expect(t.x).toContain(40);
    expect(t.x).toContain(950);
    expect(t.x).toContain(490); // fin de columna 1
    expect(t.x).toContain(510); // inicio de columna 2
  });
  it('sin ayudas no hay objetivos', () => {
    expect(layoutSnapTargets({ width: 10, height: 10 })).toEqual({ x: [], y: [] });
  });
  it('normaliza campos externos', () => {
    const d = {
      margins: { top: -5, right: 'x', bottom: 0, left: 0 },
      bleed: 'a',
      columns: { count: 99, gutter: -1, margin: 3 },
      notes: [{ id: 'a', x: 1, y: 2 }, null, { x: 1 }],
      speakerNotes: '',
    } as unknown as Doc;
    normalizeLayoutFields(d);
    expect(d.margins).toBeUndefined();
    expect(d.bleed).toBeUndefined();
    expect(d.columns).toEqual({ count: 24, gutter: 0, margin: 3 });
    expect(d.notes).toEqual([{ id: 'a', x: 1, y: 2, text: '', color: '#ffffff' }]);
    expect(d.speakerNotes).toBeUndefined();
  });
});
