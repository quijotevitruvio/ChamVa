import { describe, expect, it } from 'vitest';
import {
  findMatches,
  formatReadingTime,
  replaceInText,
  textStats,
} from './textSearch';
import { loremText } from './loremText';
import { FONT_FAMILIES } from './types';
import { fontCategory, missingFonts, similarFonts, suggestSubstitute } from './fontMeta';

describe('findMatches', () => {
  it('ignora mayúsculas y acentos por defecto', () => {
    expect(findMatches('Canción cancion CANCIÓN', 'cancion')).toHaveLength(3);
  });
  it('distingue mayúsculas y acentos con matchCase', () => {
    expect(findMatches('Canción cancion CANCIÓN', 'cancion', { matchCase: true })).toEqual([
      { start: 8, end: 15 },
    ]);
  });
  it('palabra completa', () => {
    const t = 'casa casas encasa casa.';
    expect(findMatches(t, 'casa', { wholeWord: true })).toEqual([
      { start: 0, end: 4 },
      { start: 18, end: 22 },
    ]);
    expect(findMatches(t, 'casa')).toHaveLength(4);
  });
  it('consulta vacía no encuentra nada', () => {
    expect(findMatches('abc', '')).toEqual([]);
  });
});

describe('replaceInText', () => {
  it('reemplaza todas y mantiene los spans desplazados', () => {
    const text = 'foo bar foo';
    const spans = [{ start: 4, end: 7, bold: true }]; // «bar»
    const r = replaceInText(text, spans, 'foo', 'mucho más', { wholeWord: true });
    expect(r.text).toBe('mucho más bar mucho más');
    expect(r.count).toBe(2);
    expect(r.text.slice(r.spans![0].start, r.spans![0].end)).toBe('bar');
  });
  it('solo la coincidencia n-ésima', () => {
    const r = replaceInText('a a a', undefined, 'a', 'b', {}, 1);
    expect(r.text).toBe('a b a');
    expect(r.count).toBe(1);
  });
  it('reemplazar por vacío recorta el span', () => {
    const r = replaceInText('hola mundo', [{ start: 5, end: 10, italic: true }], 'hola ', '');
    expect(r.text).toBe('mundo');
    expect(r.spans).toEqual([{ start: 0, end: 5, italic: true }]);
  });
});

describe('textStats / tiempo de lectura', () => {
  it('cuenta palabras y caracteres', () => {
    const s = textStats('Hola, mundo cruel.\nOtra línea');
    expect(s.words).toBe(5);
    expect(s.charsNoSpaces).toBe(25);
  });
  it('200 palabras = 1 minuto', () => {
    const s = textStats(Array(200).fill('palabra').join(' '));
    expect(s.readingSeconds).toBe(60);
    expect(formatReadingTime(s.readingSeconds)).toBe('1 min');
    expect(formatReadingTime(90)).toBe('1 min 30 s');
    expect(formatReadingTime(12)).toBe('12 s');
    expect(formatReadingTime(0)).toBe('0 s');
  });
});

describe('fontMeta', () => {
  it('categoriza las fuentes empaquetadas', () => {
    expect(fontCategory('Playfair Display')).toBe('serif');
    expect(fontCategory('Courier New')).toBe('mono');
    expect(fontCategory('Pacifico')).toBe('script');
    expect(fontCategory('"Anton", sans-serif')).toBe('display');
  });
  it('deduce por el nombre en fuentes desconocidas', () => {
    expect(fontCategory('Mi Fuente Mono')).toBe('mono');
    expect(fontCategory('Noto Sans Serif Display')).toBe('sans');
    expect(fontCategory('Hand Written Pro')).toBe('script');
  });
  it('sugiere una parecida de la misma categoría', () => {
    expect(fontCategory(suggestSubstitute('Garamond')!)).toBe('serif');
    expect(fontCategory(suggestSubstitute('Caveat')!)).toBe('script');
    expect(fontCategory(suggestSubstitute('Fira Code')!)).toBe('mono');
    expect(similarFonts('Lato')).not.toContain('Lato');
  });
  it('detecta fuentes faltantes', () => {
    expect(missingFonts(['Arial', 'Foo Sans', 'foo sans', 'sans-serif', '"Lato", Arial'], [...FONT_FAMILIES, 'Mia'])).toEqual([
      'Foo Sans',
      'Lato',
    ]);
    expect(missingFonts(['mia'], ['Mia'])).toEqual([]);
  });
});

describe('loremText', () => {
  it('respeta el ancho y la forma', () => {
    const p = loremText('p1', 30);
    expect(p.split('\n').every((l) => l.length <= 30)).toBe(true);
    expect(loremText('p3', 30).split('\n\n')).toHaveLength(3);
    expect(loremText('list').split('\n')).toHaveLength(5);
  });
});
