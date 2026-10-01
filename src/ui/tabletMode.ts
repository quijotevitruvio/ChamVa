// Modo tablet y preferencias táctiles/de vista. Todo en localStorage, sin red.
// `chamva.tablet` = '1' | '0'. Sin valor, el modo está apagado (pero detectTablet()
// permite ofrecerlo). La clase `tablet` en <html> activa los estilos de touch.css.
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

function read(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}
function write(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* sin almacenamiento: la preferencia vale solo esta sesión */
  }
}

// Memoria de sesión por si localStorage falla.
const mem: Record<string, boolean> = {};
function get(key: string, def: boolean): boolean {
  return key in mem ? mem[key] : read(key, def);
}
function set(key: string, on: boolean) {
  mem[key] = on;
  write(key, on);
  applyTouchClasses();
  emit();
}

// ¿Pantalla táctil de tamaño tablet (≥ 768 px en su lado corto o largo)?
export function detectTablet(): boolean {
  if (typeof matchMedia === 'undefined') return false;
  const touch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0;
  const big = Math.max(window.innerWidth, window.innerHeight) >= 768;
  return touch && big;
}

export const isTabletMode = () => get('chamva.tablet', false);
export const setTabletMode = (on: boolean) => set('chamva.tablet', on);

export const isLeftHanded = () => get('chamva.leftHanded', false);
export const setLeftHanded = (on: boolean) => set('chamva.leftHanded', on);

// Modo ahorro: baja la resolución del lienzo y quita sombras mientras se edita.
export const isSaveMode = () => get('chamva.saveMode', false);
export const setSaveMode = (on: boolean) => set('chamva.saveMode', on);

// Minimapa del lienzo (visible por defecto; se oculta desde la barra inferior).
export const isMinimapOn = () => get('chamva.minimap', true);
export const setMinimapOn = (on: boolean) => set('chamva.minimap', on);

// Presión del lápiz en el borrador mágico (activada por defecto).
export const isPenPressure = () => get('chamva.penPressure', true);
export const setPenPressure = (on: boolean) => set('chamva.penPressure', on);

// Aplica las clases de <html>: `tablet`, `lefty`, `save-mode`.
export function applyTouchClasses() {
  if (typeof document === 'undefined') return;
  const c = document.documentElement.classList;
  c.toggle('tablet', isTabletMode());
  c.toggle('lefty', isLeftHanded());
  c.toggle('save-mode', isSaveMode());
}

function hook(getter: () => boolean) {
  return () => useSyncExternalStore(subscribe, getter, () => false);
}
export const useTabletMode = hook(isTabletMode);
export const useLeftHanded = hook(isLeftHanded);
export const useSaveMode = hook(isSaveMode);
export const useMinimapOn = hook(isMinimapOn);
export const usePenPressure = hook(isPenPressure);
