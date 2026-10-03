import { describe, expect, it } from 'vitest';
import { fitLines, wrapLines } from './wrap';

// medida de pega: cada carácter ocupa 10 px
const m = (s: string) => s.length * 10;

describe('wrapLines', () => {
  it('cabe en una línea', () => {
    expect(wrapLines('hola mundo', 200, m)).toEqual(['hola mundo']);
  });
  it('salta por palabras y equilibra las dos líneas', () => {
    // voraz: «uno dos tres» / «cuatro»; equilibrado: lo más parejo posible
    const lines = wrapLines('uno dos tres cuatro', 130, m);
    expect(lines).toHaveLength(2);
    expect(Math.max(...lines.map(m))).toBeLessThanOrEqual(130);
    expect(lines.join(' ')).toBe('uno dos tres cuatro');
    const greedy = wrapLines('uno dos tres cuatro', 130, m, false);
    expect(Math.max(...lines.map(m))).toBeLessThanOrEqual(Math.max(...greedy.map(m)));
  });
  it('respeta los saltos escritos', () => {
    expect(wrapLines('uno\ndos tres', 500, m)).toEqual(['uno', 'dos tres']);
    expect(wrapLines('uno\n\ndos', 500, m)).toEqual(['uno', '', 'dos']);
  });
  it('una palabra más ancha que la línea se parte por letras', () => {
    const lines = wrapLines('supercalifragilístico', 100, m);
    expect(lines.every((l) => m(l) <= 100)).toBe(true);
    expect(lines.join('')).toBe('supercalifragilístico');
  });
  it('no parte pares sustitutos (emojis)', () => {
    const lines = wrapLines('😀😀😀😀😀😀', 30, (s) => Array.from(s).length * 10);
    expect(lines.join('')).toBe('😀😀😀😀😀😀');
    expect(lines.every((l) => !/[\ud800-\udbff]$/.test(l))).toBe(true);
  });
  it('texto vacío y espacios múltiples', () => {
    expect(wrapLines('', 100, m)).toEqual(['']);
    expect(wrapLines('a    b', 100, m)).toEqual(['a b']);
  });
  it('conserva todas las palabras y ninguna línea pasa del ancho (azar)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 200; k++) {
      const words = Array.from({ length: 1 + Math.floor(rnd() * 20) }, () => 'x'.repeat(1 + Math.floor(rnd() * 9)));
      const w = 100 + Math.floor(rnd() * 200);
      const lines = wrapLines(words.join(' '), w, m);
      expect(lines.join(' ').split(/\s+/)).toEqual(words);
      expect(lines.every((l) => m(l) <= w)).toBe(true);
    }
  });
});

describe('fitLines', () => {
  it('2 líneas permitidas y caben: sin reducir', () => {
    const r = fitLines('uno dos tres cuatro cinco seis', 200, m, 2);
    expect(r.scale).toBe(1);
    expect(r.lines).toHaveLength(2);
    expect(r.overflow).toBe(false);
  });
  it('si no caben en 2, reduce la letra', () => {
    // a 160 px: 3 líneas; reduciendo a 0,85 caben 2
    const text = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh';
    const full = wrapLines(text, 170, m);
    expect(full.length).toBeGreaterThan(2);
    const r = fitLines(text, 170, m, 2);
    expect(r.lines.length).toBeLessThanOrEqual(2);
    expect(r.scale).toBeLessThan(1);
    expect(r.scale).toBeGreaterThanOrEqual(0.8);
  });
  it('si ni así cabe, deja las líneas de más (no corta texto) y avisa', () => {
    const text = Array.from({ length: 30 }, () => 'palabra').join(' ');
    const r = fitLines(text, 200, m, 2);
    expect(r.overflow).toBe(true);
    expect(r.lines.join(' ').split(' ')).toHaveLength(30);
    expect(r.scale).toBe(0.8);
  });
  it('maxLines 1', () => {
    const r = fitLines('uno dos', 200, m, 1);
    expect(r.lines).toEqual(['uno dos']);
  });
});
