import { beforeEach, describe, expect, it } from 'vitest';
import {
  TOOL_DEFS,
  boxFromPoints,
  boxesIntersect,
  cursorFor,
  effectiveTool,
  razorTime,
  shapeFromDrag,
  toolAfterCreate,
  toolForAction,
  toolOnEscape,
  toggleTool,
  videoCursor,
  videoToolForKey,
  zoomAfterClick,
  zoomToBox,
  isClickGesture,
} from './toolLogic';
import { useTool } from './toolStore';
import { useBrush } from './brushStore';
import { ACTIONS, actionForEvent, getShortcut, _setOverridesForTest } from '../core/shortcuts';

const key = (k: string, extra: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

describe('transiciones de herramienta', () => {
  beforeEach(() => {
    _setOverridesForTest({});
    useTool.setState({ tool: 'select', shape: 'rect', spaceHeld: false });
  });

  it('Espacio activa la mano de forma temporal sin cambiar la herramienta elegida', () => {
    expect(effectiveTool('brush', true)).toBe('hand');
    expect(effectiveTool('brush', false)).toBe('brush');
    useTool.getState().setTool('text');
    useTool.getState().setSpaceHeld(true);
    expect(useTool.getState().tool).toBe('text');
    expect(effectiveTool(useTool.getState().tool, useTool.getState().spaceHeld)).toBe('hand');
    useTool.getState().setSpaceHeld(false);
    expect(effectiveTool(useTool.getState().tool, useTool.getState().spaceHeld)).toBe('text');
  });

  it('Esc vuelve siempre al puntero', () => {
    for (const t of ['select', 'hand', 'zoom', 'text', 'shape', 'brush', 'eraser'] as const) expect(toolOnEscape(t)).toBe('select');
    useTool.getState().setTool('shape', 'ellipse');
    useTool.getState().escape();
    expect(useTool.getState().tool).toBe('select');
  });

  it('tras crear texto o forma vuelve al puntero, salvo con Shift', () => {
    expect(toolAfterCreate('text', false)).toBe('select');
    expect(toolAfterCreate('shape', false)).toBe('select');
    expect(toolAfterCreate('shape', true)).toBe('shape');
    useTool.getState().setTool('text');
    useTool.getState().afterCreate(true);
    expect(useTool.getState().tool).toBe('text');
    useTool.getState().afterCreate(false);
    expect(useTool.getState().tool).toBe('select');
  });

  it('pulsar otra vez el pincel o el borrador activo lo apaga; el resto no alterna', () => {
    expect(toggleTool('brush', 'brush')).toBe('select');
    expect(toggleTool('eraser', 'eraser')).toBe('select');
    expect(toggleTool('brush', 'eraser')).toBe('eraser');
    expect(toggleTool('hand', 'hand')).toBe('hand');
    expect(toggleTool('select', 'zoom')).toBe('zoom');
  });

  it('el pincel usa la misma fuente de verdad que la barra de herramientas', () => {
    useBrush.getState().setTool('eraser');
    expect(useTool.getState().tool).toBe('eraser');
    useBrush.getState().setStyle('pen');
    expect(useTool.getState().tool).toBe('brush');
    useBrush.getState().setActive(false);
    expect(useTool.getState().tool).toBe('select');
    useTool.getState().setTool('hand');
    expect('active' in useBrush.getState()).toBe(false);
  });
});

describe('atajos', () => {
  beforeEach(() => _setOverridesForTest({}));
  it('cada herramienta tiene su tecla y no choca con otra acción', () => {
    // W = varita; el lazo va en Mayús+L porque L ya es la línea.
    const keys = ['V', 'H', 'Z', 'T', 'R', 'O', 'L', 'B', 'E', 'W', 'Shift+L'];
    TOOL_DEFS.forEach((d, i) => {
      expect(getShortcut(d.action)).toBe(d.key);
      expect(keys).toContain(d.key);
      const shift = d.key.startsWith('Shift+');
      const k = shift ? d.key.slice(6) : d.key.toLowerCase();
      expect(actionForEvent(key(k, { shiftKey: shift }))).toBe(d.action);
      expect(i).toBeGreaterThanOrEqual(0);
    });
    const all = ACTIONS.map((a) => getShortcut(a.id)).filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
  });
  it('toolForAction traduce la acción a herramienta y forma', () => {
    expect(toolForAction('toolEllipse')).toEqual({ tool: 'shape', shape: 'ellipse' });
    expect(toolForAction('toolHand')).toEqual({ tool: 'hand', shape: undefined });
    expect(toolForAction('undo')).toBeNull();
  });
});

describe('cursor', () => {
  it('uno por herramienta', () => {
    expect(cursorFor({ tool: 'select' })).toBe('default');
    expect(cursorFor({ tool: 'hand' })).toBe('grab');
    expect(cursorFor({ tool: 'hand', panning: true })).toBe('grabbing');
    expect(cursorFor({ tool: 'zoom' })).toBe('zoom-in');
    expect(cursorFor({ tool: 'zoom', altKey: true })).toBe('zoom-out');
    expect(cursorFor({ tool: 'text' })).toBe('text');
    expect(cursorFor({ tool: 'shape' })).toBe('crosshair');
    expect(cursorFor({ tool: 'brush' })).toBe('crosshair');
  });
  it('prioridad: Espacio gana a cualquier herramienta; la herramienta gana a lo que haya debajo', () => {
    expect(cursorFor({ tool: 'text', spaceHeld: true })).toBe('grab');
    expect(cursorFor({ tool: 'brush', spaceHeld: true, panning: true })).toBe('grabbing');
    expect(cursorFor({ tool: 'text', over: 'locked' })).toBe('text');
    expect(cursorFor({ tool: 'hand', over: 'locked' })).toBe('grab');
    expect(cursorFor({ tool: 'select', over: 'locked' })).toBe('not-allowed');
    expect(cursorFor({ tool: 'select', over: 'free' })).toBe('move');
    expect(cursorFor({ tool: 'select', over: 'none' })).toBe('default');
  });
});

describe('zoom', () => {
  it('clic acerca, Alt aleja, con tope', () => {
    expect(zoomAfterClick(1, false)).toBeCloseTo(1.5);
    expect(zoomAfterClick(1, true)).toBeCloseTo(1 / 1.5);
    expect(zoomAfterClick(5, false)).toBe(5);
    expect(zoomAfterClick(0.1, true)).toBe(0.1);
  });
  it('recuadro: amplía lo justo y centra la zona', () => {
    const r = zoomToBox(1, { x: 100, y: 50, w: 200, h: 100 }, { w: 800, h: 400, scrollLeft: 0, scrollTop: 0 });
    expect(r.zoom).toBe(4);
    expect(r.ratio).toBe(4);
    expect(r.scrollLeft).toBe(200 * 4 - 400); // centro x = 200
    expect(r.scrollTop).toBe(100 * 4 - 200);
    // el zoom no supera el máximo
    expect(zoomToBox(1, { x: 0, y: 0, w: 4, h: 4 }, { w: 800, h: 400, scrollLeft: 0, scrollTop: 0 }).zoom).toBe(5);
  });
  it('distingue clic de arrastre', () => {
    expect(isClickGesture(1, 2)).toBe(true);
    expect(isClickGesture(10, 0)).toBe(false);
  });
});

describe('formas y caja de selección', () => {
  it('rectángulo entre dos puntos, también hacia atrás', () => {
    expect(shapeFromDrag('rect', [10, 20], [110, 70])).toEqual({ x: 10, y: 20, width: 100, height: 50, rotation: 0 });
    expect(shapeFromDrag('rect', [110, 70], [10, 20])).toEqual({ x: 10, y: 20, width: 100, height: 50, rotation: 0 });
  });
  it('Shift hace la forma proporcional', () => {
    const s = shapeFromDrag('ellipse', [0, 0], [100, 40], { shift: true });
    expect(s.width).toBe(100);
    expect(s.height).toBe(100);
  });
  it('un clic crea una forma de tamaño por defecto centrada en el punto', () => {
    expect(shapeFromDrag('rect', [500, 500], [501, 500], { clickSize: 200 })).toEqual({ x: 400, y: 400, width: 200, height: 200, rotation: 0 });
  });
  it('la línea toma largo y ángulo del arrastre', () => {
    const l = shapeFromDrag('line', [0, 0], [0, 100], { lineThickness: 6 });
    expect(l.width).toBeCloseTo(100);
    expect(l.rotation).toBeCloseTo(90);
    const snapped = shapeFromDrag('line', [0, 0], [100, 30], { shift: true });
    expect(snapped.rotation % 15).toBeCloseTo(0);
  });
  it('cajas', () => {
    const b = boxFromPoints([50, 60], [10, 20]);
    expect(b).toEqual({ x: 10, y: 20, w: 40, h: 40 });
    expect(boxesIntersect(b, { x: 40, y: 50, w: 100, h: 100 })).toBe(true);
    expect(boxesIntersect(b, { x: 60, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('cuchilla del editor de video', () => {
  const clip = { start: 2, duration: 4 };
  it('corta en el punto del clic', () => {
    expect(razorTime(3.3, 10, 100, clip)).toBe(3.3);
  });
  it('con imán: si el cabezal está a menos de 8 px, corta exactamente en el cabezal', () => {
    expect(razorTime(3.33, 3.3, 100, clip)).toBe(3.3); // 3 px
    expect(razorTime(3.5, 3.3, 100, clip)).toBe(3.5); // 20 px: sin imán
  });
  it('fuera del clip o en sus bordes no corta', () => {
    expect(razorTime(1.5, 10, 100, clip)).toBeNull();
    expect(razorTime(2, 10, 100, clip)).toBeNull();
    expect(razorTime(6, 10, 100, clip)).toBeNull();
    expect(razorTime(6.02, 6, 100, clip)).toBeNull(); // el imán lleva al borde final: no hay corte
  });
  it('teclas y cursores de video no chocan con las de S / T / L / F', () => {
    expect(videoToolForKey('v')).toBe('select');
    expect(videoToolForKey('C')).toBe('razor');
    expect(videoToolForKey('h')).toBe('hand');
    expect(videoToolForKey('z')).toBe('zoom');
    for (const reservada of ['s', 't', 'l', 'f', 'i', 'o', 'k', 'j']) expect(videoToolForKey(reservada)).toBeNull();
    expect(videoCursor('razor')).toBe('crosshair');
    expect(videoCursor('hand', true)).toBe('grabbing');
    expect(videoCursor('zoom', false, true)).toBe('zoom-out');
  });
});
