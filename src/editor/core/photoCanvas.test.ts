import { describe, expect, it } from 'vitest';
import { photoCanvas } from './photoCanvas';

describe('photoCanvas', () => {
  it('1080×1350 queda igual', () => {
    expect(photoCanvas(1080, 1350)).toEqual({ canvasW: 1080, canvasH: 1350, scale: 1, clamped: false });
  });
  it('4000×3000 sin cambio', () => {
    expect(photoCanvas(4000, 3000)).toEqual({ canvasW: 4000, canvasH: 3000, scale: 1, clamped: false });
  });
  it('8000 exacto no se reduce', () => {
    expect(photoCanvas(8000, 100).clamped).toBe(false);
  });
  it('12000×8000 se reduce a 8000×5333', () => {
    const r = photoCanvas(12000, 8000);
    expect(r.clamped).toBe(true);
    expect(r.canvasW).toBe(8000);
    expect(r.canvasH).toBe(5333);
    expect(r.scale).toBeCloseTo(2 / 3, 6);
  });
  it('vertical enorme reduce por el lado mayor', () => {
    const r = photoCanvas(3000, 16000);
    expect(r.canvasH).toBe(8000);
    expect(r.canvasW).toBe(1500);
    expect(r.scale).toBe(0.5);
  });
  it('8×8 sube a 16×16 con escala 1', () => {
    expect(photoCanvas(8, 8)).toEqual({ canvasW: 16, canvasH: 16, scale: 1, clamped: false });
  });
  it('panorámica 20000×10: ancho 8000 y alto mínimo 16', () => {
    const r = photoCanvas(20000, 10);
    expect(r.canvasW).toBe(8000);
    expect(r.canvasH).toBe(16);
    expect(r.clamped).toBe(true);
  });
  it('nunca sale de 16–8000', () => {
    for (const [w, h] of [[1, 1], [1, 9000], [9000, 1], [7999, 8001], [0, 0]]) {
      const r = photoCanvas(w, h);
      expect(r.canvasW).toBeGreaterThanOrEqual(16);
      expect(r.canvasH).toBeLessThanOrEqual(8000);
    }
  });
});
