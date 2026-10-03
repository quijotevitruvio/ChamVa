// Geometría de las manijas de transformación sobre la vista previa (pura).
// Todo en fracciones del fotograma (0..1) salvo ángulos (grados, sentido horario).
import type { Clip, Transform } from '../../video/model';
import { fitRect, type Fit } from '../../video/engine/timeline';

export interface Size {
  w: number;
  h: number;
}

/**
 * Tamaño base del clip (scale = 1) como fracción del ancho y del alto del fotograma.
 * - video: encajado al fotograma (contain/cover), como lo dibuja el motor.
 * - imagen: `size` = fracción del ancho; el alto sale de su proporción.
 * - texto: ancho medido y alto ≈ 1,25 × el cuerpo de letra.
 */
export function baseBox(clip: Pick<Clip, 'kind' | 'size'>, frame: Size, dims: { w: number; h: number; textW?: number; fontPx?: number } | null, fit: Fit = 'contain'): Size {
  if (!dims || !frame.w || !frame.h) return { w: 0.3, h: 0.2 };
  if (clip.kind === 'video') {
    if (!dims.w || !dims.h) return { w: 1, h: 1 };
    const r = fitRect(dims.w, dims.h, frame.w, frame.h, fit, 0);
    return { w: r.w / frame.w, h: r.h / frame.h };
  }
  if (clip.kind === 'image') {
    const w = clip.size ?? 0.3;
    const ratio = dims.w ? dims.h / dims.w : 0.75;
    return { w, h: (w * frame.w * ratio) / frame.h };
  }
  const tw = Math.max(dims.textW ?? 0, 8);
  const fh = (dims.fontPx ?? 40) * 1.25;
  return { w: tw / frame.w, h: fh / frame.h };
}

export interface Handles {
  /** centro, fracción */
  cx: number;
  cy: number;
  /** tamaño con escala, fracción */
  w: number;
  h: number;
  rotation: number;
}

export function handlesFor(tr: Transform, base: Size): Handles {
  return { cx: tr.x, cy: tr.y, w: base.w * tr.scale, h: base.h * tr.scale, rotation: tr.rotation };
}

const DEG = Math.PI / 180;

/** Nueva escala al arrastrar una esquina: proporcional a la distancia del puntero al centro (px). */
export function scaleFromDrag(startScale: number, center: { x: number; y: number }, start: { x: number; y: number }, now: { x: number; y: number }): number {
  const d0 = Math.hypot(start.x - center.x, start.y - center.y);
  const d1 = Math.hypot(now.x - center.x, now.y - center.y);
  if (d0 < 1) return startScale;
  return Math.max(0.05, Math.min(10, startScale * (d1 / d0)));
}

/** Nuevo ángulo al arrastrar la manija de giro: ángulo inicial + lo girado el puntero alrededor del centro. */
export function rotationFromDrag(startRot: number, center: { x: number; y: number }, start: { x: number; y: number }, now: { x: number; y: number }, snap = false): number {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(now.y - center.y, now.x - center.x);
  let r = startRot + (a1 - a0) / DEG;
  r = ((((r + 180) % 360) + 360) % 360) - 180;
  return snapAngle(r, snap ? 15 : 0, 3);
}

/** Pega el ángulo a múltiplos de `step` (si step > 0), o a 0/90/180/-90 si queda a menos de `tol` grados. */
export function snapAngle(deg: number, step = 0, tol = 3): number {
  if (step > 0) return Math.round(deg / step) * step;
  for (const k of [-180, -90, 0, 90, 180]) if (Math.abs(deg - k) <= tol) return k === -180 ? 180 : k;
  return Math.round(deg * 10) / 10;
}

/** Pega el centro a 0,5 (y a los bordes 0 / 1) si queda a menos de `tol` (fracción). */
export function snapCenter(v: number, tol = 0.012): number {
  for (const k of [0, 0.5, 1]) if (Math.abs(v - k) <= tol) return k;
  return v;
}

/** Mueve el centro por un desplazamiento en px, dado el tamaño del fotograma en px. */
export function moveCenter(startX: number, startY: number, dxPx: number, dyPx: number, framePx: Size, snap = true): { x: number; y: number } {
  const x = startX + dxPx / framePx.w;
  const y = startY + dyPx / framePx.h;
  return snap ? { x: snapCenter(x), y: snapCenter(y) } : { x, y };
}
