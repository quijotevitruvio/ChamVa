import { describe, expect, it } from 'vitest';
import {
  applyChromatic,
  applyGlitch,
  applyGlow,
  applyGradientMap,
  applyHalftone,
  applyImageEffects,
  applyMotionBlur,
  applyRedEye,
  applySketch,
  applySkinSmooth,
  applyTiltShift,
  averageColor,
  hasImageFx,
  skinMask,
} from './imageEffects';

type Px = { data: Uint8ClampedArray; width: number; height: number };

function make(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Px {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}
const noisy = () => make(48, 40, (x, y) => [(x * 5 + y * 3) % 256, (x * 7) % 256, (y * 11 + x) % 256, 255]);
const copy = (img: Px): Px => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

describe('identidad con fuerza 0', () => {
  it('sin efectos no cambia nada', () => {
    const a = noisy();
    const b = copy(a);
    applyImageEffects(b, {});
    applyImageEffects(b, { tiltAmount: 0, glitch: 0, htSize: 0, sketchAmount: 0, skin: 0, glowAmount: 0, gradMapAmount: 0 });
    expect(b.data).toEqual(a.data);
    expect(hasImageFx({ tiltAmount: 0, redEyes: [] })).toBe(false);
  });
  it('cada función suelta con 0 es identidad', () => {
    const a = noisy();
    const b = copy(a);
    applyTiltShift(b, { tiltAmount: 0 });
    applyMotionBlur(b, { motionDist: 0 });
    applyChromatic(b, 0, 0);
    applyGlitch(b, 0, 5);
    applyHalftone(b, 0, 45, false);
    applySketch(b, 'comic', 0);
    applySkinSmooth(b, 0);
    applyGlow(b, 0, 40);
    applyGradientMap(b, undefined, 100);
    expect(b.data).toEqual(a.data);
  });
});

describe('glitch', () => {
  it('es determinista por semilla y cambia con otra', () => {
    const a = copy(noisy());
    const b = copy(noisy());
    const c = copy(noisy());
    applyGlitch(a, 60, 11);
    applyGlitch(b, 60, 11);
    applyGlitch(c, 60, 12);
    expect(a.data).toEqual(b.data);
    expect(c.data).not.toEqual(a.data);
    expect(a.data).not.toEqual(noisy().data);
  });
});

describe('halftone', () => {
  it('monocromo: solo luminancia (gris) y conserva el alfa', () => {
    const img = make(40, 40, (x) => [x * 6, 100, 30, x === 3 ? 0 : 255]);
    applyHalftone(img, 12, 45, false);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue;
      expect(img.data[i]).toBe(img.data[i + 1]);
      expect(img.data[i]).toBe(img.data[i + 2]);
    }
    expect(img.data[3 * 4 + 3]).toBe(0);
  });
});

describe('ojos rojos', () => {
  it('reduce solo R dominante dentro del círculo', () => {
    const img = make(20, 20, () => [200, 60, 60, 255]);
    img.data.set([60, 200, 60, 255], (10 * 20 + 11) * 4); // verde dentro del círculo
    applyRedEye(img, { redEyes: [{ x: 0.5, y: 0.5, r: 0.25 }] });
    const o = (10 * 20 + 10) * 4;
    expect(img.data[o]).toBeLessThan(90);
    expect(img.data[o + 1]).toBe(60);
    expect(img.data[o + 2]).toBe(60);
    const g = (10 * 20 + 11) * 4;
    expect([...img.data.slice(g, g + 4)]).toEqual([60, 200, 60, 255]);
    expect([...img.data.slice(0, 4)]).toEqual([200, 60, 60, 255]); // fuera del círculo
  });
});

describe('suavizar piel', () => {
  it('detecta piel y no azules/verdes', () => {
    expect(skinMask(224, 172, 140)).toBeGreaterThan(0.9);
    expect(skinMask(30, 60, 220)).toBe(0);
    expect(skinMask(20, 200, 40)).toBe(0);
  });
  it('no toca píxeles que no son piel', () => {
    const img = make(32, 32, (x) => (x < 16 ? [224, 172 + (x % 3) * 4, 140, 255] : [30, 60, 220, 255]));
    const before = copy(img);
    applySkinSmooth(img, 100);
    for (let y = 0; y < 32; y++)
      for (let x = 16; x < 32; x++) {
        const o = (y * 32 + x) * 4;
        expect([...img.data.slice(o, o + 4)]).toEqual([...before.data.slice(o, o + 4)]);
      }
  });
  it('suaviza el ruido sobre la piel', () => {
    const img = make(32, 32, (x, y) => [224, 172 + ((x + y) % 2) * 10, 140, 255]);
    applySkinSmooth(img, 100);
    const a = (16 * 32 + 16) * 4 + 1;
    const b = (16 * 32 + 17) * 4 + 1;
    expect(Math.abs(img.data[a] - img.data[b])).toBeLessThan(10);
  });
});

describe('mapa de degradado', () => {
  it('conserva el orden de luminancia', () => {
    const img = make(16, 1, (x) => [x * 16, x * 16, x * 16, 255]);
    applyGradientMap(img, { angle: 0, stops: [{ offset: 0, color: '#0b1a3a' }, { offset: 1, color: '#f5d9a8' }] }, 100);
    let prev = -1;
    for (let x = 0; x < 16; x++) {
      const o = x * 4;
      const l = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });
  it('negro y blanco caen en los extremos', () => {
    const img = make(2, 1, (x) => (x ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    applyGradientMap(img, { angle: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] }, 100);
    expect([...img.data.slice(0, 3)]).toEqual([255, 0, 0]);
    expect([...img.data.slice(4, 7)]).toEqual([0, 0, 255]);
  });
});

describe('otros', () => {
  it('tilt-shift deja la banda central intacta y desenfoca los bordes', () => {
    const img = make(60, 60, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const before = copy(img);
    applyTiltShift(img, { tiltAmount: 100, tiltPos: 0.5, tiltWidth: 0.3 });
    const mid = (30 * 60 + 30) * 4;
    expect(img.data[mid]).toBe(before.data[mid]);
    const top = (1 * 60 + 30) * 4;
    expect(img.data[top]).not.toBe(before.data[top]);
  });
  it('aberración cromática desplaza R y B y deja G', () => {
    const img = make(40, 40, (x) => [x * 6, x * 6, x * 6, 255]);
    const before = copy(img);
    applyChromatic(img, 100, 0);
    const o = (5 * 40 + 20) * 4;
    expect(img.data[o + 1]).toBe(before.data[o + 1]);
    expect(img.data[o]).not.toBe(before.data[o]);
  });
  it('resplandor ilumina y no oscurece', () => {
    const img = make(30, 30, (x) => (x < 15 ? [250, 250, 250, 255] : [20, 20, 20, 255]));
    const before = copy(img);
    applyGlow(img, 100, 50);
    for (let i = 0; i < img.data.length; i += 4) expect(img.data[i]).toBeGreaterThanOrEqual(before.data[i]);
    const o = (10 * 30 + 17) * 4;
    expect(img.data[o]).toBeGreaterThan(before.data[o]);
  });
  it('color medio', () => {
    const img = make(8, 8, () => [200, 40, 40, 255]);
    expect(averageColor(img)).toBe('#c82828');
  });
  it('lápiz y cómic producen cambios y mantienen alfa', () => {
    for (const mode of ['pencil', 'comic'] as const) {
      const img = copy(noisy());
      applySketch(img, mode, 100);
      expect(img.data).not.toEqual(noisy().data);
      expect(img.data[3]).toBe(255);
    }
  });
});
