import { describe, expect, it } from 'vitest';
import { addStop, gradientCss, gradientFromColor, mixColors, parseColor, reverseGradient, svgGradientDef, toHex6, withAlphaColor } from './gradients';
import type { Gradient } from './types';

const g: Gradient = { angle: 90, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] };

describe('colores con alfa', () => {
  it('lee hex, rgba y transparent', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(10,20,30,0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.502, 2);
    expect(parseColor('transparent')?.a).toBe(0);
    expect(parseColor('no-es-color')).toBeNull();
  });
  it('convierte ida y vuelta', () => {
    expect(toHex6('rgba(255,0,0,0.3)')).toBe('#ff0000');
    expect(withAlphaColor('#ff0000', 1)).toBe('#ff0000');
    expect(withAlphaColor('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });
  it('mezcla', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('degradados', () => {
  it('invertir cambia el orden de los colores', () => {
    const r = reverseGradient(g);
    expect(r.stops[0].color).toBe('#0000ff');
    expect(r.stops[1].color).toBe('#ff0000');
    expect(reverseGradient(r)).toEqual(g);
  });
  it('añadir parada pone una en el hueco mayor', () => {
    const a = addStop(g);
    expect(a.stops).toHaveLength(3);
    expect(a.stops[1].offset).toBe(0.5);
    const b = addStop({ ...g, stops: [...a.stops] });
    expect(b.stops).toHaveLength(4);
  });
  it('desde un color: del color a uno más oscuro', () => {
    const d = gradientFromColor('#ff8800');
    expect(d.stops[0].color).toBe('#ff8800');
    expect(d.stops[1].color).not.toBe('#ff8800');
  });
  it('css y svg distinguen radial de lineal', () => {
    expect(gradientCss(g)).toContain('linear-gradient');
    expect(gradientCss({ ...g, kind: 'radial' })).toContain('radial-gradient');
    expect(svgGradientDef('x', g, 100, 50)).toContain('<linearGradient');
    expect(svgGradientDef('x', { ...g, kind: 'radial' }, 100, 50)).toContain('<radialGradient');
  });
  it('las paradas con alfa salen como stop-opacity en SVG', () => {
    const t: Gradient = { angle: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: 'rgba(0,0,0,0)' }] };
    expect(svgGradientDef('x', t, 10, 10)).toContain('stop-opacity="0"');
  });
});
