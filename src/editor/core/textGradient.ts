// Color de texto con degradado: lógica pura compartida por el lienzo, la
// exportación a imagen y la SVG. El degradado cubre el CUADRO del texto
// (ancho×alto medidos); los tramos con color propio (spans) conservan el suyo.
import { gradientPoints, type Gradient, type TextLayer } from './types';
import { normalizeHex } from './richText';

export type PointMap = (x: number, y: number) => { x: number; y: number };

export const hasTextGradient = (l: TextLayer): boolean => !!l.fillGradient && l.fillGradient.stops.length > 0;

/** ¿Este tramo usa el color base de la capa (y por tanto el degradado)? */
export function runUsesGradient(l: TextLayer, runColor: string): boolean {
  return hasTextGradient(l) && normalizeHex(runColor) === normalizeHex(l.fill);
}

/** Paradas ordenadas y recortadas a 0..1. */
export function sortedStops(g: Gradient) {
  return [...g.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => ({ offset: Math.max(0, Math.min(1, s.offset)), color: s.color }));
}

/**
 * Degradado de canvas para el cuadro w×h. `map` convierte un punto del cuadro
 * al espacio local del contexto en el momento de rellenar (texto curvo, donde
 * cada letra se dibuja rotada); sin `map` el espacio es el del cuadro.
 */
export function textCanvasGradient(
  ctx: CanvasRenderingContext2D,
  g: Gradient,
  w: number,
  h: number,
  map: PointMap = (x, y) => ({ x, y }),
): CanvasGradient {
  let grad: CanvasGradient;
  if (g.kind === 'radial') {
    const c = map(w / 2, h / 2);
    grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(1, Math.hypot(w, h) / 2));
  } else {
    const p = gradientPoints(g.angle, w, h);
    const a = map(p.x0, p.y0);
    const b = map(p.x1, p.y1);
    grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  }
  for (const s of sortedStops(g)) grad.addColorStop(s.offset, s.color);
  return grad;
}

/** id único por capa para el <defs> SVG del degradado de texto. */
export const textGradientId = (layerId: string) => `tg-${layerId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
