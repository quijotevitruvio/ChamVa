// Ajustes de exportación adicionales (tamaños extra, peso objetivo, marca de agua,
// metadatos, plantilla de nombre) y «ajustes guardados» con nombre. Viven en un
// pequeño almacén propio con localStorage para no engordar el estado de App.
import { useSyncExternalStore } from 'react';
import { DEFAULT_WATERMARK, type WatermarkCfg } from './watermark';
import { DEFAULT_NAME_TEMPLATE } from './fileNameTemplate';
import type { MetaFields } from './pngMeta';

export interface ExtraSettings {
  extraScales: number[]; // además del tamaño principal (@0.5x/@1x/@2x/@3x)
  customWidths: string; // texto con anchos en px: «800, 1600»
  maxKB: number; // 0 = sin límite de peso
  watermark: WatermarkCfg;
  metaOn: boolean; // añadir metadatos (PNG/JPG); desactivado = archivos limpios
  meta: MetaFields;
  template: string; // plantilla del nombre de archivo
}

export const DEFAULT_EXTRA: ExtraSettings = {
  extraScales: [],
  customWidths: '',
  maxKB: 0,
  watermark: DEFAULT_WATERMARK,
  metaOn: false,
  meta: {},
  template: DEFAULT_NAME_TEMPLATE,
};

const EXTRA_LS = 'chamva.exportExtra';
export const PRESETS_LS = 'chamva.exportPresets';

function load(): ExtraSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(EXTRA_LS) ?? '{}') as Partial<ExtraSettings>;
    return {
      ...DEFAULT_EXTRA,
      ...raw,
      watermark: { ...DEFAULT_WATERMARK, ...(raw.watermark ?? {}) },
      meta: { ...(raw.meta ?? {}) },
    };
  } catch {
    return DEFAULT_EXTRA;
  }
}

let state: ExtraSettings = load();
const subs = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(EXTRA_LS, JSON.stringify(state));
  } catch {
    /* sin almacenamiento: se pierde al cerrar, no pasa nada */
  }
}

export const getExtra = () => state;

export function setExtra(patch: Partial<ExtraSettings>) {
  state = { ...state, ...patch };
  persist();
  subs.forEach((f) => f());
}

export function setWatermark(patch: Partial<WatermarkCfg>) {
  setExtra({ watermark: { ...state.watermark, ...patch } });
}

export function useExtra(): ExtraSettings {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

// ---- ajustes guardados con nombre ----

export interface ExportPreset {
  name: string;
  format: string;
  scale: number;
  quality: number;
  scope: 'page' | 'all' | 'selection';
  extraScales: number[];
  customWidths: string;
  maxKB: number;
  watermark: WatermarkCfg;
  template: string;
}

export function loadPresets(): ExportPreset[] {
  try {
    const arr = JSON.parse(localStorage.getItem(PRESETS_LS) ?? '[]');
    return Array.isArray(arr) ? (arr as ExportPreset[]).filter((p) => p && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

export function savePresets(list: ExportPreset[]): boolean {
  try {
    localStorage.setItem(PRESETS_LS, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// Sustituye el ajuste del mismo nombre o lo añade.
export function upsertPreset(list: ExportPreset[], p: ExportPreset): ExportPreset[] {
  const i = list.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
  if (i < 0) return [...list, p];
  const out = list.slice();
  out[i] = p;
  return out;
}
