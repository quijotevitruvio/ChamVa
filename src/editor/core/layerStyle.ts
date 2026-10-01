import type { Layer } from './types';

// Seleccionar similares y pegar solo el formato: lógica pura sobre las capas.

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ¿Es `l` "similar" a `ref`? Mismo tipo y, según el tipo:
//  - texto: misma fuente y mismo color de relleno
//  - forma: mismo color/degradado de relleno
//  - imagen: basta el tipo
export function isSimilar(ref: Layer, l: Layer): boolean {
  if (ref.type !== l.type) return false;
  if (ref.type === 'text' && l.type === 'text')
    return ref.fontFamily === l.fontFamily && ref.fill === l.fill && sameJson(ref.fillGradient, l.fillGradient);
  if (ref.type === 'shape' && l.type === 'shape')
    return ref.fill === l.fill && sameJson(ref.fillGradient, l.fillGradient);
  return true;
}

// Ids de las capas visibles y no bloqueadas similares a `refId` (incluye la propia).
export function similarLayerIds(layers: Layer[], refId: string): string[] {
  const ref = layers.find((l) => l.id === refId);
  if (!ref) return [];
  return layers.filter((l) => l.id === refId || (l.visible && !l.locked && isSimilar(ref, l))).map((l) => l.id);
}

const SHADOW_KEYS = ['shadow', 'shadowColor', 'shadowBlur', 'shadowX', 'shadowY'] as const;
const TEXT_KEYS = [
  'fontFamily',
  'fontSize',
  'bold',
  'italic',
  'align',
  'textTransform',
  'letterSpacing',
  'lineHeight',
  'textEffect',
  'effectColor',
  'underline',
  'curve',
] as const;

// Cambios que aplican el estilo de `src` a `dst` (sin tocar contenido, posición,
// tamaño ni giro). Entre tipos distintos solo pasa lo que tiene sentido en ambos.
export function stylePatch(src: Layer, dst: Layer): Record<string, unknown> {
  const p: Record<string, unknown> = { opacity: src.opacity, blendMode: src.blendMode };
  const s = src as unknown as Record<string, unknown>;
  const set = (k: string, v: unknown) => {
    p[k] = v;
  };
  // Texto, forma e imagen comparten los campos de sombra.
  for (const k of SHADOW_KEYS) set(k, s[k]);
  const srcFill = src.type === 'text' || src.type === 'shape';
  const dstFill = dst.type === 'text' || dst.type === 'shape';
  if (srcFill && dstFill) {
    set('fill', s.fill);
    set('fillGradient', s.fillGradient);
  }
  // Borde: forma usa stroke/strokeWidth; texto, strokeColor/strokeWidth.
  const srcStroke = src.type === 'text' ? s.strokeColor : src.type === 'shape' ? s.stroke : undefined;
  if (srcStroke !== undefined) {
    if (dst.type === 'text') {
      set('strokeColor', srcStroke);
      set('strokeWidth', s.strokeWidth);
    } else if (dst.type === 'shape') {
      set('stroke', srcStroke);
      set('strokeWidth', s.strokeWidth);
    }
  }
  if (src.type === 'text' && dst.type === 'text') for (const k of TEXT_KEYS) set(k, s[k]);
  if (src.type === 'shape' && dst.type === 'shape') set('cornerRadius', s.cornerRadius);
  return p;
}
