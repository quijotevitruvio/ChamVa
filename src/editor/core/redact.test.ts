import { describe, expect, it } from 'vitest';
import { blackBar, blockSize, blurRegion, pixelate, redactRegion, type PixelBuf } from './redact';

function img(w: number, h: number, f: (x: number, y: number) => number[]): PixelBuf {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}
const px = (b: PixelBuf, x: number, y: number) => Array.from(b.data.slice((y * b.width + x) * 4, (y * b.width + x) * 4 + 4));

// Tablero de 1 píxel blanco/negro.
const checker = (w: number, h: number) =>
  img(w, h, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));

describe('pixelate', () => {
  it('cada bloque queda de un solo color (el medio)', () => {
    const b = checker(8, 8);
    pixelate(b, { x: 0, y: 0, w: 8, h: 8 }, 'rect', 4);
    const c = px(b, 1, 1);
    expect(px(b, 3, 2)).toEqual(c);
    expect(c[0]).toBeGreaterThan(100);
    expect(c[0]).toBeLessThan(155);
  });
  it('no toca fuera de la zona', () => {
    const b = checker(8, 8);
    const before = px(b, 7, 7);
    pixelate(b, { x: 0, y: 0, w: 4, h: 4 }, 'rect', 4);
    expect(px(b, 7, 7)).toEqual(before);
  });
  it('elipse deja intactas las esquinas de la zona', () => {
    const b = checker(10, 10);
    const corner = px(b, 0, 0);
    pixelate(b, { x: 0, y: 0, w: 10, h: 10 }, 'ellipse', 10);
    expect(px(b, 0, 0)).toEqual(corner);
    expect(px(b, 5, 5)[0]).toBeGreaterThan(100);
  });
  it('zona fuera de la imagen no falla', () => {
    const b = checker(4, 4);
    expect(() => pixelate(b, { x: 50, y: 50, w: 5, h: 5 }, 'rect', 2)).not.toThrow();
  });
});

describe('blurRegion', () => {
  it('suaviza el tablero hacia gris medio', () => {
    const b = checker(32, 32);
    blurRegion(b, { x: 4, y: 4, w: 24, h: 24 }, 'rect', 4);
    const v = px(b, 16, 16)[0];
    expect(v).toBeGreaterThan(90);
    expect(v).toBeLessThan(165);
    expect(px(b, 0, 0)).toEqual([0, 0, 0, 255]); // fuera de la zona intacto
  });
  it('mantiene la opacidad de una imagen opaca', () => {
    const b = checker(16, 16);
    blurRegion(b, { x: 0, y: 0, w: 16, h: 16 }, 'rect', 3);
    expect(px(b, 8, 8)[3]).toBe(255);
  });
});

describe('blackBar / redactRegion', () => {
  it('tapa con negro opaco', () => {
    const b = img(6, 6, () => [200, 100, 50, 255]);
    blackBar(b, { x: 1, y: 1, w: 3, h: 3 }, 'rect');
    expect(px(b, 2, 2)).toEqual([0, 0, 0, 255]);
    expect(px(b, 0, 0)).toEqual([200, 100, 50, 255]);
  });
  it('redactRegion despacha por modo', () => {
    const b = img(6, 6, () => [200, 100, 50, 255]);
    redactRegion(b, { x: 0, y: 0, w: 6, h: 6 }, 'rect', 'bar', 50);
    expect(px(b, 3, 3)).toEqual([0, 0, 0, 255]);
  });
  it('el bloque crece con la intensidad', () => {
    expect(blockSize(80, 2000)).toBeGreaterThan(blockSize(10, 2000));
  });
});
