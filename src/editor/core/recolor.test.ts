import { describe, expect, it } from 'vitest';
import { applyColorMap, collectColors, invertDoc, invertLightness, mapByLuminosity, mapDocColors } from './recolor';
import type { Doc, ShapeLayer, TextLayer } from './types';

const base = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, visible: true, locked: false, blendMode: 'normal' };
const shape = {
  ...base,
  id: 's1',
  name: 'forma',
  type: 'shape',
  shape: 'rect',
  width: 100,
  height: 50,
  fill: '#ff0000',
  fillGradient: { angle: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: 'rgba(0,0,255,0.5)' }] },
  strokeGradient: { angle: 0, stops: [{ offset: 0, color: '#00ff00' }, { offset: 1, color: '#ffffff' }] },
  stroke: '#00ff00',
  strokeWidth: 2,
  cornerRadius: 0,
  shadow: true,
  shadowColor: '#000000',
  shadowBlur: 4,
  shadowX: 1,
  shadowY: 1,
} as unknown as ShapeLayer;
const text = {
  ...base,
  id: 't1',
  name: 'texto',
  type: 'text',
  text: 'Hola',
  fill: '#222222',
  strokeColor: '#ffffff',
  shadow: false,
  shadowColor: '#000000',
  spans: [{ start: 0, end: 2, color: '#ff0000' }],
} as unknown as TextLayer;
const doc = {
  id: 'd',
  name: 'x',
  width: 100,
  height: 100,
  version: 1,
  background: { type: 'solid', color: '#ffffff' },
  layers: [shape, text],
} as unknown as Doc;

describe('recolor', () => {
  it('recoge colores únicos de fondo, capas, degradados, sombras y tramos', () => {
    const all = collectColors(doc);
    expect(new Set(all.map((c) => c.color))).toEqual(
      new Set(['#ffffff', '#ff0000', '#0000ff', '#00ff00', '#000000', '#222222']),
    );
    expect(all.find((c) => c.color === '#ff0000')!.count).toBe(3);
  });
  it('sustituye un color en todas partes y conserva el alfa', () => {
    const out = applyColorMap(doc, { '#ff0000': '#123456', '#0000ff': '#abcdef' });
    const s = out.layers[0] as ShapeLayer;
    expect(s.fill).toBe('#123456');
    expect(s.fillGradient!.stops[0].color).toBe('#123456');
    expect(s.fillGradient!.stops[1].color).toBe('rgba(171,205,239,0.5)');
    expect((out.layers[1] as TextLayer).spans![0].color).toBe('#123456');
    expect(s.stroke).toBe('#00ff00'); // sin tocar
    expect(doc.layers[0]).toBe(shape); // no muta
  });
  it('sustituye el fondo (sólido, degradado, patrón)', () => {
    const m = { '#ffffff': '#101010' };
    expect(applyColorMap(doc, m).background).toEqual({ type: 'solid', color: '#101010' });
    const g = {
      ...doc,
      background: { type: 'gradient', gradient: { angle: 0, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] } },
    } as Doc;
    expect((applyColorMap(g, m).background as any).gradient.stops[0].color).toBe('#101010');
    const p = {
      ...doc,
      background: { type: 'pattern', pattern: { kind: 'dots', color1: '#ffffff', color2: '#ff0000', size: 20, thickness: 2 } },
    } as Doc;
    expect((applyColorMap(p, m).background as any).pattern.color1).toBe('#101010');
  });
  it('ignora transparent', () => {
    const t = mapDocColors({ ...doc, background: { type: 'solid', color: 'transparent' } } as Doc, () => '#123456');
    expect((t.background as any).color).toBe('transparent');
  });
  it('invertir luminosidad conserva el tono y es casi reversible', () => {
    expect(invertLightness('#ffffff')).toBe('#0a0a0a');
    const c = '#3a7bd5';
    const twice = invertLightness(invertLightness(c));
    const d = (a: string, b: string) =>
      [1, 3, 5].reduce((m, i) => Math.max(m, Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))), 0);
    expect(d(c, twice)).toBeLessThanOrEqual(2);
  });
  it('invertDoc cambia fondos y asegura contraste del texto', () => {
    const out = invertDoc(doc);
    expect((out.background as any).color).toBe('#0a0a0a');
    expect((out.layers[1] as TextLayer).fill).not.toBe('#222222');
  });
  it('mapa por luminosidad: oscuro→oscuro, claro→claro', () => {
    const m = mapByLuminosity(['#ffffff', '#000000', '#808080'], ['#112233', '#eeeeff', '#667788']);
    expect(m['#000000']).toBe('#112233');
    expect(m['#ffffff']).toBe('#eeeeff');
    expect(m['#808080']).toBe('#667788');
  });
  it('con menos colores de paleta que de diseño reutiliza los extremos', () => {
    const m = mapByLuminosity(['#000000', '#444444', '#bbbbbb', '#ffffff'], ['#101010', '#f0f0f0']);
    expect(m['#000000']).toBe('#101010');
    expect(m['#ffffff']).toBe('#f0f0f0');
  });
});
