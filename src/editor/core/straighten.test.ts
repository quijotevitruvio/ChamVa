import { describe, expect, it } from 'vitest';
import { angleToLevel, largestInscribedRect, rotatedBounds } from './straighten';

describe('angleToLevel', () => {
  it('línea ya horizontal = 0', () => {
    expect(angleToLevel({ x: 0, y: 5 }, { x: 100, y: 5 })).toBeCloseTo(0);
  });
  it('línea que baja a la derecha pide girar en sentido antihorario (negativo)', () => {
    expect(angleToLevel({ x: 0, y: 0 }, { x: 100, y: 10 })).toBeCloseTo(-5.71, 1);
  });
  it('no depende del orden de los puntos', () => {
    const a = angleToLevel({ x: 0, y: 0 }, { x: 100, y: 10 });
    const b = angleToLevel({ x: 100, y: 10 }, { x: 0, y: 0 });
    expect(a).toBeCloseTo(b);
  });
});

describe('largestInscribedRect', () => {
  it('sin giro devuelve todo', () => {
    expect(largestInscribedRect(300, 200, 0)).toEqual({ w: 300, h: 200 });
  });
  it('un giro pequeño reduce el rectángulo pero lo deja dentro', () => {
    const r = largestInscribedRect(300, 200, 5);
    expect(r.w).toBeLessThan(300);
    expect(r.h).toBeLessThan(200);
    const rad = (5 * Math.PI) / 180;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const x = (sx * r.w) / 2;
      const y = (sy * r.h) / 2;
      const px = x * Math.cos(rad) - y * Math.sin(rad);
      const py = x * Math.sin(rad) + y * Math.cos(rad);
      expect(Math.abs(px)).toBeLessThanOrEqual(150 + 1e-6);
      expect(Math.abs(py)).toBeLessThanOrEqual(100 + 1e-6);
    }
  });
  it('es simétrico en el signo del ángulo', () => {
    const a = largestInscribedRect(400, 300, 12);
    const b = largestInscribedRect(400, 300, -12);
    expect(a.w).toBeCloseTo(b.w);
    expect(a.h).toBeCloseTo(b.h);
  });
  it('cuadrado a 45° da lado / raíz de 2', () => {
    const r = largestInscribedRect(100, 100, 45);
    expect(r.w).toBeCloseTo(70.71, 1);
    expect(r.h).toBeCloseTo(70.71, 1);
  });
});

describe('rotatedBounds', () => {
  it('a 90° intercambia', () => {
    const b = rotatedBounds(300, 200, 90);
    expect(b.w).toBeCloseTo(200);
    expect(b.h).toBeCloseTo(300);
  });
});
