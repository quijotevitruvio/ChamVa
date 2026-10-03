import { describe, expect, it } from 'vitest';
import { isCurrentDesign, needsOpenConfirm, pagesLabel, projectSummary, shortDate } from './projectsList';

describe('projectsList', () => {
  it('pide confirmación solo si el guardado falló', () => {
    expect(needsOpenConfirm('error')).toBe(true);
    for (const s of ['idle', 'pending', 'saving', 'saved'] as const) expect(needsOpenConfirm(s)).toBe(false);
  });
  it('reconoce el diseño abierto', () => {
    expect(isCurrentDesign('a', 'a')).toBe(true);
    expect(isCurrentDesign('a', 'b')).toBe(false);
  });
  it('singular y plural de páginas', () => {
    expect(pagesLabel(1)).toBe('1 pág.');
    expect(pagesLabel(4)).toBe('4 págs.');
  });
  it('fecha distinta según sea de hoy o no', () => {
    const now = new Date(2026, 4, 12, 15, 0).getTime();
    const today = shortDate(new Date(2026, 4, 12, 9, 5).getTime(), now);
    const old = shortDate(new Date(2026, 1, 3, 9, 5).getTime(), now);
    expect(today).toMatch(/\d/);
    expect(today).not.toBe(old);
  });
  it('resumen', () => {
    const now = Date.now();
    expect(projectSummary({ pages: [1, 2], updatedAt: now }, now)).toContain('2 págs. · ');
  });
});
