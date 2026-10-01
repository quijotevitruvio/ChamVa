import { describe, it, expect } from 'vitest';
import { buildHistory, describeStep, jumpInHistory } from './historyLogic';
import type { Doc } from '../core/types';

const mk = (over: Partial<Doc> = {}, layers: unknown[] = []): Doc =>
  ({ id: 'd', name: 'x', width: 100, height: 100, background: { type: 'solid', color: '#fff' }, layers, version: 1, ...over }) as unknown as Doc;
const layer = (o: Record<string, unknown> = {}) => ({ id: 'a', name: 'A', x: 0, y: 0, rotation: 0, opacity: 1, visible: true, locked: false, ...o });

describe('describeStep', () => {
  it('detecta añadir y borrar', () => {
    expect(describeStep(mk(), mk({}, [layer()]))).toBe('Añadir capa');
    expect(describeStep(mk({}, [layer()]), mk())).toBe('Borrar capa');
  });
  it('detecta mover, color y texto', () => {
    const a = mk({}, [layer({ fill: '#000', text: 'hi' })]);
    expect(describeStep(a, mk({}, [layer({ fill: '#000', text: 'hi', x: 5 })]))).toBe('Mover capa');
    expect(describeStep(a, mk({}, [layer({ fill: '#f00', text: 'hi' })]))).toBe('Cambiar color');
    expect(describeStep(a, mk({}, [layer({ fill: '#000', text: 'yo' })]))).toBe('Editar texto');
  });
  it('cambio genérico', () => {
    expect(describeStep(mk(), mk({}))).toBe('Cambio');
  });
});

describe('historial', () => {
  const d0 = mk({ version: 0 }), d1 = mk({ version: 1 }), d2 = mk({ version: 2 }), d3 = mk({ version: 3 });
  it('buildHistory marca actual y futuros', () => {
    const h = buildHistory([d0, d1], d2, [d3]);
    expect(h.map((i) => i.current)).toEqual([false, false, true, false]);
    expect(h.map((i) => i.future)).toEqual([false, false, false, true]);
    expect(h[0].label).toBe('Estado inicial');
  });
  it('saltar atrás mantiene la línea de tiempo', () => {
    const r = jumpInHistory([d0, d1], d2, [d3], 0)!;
    expect(r.doc).toBe(d0);
    expect(r.past).toEqual([]);
    expect(r.future).toEqual([d1, d2, d3]);
  });
  it('saltar adelante', () => {
    const r = jumpInHistory([d0], d1, [d2, d3], 3)!;
    expect(r.doc).toBe(d3);
    expect(r.past).toEqual([d0, d1, d2]);
    expect(r.future).toEqual([]);
  });
  it('índice actual o inválido -> null', () => {
    expect(jumpInHistory([d0], d1, [], 1)).toBeNull();
    expect(jumpInHistory([d0], d1, [], 5)).toBeNull();
    expect(jumpInHistory([d0], d1, [], -1)).toBeNull();
  });
});
