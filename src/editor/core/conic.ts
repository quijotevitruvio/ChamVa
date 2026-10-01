import { mixColors } from './gradients';
import type { Gradient } from './types';

// Degradado cónico: el color gira alrededor de un centro. `angle` es el ángulo
// de inicio (0° = hacia la derecha, en sentido horario, como createConicGradient).
// Canvas 2D lo dibuja nativo; si el motor no lo tiene se aproxima con sectores.

export const isConic = (g: Gradient | undefined): boolean => g?.kind === 'conic';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Centro del cónico en px de la caja w×h (por defecto el centro). */
export function conicCenter(g: Gradient, w: number, h: number): { x: number; y: number } {
  return { x: clamp01(g.cx ?? 0.5) * w, y: clamp01(g.cy ?? 0.5) * h };
}

/** Ángulo de inicio en radianes. */
export const conicStartRad = (g: Gradient): number => (g.angle * Math.PI) / 180;

/** Color del degradado en la posición t (0..1) con paradas ordenadas; el primero y el último se mantienen fuera de rango. */
export function colorAtOffset(g: Gradient, t: number): string {
  const st = [...g.stops].sort((a, b) => a.offset - b.offset);
  if (!st.length) return '#000000';
  if (t <= st[0].offset) return st[0].color;
  const last = st[st.length - 1];
  if (t >= last.offset) return last.color;
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i];
    const b = st[i + 1];
    if (t >= a.offset && t <= b.offset) {
      const span = b.offset - a.offset;
      return span <= 0 ? b.color : mixColors(a.color, b.color, (t - a.offset) / span);
    }
  }
  return last.color;
}

export interface ConicSector {
  a0: number; // radianes (inicio del sector)
  a1: number; // radianes (fin, con un pequeño solape contra rendijas)
  color: string;
}

/** Aproximación por sectores (n = 180 por defecto): cada uno con el color del punto medio. */
export function conicSectors(g: Gradient, n = 180): ConicSector[] {
  const start = conicStartRad(g);
  const step = (Math.PI * 2) / n;
  const out: ConicSector[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ a0: start + i * step, a1: start + (i + 1) * step + 0.004, color: colorAtOffset(g, (i + 0.5) / n) });
  }
  return out;
}

/** CanvasGradient cónico nativo, o null si el motor no lo soporta. */
export function nativeConic(ctx: CanvasRenderingContext2D, g: Gradient, w: number, h: number): CanvasGradient | null {
  const c = ctx as CanvasRenderingContext2D & {
    createConicGradient?: (a: number, x: number, y: number) => CanvasGradient;
  };
  if (typeof c.createConicGradient !== 'function') return null;
  const p = conicCenter(g, w, h);
  const grad = c.createConicGradient(conicStartRad(g), p.x, p.y);
  for (const s of [...g.stops].sort((a, b) => a.offset - b.offset)) grad.addColorStop(clamp01(s.offset), s.color);
  return grad;
}

/**
 * Rellena el trazado actual del contexto con el cónico (nativo o por sectores).
 * Con sectores recorta al trazado, así que cambia el estado: llama dentro de save/restore.
 */
export function fillCurrentPathConic(ctx: CanvasRenderingContext2D, g: Gradient, w: number, h: number) {
  const nat = nativeConic(ctx, g, w, h);
  if (nat) {
    ctx.fillStyle = nat;
    ctx.fill();
    return;
  }
  const p = conicCenter(g, w, h);
  const r = Math.hypot(w, h) * 1.5;
  ctx.clip();
  for (const s of conicSectors(g)) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, r, s.a0, s.a1);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
  }
}
