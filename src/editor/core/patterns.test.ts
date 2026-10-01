import { describe, expect, it } from 'vitest';
import { DEFAULT_PATTERN, PATTERN_KINDS, normalizePattern, patternPrims, svgPatternDef } from './patterns';

describe('patrones de fondo', () => {
  it('todos los tipos generan primitivas', () => {
    for (const { kind } of PATTERN_KINDS)
      expect(patternPrims({ ...DEFAULT_PATTERN, kind }).length).toBeGreaterThan(0);
  });
  it('los puntos van centrados con el grosor como radio', () => {
    const [p] = patternPrims({ ...DEFAULT_PATTERN, kind: 'dots', size: 20, thickness: 3 });
    expect(p).toMatchObject({ t: 'circle', x: 10, y: 10, r: 3 });
  });
  it('los cuadros ocupan dos cuartos opuestos', () => {
    const r = patternPrims({ ...DEFAULT_PATTERN, kind: 'checks', size: 10 });
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({ x: 5, y: 5, w: 5, h: 5 });
  });
  it('normaliza valores fuera de rango o ausentes', () => {
    expect(normalizePattern(undefined)).toEqual(DEFAULT_PATTERN);
    const p = normalizePattern({ kind: 'nope' as never, size: 9999, thickness: 500 });
    expect(p.kind).toBe('dots');
    expect(p.size).toBe(400);
    expect(p.thickness).toBe(200);
  });
  it('SVG: <pattern> con fondo y motivo', () => {
    const s = svgPatternDef('bgp', { ...DEFAULT_PATTERN, kind: 'waves', size: 30 });
    expect(s).toContain('<pattern id="bgp" width="30" height="30"');
    expect(s).toContain('<path');
    expect(s.startsWith('<pattern')).toBe(true);
  });
});
