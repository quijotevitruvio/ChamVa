// Curvas de aceleración (progreso 0..1 → 0..1). Puras. Las usan las transiciones y los fotogramas clave.
import type { Bezier, EaseId } from '../model/types';

export const EASE_IDS: EaseId[] = ['linear', 'smooth', 'in', 'out', 'bounce', 'bezier'];
export const EASE_LABELS: Record<EaseId, string> = { linear: 'Lineal', smooth: 'Suave', in: 'Acelera', out: 'Frena', bounce: 'Rebote', bezier: 'Curva' };
export const DEFAULT_BEZIER: Bezier = [0.42, 0, 0.58, 1];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Suavizado clásico 3p² − 2p³ (entrada y salida suaves). */
export const smoothstep = (p: number) => {
  const x = clamp01(p);
  return x * x * (3 - 2 * x);
};

/** Rebote al final (easeOutBounce): llega a 1, rebota y se asienta. */
export function bounceOut(p: number): number {
  const x = clamp01(p);
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x - 1.5 / d) * (x - 1.5 / d) + 0.75;
  if (x < 2.5 / d) return n * (x - 2.25 / d) * (x - 2.25 / d) + 0.9375;
  return n * (x - 2.625 / d) * (x - 2.625 / d) + 0.984375;
}

/**
 * Bézier cúbica con extremos (0,0) y (1,1) y manijas (x1,y1), (x2,y2), como `cubic-bezier` de CSS.
 * Resuelve x → parámetro por Newton con respaldo de bisección. x1 y x2 se limitan a 0..1 (función de x).
 */
export function cubicBezier(bz: Bezier, p: number): number {
  const x = clamp01(p);
  const [ax, y1, bx, y2] = bz;
  const x1 = clamp01(ax);
  const x2 = clamp01(bx);
  const cx = 3 * x1;
  const bxx = 3 * (x2 - x1) - cx;
  const axx = 1 - cx - bxx;
  const cy = 3 * y1;
  const byy = 3 * (y2 - y1) - cy;
  const ayy = 1 - cy - byy;
  const sx = (s: number) => ((axx * s + bxx) * s + cx) * s;
  const sy = (s: number) => ((ayy * s + byy) * s + cy) * s;
  const dx = (s: number) => (3 * axx * s + 2 * bxx) * s + cx;
  let s = x;
  for (let i = 0; i < 8; i++) {
    const e = sx(s) - x;
    if (Math.abs(e) < 1e-7) return sy(s);
    const d = dx(s);
    if (Math.abs(d) < 1e-6) break;
    s -= e / d;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 40; i++) {
    const e = sx(s);
    if (Math.abs(e - x) < 1e-7) break;
    if (e < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return sy(s);
}

/** Aplica una curva de aceleración. `bounce` y una bézier con y fuera de 0..1 pueden salirse un poco de 0..1 (o no llegar). */
export function applyEase(id: EaseId | undefined, p: number, bz?: Bezier): number {
  const x = clamp01(p);
  switch (id) {
    case 'linear':
      return x;
    case 'in':
      return x * x * x;
    case 'out':
      return 1 - (1 - x) * (1 - x) * (1 - x);
    case 'bounce':
      return bounceOut(x);
    case 'bezier':
      return cubicBezier(bz ?? DEFAULT_BEZIER, x);
    case 'smooth':
    default:
      return smoothstep(x);
  }
}

/** Sanea una bézier guardada (x en 0..1, y en −1..2). */
export function sanitizeBezier(v: unknown): Bezier | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  return [clamp01(v[0]), Math.max(-1, Math.min(2, v[1])), clamp01(v[2]), Math.max(-1, Math.min(2, v[3]))];
}
