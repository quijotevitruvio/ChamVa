import { describe, expect, it } from 'vitest';
import {
  applySpanStyle,
  compressCharStyles,
  hasSpans,
  remapSpans,
  resolveCharStyles,
  styledLines,
  stripSpanKey,
  toggleTarget,
  baseStyle,
  normalizeHex,
} from './richText';
import type { TextLayer } from './types';

const layer = (text: string, extra: Partial<TextLayer> = {}): TextLayer =>
  ({
    id: 't',
    type: 'text',
    name: 't',
    text,
    fontFamily: 'Arial',
    fontSize: 40,
    fill: '#ffffff',
    align: 'left',
    bold: false,
    italic: false,
    textTransform: 'none',
    letterSpacing: 0,
    strokeColor: '#000',
    strokeWidth: 0,
    shadow: false,
    shadowColor: '#000',
    shadowBlur: 0,
    shadowX: 0,
    shadowY: 0,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    ...extra,
  }) as TextLayer;

describe('applySpanStyle / compress', () => {
  it('pone en negrita una sola palabra', () => {
    const l = layer('hola mundo');
    const spans = applySpanStyle(l, 5, 10, { bold: true });
    expect(spans).toEqual([{ start: 5, end: 10, bold: true }]);
  });

  it('fusiona tramos contiguos con el mismo estilo', () => {
    const l = layer('abcdef', { spans: [{ start: 0, end: 2, bold: true }] });
    expect(applySpanStyle(l, 2, 4, { bold: true })).toEqual([{ start: 0, end: 4, bold: true }]);
  });

  it('no guarda lo que coincide con la base', () => {
    const l = layer('abc', { bold: true });
    expect(applySpanStyle(l, 0, 3, { bold: true })).toEqual([]);
    expect(applySpanStyle(l, 1, 2, { bold: false })).toEqual([{ start: 1, end: 2, bold: false }]);
  });

  it('normaliza colores y los compara con la base', () => {
    expect(normalizeHex('#FFF')).toBe('#ffffff');
    const l = layer('abc', { fill: '#FFF' });
    expect(applySpanStyle(l, 0, 1, { color: '#ffffff' })).toEqual([]);
    expect(applySpanStyle(l, 0, 1, { color: '#F00' })).toEqual([{ start: 0, end: 1, color: '#ff0000' }]);
  });

  it('compressCharStyles es inverso de resolveCharStyles', () => {
    const l = layer('uno dos tres', {
      spans: [
        { start: 0, end: 3, bold: true },
        { start: 4, end: 7, color: '#ff0000', italic: true },
      ],
    });
    expect(compressCharStyles(resolveCharStyles(l), baseStyle(l))).toEqual(l.spans);
  });
});

describe('toggleTarget', () => {
  it('activa si falta en alguna letra y desactiva si todas lo tienen', () => {
    const l = layer('hola mundo', { spans: [{ start: 5, end: 10, bold: true }] });
    expect(toggleTarget(l, 5, 10, 'bold')).toBe(false);
    expect(toggleTarget(l, 3, 10, 'bold')).toBe(true);
  });
});

describe('remapSpans', () => {
  const spans = [{ start: 5, end: 10, bold: true }];
  it('escribir al final del tramo lo hereda', () => {
    expect(remapSpans(spans, 'hola mundo', 'hola mundoX')).toEqual([{ start: 5, end: 11, bold: true }]);
  });
  it('escribir antes desplaza el tramo', () => {
    expect(remapSpans(spans, 'hola mundo', 'XXhola mundo')).toEqual([{ start: 7, end: 12, bold: true }]);
  });
  it('escribir justo al inicio del tramo no lo hereda', () => {
    expect(remapSpans(spans, 'hola mundo', 'hola Xmundo')).toEqual([{ start: 6, end: 11, bold: true }]);
  });
  it('borrar todo el tramo lo elimina', () => {
    expect(remapSpans(spans, 'hola mundo', 'hola ')).toBeUndefined();
  });
  it('borrar dentro del tramo lo encoge', () => {
    expect(remapSpans(spans, 'hola mundo', 'hola mdo')).toEqual([{ start: 5, end: 8, bold: true }]);
  });
});

describe('styledLines', () => {
  it('agrupa tramos y respeta saltos de línea', () => {
    const l = layer('ab\ncd', { spans: [{ start: 1, end: 4, bold: true }] });
    const lines = styledLines(l);
    expect(lines.map((ln) => ln.map((r) => `${r.text}${r.bold ? '*' : ''}`))).toEqual([
      ['a', 'b*'],
      ['c*', 'd'],
    ]);
  });

  it('aplica mayúsculas y capitalizar sin perder estilos', () => {
    const up = styledLines(layer('hola', { textTransform: 'upper', spans: [{ start: 0, end: 2, italic: true }] }));
    expect(up[0].map((r) => r.text)).toEqual(['HO', 'LA']);
    const caps = styledLines(layer('hola mundo', { textTransform: 'caps' }));
    expect(caps[0].map((r) => r.text).join('')).toBe('Hola Mundo');
  });

  it('añade prefijos de lista con el estilo base', () => {
    const lines = styledLines(layer('a\nb', { listStyle: 'number' }));
    expect(lines.map((ln) => ln.map((r) => r.text).join(''))).toEqual(['1.  a', '2.  b']);
    expect(styledLines(layer('a\nb', { listStyle: 'number' }), { list: false })[0][0].text).toBe('a');
  });
});

describe('utilidades', () => {
  it('hasSpans ignora tramos vacíos', () => {
    expect(hasSpans(layer('abc'))).toBe(false);
    expect(hasSpans(layer('abc', { spans: [{ start: 1, end: 1, bold: true }] }))).toBe(false);
    expect(hasSpans(layer('abc', { spans: [{ start: 0, end: 1, bold: true }] }))).toBe(true);
  });
  it('stripSpanKey quita una propiedad y descarta tramos que quedan vacíos', () => {
    expect(
      stripSpanKey(
        [
          { start: 0, end: 2, bold: true },
          { start: 2, end: 4, bold: true, color: '#ff0000' },
        ],
        'bold',
      ),
    ).toEqual([{ start: 2, end: 4, color: '#ff0000' }]);
  });
});
