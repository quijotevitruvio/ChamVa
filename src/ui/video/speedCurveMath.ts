// Geometría del editor de la curva de velocidad (pura): eje x = posición en el clip (s de archivo), eje y = velocidad en
// escala logarítmica de 0,1× a 100× (tres décadas).
import { MAX_SPEED, MIN_SPEED, clampSpeed } from '../../video/speed/curve';

export interface SpeedBox {
  w: number;
  h: number;
  pad: number;
}

const LOG_MIN = Math.log10(MIN_SPEED);
const LOG_SPAN = Math.log10(MAX_SPEED) - LOG_MIN;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** (s de archivo, velocidad) → píxeles del SVG. */
export function toPx(b: SpeedBox, lo: number, hi: number, s: number, v: number): [number, number] {
  const x = hi > lo ? clamp01((s - lo) / (hi - lo)) : 0;
  const y = clamp01((Math.log10(clampSpeed(v)) - LOG_MIN) / LOG_SPAN);
  return [Math.round((b.pad + x * (b.w - b.pad * 2)) * 100) / 100, Math.round((b.pad + (1 - y) * (b.h - b.pad * 2)) * 100) / 100];
}

/** Píxeles del SVG → (s de archivo, velocidad). */
export function fromPx(b: SpeedBox, lo: number, hi: number, px: number, py: number): { s: number; v: number } {
  const x = clamp01((px - b.pad) / (b.w - b.pad * 2));
  const y = clamp01(1 - (py - b.pad) / (b.h - b.pad * 2));
  return { s: lo + x * (hi - lo), v: clampSpeed(Math.pow(10, LOG_MIN + y * LOG_SPAN)) };
}

/** Velocidad con un número de decimales que se lee bien («0,25×», «2×», «12×»). */
export function fmtSpeed(v: number): string {
  const d = v < 1 ? 2 : v < 10 ? 1 : 0;
  return `${Number(v.toFixed(d)).toString().replace('.', ',')}×`;
}

/** Posición del deslizador logarítmico (0..1000) ↔ velocidad. */
export const speedToSlider = (v: number): number => Math.round(clamp01((Math.log10(clampSpeed(v)) - LOG_MIN) / LOG_SPAN) * 1000);
export const sliderToSpeed = (pos: number): number => {
  const v = Math.pow(10, LOG_MIN + (clamp01(pos / 1000) * LOG_SPAN));
  return v < 1 ? Math.round(v * 100) / 100 : v < 10 ? Math.round(v * 20) / 20 : Math.round(v * 2) / 2;
};

/** Pasos del teclado: `dir` ±1 cambia la velocidad un 10 %. */
export const nudgeSpeed = (v: number, dir: number, big = false): number => clampSpeed(Math.round(v * Math.pow(big ? 1.5 : 1.1, dir) * 1000) / 1000);
