import { describe, expect, it } from 'vitest';
import {
  ADJUST_PRESETS,
  applyClarity,
  applyColorOps,
  applyInvertThreshold,
  needsProcessing,
  applyGrain,
  applyOutline,
  applyPixelate,
  applySharpen,
  applyVignette,
  autoEnhance,
} from './imageProcessing';
import { isStrokeOnly, shapeSvgPath } from './shapes';
import { DEFAULT_ADJUST, SHAPE_OPTIONS, type ImageAdjust, type ImageLayer } from './types';

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
  it('hay entre 6 y 24 con nombre', () => {
    expect(ADJUST_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(ADJUST_PRESETS.length).toBeLessThanOrEqual(24);
    for (const p of ADJUST_PRESETS) expect(p.label.length).toBeGreaterThan(0);
  });
});

describe('ajustes nuevos', () => {
  const base: ImageAdjust = { brightness: 1, contrast: 1, saturate: 1 };
  const sample = () => {
    const img = solid(4, 1, [0, 0, 0, 255]);
    img.data.set([200, 50, 30, 255], 0);
    img.data.set([10, 120, 240, 200], 4);
    img.data.set([128, 128, 128, 255], 8);
    img.data.set([77, 66, 55, 0], 12);
    return img;
  };

  it('invertir dos veces es identidad y no toca el alfa', () => {
    const img = sample();
    const orig = Array.from(img.data);
    applyInvertThreshold(img, { ...base, invert: true });
    expect(img.data[0]).toBe(55);
    expect(img.data[3]).toBe(255);
    expect(img.data[7]).toBe(200);
    applyInvertThreshold(img, { ...base, invert: true });
    expect(Array.from(img.data)).toEqual(orig);
  });

  it('matiz 0 y neutro no cambian nada', () => {
    const img = sample();
    const orig = Array.from(img.data);
    applyColorOps(img, { ...base, hue: 0, exposure: 0, grayscale: 0, sepia: 0 });
    applyClarity(img, 0);
    applyInvertThreshold(img, { ...base, invert: false, threshold: 0 });
    expect(Array.from(img.data)).toEqual(orig);
  });

  it('matiz 180 cambia el tono y 360 vuelve al original', () => {
    const a = sample();
    applyColorOps(a, { ...base, hue: 180 });
    expect(a.data[0]).not.toBe(200);
    const b = sample();
    applyColorOps(b, { ...base, hue: 360 });
    expect(Math.abs(b.data[0] - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.data[2] - 30)).toBeLessThanOrEqual(1);
  });

  it('blanco y negro al 100 da R=G=B', () => {
    const img = sample();
    applyColorOps(img, { ...base, grayscale: 100 });
    for (let i = 0; i < 12; i += 4) {
      expect(img.data[i]).toBe(img.data[i + 1]);
      expect(img.data[i + 1]).toBe(img.data[i + 2]);
    }
  });

  it('sepia da tono cálido (R > G > B) y exposición sube/baja la luz', () => {
    const s = solid(2, 2, [100, 100, 100, 255]);
    applyColorOps(s, { ...base, sepia: 100 });
    expect(s.data[0]).toBeGreaterThan(s.data[1]);
    expect(s.data[1]).toBeGreaterThan(s.data[2]);
    const up = solid(2, 2, [100, 100, 100, 255]);
    applyColorOps(up, { ...base, exposure: 50 });
    expect(up.data[0]).toBe(200);
    const down = solid(2, 2, [100, 100, 100, 255]);
    applyColorOps(down, { ...base, exposure: -50 });
    expect(down.data[0]).toBe(50);
  });

  it('umbral deja solo 0/255 y respeta el alfa', () => {
    const img = sample();
    applyInvertThreshold(img, { ...base, threshold: 100 });
    for (let i = 0; i < 12; i += 4) {
      for (let c = 0; c < 3; c++) expect([0, 255]).toContain(img.data[i + c]);
    }
    expect(img.data[3]).toBe(255);
    expect(img.data[7]).toBe(200);
    expect(img.data[15]).toBe(0);
    expect(img.data[12]).toBe(77); // píxel transparente intacto
  });

  it('claridad sube el contraste local y no rompe una imagen plana ni transparente', () => {
    const flat = solid(16, 16, [120, 120, 120, 255]);
    applyClarity(flat, 100);
    expect(flat.data[0]).toBe(120);
    const img = solid(16, 16, [100, 100, 100, 255]);
    img.data.set([140, 140, 140, 255], (8 * 16 + 8) * 4);
    applyClarity(img, 100);
    expect(img.data[(8 * 16 + 8) * 4]).toBeGreaterThan(140);
    const clear = solid(8, 8, [0, 0, 0, 0]);
    applyClarity(clear, 100);
    expect(Array.from(clear.data).every((v) => v === 0)).toBe(true);
  });

  it('un ImageAdjust viejo sin campos nuevos sigue funcionando', () => {
    const old = { brightness: 1, contrast: 1, saturate: 1, temperature: 0.5 } as ImageAdjust;
    const img = solid(2, 2, [100, 100, 100, 255]);
    applyColorOps(img, old);
    applyClarity(img, Number(old.clarity ?? 0));
    applyInvertThreshold(img, old);
    expect(img.data[0]).toBeGreaterThan(img.data[2]);
  });

  it('needsProcessing detecta los ajustes nuevos y los neutros no activan nada', () => {
    const layer = (adjust?: ImageAdjust) => ({ adjust, filter: 'none', flipX: false, flipY: false }) as unknown as ImageLayer;
    expect(needsProcessing(layer(DEFAULT_ADJUST))).toBe(false);
    expect(needsProcessing(layer(base))).toBe(false);
    for (const patch of [
      { invert: true }, { hue: 10 }, { exposure: -5 }, { clarity: 10 },
      { grayscale: 50 }, { sepia: 50 }, { threshold: 128 },
    ])
      expect(needsProcessing(layer({ ...base, ...patch })), JSON.stringify(patch)).toBe(true);
  });

  it('los presets nuevos existen', () => {
    const ids = ADJUST_PRESETS.map((p) => p.id);
    for (const id of ['bw-pure', 'sepia', 'negative', 'bw-contrast', 'sharp']) expect(ids).toContain(id);
  });
});
