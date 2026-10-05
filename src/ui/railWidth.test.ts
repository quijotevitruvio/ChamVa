import { describe, expect, it } from 'vitest';
import {
  RAIL_DEFAULT,
  RAIL_HIDDEN_KEY,
  RAIL_MAX,
  RAIL_MIN,
  RAIL_STEP,
  RAIL_WIDTH_KEY,
  clampRail,
  loadRailHidden,
  loadRailWidth,
  railKeyStep,
  railMax,
  saveRailHidden,
  saveRailWidth,
} from './railWidth';

function fakeStore(init: Record<string, string> = {}) {
  const m = { ...init };
  return {
    m,
    getItem: (k: string) => (k in m ? m[k] : null),
    setItem: (k: string, v: string) => {
      m[k] = v;
    },
  };
}
const broken = {
  getItem: () => {
    throw new Error('bloqueado');
  },
  setItem: () => {
    throw new Error('bloqueado');
  },
};

describe('ancho del panel izquierdo', () => {
  it('limita entre 260 y 560', () => {
    expect(clampRail(100, 1920)).toBe(RAIL_MIN);
    expect(clampRail(900, 1920)).toBe(RAIL_MAX);
    expect(clampRail(333.4, 1920)).toBe(333);
    expect(clampRail(NaN, 1920)).toBe(RAIL_DEFAULT);
  });
  it('el máximo no pasa del 45 % de la ventana, pero nunca baja del mínimo', () => {
    expect(railMax(1000)).toBe(450);
    expect(railMax(1280)).toBe(560);
    expect(railMax(500)).toBe(RAIL_MIN);
    expect(clampRail(560, 1000)).toBe(450);
  });
  it('teclado: flechas ±16, Home y End', () => {
    expect(railKeyStep('ArrowRight', 300, 1920)).toBe(300 + RAIL_STEP);
    expect(railKeyStep('ArrowLeft', 300, 1920)).toBe(300 - RAIL_STEP);
    expect(railKeyStep('ArrowLeft', 262, 1920)).toBe(RAIL_MIN);
    expect(railKeyStep('ArrowRight', 556, 1920)).toBe(RAIL_MAX);
    expect(railKeyStep('Home', 400, 1920)).toBe(RAIL_MIN);
    expect(railKeyStep('End', 400, 1920)).toBe(RAIL_MAX);
    expect(railKeyStep('End', 400, 1000)).toBe(450);
    expect(railKeyStep('a', 400, 1920)).toBeNull();
  });
  it('guarda y recupera el ancho; valores corruptos vuelven al normal', () => {
    const s = fakeStore();
    expect(loadRailWidth(1920, s)).toBe(RAIL_DEFAULT);
    saveRailWidth(412.6, s);
    expect(s.m[RAIL_WIDTH_KEY]).toBe('413');
    expect(loadRailWidth(1920, s)).toBe(413);
    expect(loadRailWidth(800, s)).toBe(360);
    expect(loadRailWidth(1920, fakeStore({ [RAIL_WIDTH_KEY]: 'abc' }))).toBe(RAIL_DEFAULT);
    expect(loadRailWidth(1920, fakeStore({ [RAIL_WIDTH_KEY]: '9999' }))).toBe(RAIL_MAX);
  });
  it('guarda si está oculto', () => {
    const s = fakeStore();
    expect(loadRailHidden(s)).toBe(false);
    saveRailHidden(true, s);
    expect(s.m[RAIL_HIDDEN_KEY]).toBe('1');
    expect(loadRailHidden(s)).toBe(true);
    saveRailHidden(false, s);
    expect(loadRailHidden(s)).toBe(false);
  });
  it('sin almacenamiento no falla', () => {
    expect(loadRailWidth(1920, broken)).toBe(RAIL_DEFAULT);
    expect(() => saveRailWidth(300, broken)).not.toThrow();
    expect(loadRailHidden(broken)).toBe(false);
    expect(() => saveRailHidden(true, broken)).not.toThrow();
    expect(loadRailWidth(1920, null)).toBe(RAIL_DEFAULT);
  });
});
