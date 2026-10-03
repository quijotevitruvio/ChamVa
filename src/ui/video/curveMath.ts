// Geometría del editor de curvas (pura): manijas de una bézier cúbica con extremos (0,0) y (1,1), como `cubic-bezier` de CSS.
import type { Bezier } from '../../video/model';

export const Y_MIN = -0.5;
export const Y_MAX = 1.5;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** x en 0..1 (la curva es una función del tiempo), y en −0,5..1,5 (permite rebasar). */
export const clampHandle = (x: number, y: number): [number, number] => [r3(clamp(Number.isFinite(x) ? x : 0, 0, 1)), r3(clamp(Number.isFinite(y) ? y : 0, Y_MIN, Y_MAX))];

/** Mueve una manija (0 = la del principio, 1 = la del final) a (x, y). */
export function setHandle(bz: Bezier, which: 0 | 1, x: number, y: number): Bezier {
  const [cx, cy] = clampHandle(x, y);
  return which === 0 ? [cx, cy, bz[2], bz[3]] : [bz[0], bz[1], cx, cy];
}

/** Desplaza una manija (teclado). */
export const nudgeHandle = (bz: Bezier, which: 0 | 1, dx: number, dy: number): Bezier => setHandle(bz, which, bz[which * 2] + dx, bz[which * 2 + 1] + dy);

/** Muestras de una curva de progreso (p → valor) para dibujarla. */
export function samples(fn: (p: number) => number, n = 48): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) out.push([i / n, fn(i / n)]);
  return out;
}

export interface Box {
  size: number;
  pad: number;
}
/** (x, y) de la curva → píxeles del SVG (y hacia arriba). */
export const toPx = (b: Box, x: number, y: number): [number, number] => {
  const inner = b.size - b.pad * 2;
  return [r3(b.pad + x * inner), r3(b.pad + (1 - (y - Y_MIN) / (Y_MAX - Y_MIN)) * inner)];
};
/** Píxeles del SVG → (x, y) de la curva. */
export const fromPx = (b: Box, px: number, py: number): [number, number] => {
  const inner = b.size - b.pad * 2;
  return [(px - b.pad) / inner, Y_MIN + (1 - (py - b.pad) / inner) * (Y_MAX - Y_MIN)];
};

export const pathOf = (b: Box, pts: [number, number][]): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${toPx(b, x, y).join(' ')}`).join(' ');
