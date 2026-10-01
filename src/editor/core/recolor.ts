import { adjustForContrast, contrastRatio, hexToRgb, hslToRgb, luminance, rgbToHex, rgbToHsl } from './colorTools';
import { parseColor, toHex6, withAlphaColor } from './gradients';
import type { Background, Doc, Gradient, ImageAdjust, Layer } from './types';

// Recolorear un diseño entero: recoge los colores distintos (fondo, rellenos,
// bordes, texto, degradados, sombras), los sustituye por otros, invierte
// claro↔oscuro o reasigna una paleta por luminosidad. Todo puro y sin mutar.
// Los colores que no se entienden (transparent, var(...)) se dejan como están
// y el alfa de cada color se conserva.

export type ColorFn = (hex: string) => string; // recibe y devuelve #rrggbb en minúsculas

const norm = (c: string): string | null => {
  const p = parseColor(c);
  return p ? toHex6(c).toLowerCase() : null;
};

function mapOne(c: string, fn: ColorFn): string {
  const p = parseColor(c);
  if (!p || c.trim().toLowerCase() === 'transparent') return c;
  const out = fn(toHex6(c).toLowerCase());
  const res = withAlphaColor(out, p.a);
  return c.trim().startsWith('#') && p.a === 1 ? res.toLowerCase() : res;
}

function mapGradient(g: Gradient | undefined, fn: ColorFn): Gradient | undefined {
  if (!g) return g;
  return { ...g, stops: g.stops.map((s) => ({ ...s, color: mapOne(s.color, fn) })) };
}

type AdjustColors = ImageAdjust & { glowColor?: string; gradMap?: Gradient };
function mapAdjust(a: ImageAdjust, fn: ColorFn): ImageAdjust {
  const src = a as AdjustColors;
  const out: AdjustColors = { ...src };
  if (src.outlineColor) out.outlineColor = mapOne(src.outlineColor, fn);
  if (src.glowColor) out.glowColor = mapOne(src.glowColor, fn);
  if (src.gradMap) out.gradMap = mapGradient(src.gradMap, fn);
  return out;
}

function mapBackground(b: Background, fn: ColorFn): Background {
  switch (b.type) {
    case 'solid':
      return { ...b, color: mapOne(b.color, fn) };
    case 'gradient':
      return { ...b, gradient: mapGradient(b.gradient, fn)! };
    case 'pattern':
      return { ...b, pattern: { ...b.pattern, color1: mapOne(b.pattern.color1, fn), color2: mapOne(b.pattern.color2, fn) } };
    default:
      return b;
  }
}

function mapLayer(l: Layer, fn: ColorFn): Layer {
  const shadow = l.shadowColor ? { shadowColor: mapOne(l.shadowColor, fn) } : {};
  if (l.type === 'shape') {
    return {
      ...l,
      ...shadow,
      fill: mapOne(l.fill, fn),
      stroke: mapOne(l.stroke, fn),
      ...(l.fillGradient ? { fillGradient: mapGradient(l.fillGradient, fn) } : {}),
      ...(l.strokeGradient ? { strokeGradient: mapGradient(l.strokeGradient, fn) } : {}),
    };
  }
  if (l.type === 'text') {
    return {
      ...l,
      ...shadow,
      fill: mapOne(l.fill, fn),
      strokeColor: mapOne(l.strokeColor, fn),
      ...(l.effectColor ? { effectColor: mapOne(l.effectColor, fn) } : {}),
      ...(l.fillGradient ? { fillGradient: mapGradient(l.fillGradient, fn) } : {}),
      ...(l.spans ? { spans: l.spans.map((s) => (s.color ? { ...s, color: mapOne(s.color, fn) } : s)) } : {}),
    };
  }
  return { ...l, ...shadow, ...(l.adjust ? { adjust: mapAdjust(l.adjust, fn) } : {}) };
}

/** Aplica `fn` a todos los colores editables del documento. */
export function mapDocColors(doc: Doc, fn: ColorFn): Doc {
  return { ...doc, background: mapBackground(doc.background, fn), layers: doc.layers.map((l) => mapLayer(l, fn)) };
}

// ---------- extracción ----------

export interface ColorUse {
  color: string; // #rrggbb minúsculas
  count: number;
  lum: number; // luminancia relativa 0..1
}

/** Colores distintos del diseño, de más a menos usado (ignora transparentes). */
export function collectColors(doc: Doc): ColorUse[] {
  const counts = new Map<string, number>();
  mapDocColors(doc, (hex) => {
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
    return hex;
  });
  return [...counts.entries()]
    .map(([color, count]) => ({ color, count, lum: luminance(color) }))
    .sort((a, b) => b.count - a.count || a.lum - b.lum);
}

/** Sustituye colores según un mapa #rrggbb → #rrggbb (los no presentes no cambian). */
export function applyColorMap(doc: Doc, map: Record<string, string>): Doc {
  const keys = Object.keys(map);
  if (!keys.some((k) => map[k].toLowerCase() !== k)) return doc;
  return mapDocColors(doc, (hex) => map[hex] ?? hex);
}

// ---------- inversión claro ↔ oscuro ----------

const L_MIN = 0.04;
const L_MAX = 0.96;

/** Invierte la luminosidad HSL conservando tono y saturación (el blanco puro no pasa de L_MIN). */
export function invertLightness(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  const l = Math.max(L_MIN, Math.min(L_MAX, 1 - hsl.l));
  return rgbToHex(hslToRgb({ ...hsl, l }));
}

/** Color representativo del fondo (para comprobar el contraste del texto). */
export function backgroundSample(b: Background): string | null {
  if (b.type === 'solid') return norm(b.color);
  if (b.type === 'gradient') {
    const st = [...b.gradient.stops].sort((a, c) => a.offset - c.offset);
    return st.length ? norm(st[Math.floor(st.length / 2)].color) : null;
  }
  if (b.type === 'pattern') return norm(b.pattern.color1);
  return null;
}

/** Invierte el tema del diseño y corrige el texto que quede con poco contraste sobre el fondo. */
export function invertDoc(doc: Doc, fixContrast = true): Doc {
  const out = mapDocColors(doc, invertLightness);
  const bg = backgroundSample(out.background);
  if (!fixContrast || !bg) return out;
  return {
    ...out,
    layers: out.layers.map((l) => {
      if (l.type !== 'text') return l;
      const fill = norm(l.fill);
      if (!fill || contrastRatio(fill, bg) >= 3) return l;
      return { ...l, fill: withAlphaColor(adjustForContrast(fill, bg, 4.5), parseColor(l.fill)?.a ?? 1) };
    }),
  };
}

// ---------- paleta por luminosidad ----------

/**
 * Reasigna `source` a `palette` por orden de luminosidad: el color más oscuro del
 * diseño pasa al más oscuro de la paleta, el más claro al más claro, y los
 * intermedios se reparten proporcionalmente. Devuelve #rrggbb → #rrggbb.
 */
export function mapByLuminosity(source: string[], palette: string[]): Record<string, string> {
  const uniq = (xs: string[]) =>
    [...new Set(xs.map((c) => norm(c)).filter((c): c is string => !!c))].sort((a, b) => luminance(a) - luminance(b));
  const src = uniq(source);
  const pal = uniq(palette);
  const out: Record<string, string> = {};
  if (!src.length || !pal.length) return out;
  src.forEach((c, i) => {
    const j = src.length === 1 ? Math.round((pal.length - 1) / 2) : Math.round((i * (pal.length - 1)) / (src.length - 1));
    out[c] = pal[j];
  });
  return out;
}
