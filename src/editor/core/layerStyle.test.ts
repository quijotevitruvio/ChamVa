import { describe, expect, it } from 'vitest';
import type { Layer } from './types';
import { similarLayerIds, stylePatch } from './layerStyle';

const base = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, blendMode: 'normal', visible: true, locked: false, name: 'n' };
const sh = { shadow: false, shadowColor: '#000', shadowBlur: 1, shadowX: 1, shadowY: 1 };
const text = (id: string, o: object = {}) =>
  ({ ...base, ...sh, id, type: 'text', text: 'hola', fontFamily: 'Arial', fontSize: 20, fill: '#111', align: 'left', bold: false, italic: false, textTransform: 'none', letterSpacing: 0, strokeColor: '#000', strokeWidth: 0, ...o }) as unknown as Layer;
const shape = (id: string, o: object = {}) =>
  ({ ...base, ...sh, id, type: 'shape', shape: 'rect', width: 5, height: 5, fill: '#f00', stroke: '#000', strokeWidth: 2, cornerRadius: 0, ...o }) as unknown as Layer;

describe('seleccionar similares', () => {
  it('texto: misma fuente y color', () => {
    const ls = [text('a'), text('b'), text('c', { fill: '#fff' }), text('d', { fontFamily: 'Impact' }), shape('e')];
    expect(similarLayerIds(ls, 'a')).toEqual(['a', 'b']);
  });
  it('forma: mismo relleno; ignora ocultas y bloqueadas', () => {
    const ls = [shape('a'), shape('b'), shape('c', { visible: false }), shape('d', { locked: true }), shape('e', { fill: '#0f0' })];
    expect(similarLayerIds(ls, 'a')).toEqual(['a', 'b']);
  });
  it('id desconocido', () => expect(similarLayerIds([], 'x')).toEqual([]));
});

describe('pegar formato', () => {
  it('texto → texto no incluye el contenido ni la posición', () => {
    const p = stylePatch(text('a', { fontSize: 99, fill: '#abc', text: 'otro', x: 50 }), text('b'));
    expect(p.fontSize).toBe(99);
    expect(p.fill).toBe('#abc');
    expect('text' in p).toBe(false);
    expect('x' in p).toBe(false);
    expect('width' in p).toBe(false);
  });
  it('forma → texto: relleno y borde mapeados', () => {
    const p = stylePatch(shape('a', { fill: '#123', stroke: '#456', strokeWidth: 7 }), text('b'));
    expect(p.fill).toBe('#123');
    expect(p.strokeColor).toBe('#456');
    expect(p.strokeWidth).toBe(7);
    expect('stroke' in p).toBe(false);
    expect('fontSize' in p).toBe(false);
  });
});
