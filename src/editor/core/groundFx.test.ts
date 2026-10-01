import { describe, expect, it } from 'vitest';
import { shadowBounds, shadowMatrix } from './groundFx';

const cs = { angle: 90, length: 1, blur: 0, opacity: 0.5, color: '#000' };

describe('shadowMatrix', () => {
  it('la base de la capa queda fija (y = h)', () => {
    const m = shadowMatrix(100, 200, cs);
    // punto de la base (50, 200) → no se mueve
    expect(m.a * 50 + m.c * 200 + m.e).toBeCloseTo(50);
    expect(m.b * 50 + m.d * 200 + m.f).toBeCloseTo(200);
  });
  it('la parte alta de la capa cae hacia el suelo (más abajo que la base) con ángulo 90', () => {
    const m = shadowMatrix(100, 200, cs);
    const y = m.b * 50 + m.d * 0 + m.f; // punto de la cabeza
    expect(y).toBeGreaterThan(200);
  });
  it('con ángulo -90 la sombra queda detrás (por encima de la base)', () => {
    const m = shadowMatrix(100, 200, { ...cs, angle: -90 });
    expect(m.b * 50 + m.d * 0 + m.f).toBeLessThan(200);
  });
  it('con ángulo 0 la cabeza se desplaza lateralmente', () => {
    const m = shadowMatrix(100, 200, { ...cs, angle: 0 });
    expect(m.a * 50 + m.c * 0 + m.e).toBeGreaterThan(50 + 100);
  });
});

describe('shadowBounds', () => {
  it('el desenfoque ensancha la caja', () => {
    const a = shadowBounds(100, 100, cs);
    const b = shadowBounds(100, 100, { ...cs, blur: 20 });
    expect(b.w).toBeGreaterThan(a.w);
    expect(b.h).toBeGreaterThan(a.h);
  });
});
