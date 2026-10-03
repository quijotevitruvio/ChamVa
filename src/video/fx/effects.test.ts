import { describe, expect, it } from 'vitest';
import { activeFx, effectiveParams, FX_CATEGORIES, FX_DEFS, fxActive, fxDef, LOOKS, lookById, makeFx } from './effects';
import { CANVAS_FX, runPixelStack } from './fxDraw';
import { applyChromaKey, applyLook, applyMirror, applyMosaic, applyVhs, curvePoints, hexToRgb, lookTables, PIXEL_FX, type Px } from './pixel';

const px = (rgba: number[][], w = rgba.length, h = 1): Px => ({ width: w, height: h, data: new Uint8ClampedArray(rgba.flat()) });
const at = (img: Px, i: number) => Array.from(img.data.slice(i * 4, i * 4 + 4));

describe('catálogo de efectos', () => {
  it('cubre las familias pedidas y todo tipo tiene implementación', () => {
    expect(FX_DEFS.length).toBeGreaterThanOrEqual(25);
    expect(FX_CATEGORIES).toEqual(['Color', 'Imagen', 'Forma', 'Croma']);
    for (const d of FX_DEFS) expect(PIXEL_FX[d.type] || CANVAS_FX.has(d.type), d.type).toBeTruthy();
    for (const t of ['brightness', 'contrast', 'saturation', 'temperature', 'tint', 'exposure', 'lights', 'vignette', 'curves', 'look', 'blur', 'motionBlur', 'sharpen', 'pixelate', 'mosaic', 'grain', 'chromatic', 'glitch', 'mirror', 'vhs', 'rays', 'mask', 'border', 'shadow', 'chroma'])
      expect(fxDef(t), t).toBeTruthy();
  });
  it('20+ preajustes de color con id único', () => {
    expect(LOOKS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length);
    for (const id of ['warm', 'cine', 'bw', 'faded']) expect(LOOKS.some((l) => l.id === id)).toBe(true);
    expect(lookById('no-existe')).toBe(LOOKS[0]);
  });
  it('los parámetros por defecto están dentro de su rango', () => {
    for (const d of FX_DEFS)
      for (const p of d.params)
        if (p.kind === 'num' || !p.kind) {
          expect(p.def as number, `${d.type}.${p.key}`).toBeGreaterThanOrEqual(p.min!);
          expect(p.def as number, `${d.type}.${p.key}`).toBeLessThanOrEqual(p.max!);
        }
  });
});

describe('parámetros efectivos', () => {
  it('la intensidad escala los parámetros numéricos (neutro 0)', () => {
    const fx = makeFx('brightness', { id: 'a', p: { v: 0.8 }, amount: 0.5 });
    expect(effectiveParams(fx).v).toBeCloseTo(0.4, 9);
    expect(effectiveParams({ ...fx, amount: 0 }).v).toBe(0);
  });
  it('faltan → por defecto; fuera de rango → se limita; no numéricos pasan', () => {
    const q = effectiveParams({ id: 'x', type: 'blur', amount: 1, p: { r: 999 } });
    expect(q.r).toBe(40);
    expect(effectiveParams({ id: 'x', type: 'blur', amount: 1 }).r).toBe(8);
    expect(effectiveParams({ id: 'x', type: 'look', amount: 0.3, p: { preset: 'noir' } }).preset).toBe('noir');
    expect(effectiveParams({ id: 'x', type: 'desconocido', amount: 1 })).toEqual({});
  });
  it('los parámetros fijos (croma, máscara, ángulos) no se escalan con la intensidad', () => {
    const q = effectiveParams({ id: 'c', type: 'chroma', amount: 0.2, p: { tol: 0.5 } });
    expect(q.tol).toBe(0.5);
    const m = effectiveParams({ id: 'm', type: 'mask', amount: 0.1, p: { size: 0.7 } });
    expect(m.size).toBe(0.7);
  });
  it('activo = encendido, intensidad > 0 y tipo conocido; respeta el orden', () => {
    const a = makeFx('brightness', { id: 'a' });
    const b = { ...makeFx('contrast', { id: 'b' }), on: false };
    const c = makeFx('vignette', { id: 'c', amount: 0 });
    const d = { id: 'd', type: 'nada', amount: 1 };
    expect([a, b, c, d].map(fxActive)).toEqual([true, false, false, false]);
    expect(activeFx([a, b, c, d]).map((f) => f.id)).toEqual(['a']);
    expect(activeFx(undefined)).toEqual([]);
  });
});

describe('orden de la pila', () => {
  it('cambiar el orden cambia el resultado (cada efecto actúa sobre el anterior)', () => {
    const mk = () => px([[100, 100, 100, 255]]);
    const bright = makeFx('brightness', { id: 'b', p: { v: 0.5 } }); // +64
    const contrast = makeFx('contrast', { id: 'c', p: { v: 0.5 } }); // (x − 128) × 1,75 + 128
    const one = mk();
    runPixelStack(one, [bright, contrast], 0);
    const two = mk();
    runPixelStack(two, [contrast, bright], 0);
    expect(at(one, 0)[0]).toBe(Math.round((164 - 128) * 1.75 + 128)); // 191
    expect(at(two, 0)[0]).toBe(Math.round((100 - 128) * 1.75 + 128 + 64)); // 143
    expect(at(one, 0)[0]).not.toBe(at(two, 0)[0]);
  });
  it('un efecto apagado o a intensidad 0 no cambia nada', () => {
    const img = px([[10, 20, 30, 255]]);
    runPixelStack(img, [{ ...makeFx('brightness', { id: 'a' }), on: false }, makeFx('contrast', { id: 'b', amount: 0 })], 0);
    expect(at(img, 0)).toEqual([10, 20, 30, 255]);
  });
});

describe('croma', () => {
  const GREEN: [number, number, number] = [0, 255, 0];
  it('quita el verde (alfa 0), conserva rojo, gris y piel', () => {
    const img = px([[0, 255, 0, 255], [255, 0, 0, 255], [128, 128, 128, 255], [220, 170, 140, 255], [255, 255, 255, 255]]);
    applyChromaKey(img, GREEN, 0.35, 0.15, 0);
    expect(at(img, 0)[3]).toBe(0);
    expect(at(img, 1)[3]).toBe(255);
    expect(at(img, 2)[3]).toBe(255);
    expect(at(img, 3)[3]).toBe(255);
    expect(at(img, 4)[3]).toBe(255);
  });
  it('un verde apagado o en sombra también se quita (tonalidad, no distancia)', () => {
    const img = px([[30, 150, 50, 255], [10, 60, 20, 255], [90, 200, 110, 255]]);
    applyChromaKey(img, GREEN, 0.35, 0.15, 0);
    for (let i = 0; i < 3; i++) expect(at(img, i)[3], `píxel ${i}`).toBe(0);
  });
  it('la tolerancia manda: con tolerancia 0 y suavizado casi 0 un verde algo desviado se conserva; con alta se quita', () => {
    const teal = [0, 200, 120, 255]; // tonalidad desviada del verde puro
    const a = px([teal]);
    applyChromaKey(a, GREEN, 0.0, 0.01, 0);
    expect(at(a, 0)[3]).toBe(255);
    const b = px([teal]);
    applyChromaKey(b, GREEN, 0.9, 0.1, 0);
    expect(at(b, 0)[3]).toBe(0);
  });
  it('el suavizado da alfa parcial en el borde', () => {
    // tonalidad intermedia entre el verde y el rojo
    const img = px([[120, 200, 20, 255]]);
    applyChromaKey(img, GREEN, 0.15, 0.45, 0);
    const a = at(img, 0)[3];
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
  });
  it('clave azul', () => {
    const img = px([[0, 0, 255, 255], [255, 0, 0, 255], [20, 40, 160, 255]]);
    applyChromaKey(img, [0, 0, 255], 0.35, 0.15, 0);
    expect([at(img, 0)[3], at(img, 1)[3], at(img, 2)[3]]).toEqual([0, 255, 0]);
  });
  it('reducir reflejo quita el verde de los píxeles que se conservan', () => {
    const img = px([[200, 220, 150, 255]]); // reflejo verdoso en un píxel claro
    applyChromaKey(img, GREEN, 0.05, 0.05, 1);
    expect(at(img, 0)[1]).toBeLessThanOrEqual(200); // g baja hasta max(r, b)
    const img2 = px([[200, 220, 150, 255]]);
    applyChromaKey(img2, GREEN, 0.05, 0.05, 0);
    expect(at(img2, 0)[1]).toBe(220);
  });
  it('un color clave sin tono (gris) no hace nada; píxeles transparentes se saltan; la intensidad mezcla', () => {
    const img = px([[0, 255, 0, 255]]);
    applyChromaKey(img, [128, 128, 128], 0.5, 0.1, 0);
    expect(at(img, 0)[3]).toBe(255);
    const t = px([[0, 255, 0, 0]]);
    applyChromaKey(t, GREEN, 0.35, 0.15, 0);
    expect(at(t, 0)[3]).toBe(0);
    const half = px([[0, 255, 0, 255]]);
    applyChromaKey(half, GREEN, 0.35, 0.15, 0, 0.5);
    expect(Math.abs(at(half, 0)[3] - 128)).toBeLessThanOrEqual(1); // 255 × 0,5
  });
  it('el efecto `chroma` de la pila usa sus parámetros', () => {
    const img = px([[0, 255, 0, 255], [255, 0, 0, 255]]);
    runPixelStack(img, [makeFx('chroma', { id: 'k', p: { color: '#00ff00', tol: 0.35, soft: 0.15, spill: 0 } })], 0);
    expect([at(img, 0)[3], at(img, 1)[3]]).toEqual([0, 255]);
    expect(hexToRgb('#00ff00')).toEqual([0, 255, 0]);
    expect(hexToRgb('malo', [1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('preajustes de color', () => {
  it('B/N da grises; el negativo invierte; mezcla 0 = original', () => {
    const bw = px([[200, 100, 50, 255]]);
    applyLook(bw, lookById('bw'), 1);
    const [r, g, b] = at(bw, 0);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
    const neg = px([[200, 100, 50, 255]]);
    applyLook(neg, lookById('negative'), 1);
    expect(at(neg, 0).slice(0, 3)).toEqual([55, 155, 205]);
    const none = px([[200, 100, 50, 255]]);
    applyLook(none, lookById('cine'), 0);
    expect(at(none, 0)).toEqual([200, 100, 50, 255]);
  });
  it('cálido sube rojo y baja azul; frío al revés; desvanecido levanta los negros', () => {
    const warm = px([[120, 120, 120, 255]]);
    applyLook(warm, lookById('warm'), 1);
    expect(at(warm, 0)[0]).toBeGreaterThan(at(warm, 0)[2]);
    const cool = px([[120, 120, 120, 255]]);
    applyLook(cool, lookById('cool'), 1);
    expect(at(cool, 0)[2]).toBeGreaterThan(at(cool, 0)[0]);
    const faded = px([[0, 0, 0, 255]]);
    applyLook(faded, lookById('faded'), 1);
    expect(at(faded, 0)[0]).toBeGreaterThan(15);
  });
  it('a medias es el punto medio entre original y resultado', () => {
    const a = px([[200, 100, 50, 255]]);
    applyLook(a, lookById('negative'), 0.5);
    for (const v of at(a, 0).slice(0, 3)) expect(Math.abs(v - 128)).toBeLessThanOrEqual(1); // (200 + 55) / 2 = 127,5
  });
  it('tablas de 256 entradas por canal', () => {
    const t = lookTables(lookById('vivid'));
    expect(t).toHaveLength(3);
    expect(t[0]).toHaveLength(256);
  });
});

describe('otros efectos de píxel', () => {
  it('curvas: puntos de control por encima y por debajo de la diagonal', () => {
    const c = curvePoints(-0.5, 0, 0.5);
    expect(c.rgb![1][1]).toBeLessThan(64);
    expect(c.rgb![2][1]).toBe(128);
    expect(c.rgb![3][1]).toBeGreaterThan(192);
  });
  it('espejo izquierda → derecha', () => {
    const img = px([[1, 0, 0, 255], [2, 0, 0, 255], [3, 0, 0, 255], [4, 0, 0, 255]]);
    applyMirror(img, 'lr');
    expect([0, 1, 2, 3].map((i) => at(img, i)[0])).toEqual([1, 2, 2, 1]);
    const img2 = px([[1, 0, 0, 255], [2, 0, 0, 255], [3, 0, 0, 255], [4, 0, 0, 255]]);
    applyMirror(img2, 'rl');
    expect([0, 1, 2, 3].map((i) => at(img2, i)[0])).toEqual([4, 3, 3, 4]);
  });
  it('mosaico: junta oscura entre teselas', () => {
    const w = 16;
    const rows = Array.from({ length: w * w }, () => [200, 200, 200, 255]);
    const img = px(rows, w, w);
    applyMosaic(img, 8, 0.25);
    expect(at(img, 0)[0]).toBeLessThan(100); // esquina de tesela: junta
    expect(at(img, 3 * w + 3)[0]).toBe(200); // centro de tesela
  });
  it('VHS y grano son deterministas por semilla y cambian con ella', () => {
    const mk = () => px(Array.from({ length: 64 }, () => [120, 120, 120, 255]), 8, 8);
    const a = mk();
    const b = mk();
    applyVhs(a, 0.6, 5, 1);
    applyVhs(b, 0.6, 5, 1);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const c = mk();
    applyVhs(c, 0.6, 6, 1);
    expect(Array.from(c.data)).not.toEqual(Array.from(a.data));
    const g1 = mk();
    const g2 = mk();
    PIXEL_FX.grain(g1, { v: 0.5 }, { k: 1, seed: 1, scale: 1 });
    PIXEL_FX.grain(g2, { v: 0.5 }, { k: 1, seed: 2, scale: 1 });
    expect(Array.from(g1.data)).not.toEqual(Array.from(g2.data));
  });
  it('los efectos respetan el alfa 0 (no pintan lo transparente)', () => {
    const img = px([[0, 0, 0, 0]]);
    runPixelStack(img, [makeFx('brightness', { id: 'a', p: { v: 1 } }), makeFx('look', { id: 'b' }), makeFx('grain', { id: 'g' })], 3);
    expect(at(img, 0)).toEqual([0, 0, 0, 0]);
  });
  it('desenfoque gaussiano suaviza un borde duro; nitidez no rompe un fondo liso', () => {
    const w = 16;
    const data = Array.from({ length: w }, (_, x) => (x < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const img = px(data, w, 1);
    runPixelStack(img, [makeFx('blur', { id: 'b', p: { r: 6 } })], 0, 1);
    expect(at(img, 7)[0]).toBeGreaterThan(5);
    expect(at(img, 8)[0]).toBeLessThan(250);
  });
});
