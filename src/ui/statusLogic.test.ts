import { describe, expect, it } from 'vitest';
import { activeToolDef, statusHints, toolStatus, zoomPercent } from './statusLogic';

const keyMap: Record<string, string> = { toolRect: 'R', toolHand: 'H', toolSelect: 'V', toolBrush: 'B', group: 'Ctrl+G', blendNext: 'Alt+Shift+↓' };
const key = (a: string) => keyMap[a] ?? '';
const base = { selectionCount: 0, key };

describe('barra de estado', () => {
  it('herramienta activa con su tecla (también personalizada)', () => {
    expect(toolStatus({ tool: 'select', key })).toEqual({ label: 'Puntero', key: 'V' });
    expect(toolStatus({ tool: 'shape', shape: 'rect', key })).toEqual({ label: 'Rectángulo', key: 'R' });
    expect(toolStatus({ tool: 'brush', key: () => 'P' })).toEqual({ label: 'Pincel', key: 'P' });
  });
  it('Espacio muestra la mano temporal', () => {
    expect(activeToolDef('text', undefined, true).id).toBe('hand');
    expect(statusHints({ ...base, tool: 'text', spaceHeld: true })[0]).toMatch(/mover el lienzo/);
  });
  it('pistas por herramienta', () => {
    expect(statusHints({ ...base, tool: 'shape', shape: 'rect' })).toContain('Mayús: proporcional');
    expect(statusHints({ ...base, tool: 'shape', shape: 'line' })).toContain('Mayús: ángulos de 15°');
    expect(statusHints({ ...base, tool: 'select' })).toContain('Espacio: mano');
    expect(statusHints({ ...base, tool: 'select', selectionCount: 1 }).join()).toMatch(/Alt\+Shift\+↓: fusión/);
    expect(statusHints({ ...base, tool: 'select', selectionCount: 3 })[0]).toBe('Ctrl+G: agrupar');
  });
  it('nunca más de 3 pistas', () => {
    for (const tool of ['select', 'hand', 'zoom', 'text', 'shape', 'brush', 'eraser'] as const)
      expect(statusHints({ ...base, tool }).length).toBeLessThanOrEqual(3);
  });
  it('zoom como porcentaje', () => {
    expect(zoomPercent(0.4567)).toBe(46);
    expect(zoomPercent(0)).toBe(1);
  });
});
