// Lógica pura del menú contextual (clic derecho / pulsación larga): qué entradas se
// muestran, dónde se coloca y cuándo una pulsación cuenta como «larga».

export type CtxItemId =
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'editText'
  | 'front'
  | 'back'
  | 'lock'
  | 'hide'
  | 'group'
  | 'ungroup'
  | 'blend'
  | 'similar'
  | 'copyStyle'
  | 'pasteStyle'
  | 'css'
  | 'rotate'
  | 'delete'
  | 'selectAll'
  | 'addPage';

export interface CtxState {
  /** Hay una capa seleccionada (si no, es el menú del lienzo vacío). */
  layer: boolean;
  multi?: boolean;
  grouped?: boolean;
  isText?: boolean;
}

/** Entradas en orden; `null` = separador. */
export function ctxItems(c: CtxState): (CtxItemId | null)[] {
  if (!c.layer) return ['paste', 'selectAll', 'addPage'];
  const out: (CtxItemId | null)[] = ['copy', 'paste', 'duplicate', null];
  if (c.isText && !c.multi) out.push('editText');
  out.push('front', 'back', null, 'lock', 'hide', null);
  if (c.multi) out.push('group');
  if (c.grouped) out.push('ungroup');
  out.push('blend', null, 'similar', 'copyStyle', 'pasteStyle', 'css', 'rotate', null, 'delete');
  return out;
}

/** Coloca el menú dentro de la ventana (voltea hacia arriba/izquierda si no cabe). */
export function clampMenu(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  vw: number,
  vh: number,
  margin = 8,
): { left: number; top: number } {
  let left = pos.x;
  let top = pos.y;
  if (left + size.w > vw - margin) left = Math.max(margin, pos.x - size.w);
  if (top + size.h > vh - margin) top = Math.max(margin, vh - margin - size.h);
  return { left: Math.max(margin, left), top: Math.max(margin, top) };
}

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_TOLERANCE = 10;

/** ¿El dedo sigue quieto (dentro de la tolerancia)? Si se movió, es un arrastre y no una pulsación larga. */
export function pressStillValid(start: { x: number; y: number }, now: { x: number; y: number }): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) <= LONG_PRESS_TOLERANCE;
}
