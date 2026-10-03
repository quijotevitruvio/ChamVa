import { describe, expect, it } from 'vitest';
import { mostVisibleIndex, pageBox, stackScale, stillPixelScale } from './stackLayout';

describe('stackScale', () => {
  const area = { width: 1048, height: 836 };
  it('usa la página más grande y es común', () => {
    const s = stackScale([{ width: 1080, height: 1080 }, { width: 500, height: 500 }], area, 1);
    expect(s).toBeCloseTo((836 - 48 - 36) / 1080, 5);
  });
  it('no pasa de 1 y multiplica por el zoom', () => {
    expect(stackScale([{ width: 100, height: 100 }], area, 1)).toBe(1);
    expect(stackScale([{ width: 100, height: 100 }], area, 2)).toBe(2);
  });
  it('sin páginas devuelve el zoom', () => {
    expect(stackScale([], area, 1.5)).toBe(1.5);
  });
  it('no cambia al reordenar', () => {
    const a = { width: 800, height: 600 };
    const b = { width: 1080, height: 1920 };
    expect(stackScale([a, b], area, 1)).toBe(stackScale([b, a], area, 1));
  });
});

describe('mostVisibleIndex', () => {
  const rects = [
    { top: 0, bottom: 100 },
    { top: 120, bottom: 220 },
    { top: 240, bottom: 340 },
  ];
  it('elige la de mayor solape', () => {
    expect(mostVisibleIndex(rects, 60, 260)).toBe(1);
    expect(mostVisibleIndex(rects, 0, 90)).toBe(0);
  });
  it('empate: la más cercana al centro', () => {
    expect(mostVisibleIndex([{ top: 0, bottom: 100 }, { top: 130, bottom: 200 }], 50, 180)).toBe(1); // solape 50 y 50; el centro de 1 está más cerca
  });
  it('empate exacto: la primera', () => {
    expect(mostVisibleIndex([{ top: 0, bottom: 100 }, { top: 0, bottom: 100 }], 0, 100)).toBe(0);
  });
  it('ninguna visible', () => {
    expect(mostVisibleIndex(rects, 500, 600)).toBe(-1);
    expect(mostVisibleIndex([], 0, 100)).toBe(-1);
  });
});

describe('pageBox y stillPixelScale', () => {
  it('reserva el hueco a la escala', () => {
    expect(pageBox({ width: 1080, height: 540 }, 0.5)).toEqual({ w: 540, h: 270 });
  });
  it('limita los píxeles del canvas', () => {
    expect(stillPixelScale({ width: 1000, height: 1000 }, 1, 2)).toBe(2);
    expect(stillPixelScale({ width: 10000, height: 1000 }, 1, 2)).toBeCloseTo(0.4096, 4);
    expect(stillPixelScale({ width: 1000, height: 1000 }, 1, 0.5)).toBe(1);
  });
});
