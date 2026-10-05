import { describe, expect, it } from 'vitest';
import { memoryBudgetBytes, planPerspectiveOutput } from './perspectiveLimit';

describe('perspectiva: tamaño de salida', () => {
  it('una foto normal de 12 MP sale a tamaño completo, sin avisos', () => {
    const p = planPerspectiveOutput({ w: 4000, h: 3000 }, 12e6, 8);
    expect(p.reduced).toBe(false);
    expect(p.options[0]).toMatchObject({ id: 'full', w: 4000, h: 3000, risky: false });
    expect(p.defaultId).toBe('full');
  });

  it('50 MP en un equipo de 8 GB ya no se reduce a 4096 en silencio', () => {
    const p = planPerspectiveOutput({ w: 8000, h: 6250 }, 50e6, 8);
    const def = p.options.find((o) => o.id === p.defaultId)!;
    expect(def.w).toBeGreaterThan(4096);
    expect(def.risky).toBe(false);
  });

  it('con poca memoria recomienda un tamaño menor, avisa y deja elegir el máximo', () => {
    const p = planPerspectiveOutput({ w: 8000, h: 6250 }, 50e6, 1);
    expect(p.reduced).toBe(true);
    const full = p.options.find((o) => o.id === 'full')!;
    const safe = p.options.find((o) => o.id === 'safe')!;
    expect(full.risky).toBe(true);
    expect(safe.w).toBeLessThan(full.w);
    expect(p.defaultId).toBe('safe');
  });

  it('respeta el límite duro del canvas', () => {
    const p = planPerspectiveOutput({ w: 40000, h: 1000 }, 1e6, 8);
    expect(Math.max(...p.options.map((o) => o.w))).toBeLessThanOrEqual(16384);
    expect(p.options[0].label).toContain('Máximo del navegador');
  });

  it('sin deviceMemory asume un equipo de 4 GB', () => {
    expect(memoryBudgetBytes(undefined)).toBe(memoryBudgetBytes(4));
    expect(memoryBudgetBytes(8)).toBeGreaterThan(memoryBudgetBytes(2));
  });

  it('las proporciones se conservan', () => {
    const p = planPerspectiveOutput({ w: 8000, h: 4000 }, 32e6, 1);
    for (const o of p.options) expect(Math.abs(o.w / o.h - 2)).toBeLessThan(0.01);
  });
});

describe('perspectiva: opción de compatibilidad', () => {
  it('con una salida enorme el tope antiguo de 4096 px sigue como opción', () => {
    const p = planPerspectiveOutput({ w: 16000, h: 12000 }, 0, 8);
    expect(p.options.some((o) => o.id === 'compat' && Math.max(o.w, o.h) === 4096)).toBe(true);
    expect(p.reduced).toBe(true);
  });
});
