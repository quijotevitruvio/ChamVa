// Lógica pura de la barra de estado: herramienta activa con su tecla, zoom y pistas cortas.
import { TOOL_DEFS, effectiveTool, type ShapeTool, type ToolDef, type ToolId } from '../editor/state/toolLogic';

export interface StatusCtx {
  tool: ToolId;
  shape?: ShapeTool;
  spaceHeld?: boolean;
  selectionCount: number;
  /** Atajo efectivo de una acción del registro (puede estar personalizado). */
  key: (action: string) => string;
}

/** Definición de la herramienta efectiva (con la mano temporal de Espacio). */
export function activeToolDef(tool: ToolId, shape: ShapeTool | undefined, spaceHeld?: boolean): ToolDef {
  const eff = effectiveTool(tool, !!spaceHeld);
  const defs = TOOL_DEFS.filter((d) => d.id === eff);
  return (eff === 'shape' ? defs.find((d) => d.shape === shape) : defs[0]) ?? TOOL_DEFS[0];
}

/** Texto «Rectángulo (R)» de la herramienta activa. */
export function toolStatus(c: Pick<StatusCtx, 'tool' | 'shape' | 'spaceHeld' | 'key'>): { label: string; key: string } {
  const d = activeToolDef(c.tool, c.shape, c.spaceHeld);
  return { label: d.label, key: c.key(d.action) || d.key };
}

/** Pistas contextuales cortas (máximo 3) según la herramienta y la selección. */
export function statusHints(c: StatusCtx): string[] {
  if (c.spaceHeld) return ['Arrastra para mover el lienzo', 'Suelta Espacio para volver'];
  const hand = c.key('toolHand') || 'H';
  switch (c.tool) {
    case 'hand':
      return ['Arrastra para desplazar el lienzo', 'Esc: puntero'];
    case 'zoom':
      return ['Clic: acercar', 'Alt+clic: alejar', 'Arrastra: ampliar una zona'];
    case 'text':
      return ['Clic en la página para escribir', 'Mayús: crear varios'];
    case 'shape':
      return c.shape === 'line'
        ? ['Arrastra para dibujar', 'Mayús: ángulos de 15°', 'Esc: puntero']
        : ['Arrastra para dibujar', 'Mayús: proporcional', 'Esc: puntero'];
    case 'brush':
    case 'eraser':
      return ['Arrastra para dibujar', 'Espacio: mano', 'Esc: puntero'];
    default:
      if (c.selectionCount > 1) return [`${c.key('group') || 'Ctrl+G'}: agrupar`, 'Mayús: proporcional', 'Clic derecho: más'];
      if (c.selectionCount === 1) return ['Mayús: proporcional', `${c.key('blendNext') || 'Alt+Shift+↓'}: fusión`, 'Clic derecho: más'];
      return ['Espacio: mano', `${hand}: mano fija`, 'Ctrl+A: seleccionar todo'];
  }
}

/** Zoom como porcentaje entero (escala real aplicada). */
export const zoomPercent = (viewScale: number): number => Math.max(1, Math.round(viewScale * 100));
