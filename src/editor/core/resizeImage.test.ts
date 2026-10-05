import { describe, expect, it } from 'vitest';
import { dimFromHeight, dimFromPercent, dimFromWidth, dimProblem, layerGeometryAfterResize } from './resizeImage';

describe('redimensionar imagen: tamaños', () => {
  const src = { w: 4000, h: 3000 };
  it('con candado el alto sigue la proporción', () => {
    expect(dimFromWidth(2000, src, true, src)).toEqual({ w: 2000, h: 1500 });
    expect(dimFromHeight(750, src, true, src)).toEqual({ w: 1000, h: 750 });
  });
  it('sin candado solo cambia el lado editado', () => {
    expect(dimFromWidth(2000, src, false, { w: 4000, h: 1234 })).toEqual({ w: 2000, h: 1234 });
  });
  it('porcentaje y redondeo mínimo 1 px', () => {
    expect(dimFromPercent(50, src)).toEqual({ w: 2000, h: 1500 });
    expect(dimFromWidth(0, src, true, src).w).toBe(1);
    expect(dimFromWidth(NaN, src, true, src).w).toBe(1);
  });
  it('límites del canvas', () => {
    expect(dimProblem({ w: 4000, h: 3000 })).toBeNull();
    expect(dimProblem({ w: 20000, h: 100 })).toMatch(/16384/);
    expect(dimProblem({ w: 15000, h: 15000 })).toMatch(/megap/);
  });
});

describe('redimensionar imagen: la capa no cambia de tamaño aparente', () => {
  it('natural × escala se conserva en ambos ejes', () => {
    const layer = { naturalWidth: 800, naturalHeight: 600, scaleX: 0.5, scaleY: 0.5 };
    for (const dst of [{ w: 2000, h: 1500 }, { w: 500, h: 375 }, { w: 1000, h: 300 }]) {
      const g = layerGeometryAfterResize(layer, { w: 4000, h: 3000 }, dst);
      expect(g.naturalWidth * g.scaleX).toBeCloseTo(800 * 0.5, 9);
      expect(g.naturalHeight * g.scaleY).toBeCloseTo(600 * 0.5, 9);
    }
  });
  it('con recorte (natural = trozo visible) mantiene la proporción de la fuente', () => {
    const layer = { naturalWidth: 400, naturalHeight: 300, scaleX: 1, scaleY: 1 }; // trozo de una fuente de 4000×3000
    const g = layerGeometryAfterResize(layer, { w: 4000, h: 3000 }, { w: 2000, h: 1500 });
    expect(g.naturalWidth).toBe(200);
    expect(g.naturalHeight).toBe(150);
    expect(g.scaleX).toBe(2);
  });
});
