import { describe, expect, it } from 'vitest';
import { clampMenu, ctxItems, LONG_PRESS_TOLERANCE, pressStillValid } from './contextMenuLogic';

const ids = (c: Parameters<typeof ctxItems>[0]) => ctxItems(c).filter((x) => x !== null);

describe('entradas del menú contextual', () => {
  it('sobre vacío: pegar, seleccionar todo y agregar página', () => {
    expect(ids({ layer: false })).toEqual(['paste', 'selectAll', 'addPage']);
  });
  it('sobre una capa: todo lo pedido', () => {
    const l = ids({ layer: true });
    for (const k of ['copy', 'paste', 'duplicate', 'front', 'back', 'lock', 'hide', 'blend', 'delete']) expect(l).toContain(k);
    expect(l).not.toContain('group');
    expect(l).not.toContain('ungroup');
    expect(l).not.toContain('editText');
  });
  it('agrupar solo con varias capas; desagrupar solo si pertenece a un grupo; editar texto solo con una', () => {
    expect(ids({ layer: true, multi: true })).toContain('group');
    expect(ids({ layer: true, grouped: true })).toContain('ungroup');
    expect(ids({ layer: true, isText: true })).toContain('editText');
    expect(ids({ layer: true, isText: true, multi: true })).not.toContain('editText');
  });
  it('sin separadores seguidos ni al borde', () => {
    for (const c of [{ layer: true }, { layer: true, multi: true, grouped: true, isText: true }, { layer: false }]) {
      const l = ctxItems(c);
      expect(l[0]).not.toBeNull();
      expect(l[l.length - 1]).not.toBeNull();
      l.forEach((x, i) => i && expect(x === null && l[i - 1] === null).toBe(false));
    }
  });
});

describe('colocación y pulsación larga', () => {
  it('el menú no se sale de la ventana', () => {
    expect(clampMenu({ x: 10, y: 10 }, { w: 200, h: 300 }, 1000, 800)).toEqual({ left: 10, top: 10 });
    expect(clampMenu({ x: 900, y: 700 }, { w: 200, h: 300 }, 1000, 800)).toEqual({ left: 700, top: 492 });
    const tiny = clampMenu({ x: 50, y: 50 }, { w: 300, h: 900 }, 390, 700);
    expect(tiny.left).toBeGreaterThanOrEqual(8);
    expect(tiny.top).toBeGreaterThanOrEqual(8);
  });
  it('la pulsación larga se cancela si el dedo se mueve', () => {
    expect(pressStillValid({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
    expect(pressStillValid({ x: 0, y: 0 }, { x: LONG_PRESS_TOLERANCE + 1, y: 0 })).toBe(false);
  });
});
