import { describe, expect, it } from 'vitest';
import { niceTicks, parseNumber, parsePasted, pastedToChart } from './charts';

describe('niceTicks', () => {
  it('rango normal', () => {
    const t = niceTicks(0, 97);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(97);
    expect(t.every((v) => Number.isFinite(v))).toBe(true);
  });
  it('negativo', () => {
    const t = niceTicks(-30, 70);
    expect(t[0]).toBeLessThanOrEqual(-30);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(70);
    expect(t).toContain(0);
  });
  it('min == max', () => {
    const t = niceTicks(5, 5);
    expect(t.length).toBeGreaterThan(1);
    expect(t[0]).toBeLessThan(5);
    expect(t[t.length - 1]).toBeGreaterThan(5);
  });
  it('todo cero', () => {
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });
  it('no produce NaN con entradas raras', () => {
    expect(niceTicks(NaN, Infinity).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('parseNumber', () => {
  it('formatos', () => {
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('12')).toBe(12);
    expect(parseNumber('-3,25')).toBe(-3.25);
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('')).toBeNaN();
  });
});

describe('parsePasted', () => {
  it('tabuladores', () => {
    expect(parsePasted('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('punto y coma con decimales', () => {
    expect(parsePasted('x;y\nq1;1.234,5')).toEqual([['x', 'y'], ['q1', '1.234,5']]);
  });
  it('comas', () => {
    expect(parsePasted('a,b,c\r\n1,2,3\r\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
  it('rellena filas cortas', () => {
    expect(parsePasted('a\tb\n1')).toEqual([['a', 'b'], ['1', '']]);
  });
  it('a gráfica con encabezado', () => {
    const r = pastedToChart(parsePasted('Mes\tVentas\nEne\t1.234,5\nFeb\t10'))!;
    expect(r.labels).toEqual(['Ene', 'Feb']);
    expect(r.series[0].name).toBe('Ventas');
    expect(r.series[0].values).toEqual([1234.5, 10]);
  });
  it('a gráfica sin encabezado', () => {
    const r = pastedToChart(parsePasted('Ene;5\nFeb;7'))!;
    expect(r.labels).toEqual(['Ene', 'Feb']);
    expect(r.series[0].values).toEqual([5, 7]);
  });
});
