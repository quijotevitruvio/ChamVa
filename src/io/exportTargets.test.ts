import { describe, expect, it } from 'vitest';
import { alphaBounds, bisectQuality, buildScaleSpecs, parseWidths, scaleLabel } from './exportTargets';

describe('buildScaleSpecs / parseWidths', () => {
  it('principal primero, sin repetir', () => {
    const s = buildScaleSpecs(1000, 2, [1, 2, 3], [500, 2000]);
    expect(s.map((x) => x.label)).toEqual(['2x', '1x', '3x', '500w']); // 2000 px = 2x ya está
  });
  it('etiquetas', () => {
    expect(scaleLabel(0.5)).toBe('0.5x');
    expect(scaleLabel(2)).toBe('2x');
  });
  it('parseWidths filtra y limita', () => {
    expect(parseWidths('800, 1600 ; 800 abc 5 99999')).toEqual([800, 1600]);
    expect(parseWidths('')).toEqual([]);
  });
});

// Peso simulado: crece con la calidad.
const model = (q: number) => Math.round(1000 + 99000 * q * q);

describe('bisectQuality', () => {
  it('si cabe a calidad máxima, la devuelve con 1 prueba', async () => {
    const r = await bisectQuality(async (q) => model(q), 200_000);
    expect(r).toMatchObject({ quality: 1, fits: true, evals: 1 });
  });
  it('encuentra la mayor calidad que cabe en ≤ 8 pruebas', async () => {
    const limit = 40_000;
    const r = await bisectQuality(async (q) => model(q), limit);
    expect(r.fits).toBe(true);
    expect(r.evals).toBeLessThanOrEqual(8);
    expect(model(r.quality)).toBeLessThanOrEqual(limit);
    // y no se queda lejos del óptimo teórico
    const ideal = Math.sqrt((limit - 1000) / 99000);
    expect(ideal - r.quality).toBeLessThan(0.02);
  });
  it('avisa si ni con la calidad mínima cabe', async () => {
    const r = await bisectQuality(async (q) => model(q), 500);
    expect(r.fits).toBe(false);
    expect(r.quality).toBe(0.05);
    expect(r.evals).toBe(2);
  });
  it('se puede cancelar', async () => {
    let calls = 0;
    const r = await bisectQuality(
      async (q) => {
        calls++;
        return model(q);
      },
      40_000,
      { isCancelled: () => calls >= 3 },
    );
    expect(r.cancelled).toBe(true);
    expect(calls).toBe(3);
  });
});

describe('alphaBounds', () => {
  it('caja de los píxeles no transparentes', () => {
    const w = 5;
    const h = 4;
    const d = new Uint8ClampedArray(w * h * 4);
    d[(1 * w + 2) * 4 + 3] = 255;
    d[(2 * w + 3) * 4 + 3] = 10;
    expect(alphaBounds(d, w, h)).toEqual({ x: 2, y: 1, w: 2, h: 2 });
  });
  it('vacío = null', () => {
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});
