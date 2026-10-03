import { describe, expect, it } from 'vitest';
import { applyEase, bounceOut, cubicBezier, sanitizeBezier, smoothstep } from './ease';

describe('curvas de aceleración', () => {
  it('todas empiezan en 0 y acaban en 1', () => {
    for (const id of ['linear', 'smooth', 'in', 'out', 'bounce', 'bezier'] as const) {
      expect(applyEase(id, 0)).toBeCloseTo(0, 6);
      expect(applyEase(id, 1)).toBeCloseTo(1, 6);
    }
  });
  it('lineal y suave a mitad', () => {
    expect(applyEase('linear', 0.5)).toBe(0.5);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 9);
    expect(applyEase('smooth', 0.25)).toBeCloseTo(0.15625, 6); // 3p² − 2p³
    expect(applyEase('in', 0.5)).toBeLessThan(0.5);
    expect(applyEase('out', 0.5)).toBeGreaterThan(0.5);
  });
  it('fuera de 0..1 se limita', () => {
    expect(applyEase('linear', -3)).toBe(0);
    expect(applyEase('smooth', 7)).toBe(1);
  });
  it('rebote: llega a 1, rebota (no es monótona) y nunca pasa de 1', () => {
    expect(bounceOut(1 / 2.75)).toBeCloseTo(1, 6);
    let max = 0;
    let dips = 0;
    let prev = 0;
    for (let i = 0; i <= 200; i++) {
      const v = bounceOut(i / 200);
      max = Math.max(max, v);
      if (v < prev - 1e-9) dips++;
      prev = v;
    }
    expect(max).toBeLessThanOrEqual(1);
    expect(dips).toBeGreaterThan(5); // hay tramos que bajan: rebota
  });
  it('bézier cúbica como CSS', () => {
    // la diagonal (manijas sobre la recta) es la identidad
    for (const x of [0, 0.1, 0.37, 0.5, 0.9, 1]) expect(cubicBezier([1 / 3, 1 / 3, 2 / 3, 2 / 3], x)).toBeCloseTo(x, 5);
    // ease-in-out simétrica: 0,5 → 0,5
    expect(cubicBezier([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 5);
    // valor conocido de CSS ease (0.25,0.1,0.25,1) a x=0.5 ≈ 0.8024
    expect(cubicBezier([0.25, 0.1, 0.25, 1], 0.5)).toBeCloseTo(0.8024, 3);
    // monótona con manijas en 0..1
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const v = cubicBezier([0.2, 0, 0.1, 1], i / 50);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    // con y fuera de 0..1 se puede pasar (anticipación / rebote suave)
    expect(cubicBezier([0.3, 1.6, 0.6, 1], 0.4)).toBeGreaterThan(1);
  });
  it('sanea bézier guardada', () => {
    expect(sanitizeBezier([2, 5, -1, 0])).toEqual([1, 2, 0, 0]);
    expect(sanitizeBezier([1, 2, 3])).toBeUndefined();
    expect(sanitizeBezier('x')).toBeUndefined();
  });
});
