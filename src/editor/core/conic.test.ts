import { describe, expect, it } from 'vitest';
import { colorAtOffset, conicCenter, conicSectors, conicStartRad, isConic } from './conic';
import type { Gradient } from './types';

const g: Gradient = {
  kind: 'conic',
  angle: 90,
  stops: [
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#ffffff' },
  ],
};

describe('conic', () => {
  it('detecta el tipo', () => {
    expect(isConic(g)).toBe(true);
    expect(isConic({ ...g, kind: 'radial' })).toBe(false);
    expect(isConic(undefined)).toBe(false);
  });
  it('centro por defecto y personalizado', () => {
    expect(conicCenter(g, 200, 100)).toEqual({ x: 100, y: 50 });
    expect(conicCenter({ ...g, cx: 0.25, cy: 1.5 }, 200, 100)).toEqual({ x: 50, y: 100 });
  });
  it('ángulo de inicio en radianes', () => {
    expect(conicStartRad(g)).toBeCloseTo(Math.PI / 2);
  });
  it('interpola las paradas y mantiene los extremos', () => {
    expect(colorAtOffset(g, 0)).toBe('#000000');
    expect(colorAtOffset(g, 1)).toBe('#ffffff');
    expect(colorAtOffset(g, 0.5)).toBe('#808080');
    const g2: Gradient = { ...g, stops: [{ offset: 0.5, color: '#ff0000' }, { offset: 0.8, color: '#0000ff' }] };
    expect(colorAtOffset(g2, 0.1)).toBe('#ff0000');
    expect(colorAtOffset(g2, 0.95)).toBe('#0000ff');
  });
  it('los sectores cubren la vuelta completa desde el ángulo de inicio', () => {
    const s = conicSectors(g, 90);
    expect(s).toHaveLength(90);
    expect(s[0].a0).toBeCloseTo(Math.PI / 2);
    expect(s[89].a1).toBeGreaterThanOrEqual(Math.PI / 2 + Math.PI * 2);
    expect(s[0].color).not.toBe(s[89].color);
  });
});
