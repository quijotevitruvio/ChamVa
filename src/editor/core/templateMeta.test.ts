import { describe, it, expect } from 'vitest';
import {
  swatchIndexOf, colorHistogram, dominantSwatchId, hasColor, normalizeTags,
  matchesTemplate, presetTags, EMPTY_FILTER,
} from './templateMeta';

describe('color dominante', () => {
  it('clasifica colores básicos', () => {
    expect(swatchIndexOf(229, 57, 53)).toBe(0);
    expect(swatchIndexOf(30, 136, 229)).toBe(4);
    expect(swatchIndexOf(67, 160, 71)).toBe(3);
    expect(swatchIndexOf(255, 255, 255)).toBe(6);
    expect(swatchIndexOf(10, 10, 10)).toBe(7);
    expect(swatchIndexOf(142, 36, 170)).toBe(5);
  });
  it('histograma y dominante, ignorando transparentes', () => {
    const px = [30, 136, 229, 255, 30, 136, 229, 255, 255, 255, 255, 255, 0, 0, 0, 0];
    const h = colorHistogram(px);
    expect(dominantSwatchId(h)).toBe('azul');
    expect(h[4]).toBeCloseTo(2 / 3);
    expect(hasColor(h, 'claro')).toBe(true); // 33 % >= 25 %
    expect(hasColor(h, 'rojo')).toBe(false);
    expect(dominantSwatchId(colorHistogram([]))).toBeNull();
  });
});

describe('etiquetas y filtro', () => {
  it('normaliza etiquetas', () => {
    expect(normalizeTags('redes, Venta ; redes,  ')).toEqual(['redes', 'Venta']);
  });
  it('etiquetas de fábrica', () => {
    expect(presetTags('Rebajas', 1080, 1080)).toContain('Ventas');
    expect(presetTags('Otra', 2480, 3508)).toEqual(['Impresión']);
  });
  it('filtra por texto (sin tildes), etiqueta y color', () => {
    const t = { name: 'Promoción', tags: ['Redes', 'Ventas'], hist: [0, 0, 0, 0, 1, 0, 0, 0] };
    expect(matchesTemplate(t, { ...EMPTY_FILTER, query: 'promocion' })).toBe(true);
    expect(matchesTemplate(t, { ...EMPTY_FILTER, query: 'ventas redes' })).toBe(true);
    expect(matchesTemplate(t, { ...EMPTY_FILTER, query: 'xyz' })).toBe(false);
    expect(matchesTemplate(t, { ...EMPTY_FILTER, tag: 'redes' })).toBe(true);
    expect(matchesTemplate(t, { ...EMPTY_FILTER, tag: 'Eventos' })).toBe(false);
    expect(matchesTemplate(t, { ...EMPTY_FILTER, color: 'azul' })).toBe(true);
    expect(matchesTemplate(t, { ...EMPTY_FILTER, color: 'rojo' })).toBe(false);
    expect(matchesTemplate({ ...t, hist: undefined }, { ...EMPTY_FILTER, color: 'rojo' }, false)).toBe(true);
  });
});
