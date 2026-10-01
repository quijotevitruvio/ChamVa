import { describe, it, expect } from 'vitest';
import {
  adjustForContrast,
  contrastLevels,
  contrastRatio,
  luminance,
  tonalScale,
  simulateColorBlind,
  hexToRgb,
} from './colorTools';
import { COLOR_NAMES, colorName } from './colorNames';
import { MOODS, moodPalette, surpriseMood } from './moods';
import { exportPalette, parsePalette, parseColorToken } from './paletteIO';

describe('contraste', () => {
  it('niveles WCAG', () => {
    const l = contrastLevels('#000000', '#ffffff');
    expect(l.ratio).toBeCloseTo(21, 0);
    expect(l.aaaNormal).toBe(true);
    const g = contrastLevels('#8a8a8a', '#ffffff');
    expect(g.aaNormal).toBe(false);
    expect(g.aaLarge).toBe(true);
  });
  it('ajusta a AA sobre claro y sobre oscuro', () => {
    for (const [fg, bg] of [['#aaaaaa', '#ffffff'], ['#3366cc', '#0b1437'], ['#ffde59', '#ffffff'], ['#777777', '#808080']]) {
      const out = adjustForContrast(fg, bg, 4.5);
      expect(contrastRatio(out, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('no toca lo que ya cumple', () => {
    expect(adjustForContrast('#000000', '#ffffff')).toBe('#000000');
  });
  it('AAA', () => {
    expect(contrastRatio(adjustForContrast('#888888', '#ffffff', 7), '#ffffff')).toBeGreaterThanOrEqual(7);
  });
});

describe('nombres de color', () => {
  it('diccionario >= 120', () => expect(COLOR_NAMES.length).toBeGreaterThanOrEqual(120));
  it('cada color del diccionario se nombra a sí mismo', () => {
    for (const [n, h] of COLOR_NAMES) expect(colorName(h)).toBe(n);
  });
  it('aproxima', () => {
    expect(colorName('#000001')).toMatch(/Negro/);
    expect(colorName('#fefefe')).toMatch(/Blanco/);
    expect(colorName('#nope')).toBe('');
  });
});

describe('escala tonal', () => {
  it('11 pasos con luminancia monótona decreciente', () => {
    for (const c of ['#3366cc', '#ff5733', '#808080', '#00ff00', '#000000', '#ffffff', '#8c52ff']) {
      const s = tonalScale(c);
      expect(s).toHaveLength(11);
      for (let i = 1; i < s.length; i++) expect(luminance(s[i])).toBeLessThanOrEqual(luminance(s[i - 1]));
    }
  });
});

describe('daltonismo', () => {
  it('acromatopsia da grises', () => {
    const { r, g, b } = hexToRgb(simulateColorBlind('#ff5733', 'acromatopsia'))!;
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
  });
  it('el blanco sigue siendo ~blanco', () => {
    for (const k of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      const { r, g, b } = hexToRgb(simulateColorBlind('#ffffff', k))!;
      expect(Math.min(r, g, b)).toBeGreaterThan(245);
    }
  });
});

describe('moods', () => {
  it('>= 30 ambientes con 5 colores válidos', () => {
    expect(MOODS.length).toBeGreaterThanOrEqual(30);
    for (const m of MOODS) {
      expect(m.colors).toHaveLength(5);
      for (const c of m.colors) expect(hexToRgb(c)).not.toBeNull();
    }
  });
  it('siempre 5 hex válidos, también con texto raro y variaciones', () => {
    for (const t of ['atardecer', 'Café', 'PLAYA!!', 'xyzzy', '', '   ', 'ñandú 123', 'bosque encantado']) {
      for (let v = 0; v < 8; v++) {
        const r = moodPalette(t, v);
        expect(r.colors).toHaveLength(5);
        for (const c of r.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
  it('determinista y reconoce sinónimos', () => {
    expect(moodPalette('cafe', 3)).toEqual(moodPalette('café', 3));
    expect(moodPalette('atardecer').known).toBe(true);
    expect(moodPalette('atardecer', 1).colors).not.toEqual(moodPalette('atardecer', 0).colors);
    expect(moodPalette('zzqq').known).toBe(false);
  });
  it('sorpréndeme', () => {
    for (let s = 0; s < 50; s++) expect(surpriseMood(s).colors).toHaveLength(5);
  });
});

describe('paletas: importar', () => {
  it('GPL', () => {
    const p = parsePalette('GIMP Palette\nName: Prueba\nColumns: 4\n#\n255   0   0\tRojo\n  0 128 255\tAzul\n255 0 0 dup');
    expect(p.format).toBe('gpl');
    expect(p.name).toBe('Prueba');
    expect(p.colors).toEqual(['#ff0000', '#0080ff']);
  });
  it('CSS', () => {
    const p = parsePalette(':root{ --a:#F00; --b: rgb(0, 128, 255); --c:hsl(120, 100%, 50%); --size: 12px; }');
    expect(p.format).toBe('css');
    expect(p.colors).toEqual(['#ff0000', '#0080ff', '#00ff00']);
  });
  it('JSON', () => {
    expect(parsePalette('["#ff0000","#00ff00"]').colors).toEqual(['#ff0000', '#00ff00']);
    expect(parsePalette('{"name":"X","colors":[{"hex":"#112233"},{"hex":"#112233"}]}')).toMatchObject({
      name: 'X',
      colors: ['#112233'],
    });
    expect(parsePalette('{"a":"#fff","b":{"c":"#000"}}').colors).toEqual(['#ffffff', '#000000']);
  });
  it('hex sueltos', () => {
    expect(parsePalette('#ff0000, #00ff00 #0000ff\n123456').colors).toEqual(['#ff0000', '#00ff00', '#0000ff', '#123456']);
    expect(parsePalette('hola mundo').colors).toEqual([]);
    expect(parsePalette('').colors).toEqual([]);
    expect(parsePalette('{roto').colors).toEqual([]);
  });
  it('token', () => {
    expect(parseColorToken('#abc')).toBe('#aabbcc');
    expect(parseColorToken('#aabbcc80')).toBe('#aabbcc');
    expect(parseColorToken('nada')).toBeNull();
  });
});

describe('paletas: exportar y ciclo', () => {
  const cols = ['#ff0000', '#00ff00', '#0000ff', '#ff0001'];
  it('todos los formatos reimportan igual (salvo svg)', () => {
    for (const f of ['css', 'json', 'gpl'] as const) {
      expect(parsePalette(exportPalette(cols, f)).colors).toEqual(cols);
    }
  });
  it('css con nombres únicos', () => {
    const css = exportPalette(['#ff0000', '#ff0001'], 'css');
    const names = [...css.matchAll(/--([\w-]+):/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(2);
  });
  it('svg', () => {
    const s = exportPalette(cols, 'svg');
    expect(s).toContain('<svg');
    expect(s.match(/<rect /g)!.length).toBe(5);
  });
});
