import { describe, expect, it } from 'vitest';
import { computeSnap, gridStepFor, snapAxis, snapToStep } from './snap';

describe('gridStepFor', () => {
  it('elige el menor paso con >= 18 px en pantalla', () => {
    expect(gridStepFor(1)).toBe(20);
    expect(gridStepFor(0.5)).toBe(50);
    expect(gridStepFor(4)).toBe(5);
    expect(gridStepFor(0.001)).toBe(1000);
  });
});

describe('snapAxis / snapToStep', () => {
  it('imanta dentro del umbral y no fuera', () => {
    expect(snapAxis([103], [100], 6)).toEqual({ delta: -3, line: 100 });
    expect(snapAxis([110], [100], 6)).toBeNull();
  });
  it('redondea al paso', () => {
    expect(snapToStep(34, 20)).toBe(40);
    expect(snapToStep(29, 20)).toBe(20);
  });
});

describe('computeSnap', () => {
  const base = { targetsX: [], targetsY: [], scale: 1 };
  it('imanta a una guía del usuario con el umbral 6/escala', () => {
    const r = computeSnap({ ...base, box: { x: 203, y: 0, width: 50, height: 50 }, guidesX: [200] });
    expect(r.dx).toBe(-3);
    expect(r.vx).toEqual([200]);
    const far = computeSnap({ ...base, scale: 0.5, box: { x: 215, y: 0, width: 50, height: 50 }, guidesX: [200] });
    expect(far.dx).toBe(0); // umbral = 12
    const near = computeSnap({ ...base, scale: 0.5, box: { x: 210, y: 0, width: 50, height: 50 }, guidesX: [200] });
    expect(near.dx).toBe(-10);
  });
  it('imanta a la cuadrícula con la esquina superior izquierda', () => {
    const r = computeSnap({ ...base, box: { x: 34, y: 47, width: 50, height: 50 }, gridStep: 20 });
    expect(r.dx).toBe(6);
    expect(r.dy).toBe(-7);
    expect(r.vx).toEqual([]);
  });
  it('una guía inteligente gana a la cuadrícula en ese eje', () => {
    const r = computeSnap({
      ...base,
      targetsX: [100],
      box: { x: 98, y: 47, width: 50, height: 50 },
      gridStep: 20,
    });
    expect(r.dx).toBe(2); // x con la guía, no con la cuadrícula (100 también)
    expect(r.vx).toEqual([100]);
    expect(r.dy).toBe(-7); // eje y: cuadrícula
    const g = computeSnap({
      ...base,
      targetsX: [113],
      box: { x: 111, y: 0, width: 50, height: 50 },
      gridStep: 20,
    });
    expect(g.dx).toBe(2); // 113 y no 120
  });
});
