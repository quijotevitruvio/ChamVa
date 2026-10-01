import { describe, expect, it } from 'vitest';
import { fitSize, isImageFile, outputName } from './batchConvert';

describe('batchConvert', () => {
  it('fitSize conserva proporción y no agranda', () => {
    expect(fitSize(4000, 3000, 1000, 0)).toEqual({ w: 1000, h: 750 });
    expect(fitSize(4000, 3000, 0, 600)).toEqual({ w: 800, h: 600 });
    expect(fitSize(4000, 3000, 1000, 600)).toEqual({ w: 800, h: 600 });
    expect(fitSize(400, 300, 1000, 1000)).toEqual({ w: 400, h: 300 });
    expect(fitSize(400, 300, 0, 0)).toEqual({ w: 400, h: 300 });
    expect(fitSize(10000, 1, 100, 0)).toEqual({ w: 100, h: 1 });
    expect(fitSize(0, 0, 10, 10)).toEqual({ w: 1, h: 1 });
  });
  it('outputName cambia la extensión y evita duplicados', () => {
    const used = new Set<string>();
    expect(outputName('C:\\fotos\\a.final.jpeg', 'webp', used)).toBe('a.final.webp');
    expect(outputName('a.final.png', 'webp', used)).toBe('a.final (2).webp');
    expect(outputName('b', 'jpeg', used)).toBe('b.jpg');
  });
  it('isImageFile', () => {
    expect(isImageFile({ name: 'x.PNG', type: '' })).toBe(true);
    expect(isImageFile({ name: 'x.txt', type: 'text/plain' })).toBe(false);
    expect(isImageFile({ name: 'x', type: 'image/avif' })).toBe(true);
  });
});
