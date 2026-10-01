import { describe, expect, it } from 'vitest';
import { DITHER_ALPHA, grainActive, grainMaxAlpha, mulberry32, noiseCells, normalizeGrain } from './grain';

describe('grain', () => {
  it('el PRNG es determinista', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('noiseCells: mismo seed, mismos datos; alfa acotado', () => {
    const x = noiseCells(16, 0.2, 7);
    const y = noiseCells(16, 0.2, 7);
    expect(Array.from(x)).toEqual(Array.from(y));
    expect(Array.from(noiseCells(16, 0.2, 8))).not.toEqual(Array.from(x));
    let max = 0;
    for (let i = 3; i < x.length; i += 4) max = Math.max(max, x[i]);
    expect(max).toBeLessThanOrEqual(Math.round(0.2 * 255));
    expect(max).toBeGreaterThan(0);
    // solo blanco o negro
    for (let i = 0; i < x.length; i += 4) expect([0, 255]).toContain(x[i]);
  });
  it('el tramado es muy sutil', () => {
    const d = noiseCells(32, DITHER_ALPHA, 1);
    for (let i = 3; i < d.length; i += 4) expect(d[i]).toBeLessThanOrEqual(6);
  });
  it('normaliza cantidad y tamaño', () => {
    expect(normalizeGrain({ amount: 300, size: 99 })).toEqual({ amount: 100, size: 6 });
    expect(normalizeGrain({ amount: -5, size: 0 })).toEqual({ amount: 0, size: 1 });
    expect(normalizeGrain(undefined)).toEqual({ amount: 30, size: 1 });
  });
  it('actividad y opacidad máxima', () => {
    expect(grainActive(undefined)).toBe(false);
    expect(grainActive({ amount: 0, size: 1 })).toBe(false);
    expect(grainActive({ amount: 10, size: 1 })).toBe(true);
    expect(grainMaxAlpha(100)).toBeCloseTo(0.5);
  });
});
