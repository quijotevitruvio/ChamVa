import { describe, expect, it } from 'vitest';
import { MOCKUP_FRAMES, fitRect, tiltQuad } from './mockups';
import { isConvexQuad } from './perspective';

describe('tiltQuad', () => {
  it('sin ángulo es el rectángulo original', () => {
    const t = tiltQuad(400, 300, 0, 0);
    expect(t.width).toBeCloseTo(400);
    expect(t.height).toBeCloseTo(300);
    expect(t.quad[0]).toEqual({ x: 0, y: 0 });
    expect(t.quad[2].x).toBeCloseTo(400);
    expect(t.quad[2].y).toBeCloseTo(300);
  });
  it('un giro lateral acorta el ancho y hace un lado más alto que el otro', () => {
    const t = tiltQuad(400, 300, 30, 0);
    expect(t.width).toBeLessThan(400);
    const left = t.quad[3].y - t.quad[0].y;
    const right = t.quad[2].y - t.quad[1].y;
    expect(left).not.toBeCloseTo(right, 1);
    expect(isConvexQuad(t.quad)).toBe(true);
  });
  it('el giro contrario es el espejo', () => {
    const a = tiltQuad(400, 300, 25, 0);
    const b = tiltQuad(400, 300, -25, 0);
    expect(a.quad[3].y - a.quad[0].y).toBeCloseTo(b.quad[2].y - b.quad[1].y);
    expect(a.width).toBeCloseTo(b.width);
  });
  it('todas las esquinas caen dentro del lienzo calculado', () => {
    const t = tiltQuad(500, 800, 20, 15, 2.2, 10);
    for (const p of t.quad) {
      expect(p.x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(t.width - 10 + 1e-6);
      expect(p.y).toBeLessThanOrEqual(t.height - 10 + 1e-6);
    }
  });
});

describe('marcos', () => {
  it('hay al menos 4 y el hueco cabe dentro del marco', () => {
    expect(MOCKUP_FRAMES.length).toBeGreaterThanOrEqual(4);
    for (const f of MOCKUP_FRAMES) {
      expect(f.screen.x).toBeGreaterThanOrEqual(0);
      expect(f.screen.y).toBeGreaterThanOrEqual(0);
      expect(f.screen.x + f.screen.w).toBeLessThanOrEqual(f.w);
      expect(f.screen.y + f.screen.h).toBeLessThanOrEqual(f.h);
    }
  });
});

describe('fitRect', () => {
  const dst = { x: 10, y: 20, w: 200, h: 100 };
  it('cover llena el hueco y desborda en un eje', () => {
    const r = fitRect(100, 100, dst, 'cover');
    expect(r.w).toBeCloseTo(200);
    expect(r.h).toBeCloseTo(200);
    expect(r.y).toBeCloseTo(-30);
  });
  it('contain cabe entero y queda centrado', () => {
    const r = fitRect(100, 100, dst, 'contain');
    expect(r.h).toBeCloseTo(100);
    expect(r.x).toBeCloseTo(60);
  });
});
