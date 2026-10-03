import type { ConstraintH, ConstraintV, Layer, LayerConstraints } from './types';

// Restricciones al redimensionar el lienzo (como en Figma): en vez de escalar la capa
// proporcionalmente, se recoloca según a qué borde está «anclada» en cada eje.
//  h: left | right | center | stretch | scale      v: top | bottom | center | stretch | scale
// Limitación: se usa la caja sin rotación (x, y = esquina superior izquierda).

export interface Size {
  width: number;
  height: number;
}
export type BoxFn = (l: Layer) => { w: number; h: number };

export const H_OPTIONS: { id: ConstraintH; label: string }[] = [
  { id: 'left', label: 'Izquierda' },
  { id: 'center', label: 'Centro' },
  { id: 'right', label: 'Derecha' },
  { id: 'stretch', label: 'Estirar' },
  { id: 'scale', label: 'Escalar' },
];
export const V_OPTIONS: { id: ConstraintV; label: string }[] = [
  { id: 'top', label: 'Arriba' },
  { id: 'center', label: 'Centro' },
  { id: 'bottom', label: 'Abajo' },
  { id: 'stretch', label: 'Estirar' },
  { id: 'scale', label: 'Escalar' },
];

// Tamaño aproximado de la capa en px del documento (sin rotación).
export function defaultBox(l: Layer): { w: number; h: number } {
  if (l.type === 'image') return { w: l.naturalWidth * l.scaleX, h: l.naturalHeight * l.scaleY };
  if (l.type === 'shape' || l.type === 'stroke') return { w: l.width * l.scaleX, h: l.height * l.scaleY };
  const lines = (l.text || ' ').split('\n');
  const longest = lines.reduce((m, s) => Math.max(m, s.length), 1);
  return {
    w: longest * l.fontSize * 0.56 * l.scaleX,
    h: lines.length * l.fontSize * (l.lineHeight ?? 1) * l.scaleY,
  };
}

// Un eje: devuelve la nueva posición y el factor de tamaño (1 = igual) de la capa.
export function axisConstraint(
  mode: ConstraintH | ConstraintV,
  pos: number,
  len: number,
  oldLen: number,
  newLen: number,
): { pos: number; factor: number } {
  const d = newLen - oldLen;
  switch (mode) {
    case 'right':
    case 'bottom':
      return { pos: pos + d, factor: 1 };
    case 'center':
      return { pos: pos + d / 2, factor: 1 };
    case 'stretch': {
      const nl = Math.max(1, len + d);
      return { pos, factor: len > 0 ? nl / len : 1 };
    }
    case 'scale': {
      const f = oldLen > 0 ? newLen / oldLen : 1;
      return { pos: pos * f, factor: f };
    }
    default: // left / top
      return { pos, factor: 1 };
  }
}

// Capa recolocada para el nuevo tamaño de lienzo. Sin restricciones devuelve la misma capa.
export function applyConstraints(layer: Layer, oldSize: Size, newSize: Size, box: BoxFn = defaultBox): Layer {
  const c = layer.constraints;
  if (!c) return layer;
  if (oldSize.width === newSize.width && oldSize.height === newSize.height) return layer;
  const { w, h } = box(layer);
  const ax = axisConstraint(c.h, layer.x, w, oldSize.width, newSize.width);
  const ay = axisConstraint(c.v, layer.y, h, oldSize.height, newSize.height);
  return {
    ...layer,
    x: ax.pos,
    y: ay.pos,
    scaleX: layer.scaleX * ax.factor,
    scaleY: layer.scaleY * ay.factor,
  } as Layer;
}

// Redimensionado completo de una capa (Magic Resize): con restricciones, las aplica;
// sin ellas, escala proporcionalmente para caber y centra (comportamiento de siempre).
export function resizeLayer(layer: Layer, oldSize: Size, newSize: Size, box: BoxFn = defaultBox): Layer {
  if (layer.constraints) return applyConstraints(layer, oldSize, newSize, box);
  const factor = Math.min(newSize.width / oldSize.width, newSize.height / oldSize.height);
  const offX = (newSize.width - oldSize.width * factor) / 2;
  const offY = (newSize.height - oldSize.height * factor) / 2;
  return {
    ...layer,
    x: layer.x * factor + offX,
    y: layer.y * factor + offY,
    scaleX: layer.scaleX * factor,
    scaleY: layer.scaleY * factor,
  } as Layer;
}

export function isValidConstraints(c: unknown): c is LayerConstraints {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return (
    ['left', 'right', 'center', 'stretch', 'scale'].includes(o.h as string) &&
    ['top', 'bottom', 'center', 'stretch', 'scale'].includes(o.v as string)
  );
}
