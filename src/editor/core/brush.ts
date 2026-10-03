// Pinceles: geometría pura de los trazos a mano alzada (sin DOM, probada con Vitest).
// El mismo resultado (`strokePrims`) lo consumen el editor (Konva), la exportación PNG/JPG/PDF
// (Canvas 2D) y el SVG (como <path>), así que se ven igual en todas partes.
import type { BrushStyle, StrokeLayer } from './types';

export interface BrushInfo {
  id: BrushStyle;
  label: string;
  desc: string;
  size: number; // grosor por defecto
  opacity: number; // opacidad por defecto de la capa
  blend?: 'multiply';
}

export const BRUSHES: BrushInfo[] = [
  { id: 'pencil', label: 'Lápiz', desc: 'Grafito fino con grano', size: 5, opacity: 0.95 },
  { id: 'pen', label: 'Bolígrafo', desc: 'Línea limpia, varía con la presión', size: 4, opacity: 1 },
  { id: 'marker', label: 'Rotulador', desc: 'Trazo grueso y uniforme', size: 14, opacity: 0.95 },
  { id: 'brush', label: 'Pincel', desc: 'Grosor variable por velocidad o presión', size: 22, opacity: 1 },
  { id: 'watercolor', label: 'Acuarela', desc: 'Borde suave y difuso', size: 26, opacity: 0.9 },
  { id: 'airbrush', label: 'Aerógrafo', desc: 'Spray de puntitos', size: 44, opacity: 1 },
  { id: 'highlighter', label: 'Resaltador', desc: 'Translúcido, se mezcla por multiplicar', size: 26, opacity: 0.6, blend: 'multiply' },
  { id: 'chalk', label: 'Tiza', desc: 'Carboncillo con textura de grano', size: 24, opacity: 0.95 },
  { id: 'calligraphy', label: 'Caligráfico', desc: 'Punta plana inclinada', size: 14, opacity: 1 },
];

export const BRUSH_MAX_POINTS = 600;
export const SIZE_MIN = 1;
export const SIZE_MAX = 200;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const n1 = (v: number) => String(Math.round(v * 10) / 10);

// ---------- aleatorio determinista ----------
export function rng(seed: number): () => number {
  let a = (seed | 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- captura: estabilizador y presión simulada ----------
/** Media móvil exponencial: smoothing 0 = sigue el puntero, 1 = mucho retardo (cuerda). */
export function stabilize(prev: [number, number], raw: [number, number], smoothing: number): [number, number] {
  const k = 1 - clamp(smoothing, 0, 1) * 0.92; // fracción del camino que se avanza por muestra
  return [prev[0] + (raw[0] - prev[0]) * k, prev[1] + (raw[1] - prev[1]) * k];
}

/** Presión simulada: rápido = fino, lento = grueso. v en px por ms; prev = presión anterior (suaviza). */
export function simulatedPressure(v: number, prev: number): number {
  const target = clamp(1 - v / 3, 0.15, 1);
  return prev * 0.7 + target * 0.3;
}

// ---------- simplificación (Douglas-Peucker) ----------
/** Simplifica una polilínea [x,y,p,...] conservando la presión de los puntos que quedan. */
export function simplifyRDP(pts: number[], eps: number): number[] {
  const n = Math.floor(pts.length / 3);
  if (n <= 2 || eps <= 0) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 3], ay = pts[a * 3 + 1], bx = pts[b * 3], by = pts[b * 3 + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 3], py = pts[i * 3 + 1];
      let d: number;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > eps && mi > 0) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  return out;
}

/** Simplifica subiendo la tolerancia hasta no pasar de `max` puntos (límite del guardado). */
export function limitPoints(pts: number[], eps0: number, max = BRUSH_MAX_POINTS): number[] {
  let eps = eps0;
  let out = simplifyRDP(pts, eps);
  let guard = 0;
  while (out.length / 3 > max && guard++ < 40) {
    eps *= 1.5;
    out = simplifyRDP(pts, eps);
  }
  return out;
}

// ---------- suavizado Catmull-Rom ----------
/** Curva Catmull-Rom (centrípeta no hace falta aquí) muestreada a polilínea densa [x,y,p,...]. */
export function catmullRom(pts: number[], perSeg = 6): number[] {
  const n = Math.floor(pts.length / 3);
  if (n < 3) return pts.slice();
  const out: number[] = [];
  const g = (i: number, k: number) => pts[clamp(i, 0, n - 1) * 3 + k];
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      for (let k = 0; k < 3; k++) {
        const p0 = g(i - 1, k), p1 = g(i, k), p2 = g(i + 1, k), p3 = g(i + 2, k);
        out.push(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
      }
    }
  }
  out.push(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1], pts[(n - 1) * 3 + 2]);
  return out;
}

/** Trazado SVG (M + C) de la curva Catmull-Rom convertida a Bézier cúbicas exactas. */
export function bezierPath(pts: number[]): string {
  const n = Math.floor(pts.length / 3);
  if (n === 0) return '';
  const x = (i: number) => pts[clamp(i, 0, n - 1) * 3];
  const y = (i: number) => pts[clamp(i, 0, n - 1) * 3 + 1];
  if (n === 1) return `M${n1(x(0))} ${n1(y(0))}L${n1(x(0) + 0.01)} ${n1(y(0))}`;
  let d = `M${n1(x(0))} ${n1(y(0))}`;
  if (n === 2) return d + `L${n1(x(1))} ${n1(y(1))}`;
  for (let i = 0; i < n - 1; i++) {
    d += `C${n1(x(i) + (x(i + 1) - x(i - 1)) / 6)} ${n1(y(i) + (y(i + 1) - y(i - 1)) / 6)} ${n1(x(i + 1) - (x(i + 2) - x(i)) / 6)} ${n1(y(i + 1) - (y(i + 2) - y(i)) / 6)} ${n1(x(i + 1))} ${n1(y(i + 1))}`;
  }
  return d;
}

// ---------- geometría ----------
export type Prim =
  | { k: 'line'; d: string; w: number; alpha: number; cap: 'round' | 'butt' }
  | { k: 'poly'; d: string; alpha: number }
  | { k: 'dots'; sq: number[]; alpha: number }; // [x, y, lado, …] cuadraditos de grano

function polyD(poly: number[]): string {
  let d = '';
  for (let i = 0; i < poly.length; i += 2) d += `${i ? 'L' : 'M'}${n1(poly[i])} ${n1(poly[i + 1])}`;
  return d + 'Z';
}

/** Longitud acumulada de una polilínea densa. */
function arcLengths(dense: number[]): number[] {
  const n = dense.length / 3;
  const L = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(dense[i * 3] - dense[i * 3 - 3], dense[i * 3 + 1] - dense[i * 3 - 2]));
  return L;
}

/** Cinta de ancho variable (con puntas redondeadas) alrededor de la polilínea densa. */
export function ribbon(dense: number[], width: (i: number, t: number) => number): number[] {
  const n = dense.length / 3;
  if (n === 0) return [];
  const L = arcLengths(dense);
  const total = L[n - 1] || 1;
  const left: number[] = [];
  const right: number[] = [];
  const hw: number[] = [];
  let lastNx = 0, lastNy = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const tx = dense[b * 3] - dense[a * 3], ty = dense[b * 3 + 1] - dense[a * 3 + 1];
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-6) {
      lastNx = -ty / tl;
      lastNy = tx / tl;
    }
    const w = Math.max(0.2, width(i, L[i] / total)) / 2;
    hw.push(w);
    const x = dense[i * 3], y = dense[i * 3 + 1];
    left.push(x + lastNx * w, y + lastNy * w);
    right.push(x - lastNx * w, y - lastNy * w);
  }
  const poly: number[] = [...left];
  // punta final redondeada (semicírculo de left a right)
  const cap = (cx: number, cy: number, r: number, from: number, dirSign: number) => {
    for (let s = 1; s < 6; s++) {
      const a = from + (dirSign * Math.PI * s) / 6;
      poly.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  };
  {
    const i = n - 1;
    const ang = Math.atan2(left[i * 2 + 1] - dense[i * 3 + 1], left[i * 2] - dense[i * 3]);
    cap(dense[i * 3], dense[i * 3 + 1], hw[i], ang, -1);
  }
  for (let i = n - 1; i >= 0; i--) poly.push(right[i * 2], right[i * 2 + 1]);
  {
    const ang = Math.atan2(right[1] - dense[1], right[0] - dense[0]);
    cap(dense[0], dense[1], hw[0], ang, -1);
  }
  return poly;
}

/** Paralelogramos de la punta plana, todos con el mismo sentido (así la unión no deja huecos). */
function nibQuads(dense: number[], nx: number, ny: number, scale: (i: number) => number): string {
  const n = dense.length / 3;
  let d = '';
  if (n === 1) {
    const x = dense[0], y = dense[1];
    return polyD([x - nx, y - ny, x + nx, y + ny, x + nx + 0.4, y + ny + 0.4, x - nx + 0.4, y - ny + 0.4]);
  }
  for (let i = 0; i < n - 1; i++) {
    const s0 = scale(i), s1 = scale(i + 1);
    const ax = dense[i * 3], ay = dense[i * 3 + 1], bx = dense[i * 3 + 3], by = dense[i * 3 + 4];
    let q = [ax - nx * s0, ay - ny * s0, bx - nx * s1, by - ny * s1, bx + nx * s1, by + ny * s1, ax + nx * s0, ay + ny * s0];
    let area = 0;
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4;
      area += q[j * 2] * q[k * 2 + 1] - q[k * 2] * q[j * 2 + 1];
    }
    if (area < 0) q = [q[6], q[7], q[4], q[5], q[2], q[3], q[0], q[1]];
    d += polyD(q);
  }
  return d;
}

/** Muestras equiespaciadas (cada `step` px) sobre la polilínea densa: [x,y,p, ...]. */
function samplesAlong(dense: number[], step: number): number[] {
  const n = dense.length / 3;
  const out: number[] = [dense[0], dense[1], dense[2]];
  if (n < 2) return out;
  let carry = 0;
  for (let i = 1; i < n; i++) {
    const x0 = dense[i * 3 - 3], y0 = dense[i * 3 - 2], p0 = dense[i * 3 - 1];
    const x1 = dense[i * 3], y1 = dense[i * 3 + 1], p1 = dense[i * 3 + 2];
    const len = Math.hypot(x1 - x0, y1 - y0);
    let pos = step - carry;
    while (pos <= len) {
      const t = len ? pos / len : 0;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t);
      pos += step;
    }
    carry = len - (pos - step);
  }
  return out;
}

function pathLength(dense: number[]): number {
  const L = arcLengths(dense);
  return L[L.length - 1] || 0;
}

/** Reparte los cuadraditos de grano en 3 cubos de opacidad (menos trazos en el SVG). */
function bucketDots(list: { x: number; y: number; s: number; a: number }[], base: number): Prim[] {
  const alphas = [0.4, 0.7, 1];
  const b: number[][] = [[], [], []];
  for (const q of list) b[q.a < 0.45 ? 0 : q.a < 0.75 ? 1 : 2].push(Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10, Math.round(q.s * 10) / 10);
  return b.map((sq, i) => ({ k: 'dots', sq, alpha: base * alphas[i] }) as Prim).filter((p) => p.k === 'dots' && p.sq.length > 0);
}

export const PRESSURE_VARIATION: Record<BrushStyle, boolean> = {
  pencil: false,
  pen: true,
  marker: false,
  brush: true,
  watercolor: false,
  airbrush: false,
  highlighter: false,
  chalk: true,
  calligraphy: false,
};

const NIB_ANGLE = (-40 * Math.PI) / 180;

/** Primitivas (líneas, polígonos, granos) que dibujan el trazo, en coordenadas locales de la capa. */
export function strokePrims(l: Pick<StrokeLayer, 'brush' | 'size' | 'pts' | 'seed'>): Prim[] {
  const pts = l.pts;
  if (pts.length < 3) return [];
  const size = Math.max(0.5, l.size);
  const dense = catmullRom(pts, 6);
  const r = rng(l.seed);
  switch (l.brush) {
    case 'pen': {
      const poly = ribbon(dense, (i) => size * (0.55 + 0.7 * dense[i * 3 + 2]));
      return [{ k: 'poly', d: polyD(poly), alpha: 1 }];
    }
    case 'brush': {
      const taper = Math.max(1, size * 1.4);
      const total = pathLength(dense);
      const poly = ribbon(dense, (i, t) => {
        const dist = Math.min(t * total, (1 - t) * total);
        const tp = 0.3 + 0.7 * clamp(dist / taper, 0, 1);
        return size * (0.15 + 1.0 * dense[i * 3 + 2]) * tp;
      });
      return [{ k: 'poly', d: polyD(poly), alpha: 1 }];
    }
    case 'marker':
      return [{ k: 'line', d: bezierPath(pts), w: size, alpha: 0.92, cap: 'round' }];
    case 'highlighter':
      return [{ k: 'line', d: bezierPath(pts), w: size * 1.6, alpha: 0.6, cap: 'butt' }];
    case 'watercolor': {
      const d = bezierPath(pts);
      const out: Prim[] = [];
      for (let i = 0; i < 6; i++) out.push({ k: 'line', d, w: size * (2.2 - i * 0.26), alpha: 0.075 + i * 0.01, cap: 'round' });
      return out;
    }
    case 'calligraphy': {
      const hw = size / 2;
      const d = nibQuads(dense, Math.cos(NIB_ANGLE) * hw, Math.sin(NIB_ANGLE) * hw, (i) => 0.75 + 0.5 * dense[i * 3 + 2]);
      return [{ k: 'poly', d, alpha: 1 }];
    }
    case 'airbrush': {
      const total = pathLength(dense);
      const radius = size * 0.8;
      let step = Math.max(1, size * 0.08);
      const per = Math.max(3, Math.round(size * 0.8));
      while ((total / step + 1) * per > 12000) step *= 1.4;
      const list: { x: number; y: number; s: number; a: number }[] = [];
      for (const [x, y, p] of chunk3(samplesAlong(dense, step))) {
        for (let k = 0; k < per; k++) {
          const ang = r() * Math.PI * 2;
          const g = Math.sqrt(-2 * Math.log(1 - r() * 0.999)) * 0.38; // gaussiana: denso al centro
          const rad = Math.min(1, g) * radius * (0.6 + 0.4 * p);
          list.push({ x: x + Math.cos(ang) * rad, y: y + Math.sin(ang) * rad, s: 0.9 + r() * 1.3, a: 1 - rad / (radius * 1.1) });
        }
      }
      return bucketDots(list, 0.7);
    }
    case 'chalk': {
      const total = pathLength(dense);
      let step = Math.max(0.8, size * 0.06);
      const per = Math.max(3, Math.round(size * 0.55));
      while ((total / step + 1) * per > 14000) step *= 1.4;
      const list: { x: number; y: number; s: number; a: number }[] = [];
      for (const [x, y, p] of chunk3(samplesAlong(dense, step))) {
        const half = (size / 2) * (0.7 + 0.5 * p);
        for (let k = 0; k < per; k++) {
          const u = r(), v = r();
          if (r() < 0.38) continue; // huecos: textura de papel
          const ang = r() * Math.PI * 2;
          const rad = Math.sqrt(u) * half;
          list.push({ x: x + Math.cos(ang) * rad, y: y + Math.sin(ang) * rad, s: 0.9 + v * 1.8, a: 0.4 + r() * 0.6 });
        }
      }
      return bucketDots(list, 0.9);
    }
    case 'pencil':
    default: {
      const total = pathLength(dense);
      let step = Math.max(0.8, size * 0.25);
      const per = Math.max(1, Math.round(size * 0.35));
      while ((total / step + 1) * per > 6000) step *= 1.4;
      const list: { x: number; y: number; s: number; a: number }[] = [];
      for (const [x, y] of chunk3(samplesAlong(dense, step))) {
        for (let k = 0; k < per; k++) {
          const ang = r() * Math.PI * 2;
          const rad = Math.sqrt(r()) * size * 0.55;
          list.push({ x: x + Math.cos(ang) * rad, y: y + Math.sin(ang) * rad, s: 0.7 + r() * 0.8, a: 0.3 + r() * 0.5 });
        }
      }
      return [{ k: 'line', d: bezierPath(pts), w: size * 0.6, alpha: 0.8, cap: 'round' }, ...bucketDots(list, 0.85)];
    }
  }
}

function* chunk3(a: number[]): Generator<[number, number, number]> {
  for (let i = 0; i + 2 < a.length; i += 3) yield [a[i], a[i + 1], a[i + 2]];
}

// ---------- dibujo en Canvas 2D (editor y exportación) ----------
/** Dibuja el trazo en el origen local de la capa. Respeta la opacidad ya puesta en ctx.globalAlpha. */
export function drawStroke(ctx: CanvasRenderingContext2D, l: Pick<StrokeLayer, 'brush' | 'size' | 'pts' | 'seed' | 'color'>, prims = strokePrims(l)) {
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const p of prims) {
    ctx.globalAlpha = base * p.alpha;
    if (p.k === 'line') {
      ctx.strokeStyle = l.color;
      ctx.lineWidth = p.w;
      ctx.lineCap = p.cap;
      ctx.stroke(new Path2D(p.d));
    } else if (p.k === 'poly') {
      ctx.fillStyle = l.color;
      ctx.fill(new Path2D(p.d), 'nonzero');
    } else {
      ctx.fillStyle = l.color;
      ctx.beginPath();
      for (let i = 0; i < p.sq.length; i += 3) ctx.rect(p.sq[i], p.sq[i + 1], p.sq[i + 2], p.sq[i + 2]);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---------- SVG ----------
/** Trazo como elementos <path> (sin imágenes). Va dentro del <g transform> de la capa. */
export function strokeToSvg(l: Pick<StrokeLayer, 'brush' | 'size' | 'pts' | 'seed' | 'color'>): string {
  return strokePrims(l)
    .map((p) => {
      const a = p.alpha < 1 ? ` opacity="${Math.round(p.alpha * 1000) / 1000}"` : '';
      if (p.k === 'line')
        return `<path d="${p.d}" fill="none" stroke="${l.color}" stroke-width="${n1(p.w)}" stroke-linecap="${p.cap}" stroke-linejoin="round"${a}/>`;
      if (p.k === 'poly') return `<path d="${p.d}" fill="${l.color}" fill-rule="nonzero"${a}/>`;
      let d = '';
      for (let i = 0; i < p.sq.length; i += 3) d += `M${p.sq[i]} ${p.sq[i + 1]}h${p.sq[i + 2]}v${p.sq[i + 2]}h-${p.sq[i + 2]}z`;
      return `<path d="${d}" fill="${l.color}"${a}/>`;
    })
    .join('');
}

// ---------- construcción de la capa ----------
export interface StrokeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  pts: number[];
}

/** Margen que el pincel dibuja fuera de la polilínea (para la caja de la capa). */
export function brushPad(style: BrushStyle, size: number): number {
  const m = style === 'watercolor' ? 1.3 : style === 'highlighter' ? 0.9 : style === 'airbrush' ? 0.9 : 0.75;
  return Math.ceil(size * m + 2);
}

/** Convierte los puntos capturados en la doc a la geometría de la capa: simplifica, redondea y centra. */
export function buildStrokeGeometry(raw: number[], style: BrushStyle, size: number): StrokeGeometry {
  const eps = clamp(size * 0.06, 0.5, 3);
  let pts = limitPoints(raw, eps);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  const pad = brushPad(style, size);
  const ox = Math.floor(minX - pad), oy = Math.floor(minY - pad);
  pts = pts.map((v, i) => (i % 3 === 0 ? Math.round((v - ox) * 10) / 10 : i % 3 === 1 ? Math.round((v - oy) * 10) / 10 : Math.round(v * 100) / 100));
  return { x: ox, y: oy, width: Math.ceil(maxX - minX + pad * 2), height: Math.ceil(maxY - minY + pad * 2), pts };
}

/** ¿El punto (x, y) del documento toca este trazo (con un radio extra de borrador)? */
export function strokeHit(l: StrokeLayer, x: number, y: number, radius: number): boolean {
  const r = (-l.rotation * Math.PI) / 180;
  const dx = x - l.x, dy = y - l.y;
  const lx = (dx * Math.cos(r) - dy * Math.sin(r)) / (l.scaleX || 1);
  const ly = (dx * Math.sin(r) + dy * Math.cos(r)) / (l.scaleY || 1);
  const sc = (Math.abs(l.scaleX) + Math.abs(l.scaleY)) / 2 || 1;
  const reach = l.size * 0.5 + radius / sc;
  const n = l.pts.length / 3;
  if (n === 1) return Math.hypot(lx - l.pts[0], ly - l.pts[1]) <= reach;
  for (let i = 0; i < n - 1; i++) {
    const ax = l.pts[i * 3], ay = l.pts[i * 3 + 1], bx = l.pts[i * 3 + 3], by = l.pts[i * 3 + 4];
    const ex = bx - ax, ey = by - ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 ? clamp(((lx - ax) * ex + (ly - ay) * ey) / len2, 0, 1) : 0;
    if (Math.hypot(lx - (ax + t * ex), ly - (ay + t * ey)) <= reach) return true;
  }
  return false;
}

/** Trazo de muestra (curva en S) para las vistas previas del panel. */
export function samplePoints(w: number, h: number): number[] {
  const out: number[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    out.push(w * (0.1 + 0.8 * t), h * (0.5 + 0.28 * Math.sin(t * Math.PI * 2)), 0.35 + 0.65 * Math.sin(t * Math.PI));
  }
  return out;
}

/** Parche para cambiar el grosor de un trazo ya hecho: reajusta caja y puntos al nuevo margen. */
export function resizePatch(l: StrokeLayer, size: number): Partial<StrokeLayer> {
  const d = brushPad(l.brush, size) - brushPad(l.brush, l.size);
  const pts = l.pts.map((v, i) => (i % 3 === 2 ? v : Math.round((v + d) * 10) / 10));
  return { size, pts, x: l.x - d * l.scaleX, y: l.y - d * l.scaleY, width: l.width + 2 * d, height: l.height + 2 * d };
}
