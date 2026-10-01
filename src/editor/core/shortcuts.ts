// Registro central de atajos de teclado personalizables.
// Una acción tiene id, etiqueta, grupo y un atajo por defecto; el usuario puede
// cambiarlo (se guarda en localStorage `chamva.shortcuts`). Las teclas «fijas»
// (Esc, Supr, flechas, Espacio…) no se personalizan, pero se listan.
import { useSyncExternalStore } from 'react';

export interface ShortcutAction {
  id: string;
  label: string;
  desc?: string;
  group: string;
  /** Combinación por defecto, p. ej. «Ctrl+Shift+G» o «F». */
  def: string;
  /** Alias fijos que también activan la acción (no personalizables). */
  extra?: string[];
}

export const ACTIONS: ShortcutAction[] = [
  { id: 'palette', label: 'Buscar cualquier acción', desc: 'Abre la paleta de comandos', group: 'General', def: 'Ctrl+K' },
  { id: 'shortcuts', label: 'Atajos de teclado', desc: 'Muestra la lista de atajos', group: 'General', def: '?', extra: ['F1'] },
  { id: 'focus', label: 'Modo concentración', desc: 'Oculta barras y paneles; Esc para salir', group: 'General', def: 'F' },
  { id: 'undo', label: 'Deshacer', group: 'Edición', def: 'Ctrl+Z' },
  { id: 'redo', label: 'Rehacer', group: 'Edición', def: 'Ctrl+Y', extra: ['Ctrl+Shift+Z'] },
  { id: 'copy', label: 'Copiar capa', group: 'Edición', def: 'Ctrl+C' },
  { id: 'paste', label: 'Pegar capa', group: 'Edición', def: 'Ctrl+V' },
  { id: 'duplicate', label: 'Duplicar capa', group: 'Edición', def: 'Ctrl+D' },
  { id: 'group', label: 'Agrupar', group: 'Edición', def: 'Ctrl+G' },
  { id: 'ungroup', label: 'Desagrupar', group: 'Edición', def: 'Ctrl+Shift+G' },
];

/** Teclas que no se pueden reasignar (y que ninguna acción puede usar solas). */
export const FIXED_KEYS: [string, string][] = [
  ['Esc', 'Deseleccionar / cancelar / salir del modo concentración'],
  ['Supr', 'Borrar capa (no bloqueadas)'],
  ['Flechas', 'Mover 1 px · con Shift 10 px'],
  ['Espacio + arrastrar', 'Mover el lienzo'],
];
const FIXED_NAMES = new Set(['Esc', 'Supr', 'Retroceso', '←', '→', '↑', '↓', 'Espacio']);

export interface Combo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const MOD_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);
const KEY_NAMES: Record<string, string> = {
  Escape: 'Esc',
  Delete: 'Supr',
  Backspace: 'Retroceso',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ' ': 'Espacio',
  Enter: 'Intro',
};

/** Normaliza el nombre de una tecla (`event.key`) a su forma canónica. */
export function normalizeKey(key: string): string {
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** ¿La tecla distingue Mayús? Las letras y dígitos sí; símbolos como «?» no. */
function shiftSensitive(key: string): boolean {
  return key.length > 1 || /^[A-Z0-9]$/.test(key);
}

export function parseCombo(s: string): Combo | null {
  const raw = s.trim();
  if (!raw) return null;
  const out: Combo = { ctrl: false, alt: false, shift: false, key: '' };
  // «+» como tecla final: «Ctrl++»
  const parts = raw.endsWith('+') && raw.length > 1 ? [...raw.slice(0, -2).split('+'), '+'] : raw.split('+');
  for (const p of parts) {
    const low = p.trim().toLowerCase();
    if (low === 'ctrl' || low === 'cmd' || low === 'meta') out.ctrl = true;
    else if (low === 'alt') out.alt = true;
    else if (low === 'shift' || low === 'mayús') out.shift = true;
    else if (p.trim()) {
      if (out.key) return null;
      out.key = normalizeKey(p.trim());
    }
  }
  return out.key ? out : null;
}

export function formatCombo(c: Combo): string {
  const mods = [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift'].filter(Boolean) as string[];
  return [...mods, c.key].join('+');
}

/** Forma canónica de una cadena de atajo (o '' si no se entiende). */
export function canonical(s: string): string {
  const c = parseCombo(s);
  if (!c) return '';
  if (!shiftSensitive(c.key)) c.shift = false;
  return formatCombo(c);
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey?: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Combinación que representa un evento de teclado (null si es solo un modificador). */
export function eventToCombo(e: KeyLike): string | null {
  if (MOD_KEYS.has(e.key)) return null;
  const key = normalizeKey(e.key);
  return canonical(
    formatCombo({ ctrl: e.ctrlKey || !!e.metaKey, alt: e.altKey, shift: e.shiftKey, key }),
  );
}

export function matchesCombo(e: KeyLike, combo: string): boolean {
  const got = eventToCombo(e);
  return !!got && got === canonical(combo);
}

/** ¿Se puede asignar? Devuelve el motivo del rechazo o null. */
export function validateCombo(combo: string): string | null {
  const c = parseCombo(combo);
  if (!c) return 'Combinación no válida';
  if (FIXED_NAMES.has(c.key) && !c.ctrl && !c.alt) return 'Esa tecla está reservada';
  if (['Tab', 'Intro'].includes(c.key) && !c.ctrl && !c.alt) return 'Esa tecla está reservada';
  return null;
}

// ---- almacenamiento ----
const KEY = 'chamva.shortcuts';
type Overrides = Record<string, string>; // '' = desactivado

function load(): Overrides {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object') return {};
    const out: Overrides = {};
    for (const a of ACTIONS) {
      const x = (v as Record<string, unknown>)[a.id];
      if (typeof x === 'string') out[a.id] = x ? canonical(x) : '';
    }
    return out;
  } catch {
    return {};
  }
}

let overrides: Overrides = load();
let version = 0;
let capturing = false;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((f) => f());
};

/** Atajo efectivo de una acción ('' si está desactivado). */
export function getShortcut(id: string, ov: Overrides = overrides): string {
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) return '';
  return id in ov ? ov[id] : canonical(a.def);
}

export function effectiveMap(ov: Overrides = overrides): Record<string, string> {
  const m: Record<string, string> = {};
  for (const a of ACTIONS) m[a.id] = getShortcut(a.id, ov);
  return m;
}

/** Otras acciones que ya usan esa combinación (incluye alias fijos). */
export function findConflicts(id: string, combo: string, ov: Overrides = overrides): string[] {
  const c = canonical(combo);
  if (!c) return [];
  return ACTIONS.filter((a) => {
    if (a.id === id) return false;
    if (getShortcut(a.id, ov) === c) return true;
    return (a.extra ?? []).some((x) => canonical(x) === c);
  }).map((a) => a.id);
}

export function setShortcut(id: string, combo: string) {
  overrides = { ...overrides, [id]: combo ? canonical(combo) : '' };
  persist();
}
export function resetShortcut(id: string) {
  const { [id]: _drop, ...rest } = overrides;
  overrides = rest;
  persist();
}
export function resetAllShortcuts() {
  overrides = {};
  persist();
}
function persist() {
  try {
    if (Object.keys(overrides).length) localStorage.setItem(KEY, JSON.stringify(overrides));
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  emit();
}
export function isCustomized(id: string): boolean {
  return id in overrides;
}

/** Mientras el editor captura una tecla, el manejador global no actúa. */
export function setCapturing(v: boolean) {
  capturing = v;
}

/** Acción que activa este evento (o null). Considera atajo efectivo y alias. */
export function actionForEvent(e: KeyLike): string | null {
  if (capturing) return null;
  const got = eventToCombo(e);
  if (!got) return null;
  for (const a of ACTIONS) {
    if (getShortcut(a.id) === got) return a.id;
  }
  for (const a of ACTIONS) {
    if ((a.extra ?? []).some((x) => canonical(x) === got)) return a.id;
  }
  return null;
}

/** Re-renderiza al cambiar los atajos y devuelve el mapa efectivo id → combinación. */
export function useShortcuts(): Record<string, string> {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return effectiveMap();
}

/** Solo para pruebas: fija los atajos personalizados en memoria. */
export function _setOverridesForTest(ov: Overrides) {
  overrides = ov;
}
