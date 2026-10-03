import { describe, expect, it } from 'vitest';
import * as M from './transformMath';

describe('caja base', () => {
  it('video 16:9 en fotograma 16:9 llena; en 9:16 queda con bandas (contain) o desborda (cover)', () => {
    expect(M.baseBox({ kind: 'video' }, { w: 1600, h: 900 }, { w: 1920, h: 1080 })).toEqual({ w: 1, h: 1 });
    const b = M.baseBox({ kind: 'video' }, { w: 900, h: 1600 }, { w: 1920, h: 1080 });
    expect(b.w).toBe(1);
    expect(b.h).toBeCloseTo((900 * 9) / 16 / 1600, 6);
    const c = M.baseBox({ kind: 'video' }, { w: 900, h: 1600 }, { w: 1920, h: 1080 }, 'cover');
    expect(c.h).toBe(1);
    expect(c.w).toBeGreaterThan(1);
  });
  it('imagen: ancho = size y alto por proporción', () => {
    const b = M.baseBox({ kind: 'image', size: 0.4 }, { w: 1000, h: 500 }, { w: 200, h: 100 });
    expect(b.w).toBe(0.4);
    expect(b.h).toBeCloseTo((0.4 * 1000 * 0.5) / 500, 9);
  });
  it('texto: mide por ancho de texto y cuerpo de letra', () => {
    const b = M.baseBox({ kind: 'text' }, { w: 1000, h: 500 }, { w: 0, h: 0, textW: 250, fontPx: 40 });
    expect(b.w).toBe(0.25);
    expect(b.h).toBeCloseTo(50 / 500, 9);
  });
  it('sin datos devuelve un tamaño razonable', () => {
    expect(M.baseBox({ kind: 'image' }, { w: 0, h: 0 }, null).w).toBeGreaterThan(0);
  });
});

describe('manijas', () => {
  it('la escala multiplica el tamaño base', () => {
    const h = M.handlesFor({ x: 0.3, y: 0.6, scale: 2, rotation: 15, opacity: 1 }, { w: 0.2, h: 0.1 });
    expect(h).toEqual({ cx: 0.3, cy: 0.6, w: 0.4, h: 0.2, rotation: 15 });
  });
  it('escala por distancia al centro', () => {
    const c = { x: 100, y: 100 };
    expect(M.scaleFromDrag(1, c, { x: 200, y: 100 }, { x: 300, y: 100 })).toBeCloseTo(2, 9);
    expect(M.scaleFromDrag(2, c, { x: 200, y: 100 }, { x: 150, y: 100 })).toBeCloseTo(1, 9);
    expect(M.scaleFromDrag(1, c, { x: 200, y: 100 }, { x: 100, y: 100 })).toBe(0.05); // mínimo
    expect(M.scaleFromDrag(1, c, { x: 100, y: 100 }, { x: 300, y: 100 })).toBe(1); // inicio sobre el centro
  });
  it('giro: 90° en sentido horario al pasar de la derecha a abajo (y crece hacia abajo)', () => {
    const c = { x: 0, y: 0 };
    expect(M.rotationFromDrag(0, c, { x: 10, y: 0 }, { x: 0, y: 10 })).toBe(90);
    expect(M.rotationFromDrag(80, c, { x: 10, y: 0 }, { x: 0, y: 10 })).toBe(170);
    expect(M.rotationFromDrag(90, c, { x: 10, y: 0 }, { x: 0, y: 10 })).toBe(180);
  });
  it('giro con Shift a pasos de 15° y pegado a 0/90 sin Shift', () => {
    const c = { x: 0, y: 0 };
    const a = Math.atan2(1, 10) * (180 / Math.PI); // 5.7°
    expect(M.rotationFromDrag(0, c, { x: 10, y: 0 }, { x: 10, y: 1 }, true)).toBe(0);
    expect(M.rotationFromDrag(0, c, { x: 10, y: 0 }, { x: 10, y: 1 })).toBe(0 + Math.round(a * 10) / 10);
    expect(M.snapAngle(2)).toBe(0);
    expect(M.snapAngle(88)).toBe(90);
    expect(M.snapAngle(40)).toBe(40);
  });
  it('el ángulo se normaliza a (-180, 180]', () => {
    const c = { x: 0, y: 0 };
    const r = M.rotationFromDrag(170, c, { x: 10, y: 0 }, { x: 0, y: 10 });
    expect(r).toBeGreaterThan(-180);
    expect(r).toBeLessThanOrEqual(180);
  });
  it('mover: desplazamiento en px → fracción, con pegado al centro', () => {
    const mv = M.moveCenter(0.2, 0.2, 100, 50, { w: 1000, h: 500 }, false);
    expect(mv.x).toBeCloseTo(0.3, 9);
    expect(mv.y).toBeCloseTo(0.3, 9);
    expect(M.moveCenter(0.4, 0.4, 105, 52, { w: 1000, h: 500 })).toEqual({ x: 0.5, y: 0.5 });
    expect(M.snapCenter(0.7)).toBe(0.7);
    expect(M.snapCenter(0.995)).toBe(1);
  });
});
