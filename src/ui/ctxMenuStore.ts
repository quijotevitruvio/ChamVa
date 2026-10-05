import { create } from 'zustand';
import { useRef, type PointerEvent as RPointerEvent } from 'react';
import { LONG_PRESS_MS, pressStillValid } from './contextMenuLogic';

// Estado del menú contextual: se abre desde el lienzo o desde el panel de capas.
export interface CtxOpen {
  x: number;
  y: number;
  /** Capa sobre la que se abrió (panel Capas); si falta, manda la selección actual. */
  layerId?: string;
}
interface CtxStore {
  open: CtxOpen | null;
  openedAt: number;
  show: (o: CtxOpen) => void;
  hide: () => void;
}
export const useCtxMenu = create<CtxStore>((set) => ({
  open: null,
  openedAt: 0,
  show: (open) => set({ open, openedAt: Date.now() }),
  hide: () => set({ open: null }),
}));

/** Pulsación larga (solo táctil/lápiz) que abre el menú contextual; el ratón usa clic derecho. */
export function useLongPress(onFire: (x: number, y: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: RPointerEvent) => {
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      cancel();
      const p = { x: e.clientX, y: e.clientY };
      start.current = p;
      timer.current = setTimeout(() => {
        if (start.current) onFire(p.x, p.y);
        start.current = null;
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: RPointerEvent) => {
      if (start.current && !pressStillValid(start.current, { x: e.clientX, y: e.clientY })) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}
