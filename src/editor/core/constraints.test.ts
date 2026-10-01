import { describe, expect, it } from 'vitest';
import type { Layer, LayerConstraints, ShapeLayer } from './types';
import { applyConstraints, axisConstraint, isValidConstraints, resizeLayer } from './constraints';

const shape = (c?: LayerConstraints): ShapeLayer =>
  ({
    id: 'a', name: 'a', type: 'shape', shape: 'rect', x: 100, y: 50, width: 40, height: 20, scaleX: 1, scaleY: 1,
    rotation: 0, opacity: 1, blendMode: 'normal', visible: true, locked: false, fill: '#000', stroke: '#000',
    strokeWidth: 0, cornerRadius: 0, shadow: false, shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0,
    constraints: c,
  }) as ShapeLayer;

const old = { width: 400, height: 200 };
const next = { width: 600, height: 500 };

describe('restricciones por eje', () => {
  it('izquierda/arriba no se mueve; derecha/abajo sigue al borde; centro, a la mitad', () => {
    expect(axisConstraint('left', 100, 40, 400, 600)).toEqual({ pos: 100, factor: 1 });
    expect(axisConstraint('right', 100, 40, 400, 600)).toEqual({ pos: 300, factor: 1 });
    expect(axisConstraint('bottom', 50, 20, 200, 500)).toEqual({ pos: 350, factor: 1 });
    expect(axisConstraint('center', 100, 40, 400, 600)).toEqual({ pos: 200, factor: 1 });
  });
  it('estirar conserva los márgenes; escalar es proporcional al eje', () => {
    const s = axisConstraint('stretch', 100, 40, 400, 600);
    expect(s.pos).toBe(100);
    expect(40 * s.factor).toBeCloseTo(240); // 40 + 200
    expect(axisConstraint('scale', 100, 40, 400, 600)).toEqual({ pos: 150, factor: 1.5 });
  });
  it('estirar no colapsa a cero al encoger', () => {
    const s = axisConstraint('stretch', 0, 40, 400, 100);
    expect(40 * s.factor).toBeGreaterThanOrEqual(1);
  });
});

describe('applyConstraints', () => {
  it('sin restricciones devuelve la misma capa', () => {
    const l = shape();
    expect(applyConstraints(l, old, next)).toBe(l);
  });
  it('misma medida de lienzo no cambia nada', () => {
    const l = shape({ h: 'right', v: 'bottom' });
    expect(applyConstraints(l, old, old)).toBe(l);
  });
  it('derecha + abajo: se recoloca en la nueva esquina sin escalar', () => {
    const r = applyConstraints(shape({ h: 'right', v: 'bottom' }), old, next) as ShapeLayer;
    expect(r.x).toBe(300);
    expect(r.y).toBe(350);
    expect(r.scaleX).toBe(1);
    expect(r.scaleY).toBe(1);
  });
  it('estirar en horizontal cambia scaleX y deja scaleY', () => {
    const r = applyConstraints(shape({ h: 'stretch', v: 'top' }), old, next) as ShapeLayer;
    expect(r.width * r.scaleX).toBeCloseTo(240);
    expect(r.scaleY).toBe(1);
    expect(r.y).toBe(50);
  });
  it('resizeLayer sin restricciones escala para caber y centra (comportamiento de Magic Resize)', () => {
    const r = resizeLayer(shape(), old, next) as Layer;
    const f = Math.min(600 / 400, 500 / 200); // 1.5
    expect(r.scaleX).toBeCloseTo(f);
    expect(r.x).toBeCloseTo(100 * f);
    expect(r.y).toBeCloseTo(50 * f + (500 - 200 * f) / 2);
  });
  it('validación de restricciones', () => {
    expect(isValidConstraints({ h: 'left', v: 'top' })).toBe(true);
    expect(isValidConstraints({ h: 'top', v: 'top' })).toBe(false);
    expect(isValidConstraints(null)).toBe(false);
  });
});
