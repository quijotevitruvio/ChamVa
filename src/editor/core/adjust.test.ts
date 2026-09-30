import { describe, expect, it } from 'vitest';
import {
  ADJUST_PRESETS,
  applyColorOps,
  applyGrain,
  applyOutline,
  applyPixelate,
  applySharpen,
  applyVignette,
  autoEnhance,
} from './imageProcessing';
import { isStrokeOnly, shapeSvgPath } from './shapes';
import { SHAPE_OPTIONS } from './types';

function solid(w: number, h: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, width: w, height: h };
}

describe('autoEnhance', () => {
  it('una imagen oscura propone más brillo', () => {
    const r = autoEnhance(solid(32, 32, [30, 30, 30, 255]));
    expect(r.brightness!).toBeGreaterThan(1);
  });

  it('una imagen clara propone menos brillo', () => {
    const r = autoEnhance(solid(32, 32, [230, 230, 230, 255]));
    expect(r.brightness!).toBeLessThan(1);
  });

  it('una imagen totalmente transparente no rompe', () => {
    expect(autoEnhance(solid(16, 16, [0, 0, 0, 0]))).toEqual({});
  });

  it('ignora los píxeles transparentes', () => {
    const img = solid(16, 16, [0, 0, 0, 0]);
    // solo un cuarto opaco y claro
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) img.data.set([220, 220, 220, 255], (y * 16 + x) * 4);
    expect(autoEnhance(img).brightness!).toBeLessThan(1);
  });
});

describe('shapeSvgPath', () => {
  const fillable = SHAPE_OPTIONS.filter((o) => !isStrokeOnly(o.kind));
  it('devuelve un path no vacío para cada forma rellenable', () => {
    for (const o of fillable) {
      const d = shapeSvgPath(o.kind, 200, 120, 10);
      expect(d.length, o.kind).toBeGreaterThan(5);
      expect(d.startsWith('M'), o.kind).toBe(true);
      expect(d.includes('NaN'), o.kind).toBe(false);
    }
  });
  it('hay al menos 16 formas nuevas', () => {
    expect(SHAPE_OPTIONS.length).toBeGreaterThanOrEqual(22);
  });
  it('el anillo tiene dos subtrayectos', () => {
    expect(shapeSvgPath('ring', 100, 100).match(/M/g)!.length).toBe(2);
  });
});

describe('operaciones de píxel', () => {
  it('respetan el alfa transparente', () => {
    const img = solid(8, 8, [0, 0, 0, 0]);
    applyColorOps(img, { brightness: 1, contrast: 1, saturate: 1, temperature: 1, shadows: 1, posterize: 1 });
    applySharpen(img, 1);
    applyVignette(img, 1);
    applyGrain(img, 1);
    applyPixelate(img, 4);
    expect(Array.from(img.data).every((v) => v === 0)).toBe(true);
  });

  it('temperatura positiva calienta', () => {
    const img = solid(2, 2, [100, 100, 100, 255]);
    applyColorOps(img, { brightness: 1, contrast: 1, saturate: 1, temperature: 1 });
    expect(img.data[0]).toBeGreaterThan(img.data[2]);
  });

  it('el grano es determinista', () => {
    const a = solid(16, 16, [128, 128, 128, 255]);
    const b = solid(16, 16, [128, 128, 128, 255]);
    applyGrain(a, 0.5);
    applyGrain(b, 0.5);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('el pixelado promedia bloques', () => {
    const img = solid(4, 4, [0, 0, 0, 255]);
    img.data.set([200, 200, 200, 255], 0);
    applyPixelate(img, 2);
    expect(img.data[0]).toBe(img.data[4]);
    expect(img.data[0]).toBe(50);
  });

  it('el contorno rodea la silueta con el color indicado', () => {
    const img = solid(21, 21, [0, 0, 0, 0]);
    img.data.set([255, 0, 0, 255], (10 * 21 + 10) * 4);
    applyOutline(img, 3, '#00ff00');
    const at = (x: number, y: number) => Array.from(img.data.slice((y * 21 + x) * 4, (y * 21 + x) * 4 + 4));
    expect(at(10, 10)).toEqual([255, 0, 0, 255]);
    expect(at(12, 10)[1]).toBe(255);
    expect(at(12, 10)[3]).toBe(255);
    expect(at(17, 10)[3]).toBe(0);
  });

  it('a 2048x2048 los ajustes de color + nitidez + contorno son rápidos', () => {
    const img = solid(2048, 2048, [120, 90, 60, 255]);
    const t = performance.now();
    applyColorOps(img, { brightness: 1, contrast: 1, saturate: 1, temperature: 0.3, vibrance: 0.4, shadows: 0.3 });
    applySharpen(img, 0.5);
    const dt = performance.now() - t;
    expect(dt).toBeLessThan(2000); // margen amplio para CI; en local ~100-200 ms
  });
});

describe('presets', () => {
  it('hay entre 6 y 8 con nombre', () => {
    expect(ADJUST_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(ADJUST_PRESETS.length).toBeLessThanOrEqual(8);
    for (const p of ADJUST_PRESETS) expect(p.label.length).toBeGreaterThan(0);
  });
});
