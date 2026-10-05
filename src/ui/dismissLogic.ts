/** Lógica pura de cierre y foco para diálogos y pantallas encima del editor. */

export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Trampa de foco: dado el número de elementos enfocables, el índice del activo
 * y si se pulsó Shift, devuelve el índice al que hay que saltar o null si el
 * navegador puede seguir con su comportamiento normal.
 */
export function trapIndex(count: number, activeIndex: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (activeIndex < 0) return shift ? count - 1 : 0; // el foco está fuera: entra
  if (shift && activeIndex === 0) return count - 1;
  if (!shift && activeIndex === count - 1) return 0;
  return null;
}

/** Pila de capas abiertas: solo la de arriba reacciona a Esc y a la trampa. */
const stack: symbol[] = [];
export function pushLayer(): symbol {
  const id = Symbol('layer');
  stack.push(id);
  return id;
}
export function popLayer(id: symbol): void {
  const i = stack.indexOf(id);
  if (i >= 0) stack.splice(i, 1);
}
export function isTopLayer(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}
export function layerCount(): number {
  return stack.length;
}

/** ¿Un clic en el fondo debe cerrar? Solo si cae en el propio fondo y no se pierde trabajo. */
export function backdropShouldClose(
  target: unknown,
  currentTarget: unknown,
  opts: { dirty?: boolean; busy?: boolean; backdrop?: boolean } = {},
): boolean {
  if (opts.backdrop === false || opts.busy) return false;
  if (target !== currentTarget) return false;
  return !opts.dirty;
}

/** ¿Esc debe cerrar ahora? Se ignora si otro manejador ya lo consumió o hay IME activo. */
export function escShouldClose(e: { key: string; defaultPrevented?: boolean; isComposing?: boolean }): boolean {
  return e.key === 'Escape' && !e.defaultPrevented && !e.isComposing;
}
