import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  harmonies,
  contrastRatio,
  readableOn,
  extractPalette,
} from './colorTools';

describe('conversiones', () => {
  it('rgb<->hex', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe('#ff8000');
  });
  it('rgb<->hsl ida y vuelta', () => {
    for (const hex of ['#ff0000', '#12ab34', '#808080', '#0000ff', '#fedcba']) {
      const back = rgbToHex(hslToRgb(rgbToHsl(hexToRgb(hex)!)));
      expect(back).toBe(hex);
    }
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, l: 0.5 });
  });
});

describe('harmonies', () => {
  it('complementario del rojo es cian', () => {
    expect(harmonies('#ff0000').complementario[1]).toBe('#00ffff');
  });
  it('triada del rojo', () => {
    expect(harmonies('#ff0000').triada).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });
  it('tamaños de familia y formato', () => {
    const h = harmonies('#3366cc');
    expect(h.analogos).toHaveLength(3);
    expect(h.tetrada).toHaveLength(4);
    expect(h.complementarioDividido).toHaveLength(3);
    expect(h.monocromatico).toHaveLength(5);
    for (const fam of Object.values(h))
      for (const c of fam) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('contraste', () => {
  it('negro sobre blanco = 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
  it('readableOn', () => {
    expect(readableOn('#ffffff')).toBe('#000000');
    expect(readableOn('#000000')).toBe('#ffffff');
    expect(readableOn('#0033aa')).toBe('#ffffff');
    expect(readableOn('#ffee88')).toBe('#000000');
  });
});

describe('extractPalette', () => {
  const make = (w: number, h: number, f: (x: number, y: number) => number[]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
    return { data, width: w, height: h };
  };
  it('ordena por frecuencia y separa colores', () => {
    // 60% rojo, 30% verde, 10% azul
    const img = make(100, 10, (x) =>
      x < 60 ? [255, 0, 0, 255] : x < 90 ? [0, 255, 0, 255] : [0, 0, 255, 255],
    );
    const p = extractPalette(img, 3);
    expect(p).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });
  it('ignora transparentes', () => {
    const img = make(10, 10, (x) => (x < 5 ? [10, 20, 30, 0] : [200, 100, 50, 255]));
    expect(extractPalette(img, 4)).toEqual(['#c86432']);
  });
  it('vacío si todo transparente y sin duplicados', () => {
    expect(extractPalette(make(4, 4, () => [0, 0, 0, 0]))).toEqual([]);
    const img = make(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2, 255]);
    const p = extractPalette(img, 6);
    expect(p.length).toBeGreaterThan(0);
    expect(new Set(p).size).toBe(p.length);
  });
});
