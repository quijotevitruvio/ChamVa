import { describe, expect, it } from 'vitest';
import type { Doc, Layer, ShapeLayer, TextLayer } from './types';
import {
  applyStyleToLayers,
  createStyle,
  deleteStyle,
  normalizeStyles,
  styleUsage,
  unlinkStyle,
  updateStyleFromLayer,
} from './sharedStyles';

const base = { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, blendMode: 'normal', visible: true, locked: false } as const;
const shape = (id: string, extra: Partial<ShapeLayer> = {}): Layer =>
  ({ ...base, id, name: id, type: 'shape', shape: 'rect', width: 10, height: 10, fill: '#000000', stroke: '#111111', strokeWidth: 1, cornerRadius: 0, shadow: false, shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0, ...extra }) as Layer;
const text = (id: string, extra: Partial<TextLayer> = {}): Layer =>
  ({ ...base, id, name: id, type: 'text', text: id, fontFamily: 'Arial', fontSize: 20, fill: '#000000', align: 'left', bold: false, italic: false, textTransform: 'none', letterSpacing: 0, strokeColor: '#000', strokeWidth: 0, shadow: false, shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0, ...extra }) as Layer;
const mk = (layers: Layer[]): Doc => ({
  id: 'd', name: 'd', width: 100, height: 100, background: { type: 'transparent' }, layers, version: 1,
});
const get = (d: Doc, id: string) => d.layers.find((l) => l.id === id)!;

describe('estilos de objeto compartidos', () => {
  it('guarda el estilo de una capa, la vincula y lo aplica a otra sin tocar posición ni contenido', () => {
    let d = mk([shape('a', { fill: '#ff0000', opacity: 0.5, strokeWidth: 4 }), shape('b', { x: 99, fillGradient: { angle: 0, stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] } })]);
    d = createStyle(d, 's1', 'Rojo', get(d, 'a'));
    expect(get(d, 'a').styleId).toBe('s1');
    d = applyStyleToLayers(d, 's1', ['b']);
    const b = get(d, 'b') as ShapeLayer;
    expect(b.fill).toBe('#ff0000');
    expect(b.fillGradient).toBeUndefined(); // el degradado anterior se quita
    expect(b.opacity).toBe(0.5);
    expect(b.strokeWidth).toBe(4);
    expect(b.x).toBe(99);
    expect(b.styleId).toBe('s1');
    expect(styleUsage(d, 's1')).toBe(2);
  });
  it('actualizar el estilo reaplica a todas las capas vinculadas', () => {
    let d = mk([shape('a', { fill: '#ff0000' }), shape('b'), shape('c')]);
    d = createStyle(d, 's1', 'X', get(d, 'a'));
    d = applyStyleToLayers(d, 's1', ['b']);
    d = { ...d, layers: d.layers.map((l) => (l.id === 'a' ? ({ ...l, fill: '#00ff00', opacity: 0.3 } as Layer) : l)) };
    d = updateStyleFromLayer(d, 's1', 'a');
    expect((get(d, 'b') as ShapeLayer).fill).toBe('#00ff00');
    expect(get(d, 'b').opacity).toBe(0.3);
    expect((get(d, 'c') as ShapeLayer).fill).toBe('#000000'); // c no estaba vinculada
  });
  it('entre texto y forma pasa solo lo compatible', () => {
    let d = mk([text('t', { fill: '#123456', fontSize: 64, bold: true }), shape('s')]);
    d = createStyle(d, 's1', 'T', get(d, 't'));
    d = applyStyleToLayers(d, 's1', ['s']);
    const s = get(d, 's') as ShapeLayer;
    expect(s.fill).toBe('#123456');
    expect('fontSize' in s).toBe(false);
  });
  it('desvincular y borrar conservan el aspecto', () => {
    let d = mk([shape('a', { fill: '#ff0000' }), shape('b')]);
    d = createStyle(d, 's1', 'X', get(d, 'a'));
    d = applyStyleToLayers(d, 's1', ['b']);
    d = unlinkStyle(d, ['b']);
    expect(get(d, 'b').styleId).toBeUndefined();
    expect((get(d, 'b') as ShapeLayer).fill).toBe('#ff0000');
    d = deleteStyle(d, 's1');
    expect(d.styles).toBeUndefined();
    expect(get(d, 'a').styleId).toBeUndefined();
  });
  it('normalizar quita vínculos a estilos que no existen', () => {
    const d = normalizeStyles(mk([shape('a', { styleId: 'nada' })]));
    expect(get(d, 'a').styleId).toBeUndefined();
    expect('styles' in d).toBe(false);
  });
});
