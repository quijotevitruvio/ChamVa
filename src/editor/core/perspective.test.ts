import { describe, expect, it } from 'vitest';
import {
  applyH,
  homography,
  invertMat3,
  isConvexQuad,
  quadOutputSize,
  warpPerspective,
  warpToQuad,
  type PixelBuf,
} from './perspective';

const rect = (w: number, h: number) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

function solid(w: number, h: number, f: (x: number, y: number) => number[]): PixelBuf {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}

describe('homography', () => {
  it('rectángulo → mismo rectángulo es la identidad', () => {
    const H = homography(rect(100, 50), rect(100, 50))!;
    const p = applyH(H, 30, 20);
    expect(p.x).toBeCloseTo(30);
    expect(p.y).toBeCloseTo(20);
  });
  it('mapea las 4 esquinas a sus destinos', () => {
    const dst = [
      { x: 10, y: 5 },
      { x: 90, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 50 },
    ];
    const H = homography(rect(100, 50), dst)!;
    rect(100, 50).forEach((s, i) => {
      const p = applyH(H, s.x, s.y);
      expect(p.x).toBeCloseTo(dst[i].x, 6);
      expect(p.y).toBeCloseTo(dst[i].y, 6);
    });
  });
  it('degenerada devuelve null', () => {
    const line = [0, 1, 2, 3].map((i) => ({ x: i, y: i }));
    expect(homography(rect(10, 10), line)).toBeNull();
  });
  it('la inversa deshace la transformación', () => {
    const dst = [
      { x: 10, y: 5 },
      { x: 90, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 50 },
    ];
    const H = homography(rect(100, 50), dst)!;
    const Hi = invertMat3(H)!;
    const f = applyH(H, 40, 25);
    const q = applyH(Hi, f.x, f.y);
    expect(q.x).toBeCloseTo(40);
    expect(q.y).toBeCloseTo(25);
  });
});

describe('warpPerspective', () => {
  it('con el cuadrilátero completo devuelve la misma imagen', () => {
    const src = solid(8, 6, (x, y) => [x * 30, y * 40, 7, 255]);
    const out = warpPerspective(src, rect(8, 6), 8, 6)!;
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });
  it('recorta una subregión y la agranda', () => {
    const src = solid(10, 10, (x) => (x < 5 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const quad = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    const out = warpPerspective(src, quad, 20, 20)!;
    // toda la salida viene de la mitad roja
    expect(out.data[(10 * 20 + 10) * 4]).toBe(255);
    expect(out.data[(10 * 20 + 15) * 4 + 2]).toBe(0);
  });
  it('warpToQuad deja transparente lo que queda fuera', () => {
    const src = solid(10, 10, () => [10, 20, 30, 255]);
    const quad = [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ];
    const out = warpToQuad(src, quad, 20, 20)!;
    expect(out.data[(1 * 20 + 1) * 4 + 3]).toBe(0);
    expect(out.data[(10 * 20 + 10) * 4 + 3]).toBe(255);
  });
});

describe('cuadriláteros', () => {
  it('tamaño de salida y convexidad', () => {
    expect(quadOutputSize(rect(80, 40))).toEqual({ w: 80, h: 40 });
    expect(isConvexQuad(rect(80, 40))).toBe(true);
    const bow = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(isConvexQuad(bow)).toBe(false);
  });
});
