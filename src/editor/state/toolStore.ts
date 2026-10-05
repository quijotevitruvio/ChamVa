// Herramienta activa del lienzo: ÚNICA fuente de verdad (solo interfaz; no entra en el
// documento ni en el deshacer, y no se guarda). El pincel y el borrador son dos valores
// más de la misma herramienta: `brushStore` ya no guarda «active» ni «tool».
import { create } from 'zustand';
import { effectiveTool, toolAfterCreate, toolOnEscape, toggleTool, type ShapeTool, type ToolId } from './toolLogic';

export interface ToolState {
  tool: ToolId; // herramienta elegida
  shape: ShapeTool; // qué forma crea la herramienta «shape»
  spaceHeld: boolean; // Espacio pulsado: mano temporal
  setTool: (t: ToolId, shape?: ShapeTool) => void;
  /** Como setTool, pero pulsar otra vez el pincel/borrador activo lo apaga (B / E). */
  toggle: (t: ToolId, shape?: ShapeTool) => void;
  escape: () => void;
  /** Tras crear un elemento con texto/forma: vuelve al puntero salvo con Shift. */
  afterCreate: (shift: boolean) => void;
  setSpaceHeld: (v: boolean) => void;
}

export const useTool = create<ToolState>((set, get) => ({
  tool: 'select',
  shape: 'rect',
  spaceHeld: false,
  setTool: (tool, shape) => set((s) => ({ tool, shape: shape ?? s.shape })),
  toggle: (tool, shape) => set((s) => ({ tool: toggleTool(s.tool, tool), shape: shape ?? s.shape })),
  escape: () => set({ tool: toolOnEscape(get().tool) }),
  afterCreate: (shift) => set((s) => ({ tool: toolAfterCreate(s.tool, shift) })),
  setSpaceHeld: (spaceHeld) => set((s) => (s.spaceHeld === spaceHeld ? s : { spaceHeld })),
}));

/** Herramienta efectiva ahora mismo (con la mano temporal de Espacio). */
export const useEffectiveTool = (): ToolId => useTool((s) => effectiveTool(s.tool, s.spaceHeld));
export const isDrawingTool = (t: ToolId) => t === 'brush' || t === 'eraser';
/** ¿Está activo el pincel o el borrador? */
export const useBrushActive = (): boolean => useTool((s) => isDrawingTool(s.tool));
