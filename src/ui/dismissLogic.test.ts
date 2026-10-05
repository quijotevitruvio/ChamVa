import { describe, expect, it } from 'vitest';
import {
  backdropShouldClose,
  escShouldClose,
  isTopLayer,
  layerCount,
  popLayer,
  pushLayer,
  trapIndex,
} from './dismissLogic';

describe('trapIndex (trampa de foco)', () => {
  it('sin elementos no hace nada', () => {
    expect(trapIndex(0, -1, false)).toBeNull();
  });
  it('Tab en el último vuelve al primero', () => {
    expect(trapIndex(4, 3, false)).toBe(0);
  });
  it('Shift+Tab en el primero salta al último', () => {
    expect(trapIndex(4, 0, true)).toBe(3);
  });
  it('en medio deja el comportamiento normal', () => {
    expect(trapIndex(4, 1, false)).toBeNull();
    expect(trapIndex(4, 2, true)).toBeNull();
  });
  it('si el foco está fuera, entra por el primero o el último', () => {
    expect(trapIndex(3, -1, false)).toBe(0);
    expect(trapIndex(3, -1, true)).toBe(2);
  });
  it('con un solo elemento siempre se queda en él', () => {
    expect(trapIndex(1, 0, false)).toBe(0);
    expect(trapIndex(1, 0, true)).toBe(0);
  });
});

describe('pila de capas', () => {
  it('solo la capa de arriba es la activa', () => {
    const base = layerCount();
    const a = pushLayer();
    const b = pushLayer();
    expect(isTopLayer(a)).toBe(false);
    expect(isTopLayer(b)).toBe(true);
    popLayer(b);
    expect(isTopLayer(a)).toBe(true);
    popLayer(a);
    expect(layerCount()).toBe(base);
  });
  it('cerrar una capa que no está arriba no rompe la pila', () => {
    const a = pushLayer();
    const b = pushLayer();
    popLayer(a);
    expect(isTopLayer(b)).toBe(true);
    popLayer(b);
    popLayer(b); // doble cierre: inocuo
  });
});

describe('backdropShouldClose', () => {
  const el = {};
  it('cierra con un clic directo en el fondo', () => {
    expect(backdropShouldClose(el, el)).toBe(true);
  });
  it('no cierra si el clic fue dentro de la tarjeta', () => {
    expect(backdropShouldClose({}, el)).toBe(false);
  });
  it('no cierra si hay cambios sin guardar, está ocupado o se desactivó', () => {
    expect(backdropShouldClose(el, el, { dirty: true })).toBe(false);
    expect(backdropShouldClose(el, el, { busy: true })).toBe(false);
    expect(backdropShouldClose(el, el, { backdrop: false })).toBe(false);
  });
});

describe('escShouldClose', () => {
  it('solo Esc', () => {
    expect(escShouldClose({ key: 'Escape' })).toBe(true);
    expect(escShouldClose({ key: 'Enter' })).toBe(false);
  });
  it('respeta un Esc ya consumido o con IME', () => {
    expect(escShouldClose({ key: 'Escape', defaultPrevented: true })).toBe(false);
    expect(escShouldClose({ key: 'Escape', isComposing: true })).toBe(false);
  });
});
