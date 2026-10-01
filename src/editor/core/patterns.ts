import type { PatternKind, PatternSpec } from './types';

// Patrones de fondo: una baldosa cuadrada descrita con primitivas simples que
// se dibujan IGUAL en el lienzo (Konva, vía baldosa canvas), en la exportación
// a imagen (canvas 2D) y en SVG (<pattern>).

export const PATTERN_KINDS: { kind: PatternKind; label: string }[] = [
  { kind: 'dots', label: 'Puntos' },
  { kind: 'lines', label: 'Líneas' },
  { kind: 'grid', label: 'Cuadrícula' },
  { kind: 'diagonal', label: 'Diagonales' },
  { kind: 'zigzag', label: 'Zigzag' },
  { kind: 'checks', label: 'Cuadros' },
  { kind: 'waves', label: 'Olas' },
];

export const DEFAULT_PATTERN: PatternSpec = {
  kind: 'dots',
  color1: '#ffffff',
  color2: '#d9d9d6',
  size: 24,
  thickness: 2,
};

export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { t: 'circle'; x: number; y: number; r: number; fill: string }
  | { t: 'path'; d: string; stroke: string; width: number };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const n = (v: number) => String(Math.round(v * 1000) / 1000);

// Normaliza tamaño y grosor a rangos válidos (proyectos antiguos o editados a mano).
export function normalizePattern(p: Partial<PatternSpec> | undefined): PatternSpec {
  const d = DEFAULT_PATTERN;
  const kind = PATTERN_KINDS.some((k) => k.kind === p?.kind) ? (p!.kind as PatternKind) : d.kind;
  const num = (v: unknown, def: number) => (typeof v === 'number' && isFinite(v) ? v : def);
  const size = clamp(num(p?.size, d.size), 4, 400);
  return {
    kind,
    color1: typeof p?.color1 === 'string' ? p.color1 : d.color1,
    color2: typeof p?.color2 === 'string' ? p.color2 : d.color2,
    size,
    thickness: clamp(num(p?.thickness, d.thickness), 0.5, size / 2),
  };
}

// Primitivas de la baldosa (size × size). El fondo (color1) lo rellena el que dibuja.
export function patternPrims(spec: PatternSpec): Prim[] {
  const { size: s, thickness: t, color2: c } = spec;
  const h = s / 2;
  switch (spec.kind) {
    case 'dots':
      return [{ t: 'circle', x: h, y: h, r: t, fill: c }];
    case 'lines':
      return [{ t: 'rect', x: 0, y: h - t / 2, w: s, h: t, fill: c }];
    case 'grid':
      return [
        { t: 'rect', x: 0, y: h - t / 2, w: s, h: t, fill: c },
        { t: 'rect', x: h - t / 2, y: 0, w: t, h: s, fill: c },
      ];
    case 'diagonal':
      // Tres tramos para que la diagonal enlace entre baldosas contiguas.
      return [
        {
          t: 'path',
          d: `M0 ${n(s)}L${n(s)} 0M${n(-h)} ${n(h)}L${n(h)} ${n(-h)}M${n(h)} ${n(s + h)}L${n(s + h)} ${n(h)}`,
          stroke: c,
          width: t,
        },
      ];
    case 'zigzag':
      return [{ t: 'path', d: `M0 ${n(s * 0.75)}L${n(h)} ${n(s * 0.25)}L${n(s)} ${n(s * 0.75)}`, stroke: c, width: t }];
    case 'checks':
      return [
        { t: 'rect', x: 0, y: 0, w: h, h: h, fill: c },
        { t: 'rect', x: h, y: h, w: h, h: h, fill: c },
      ];
    case 'waves':
      return [{ t: 'path', d: `M0 ${n(h)}Q${n(s / 4)} 0 ${n(h)} ${n(h)}Q${n(s * 0.75)} ${n(s)} ${n(s)} ${n(h)}`, stroke: c, width: t }];
  }
}

// ---------- SVG ----------

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function primSvg(p: Prim): string {
  if (p.t === 'rect') return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${esc(p.fill)}"/>`;
  if (p.t === 'circle') return `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.r)}" fill="${esc(p.fill)}"/>`;
  return `<path d="${p.d}" fill="none" stroke="${esc(p.stroke)}" stroke-width="${n(p.width)}" stroke-linejoin="round"/>`;
}

// <pattern id> listo para <defs>; se usa con fill="url(#id)".
export function svgPatternDef(id: string, spec: PatternSpec): string {
  const s = spec.size;
  return (
    `<pattern id="${id}" width="${n(s)}" height="${n(s)}" patternUnits="userSpaceOnUse">` +
    `<rect width="${n(s)}" height="${n(s)}" fill="${esc(spec.color1)}"/>` +
    patternPrims(spec).map(primSvg).join('') +
    `</pattern>`
  );
}

// ---------- Canvas 2D ----------

// Baldosa a resolución `k` (píxeles por px del documento). Devuelve el canvas y
// el factor `ps` con el que hay que repetirlo para que mida exactamente `size`.
export function renderPatternTile(spec: PatternSpec, k: number): { canvas: HTMLCanvasElement; ps: number } {
  const px = clamp(Math.round(spec.size * k), 1, 2048);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const f = px / spec.size;
  ctx.scale(f, f);
  ctx.fillStyle = spec.color1;
  ctx.fillRect(0, 0, spec.size, spec.size);
  for (const p of patternPrims(spec)) {
    if (p.t === 'rect') {
      ctx.fillStyle = p.fill;
      ctx.fillRect(p.x, p.y, p.w, p.h);
    } else if (p.t === 'circle') {
      ctx.fillStyle = p.fill;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.width;
      ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(p.d));
    }
  }
  return { canvas, ps: 1 / f };
}

// Rellena el documento con el patrón (la exportación ya tiene ctx.scale(scale)).
export function fillPatternBackground(
  ctx: CanvasRenderingContext2D,
  spec: PatternSpec,
  w: number,
  h: number,
  scale: number,
) {
  const { canvas, ps } = renderPatternTile(spec, Math.max(1, scale));
  const pat = ctx.createPattern(canvas, 'repeat');
  if (!pat) return;
  pat.setTransform(new DOMMatrix().scale(ps, ps));
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
}
