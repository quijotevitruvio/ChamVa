import { describe, expect, it } from 'vitest';
import {
  PAPER_SIZES, clampPx, convert, formatSize, fromPx, orientation, parseLength, sizeInPx, toPx,
} from './units';

describe('unidades', () => {
  it('1 in = 25,4 mm = 2,54 cm = 72 pt = 6 pc', () => {
    expect(convert(1, 'in', 'mm')).toBeCloseTo(25.4, 10);
    expect(convert(1, 'in', 'cm')).toBeCloseTo(2.54, 10);
    expect(convert(1, 'in', 'pt')).toBeCloseTo(72, 10);
    expect(convert(1, 'in', 'pc')).toBeCloseTo(6, 10);
  });
  it('ida y vuelta px↔cm↔in a varios dpi', () => {
    for (const dpi of [96, 150, 300]) {
      for (const px of [100, 1080, 2480]) {
        const cm = fromPx(px, 'cm', dpi);
        expect(toPx(cm, 'cm', dpi)).toBeCloseTo(px, 8);
        expect(convert(convert(px, 'px', 'in', dpi), 'in', 'cm', dpi)).toBeCloseTo(cm, 8);
      }
    }
  });
  it('A4 a 300 dpi = 2480×3508 y a 96 dpi = 794×1123', () => {
    const a4 = PAPER_SIZES.find((p) => p.id === 'a4')!;
    expect(sizeInPx(a4, 300)).toEqual({ width: 2480, height: 3508 });
    expect(sizeInPx(a4, 300, true)).toEqual({ width: 3508, height: 2480 });
    expect(sizeInPx(a4, 96)).toEqual({ width: 794, height: 1123 });
    expect(orientation(a4)).toBe('vertical');
  });
  it('dpi inválido cae a 96', () => {
    expect(toPx(1, 'in', NaN)).toBe(96);
    expect(toPx(1, 'in', 0)).toBe(96);
  });
  it('formatSize: decimales por unidad y locale', () => {
    expect(formatSize(29.7, 'cm', 'es-CO')).toBe('29,7');
    expect(formatSize(29.7, 'cm', 'en-US')).toBe('29.7');
    expect(formatSize(21, 'cm', 'es')).toBe('21');
    expect(formatSize(1080.4, 'px', 'es')).toBe('1080');
    expect(formatSize(8.5, 'in', 'en-US')).toBe('8.5');
    expect(formatSize(210.04, 'mm', 'en-US')).toBe('210');
    expect(formatSize(NaN, 'px', 'en-US')).toBe('0');
  });
  it('parseLength con coma, punto y unidad opcional', () => {
    expect(parseLength('21,59 cm')).toEqual({ value: 21.59, unit: 'cm' });
    expect(parseLength('8.5in')).toEqual({ value: 8.5, unit: 'in' });
    expect(parseLength('1080')).toEqual({ value: 1080 });
    expect(parseLength(' 210mm ')).toEqual({ value: 210, unit: 'mm' });
    expect(parseLength('5 pulgadas')).toEqual({ value: 5, unit: 'in' });
  });
  it('parseLength: basura devuelve null', () => {
    for (const s of ['', 'abc', '-5', '12 foo', '1.2.3', 'cm', '12 cm cm']) expect(parseLength(s)).toBeNull();
  });
  it('redondeo estable', () => {
    const px = clampPx(toPx(21, 'cm', 300));
    expect(px).toBe(2480);
    expect(clampPx(toPx(fromPx(px, 'cm', 300), 'cm', 300))).toBe(px);
  });
  it('clampPx respeta 16–8000', () => {
    expect(clampPx(1)).toBe(16);
    expect(clampPx(99999)).toBe(8000);
    expect(clampPx(NaN)).toBe(16);
    expect(clampPx(100.6)).toBe(101);
  });
});
