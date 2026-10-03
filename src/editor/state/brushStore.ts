// Estado de la herramienta Pinceles (solo interfaz: no entra en el documento ni en el deshacer).
import { create } from 'zustand';
import { BRUSHES, SIZE_MAX, SIZE_MIN, clamp } from '../core/brush';
import type { BrushStyle } from '../core/types';

export type BrushTool = 'brush' | 'eraser';

export interface BrushState {
  active: boolean; // true = dibujar/borrar sobre el lienzo
  tool: BrushTool;
  style: BrushStyle;
  size: number;
  opacity: number; // 0.05..1
  smoothing: number; // 0..1 estabilizador
  color: string;
  recent: string[]; // últimos colores usados con el pincel (el más reciente primero)
  setActive: (on: boolean) => void;
  setTool: (t: BrushTool) => void;
  setStyle: (s: BrushStyle) => void; // al elegir un pincel se cargan su grosor y opacidad típicos
  setSize: (n: number) => void;
  setOpacity: (n: number) => void;
  setSmoothing: (n: number) => void;
  setColor: (c: string) => void;
}

const LS = 'chamva.brush';
type Saved = Partial<Pick<BrushState, 'style' | 'size' | 'opacity' | 'smoothing' | 'color' | 'recent'>>;

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) ?? '{}') as Saved;
    const ok = BRUSHES.some((b) => b.id === raw.style);
    return {
      style: ok ? raw.style : undefined,
      size: typeof raw.size === 'number' ? clamp(raw.size, SIZE_MIN, SIZE_MAX) : undefined,
      opacity: typeof raw.opacity === 'number' ? clamp(raw.opacity, 0.05, 1) : undefined,
      smoothing: typeof raw.smoothing === 'number' ? clamp(raw.smoothing, 0, 1) : undefined,
      recent: Array.isArray(raw.recent) ? raw.recent.filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8) : undefined,
      color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : undefined,
    };
  } catch {
    return {};
  }
}
function save(s: BrushState) {
  try {
    localStorage.setItem(LS, JSON.stringify({ style: s.style, size: s.size, opacity: s.opacity, smoothing: s.smoothing, color: s.color, recent: s.recent }));
  } catch {
    /* noop */
  }
}

const saved = load();

export const useBrush = create<BrushState>((set, get) => ({
  active: false,
  tool: 'brush',
  style: saved.style ?? 'pen',
  size: saved.size ?? 4,
  opacity: saved.opacity ?? 1,
  smoothing: saved.smoothing ?? 0.35,
  color: saved.color ?? '#111111',
  recent: saved.recent ?? [],
  setActive: (on) => set({ active: on }),
  setTool: (tool) => set({ tool, active: true }),
  setStyle: (style) => {
    const b = BRUSHES.find((x) => x.id === style)!;
    set({ style, size: b.size, opacity: b.opacity, tool: 'brush', active: true });
    save(get());
  },
  setSize: (n) => {
    set({ size: Math.round(clamp(n, SIZE_MIN, SIZE_MAX)) });
    save(get());
  },
  setOpacity: (n) => {
    set({ opacity: clamp(n, 0.05, 1) });
    save(get());
  },
  setSmoothing: (n) => {
    set({ smoothing: clamp(n, 0, 1) });
    save(get());
  },
  setColor: (c) => {
    set((s) => ({ color: c, recent: [c, ...s.recent.filter((x) => x !== c)].slice(0, 8) }));
    save(get());
  },
}));
