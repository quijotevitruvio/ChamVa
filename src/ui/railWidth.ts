// Ancho del panel izquierdo (el que se abre junto al riel de pestañas).
// Lógica pura: límites, paso de teclado y persistencia (con almacenamiento inyectable).

export const RAIL_MIN = 260;
export const RAIL_MAX = 560;
export const RAIL_DEFAULT = 260;
export const RAIL_STEP = 16;
/** Parte máxima de la ventana que puede ocupar el panel. */
export const RAIL_MAX_FRACTION = 0.45;

export const RAIL_WIDTH_KEY = 'chamva.railWidth';
export const RAIL_HIDDEN_KEY = 'chamva.railHidden';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Máximo efectivo: 560 px y como mucho el 45 % de la ventana (nunca bajo el mínimo). */
export function railMax(winW: number): number {
  if (!Number.isFinite(winW) || winW <= 0) return RAIL_MAX;
  return Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.floor(winW * RAIL_MAX_FRACTION)));
}

export function clampRail(w: number, winW: number): number {
  if (!Number.isFinite(w)) return RAIL_DEFAULT;
  return Math.round(Math.min(railMax(winW), Math.max(RAIL_MIN, w)));
}

/** Nuevo ancho al pulsar una tecla sobre la manija (null si la tecla no cuenta). */
export function railKeyStep(key: string, w: number, winW: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clampRail(w + RAIL_STEP, winW);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampRail(w - RAIL_STEP, winW);
    case 'Home':
      return RAIL_MIN;
    case 'End':
      return railMax(winW);
    default:
      return null;
  }
}

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRailWidth(winW: number, store: Store | null = defaultStore()): number {
  try {
    const raw = store?.getItem(RAIL_WIDTH_KEY);
    if (raw == null) return RAIL_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clampRail(n, winW) : RAIL_DEFAULT;
  } catch {
    return RAIL_DEFAULT;
  }
}

export function saveRailWidth(w: number, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(RAIL_WIDTH_KEY, String(Math.round(w)));
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
}

export function loadRailHidden(store: Store | null = defaultStore()): boolean {
  try {
    return store?.getItem(RAIL_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveRailHidden(hidden: boolean, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(RAIL_HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    /* sin almacenamiento */
  }
}
