// Estado de la vista de daltonismo (solo vista: nunca modifica el diseño ni la exportación).
import { create } from 'zustand';
import type { ColorBlindKind } from '../editor/core/colorTools';

interface ColorBlindState {
  kind: ColorBlindKind | null; // null = vista normal
  setKind: (kind: ColorBlindKind | null) => void;
}

export const useColorBlind = create<ColorBlindState>((set) => ({
  kind: null,
  setKind: (kind) => set({ kind }),
}));
