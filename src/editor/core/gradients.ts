import { gradientPoints, type Gradient, type GradientStop } from './types';

// Degradados lineales y radiales: una sola definición que se dibuja igual en
// el lienzo (Konva), al exportar a imagen (canvas 2D), a SVG y en CSS.

export const isRadial = (g: Gradient) => g.kind === 'radial';
export const isConicGradient = (g: Gradient) => g.kind === 'conic';
const conicCenterOf = (g: Gradient, w: number, h: number) => ({
  x: Math.max(0, Math.min(1, g.cx ?? 0.5)) * w,
  y: Math.max(0, Math.min(1, g.cy ?? 0.5)) * h,
});

// ---------- colores con alfa ----------

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() → partes. null si no se entiende. */
export function parseColor(c: string): RGBA | null {
  const s = c.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : Math.max(0, Math.min(1, +m[4])) };
  const h = s.replace('#', '');
  if (/^[0-9a-f]{3}$/.test(h))
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h))
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  return null;
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** Color → #rrggbb (descarta el alfa; el selector nativo no lo admite). */
export function toHex6(c: string): string {
  const p = parseColor(c);
  return p ? `#${hex2(p.r)}${hex2(p.g)}${hex2(p.b)}` : '#000000';
}

/** #rrggbb + alfa 0..1 → "#rrggbb" (alfa 1) o "rgba(r,g,b,a)". */
export function withAlphaColor(hex: string, a: number): string {
  const p = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  const al = Math.max(0, Math.min(1, a));
  return al >= 1 ? `#${hex2(p.r)}${hex2(p.g)}${hex2(p.b)}` : `rgba(${p.r},${p.g},${p.b},${Number(al.toFixed(2))})`;
}

/** Mezcla dos colores (t = 0 → a, t = 1 → b). */
export function mixColors(a: string, b: string, t: number): string {
  const pa = parseColor(a) ?? { r: 0, g: 0, b: 0, a: 1 };
  const pb = parseColor(b) ?? { r: 0, g: 0, b: 0, a: 1 };
  const k = (x: number, y: number) => x + (y - x) * t;
  return withAlphaColor(`#${hex2(k(pa.r, pb.r))}${hex2(k(pa.g, pb.g))}${hex2(k(pa.b, pb.b))}`, k(pa.a, pb.a));
}

// ---------- operaciones sobre un degradado ----------

const sortStops = (stops: GradientStop[]) => [...stops].sort((a, b) => a.offset - b.offset);

/** Invierte el sentido: el primer color pasa a ser el último. */
export function reverseGradient(g: Gradient): Gradient {
  return { ...g, stops: sortStops(g.stops.map((s) => ({ ...s, offset: 1 - s.offset }))) };
}

/** Añade una parada en el hueco más grande, con el color intermedio. */
export function addStop(g: Gradient): Gradient {
  const st = sortStops(g.stops);
  let best = 0;
  let gap = -1;
  for (let i = 0; i < st.length - 1; i++) {
    const d = st[i + 1].offset - st[i].offset;
    if (d > gap) {
      gap = d;
      best = i;
    }
  }
  const a = st[best];
  const b = st[best + 1] ?? a;
  const stop = { offset: (a.offset + b.offset) / 2, color: mixColors(a.color, b.color, 0.5) };
  return { ...g, stops: sortStops([...st, stop]) };
}

/** Degradado inicial a partir de un color suelto: del color a una versión más oscura. */
export function gradientFromColor(color: string): Gradient {
  return {
    angle: 90,
    kind: 'linear',
    stops: [
      { offset: 0, color },
      { offset: 1, color: mixColors(color, '#000000', 0.45) },
    ],
  };
}

// ---------- canvas 2D (exportación, previsualizaciones) ----------

export function canvasGradient(ctx: CanvasRenderingContext2D, g: Gradient, w: number, h: number): CanvasGradient {
  let grad: CanvasGradient;
  const conic = (ctx as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient })
    .createConicGradient;
  if (isConicGradient(g) && typeof conic === 'function') {
    const c = conicCenterOf(g, w, h);
    grad = conic.call(ctx, (g.angle * Math.PI) / 180, c.x, c.y);
  } else if (isRadial(g)) {
    grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(1, Math.hypot(w, h) / 2));
  } else {
    const p = gradientPoints(g.angle, w, h);
    grad = ctx.createLinearGradient(p.x0, p.y0, p.x1, p.y1);
  }
  for (const s of sortStops(g.stops)) grad.addColorStop(Math.max(0, Math.min(1, s.offset)), s.color);
  return grad;
}

// ---------- Konva (props de un Rect/Shape) ----------

export function konvaGradientProps(g: Gradient, w: number, h: number) {
  const stops = sortStops(g.stops).flatMap((s) => [Math.max(0, Math.min(1, s.offset)), s.color]);
  if (isRadial(g)) {
    return {
      fillPriority: 'radial-gradient' as const,
      fillRadialGradientStartPoint: { x: w / 2, y: h / 2 },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndPoint: { x: w / 2, y: h / 2 },
      fillRadialGradientEndRadius: Math.max(1, Math.hypot(w, h) / 2),
      fillRadialGradientColorStops: stops,
    };
  }
  const p = gradientPoints(g.angle, w, h);
  return {
    fillPriority: 'linear-gradient' as const,
    fillLinearGradientStartPoint: { x: p.x0, y: p.y0 },
    fillLinearGradientEndPoint: { x: p.x1, y: p.y1 },
    fillLinearGradientColorStops: stops,
  };
}

// ---------- SVG ----------

/** <linearGradient>/<radialGradient> con el id dado, en coordenadas de usuario de w×h. */
export function svgGradientDef(id: string, g: Gradient, w: number, h: number): string {
  if (isConicGradient(g)) return svgConicPattern(id, g, w, h);
  const stops = sortStops(g.stops)
    .map((s) => {
      const p = parseColor(s.color);
      const col = p ? `#${hex2(p.r)}${hex2(p.g)}${hex2(p.b)}` : s.color;
      const op = p && p.a < 1 ? ` stop-opacity="${Number(p.a.toFixed(3))}"` : '';
      return `<stop offset="${s.offset}" stop-color="${col}"${op}/>`;
    })
    .join('');
  if (isRadial(g)) {
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${w / 2}" cy="${h / 2}" r="${Math.max(1, Math.hypot(w, h) / 2)}">${stops}</radialGradient>`;
  }
  const p = gradientPoints(g.angle, w, h);
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${p.x0}" y1="${p.y0}" x2="${p.x1}" y2="${p.y1}">${stops}</linearGradient>`;
}

/** SVG no tiene degradado cónico: se rasteriza a un <pattern> con <image> (declarado en la exportación). */
function svgConicPattern(id: string, g: Gradient, w: number, h: number): string {
  const k = Math.min(1, 1024 / Math.max(1, w, h));
  const pw = Math.max(1, Math.round(w * k));
  const ph = Math.max(1, Math.round(h * k));
  let href = '';
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    const cx = c.getContext('2d');
    if (cx) {
      cx.fillStyle = canvasGradient(cx, g, pw, ph);
      cx.fillRect(0, 0, pw, ph);
      href = c.toDataURL('image/png');
    }
  }
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${w}" height="${h}"><image width="${w}" height="${h}" preserveAspectRatio="none" href="${href}"/></pattern>`;
}

// ---------- CSS (vistas previas) ----------

export function gradientCss(g: Gradient): string {
  const stops = sortStops(g.stops)
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(', ');
  if (isConicGradient(g)) {
    const c = conicCenterOf(g, 100, 100);
    return `conic-gradient(from ${g.angle + 90}deg at ${c.x}% ${c.y}%, ${stops})`;
  }
  return isRadial(g) ? `radial-gradient(circle, ${stops})` : `linear-gradient(${g.angle + 90}deg, ${stops})`;
}
