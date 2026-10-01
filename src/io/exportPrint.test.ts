import { describe, expect, it } from 'vitest';
import {
  bleedPageGeometry,
  bookletAll,
  bookletSheets,
  clampBleedMm,
  cornerMarks,
  fitInCell,
  mmToPx,
  nUpLayout,
  pxToMm,
  stepRepeat,
} from './exportPrint';

describe('unidades', () => {
  it('300 dpi: 1 pulgada = 25,4 mm', () => {
    expect(pxToMm(300, 300)).toBeCloseTo(25.4, 6);
    expect(mmToPx(25.4, 96)).toBeCloseTo(96, 6);
    expect(mmToPx(pxToMm(1234, 300), 300)).toBeCloseTo(1234, 6);
  });
  it('el sangrado se limita a 0–10 mm', () => {
    expect(clampBleedMm(-3)).toBe(0);
    expect(clampBleedMm(40)).toBe(10);
    expect(clampBleedMm(3)).toBe(3);
    expect(clampBleedMm(NaN)).toBe(0);
  });
});

describe('marcas de corte', () => {
  it('8 segmentos, todos fuera del sangrado', () => {
    const trim = { x: 20, y: 20, w: 100, h: 50 };
    const marks = cornerMarks(trim, 4, 4);
    expect(marks).toHaveLength(8);
    for (const m of marks) {
      const len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
      expect(len).toBeCloseTo(4, 6);
      // ningún extremo cae dentro del rectángulo del sangrado (trim ± 3)
      for (const [x, y] of [[m.x1, m.y1], [m.x2, m.y2]]) {
        const inside = x > 17 && x < 123 && y > 17 && y < 73;
        expect(inside).toBe(false);
      }
    }
  });
  it('la página con sangrado y marcas suma sangrado + zona de marcas', () => {
    const g = bleedPageGeometry(100, 50, 3, true, true);
    expect(g.pageW).toBeCloseTo(100 + 2 * (3 + 7), 6);
    expect(g.trim.x).toBeCloseTo(10, 6);
    expect(g.bleedRect.w).toBeCloseTo(106, 6);
    expect(g.marks).toHaveLength(8);
    expect(g.registration).toHaveLength(4);
    const plain = bleedPageGeometry(100, 50, 0, false, false);
    expect(plain.pageW).toBe(100);
    expect(plain.marks).toHaveLength(0);
  });
});

describe('cuadernillo', () => {
  it('8 páginas: orden de pliegos a doble cara', () => {
    const s = bookletSheets(8);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ front: [7, 0], back: [1, 6] });
    expect(s[1]).toEqual({ front: [5, 2], back: [3, 4] });
  });
  it('4 páginas: una hoja', () => {
    expect(bookletSheets(4)).toEqual([{ front: [3, 0], back: [1, 2] }]);
  });
  it('rellena con páginas en blanco si faltan', () => {
    const s = bookletSheets(8, 5);
    const all = s.flatMap((x) => [...x.front, ...x.back]);
    expect(all.filter((v) => v === null)).toHaveLength(3);
    expect(all.filter((v) => v !== null).sort()).toEqual([0, 1, 2, 3, 4]);
  });
  it('varios cuadernillos: cada página sale una sola vez', () => {
    const s = bookletAll(10, 4);
    const all = s.flatMap((x) => [...x.front, ...x.back]).filter((v) => v !== null) as number[];
    expect(all.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(s).toHaveLength(3);
  });
});

describe('n por hoja', () => {
  it('da celdas del número pedido, dentro de la hoja y sin solaparse', () => {
    for (const n of [2, 4, 6, 9] as const) {
      const l = nUpLayout(n, 'a4', 5, 8, 1, true);
      expect(l.cells).toHaveLength(n);
      expect(l.cols * l.rows).toBe(n);
      for (const c of l.cells) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(l.pageW + 1e-6);
        expect(c.y + c.h).toBeLessThanOrEqual(l.pageH + 1e-6);
      }
    }
  });
  it('con marcas fuerza separación mínima de 6 mm', () => {
    const l = nUpLayout(4, 'a4', 0, 0, 1, true);
    expect(l.cells[1].x - (l.cells[0].x + l.cells[0].w)).toBeCloseTo(6, 6);
  });
  it('elige la hoja horizontal para páginas apaisadas en 2-up', () => {
    const l = nUpLayout(2, 'a4', 0, 0, 16 / 9, false);
    expect(l.pageW).toBeLessThan(l.pageH); // 2 apaisadas apiladas en vertical
    const v = nUpLayout(2, 'a4', 0, 0, 0.7, false);
    expect(v.pageW).toBeGreaterThan(v.pageH); // 2 altas lado a lado
  });
  it('fitInCell conserva la proporción', () => {
    const r = fitInCell({ x: 0, y: 0, w: 100, h: 100 }, 2);
    expect(r.w / r.h).toBeCloseTo(2, 6);
    expect(r.y).toBeCloseTo(25, 6);
  });
});

describe('plancha de pegatinas', () => {
  it('85×55 mm en A4: 2 columnas × 5 filas con medianil 3', () => {
    const s = stepRepeat(85, 55, 'a4', 5, 3, false);
    expect(s.count).toBe(s.cols * s.rows);
    expect(s.count).toBe(10);
    expect(s.cells).toHaveLength(10);
  });
  it('pieza más grande que la hoja: 0 piezas', () => {
    expect(stepRepeat(500, 500, 'a4', 5, 3, false).count).toBe(0);
  });
});
