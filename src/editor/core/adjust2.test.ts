import { describe, expect, it } from 'vitest';
import { addCurvePoint, applyCurves, curveLut, curveLuts, hasCurves, moveCurvePoint, removeCurvePoint } from './curves';
import { applyLevels, computeHistogram, gammaToMidFraction, isNeutralLevels, levelsLut, midFractionToGamma } from './levels';
import { applyHslMix, familyWeights, hasHslMix, HSL_FAMILIES } from './hslMixer';
import { applyDehaze, applyDenoise, applyLens } from './photoFix';
import { needsProcessing } from './imageProcessing';
import { DEFAULT_ADJUST, type ImageAdjust, type ImageLayer } from './types';

function solid(w: number, h: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, width: w, height: h };
}

const layer = (adjust: ImageAdjust) => ({ adjust, filter: 'none', flipX: false, flipY: false }) as unknown as ImageLayer;

describe('curvas de tono', () => {
  it('la curva identidad da una tabla identidad y no cambia píxeles', () => {
    const lut = curveLut([[0, 0], [255, 255]]);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
    const img = solid(2, 2, [10, 120, 250, 255]);
    applyCurves(img, { rgb: [[0, 0], [255, 255]] });
    expect(Array.from(img.data.slice(0, 4))).toEqual([10, 120, 250, 255]);
    expect(hasCurves({ rgb: [[0, 0], [255, 255]] })).toBe(false);
  });

  it('es monótona aunque los puntos sean extremos', () => {
    const pts: [number, number][] = [[0, 0], [60, 200], [120, 20], [200, 255], [255, 255]];
    // los puntos no son monótonos (60->200, 120->20); la tabla puede subir y bajar ahí,
    // pero con puntos monótonos nunca debe sobreoscilar:
    const mono: [number, number][] = [[0, 0], [30, 5], [128, 200], [140, 205], [255, 255]];
    const lut = curveLut(mono);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(curveLut(pts).length).toBe(256);
  });

  it('pasa por los puntos de control', () => {
    const lut = curveLut([[0, 0], [64, 100], [192, 160], [255, 255]]);
    expect(lut[64]).toBe(100);
    expect(lut[192]).toBe(160);
  });

  it('una curva en S aumenta el contraste', () => {
    const lut = curveLut([[0, 0], [64, 40], [192, 215], [255, 255]]);
    expect(lut[64]).toBeLessThan(64);
    expect(lut[192]).toBeGreaterThan(192);
  });

  it('un canal solo mueve ese canal', () => {
    const img = solid(1, 1, [100, 100, 100, 255]);
    applyCurves(img, { r: [[0, 0], [100, 200], [255, 255]] });
    expect(img.data[0]).toBe(200);
    expect(img.data[1]).toBe(100);
    expect(img.data[2]).toBe(100);
  });

  it('combina maestra y canal, y respeta el alfa', () => {
    const luts = curveLuts({ rgb: [[0, 0], [255, 128]], b: [[0, 0], [255, 255]] })!;
    expect(luts.b[255]).toBe(128);
    const img = solid(1, 1, [50, 50, 50, 0]);
    applyCurves(img, { rgb: [[0, 255], [255, 255]] });
    expect(img.data[0]).toBe(50);
  });

  it('añadir, mover y quitar puntos mantiene el orden', () => {
    let r = addCurvePoint(undefined, 100, 150);
    expect(r.points).toEqual([[0, 0], [100, 150], [255, 255]]);
    expect(r.index).toBe(1);
    r = addCurvePoint(r.points, 101, 10); // demasiado cerca: reutiliza
    expect(r.points.length).toBe(3);
    const moved = moveCurvePoint(r.points, 1, 400, -5);
    expect(moved[1][0]).toBeLessThan(255);
    expect(moved[1][1]).toBe(0);
    expect(removeCurvePoint(r.points, 1)).toEqual([[0, 0], [255, 255]]);
    expect(removeCurvePoint(r.points, 0)).toEqual(r.points);
  });
});

describe('niveles', () => {
  it('niveles neutros = identidad', () => {
    const lut = levelsLut({ inBlack: 0, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 });
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
    expect(isNeutralLevels({ inBlack: 0, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 })).toBe(true);
    expect(isNeutralLevels(undefined)).toBe(true);
  });

  it('recorta negros y blancos', () => {
    const lut = levelsLut({ inBlack: 50, gamma: 1, inWhite: 200, outBlack: 0, outWhite: 255 });
    expect(lut[50]).toBe(0);
    expect(lut[20]).toBe(0);
    expect(lut[200]).toBe(255);
    expect(lut[240]).toBe(255);
  });

  it('el gamma > 1 aclara los medios', () => {
    const lut = levelsLut({ inBlack: 0, gamma: 2, inWhite: 255, outBlack: 0, outWhite: 255 });
    expect(lut[128]).toBeGreaterThan(128);
  });

  it('valores extremos no rompen (blanco = negro, salida invertida)', () => {
    const lut = levelsLut({ inBlack: 254, gamma: 10, inWhite: 1, outBlack: 255, outWhite: 0 });
    expect(lut.length).toBe(256);
    for (let i = 0; i < 256; i++) expect(Number.isFinite(lut[i])).toBe(true);
    const inv = levelsLut({ inBlack: 0, gamma: 1, inWhite: 255, outBlack: 255, outWhite: 0 });
    expect(inv[0]).toBe(255);
    expect(inv[255]).toBe(0);
  });

  it('la salida limitada comprime el rango', () => {
    const img = solid(1, 1, [255, 0, 128, 255]);
    applyLevels(img, { inBlack: 0, gamma: 1, inWhite: 255, outBlack: 40, outWhite: 200 });
    expect(img.data[0]).toBe(200);
    expect(img.data[1]).toBe(40);
  });

  it('gamma y fracción del tirador de medios son inversas', () => {
    for (const g of [0.3, 1, 2.2, 5]) expect(midFractionToGamma(gammaToMidFraction(g))).toBeCloseTo(g, 5);
  });

  it('histograma de una imagen sintética', () => {
    const img = solid(10, 10, [0, 0, 0, 255]);
    for (let p = 0; p < 50; p++) img.data.set([255, 255, 255, 255], p * 4); // mitad blanca
    img.data.set([200, 0, 0, 0], 99 * 4); // un píxel transparente: ignorado
    const h = computeHistogram(img);
    expect(h.count).toBe(99);
    expect(h.lum[255]).toBe(50);
    expect(h.lum[0]).toBe(49);
    expect(h.r[255]).toBe(50);
    expect(h.max).toBe(50);
  });
});

describe('mezclador HSL', () => {
  it('sin ajustes no cambia nada', () => {
    const img = solid(2, 2, [255, 0, 0, 255]);
    applyHslMix(img, undefined);
    applyHslMix(img, { red: { h: 0, s: 0, l: 0 } });
    expect(Array.from(img.data.slice(0, 3))).toEqual([255, 0, 0]);
    expect(hasHslMix({ red: { h: 0 } })).toBe(false);
    expect(hasHslMix({ red: { h: 10 } })).toBe(true);
  });

  it('los pesos suman 1', () => {
    for (let h = 0; h < 360; h += 7) expect(familyWeights(h).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(familyWeights(0)[0]).toBe(1);
    expect(familyWeights(HSL_FAMILIES[3].hue)[3]).toBe(1);
  });

  it('el tono de los rojos desplaza el rojo puro hacia naranja', () => {
    const img = solid(1, 1, [255, 0, 0, 255]);
    applyHslMix(img, { red: { h: 100 } });
    expect(img.data[0]).toBeGreaterThan(240);
    expect(img.data[1]).toBeGreaterThan(100); // ~ naranja
    expect(img.data[2]).toBeLessThan(10);
  });

  it('desaturar los rojos deja el rojo puro gris y no toca los azules', () => {
    const red = solid(1, 1, [255, 0, 0, 255]);
    applyHslMix(red, { red: { s: -100 } });
    expect(Math.abs(red.data[0] - red.data[1])).toBeLessThan(3);
    const blue = solid(1, 1, [0, 0, 255, 255]);
    applyHslMix(blue, { red: { s: -100 } });
    expect(Array.from(blue.data.slice(0, 3))).toEqual([0, 0, 255]);
  });

  it('luminosidad + aclara y - oscurece; los grises quedan igual', () => {
    const a = solid(1, 1, [200, 40, 40, 255]);
    applyHslMix(a, { red: { l: 100 } });
    expect(a.data[1]).toBeGreaterThan(40);
    const b = solid(1, 1, [200, 40, 40, 255]);
    applyHslMix(b, { red: { l: -100 } });
    expect(b.data[0]).toBeLessThan(200);
    const g = solid(1, 1, [128, 128, 128, 255]);
    applyHslMix(g, { red: { s: 100, l: 100, h: 100 } });
    expect(Array.from(g.data.slice(0, 3))).toEqual([128, 128, 128]);
  });
});

describe('reducir ruido', () => {
  function noisy() {
    const img = solid(24, 24, [128, 128, 128, 255]);
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 40;
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rnd();
      img.data[i] += v;
      img.data[i + 1] += v;
      img.data[i + 2] += v;
    }
    return img;
  }
  const variance = (img: ReturnType<typeof solid>) => {
    let m = 0;
    let c = 0;
    for (let i = 0; i < img.data.length; i += 4) (m += img.data[i]), c++;
    m /= c;
    let v = 0;
    for (let i = 0; i < img.data.length; i += 4) v += (img.data[i] - m) ** 2;
    return v / c;
  };

  it('reduce la varianza del ruido', () => {
    const img = noisy();
    const before = variance(img);
    applyDenoise(img, 80, 0);
    expect(variance(img)).toBeLessThan(before * 0.6);
  });

  it('con fuerza 0 no toca nada', () => {
    const img = noisy();
    const copy = new Uint8ClampedArray(img.data);
    applyDenoise(img, 0, 0);
    expect(Array.from(img.data)).toEqual(Array.from(copy));
  });

  it('conserva un borde fuerte', () => {
    const img = solid(20, 10, [0, 0, 0, 255]);
    for (let y = 0; y < 10; y++) for (let x = 10; x < 20; x++) img.data.set([255, 255, 255, 255], (y * 20 + x) * 4);
    applyDenoise(img, 100, 100);
    expect(img.data[(5 * 20 + 9) * 4]).toBeLessThan(40);
    expect(img.data[(5 * 20 + 10) * 4]).toBeGreaterThan(215);
  });
});

describe('quitar neblina', () => {
  function hazy() {
    const img = solid(32, 8, [0, 0, 0, 255]);
    for (let x = 0; x < 32; x++) {
      const v = 120 + x * 2.5; // 120..197: bruma de bajo contraste
      for (let y = 0; y < 8; y++) img.data.set([v, v, v, 255], (y * 32 + x) * 4);
    }
    return img;
  }
  it('aumenta el contraste de una imagen con bruma', () => {
    const img = hazy();
    const before = img.data[(0 * 32 + 31) * 4] - img.data[0];
    applyDehaze(img, 100);
    const after = img.data[(0 * 32 + 31) * 4] - img.data[0];
    expect(after).toBeGreaterThan(before);
    expect(img.data[0]).toBeLessThan(120);
  });
  it('fuerza 0 no cambia nada', () => {
    const img = hazy();
    const copy = new Uint8ClampedArray(img.data);
    applyDehaze(img, 0);
    expect(Array.from(img.data)).toEqual(Array.from(copy));
  });
  it('imagen transparente no rompe', () => {
    const img = solid(8, 8, [0, 0, 0, 0]);
    applyDehaze(img, 100);
    expect(img.data[3]).toBe(0);
  });
});

describe('lente', () => {
  it('sin distorsión ni viñeteo no cambia nada', () => {
    const img = solid(8, 8, [10, 20, 30, 255]);
    applyLens(img, 0, 0);
    expect(Array.from(img.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });
  it('mantiene el centro y mueve los bordes', () => {
    const w = 21;
    const img = solid(w, w, [0, 0, 0, 255]);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) img.data.set([x * 12, y * 12, 0, 255], (y * w + x) * 4);
    const center = Array.from(img.data.slice((10 * w + 10) * 4, (10 * w + 10) * 4 + 3));
    applyLens(img, 100, 0);
    expect(Array.from(img.data.slice((10 * w + 10) * 4, (10 * w + 10) * 4 + 3))).toEqual(center);
    // la esquina ahora muestra un punto más cercano al centro
    expect(img.data[(0 * w + 0) * 4]).toBeGreaterThan(0);
  });
  it('el cojín no deja huecos transparentes', () => {
    const img = solid(16, 16, [200, 100, 50, 255]);
    applyLens(img, -100, 0);
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(255);
  });
  it('el viñeteo aclara las esquinas y no el centro', () => {
    const img = solid(21, 21, [100, 100, 100, 255]);
    applyLens(img, 0, 100);
    expect(img.data[0]).toBeGreaterThan(100);
    expect(img.data[(10 * 21 + 10) * 4]).toBe(100);
  });
});

describe('compatibilidad con ajustes antiguos', () => {
  it('un ImageAdjust antiguo o neutro sigue sin procesarse', () => {
    expect(needsProcessing(layer(DEFAULT_ADJUST))).toBe(false);
    const old = { brightness: 1, contrast: 1, saturate: 1 } as ImageAdjust;
    expect(needsProcessing(layer(old))).toBe(false);
    expect(
      needsProcessing(
        layer({
          ...old,
          curves: { rgb: [[0, 0], [255, 255]] },
          levels: { inBlack: 0, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 },
          hslMix: { red: { h: 0 } },
        }),
      ),
    ).toBe(false);
  });
  it('cada ajuste nuevo activa el procesado', () => {
    const base = { brightness: 1, contrast: 1, saturate: 1 } as ImageAdjust;
    const patches: Partial<ImageAdjust>[] = [
      { curves: { rgb: [[0, 0], [100, 150], [255, 255]] } },
      { levels: { inBlack: 10, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 } },
      { hslMix: { blue: { s: 20 } } },
      { denoise: 10 },
      { denoiseColor: 10 },
      { dehaze: 10 },
      { lensDistortion: -5 },
      { lensVignette: 10 },
    ];
    for (const p of patches) expect(needsProcessing(layer({ ...base, ...p })), JSON.stringify(p)).toBe(true);
  });
});
