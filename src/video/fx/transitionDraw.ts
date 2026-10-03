// Dibujo de las transiciones (V6). Cada una recibe la capa saliente A, la entrante B (lienzos del tamaño del
// fotograma), el progreso ya suavizado `p` y dibuja el resultado en `ctx` (que ya contiene lo de debajo).
// Solo usan operaciones de Canvas2D (recortes, escalas, desplazamientos) salvo la disolución (por píxel): dan lo mismo
// en cualquier navegador y no dependen de la GPU. La geometría pura (radios, polígonos) está exportada y probada.
import { getScratch, type Canvas2, type Ctx2 } from './scratch';

export interface TransDraw {
  ctx: Ctx2;
  A: Canvas2;
  B: Canvas2;
  w: number;
  h: number;
  /** progreso con la curva aplicada (puede pasarse un poco de 0..1 con rebote o bézier) */
  p: number;
  /** semilla estable de la transición (glitch, tinta) */
  seed: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------- geometría pura ----------

/** Radio de la cortina circular: de 0 a la mitad de la diagonal (cubre el cuadro entero). */
export const circleRadius = (c: number, w: number, h: number) => clamp01(c) * (Math.hypot(w, h) / 2);

/** Polígono de la cortina diagonal: región x/w + y/h ≤ 2c. */
export function diagonalPolygon(c: number, w: number, h: number): [number, number][] {
  const u = 2 * clamp01(c);
  if (u <= 1) return [[0, 0], [u * w, 0], [0, u * h]];
  const v = u - 1;
  return [[0, 0], [w, 0], [w, v * h], [v * w, h], [0, h]];
}

/** Rectángulos revelados de la cortina de barras: `n` franjas horizontales, cada una descubierta de arriba abajo. */
export function barRects(c: number, w: number, h: number, n = 8): [number, number, number, number][] {
  const bh = h / n;
  return Array.from({ length: n }, (_, i) => [0, i * bh, w, bh * clamp01(c)] as [number, number, number, number]);
}

/** Escala horizontal de la tarjeta del giro 3D: la saliente (1→0) y luego la entrante (0→1). */
export function flipScaleX(c: number): { which: 'A' | 'B'; sx: number } {
  const a = Math.PI * clamp01(c);
  return c < 0.5 ? { which: 'A', sx: Math.cos(a) } : { which: 'B', sx: -Math.cos(a) };
}

/** Desplazamientos (en fracciones del cuadro) de A y de B para deslizar/empujar/cubrir/revelar. */
export function moveOffsets(id: string, p: number): { a: [number, number]; b: [number, number] } | null {
  const c = p; // sin limitar: el rebote puede pasarse
  const e = 1 - c;
  switch (id) {
    case 'slideLeft': return { a: [0, 0], b: [e, 0] };
    case 'slideRight': return { a: [0, 0], b: [-e, 0] };
    case 'slideUp': return { a: [0, 0], b: [0, e] };
    case 'slideDown': return { a: [0, 0], b: [0, -e] };
    case 'pushLeft': return { a: [-c, 0], b: [e, 0] };
    case 'pushRight': return { a: [c, 0], b: [-e, 0] };
    case 'pushUp': return { a: [0, -c], b: [0, e] };
    case 'pushDown': return { a: [0, c], b: [0, -e] };
    case 'cover': return { a: [-0.25 * c, 0], b: [e, 0] };
    case 'reveal': return { a: [-c, 0], b: [0, 0] };
    default: return null;
  }
}

/** Posiciones y radios de las manchas de tinta (deterministas): rejilla 5×3 con retraso y deformación por mancha. */
export interface Blob {
  x: number;
  y: number;
  delay: number;
  phase: number;
  wob: number;
}
export function inkBlobs(seed: number): Blob[] {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Blob[] = [];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 5; i++) out.push({ x: (i + 0.2 + rnd() * 0.6) / 5, y: (j + 0.2 + rnd() * 0.6) / 3, delay: rnd() * 0.4, phase: rnd() * 6.28, wob: 0.1 + rnd() * 0.12 });
  return out;
}
/** Radio relativo de una mancha en el progreso c (0 al principio, ≥ 1 cuando ya cubre su celda). */
export const blobGrow = (c: number, b: Blob) => Math.max(0, (clamp01(c) * 1.4 - b.delay) / 1.0);

// ---------- dibujo ----------

type Fn = (g: TransDraw) => void;

const shift = (g: TransDraw, img: Canvas2, dx: number, dy: number) => g.ctx.drawImage(img as CanvasImageSource, Math.round(dx * g.w), Math.round(dy * g.h));

function clipPoly(ctx: Ctx2, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
}

function drawScaled(g: TransDraw, img: Canvas2, s: number, alpha = 1) {
  const { ctx, w, h } = g;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(w / 2, h / 2);
  ctx.scale(s, s);
  ctx.drawImage(img as CanvasImageSource, -w / 2, -h / 2);
  ctx.restore();
}

/** Versión pixelada (bloque `b` px) o suavizada de una capa, dibujada en ctx. */
function drawBlocky(g: TransDraw, img: Canvas2, b: number, smooth: boolean) {
  const { ctx, w, h } = g;
  if (b <= 1) return ctx.drawImage(img as CanvasImageSource, 0, 0);
  const sw = Math.max(1, Math.round(w / b));
  const sh = Math.max(1, Math.round(h / b));
  const small = getScratch('trans-small', sw, sh);
  small.ctx.imageSmoothingEnabled = true;
  small.ctx.drawImage(img as CanvasImageSource, 0, 0, sw, sh);
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  if (smooth) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small.canvas as CanvasImageSource, 0, 0, sw, sh, 0, 0, w, h);
  ctx.restore();
}

const level = (c: number) => 1 - Math.abs(2 * clamp01(c) - 1);

/** Hash determinista 0..1 de un entero. */
const hash = (n: number) => (Math.imul(n ^ (n >>> 15), 2246822519) >>> 8) / 16777216;

const move = (id: string): Fn => (g) => {
  const o = moveOffsets(id, g.p)!;
  if (id === 'reveal') {
    shift(g, g.B, 0, 0);
    shift(g, g.A, o.a[0], o.a[1]);
    return;
  }
  if (id.startsWith('push')) {
    // las dos capas se desplazan: el hueco que dejan queda negro solo si el rebote se pasa
    shift(g, g.A, o.a[0], o.a[1]);
    shift(g, g.B, o.b[0], o.b[1]);
    return;
  }
  shift(g, g.A, o.a[0], o.a[1]);
  shift(g, g.B, o.b[0], o.b[1]);
};

const fade: Fn = (g) => {
  const c = clamp01(g.p);
  const t = getScratch('trans-t', g.w, g.h);
  t.ctx.globalAlpha = 1 - c;
  t.ctx.drawImage(g.A as CanvasImageSource, 0, 0);
  t.ctx.globalCompositeOperation = 'lighter';
  t.ctx.globalAlpha = c;
  t.ctx.drawImage(g.B as CanvasImageSource, 0, 0);
  g.ctx.drawImage(t.canvas as CanvasImageSource, 0, 0);
};

const dip = (color: string): Fn => (g) => {
  const c = clamp01(g.p);
  const { ctx, w, h } = g;
  ctx.drawImage((c < 0.5 ? g.A : g.B) as CanvasImageSource, 0, 0);
  ctx.save();
  ctx.globalAlpha = c < 0.5 ? c * 2 : (1 - c) * 2;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
};

const dissolve: Fn = (g) => {
  const { w, h } = g;
  const a = getScratch('trans-a', w, h, false);
  const b = getScratch('trans-b', w, h, false);
  a.ctx.clearRect(0, 0, w, h);
  b.ctx.clearRect(0, 0, w, h);
  a.ctx.drawImage(g.A as CanvasImageSource, 0, 0);
  b.ctx.drawImage(g.B as CanvasImageSource, 0, 0);
  const ia = a.ctx.getImageData(0, 0, w, h);
  const ib = b.ctx.getImageData(0, 0, w, h);
  const a32 = new Uint32Array(ia.data.buffer);
  const b32 = new Uint32Array(ib.data.buffer);
  const c = clamp01(g.p);
  const salt = g.seed | 0;
  for (let i = 0; i < a32.length; i++) if (hash(i + salt) < c) a32[i] = b32[i];
  a.ctx.putImageData(ia, 0, 0);
  g.ctx.drawImage(a.canvas as CanvasImageSource, 0, 0);
};

const clipReveal = (build: (g: TransDraw) => void): Fn => (g) => {
  g.ctx.drawImage(g.A as CanvasImageSource, 0, 0);
  g.ctx.save();
  build(g);
  g.ctx.drawImage(g.B as CanvasImageSource, 0, 0);
  g.ctx.restore();
};

const FNS: Record<string, Fn> = {
  fade,
  dissolve,
  fadeBlack: dip('#000'),
  fadeWhite: dip('#fff'),
  slideLeft: move('slideLeft'),
  slideRight: move('slideRight'),
  slideUp: move('slideUp'),
  slideDown: move('slideDown'),
  pushLeft: move('pushLeft'),
  pushRight: move('pushRight'),
  pushUp: move('pushUp'),
  pushDown: move('pushDown'),
  cover: move('cover'),
  reveal: move('reveal'),
  zoomIn: (g) => {
    const c = clamp01(g.p);
    g.ctx.drawImage(g.B as CanvasImageSource, 0, 0);
    drawScaled(g, g.A, 1 + 0.8 * c, 1 - c);
  },
  zoomOut: (g) => {
    const c = clamp01(g.p);
    g.ctx.drawImage(g.A as CanvasImageSource, 0, 0);
    drawScaled(g, g.B, 1.8 - 0.8 * c, c);
  },
  wipe: clipReveal((g) => {
    g.ctx.beginPath();
    g.ctx.rect(0, 0, g.w * clamp01(g.p), g.h);
    g.ctx.clip();
  }),
  circle: clipReveal((g) => {
    g.ctx.beginPath();
    g.ctx.arc(g.w / 2, g.h / 2, circleRadius(g.p, g.w, g.h), 0, Math.PI * 2);
    g.ctx.clip();
  }),
  bars: clipReveal((g) => {
    g.ctx.beginPath();
    for (const [x, y, w, h] of barRects(g.p, g.w, g.h)) if (h > 0) g.ctx.rect(x, y, w, Math.min(h + 0.5, g.h / 8));
    g.ctx.clip();
  }),
  diagonal: clipReveal((g) => clipPoly(g.ctx, diagonalPolygon(g.p, g.w, g.h))),
  clock: clipReveal((g) => {
    const { ctx, w, h } = g;
    const R = Math.hypot(w, h);
    const a0 = -Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + Math.cos(a0) * R, h / 2 + Math.sin(a0) * R);
    ctx.arc(w / 2, h / 2, R, a0, a0 + Math.PI * 2 * clamp01(g.p));
    ctx.closePath();
    ctx.clip();
  }),
  flip: (g) => {
    const { ctx, w, h } = g;
    const c = clamp01(g.p);
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const f = flipScaleX(c);
    const sy = 1 - 0.08 * Math.sin(Math.PI * c);
    ctx.translate(w / 2, h / 2);
    ctx.scale(Math.max(1e-3, Math.abs(f.sx)), sy);
    ctx.drawImage((f.which === 'A' ? g.A : g.B) as CanvasImageSource, -w / 2, -h / 2);
    ctx.restore();
  },
  pixelate: (g) => {
    const c = clamp01(g.p);
    const b = Math.max(1, Math.round(level(c) * 0.07 * g.w));
    drawBlocky(g, c < 0.5 ? g.A : g.B, b, false);
  },
  blur: (g) => {
    const c = clamp01(g.p);
    const b = Math.max(1, 1 + level(c) * 28);
    drawBlocky(g, c < 0.5 ? g.A : g.B, b, true);
  },
  flash: (g) => {
    const c = clamp01(g.p);
    const { ctx, w, h } = g;
    ctx.drawImage((c < 0.5 ? g.A : g.B) as CanvasImageSource, 0, 0);
    ctx.save();
    ctx.globalAlpha = Math.pow(level(c), 1.4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  },
  glitch: (g) => {
    const { ctx, w, h } = g;
    const c = clamp01(g.p);
    const lv = level(c);
    const step = Math.floor(c * 18);
    const rows = 24;
    ctx.drawImage(g.A as CanvasImageSource, 0, 0);
    for (let i = 0; i < rows; i++) {
      const y0 = Math.round((i * h) / rows);
      const y1 = Math.round(((i + 1) * h) / rows);
      const useB = hash(i * 977 + (g.seed | 0)) < c;
      const off = Math.round((hash(i * 131 + step * 7919 + (g.seed | 0)) - 0.5) * 0.3 * w * lv);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y0, w, y1 - y0);
      ctx.clip();
      ctx.drawImage((useB ? g.B : g.A) as CanvasImageSource, off, 0);
      if (lv > 0.15 && hash(i * 31 + step) > 0.7) {
        // fantasma de color desplazado en las franjas más afectadas
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 * lv;
        ctx.drawImage((useB ? g.B : g.A) as CanvasImageSource, off + Math.round(0.02 * w * lv), 0);
      }
      ctx.restore();
    }
  },
  ink: (g) => {
    const { ctx, w, h } = g;
    ctx.drawImage(g.A as CanvasImageSource, 0, 0);
    const blobs = inkBlobs(g.seed | 0);
    const rmax = 1.1 * Math.hypot(w / 5, h / 3);
    ctx.save();
    ctx.beginPath();
    for (const b of blobs) {
      const r = blobGrow(g.p, b) * rmax;
      if (r <= 0.5) continue;
      const cx = b.x * w;
      const cy = b.y * h;
      const n = 28;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * (1 + b.wob * Math.sin(a * 3 + b.phase) + b.wob * 0.5 * Math.sin(a * 7 + b.phase * 2));
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.clip('nonzero');
    ctx.drawImage(g.B as CanvasImageSource, 0, 0);
    ctx.restore();
  },
};

/** ¿Existe el dibujo de esta transición? */
export const hasTransitionDraw = (id: string) => id in FNS;

/** Dibuja la transición (si el id es desconocido: corte seco a B a mitad de camino). */
export function drawTransition(id: string, g: TransDraw) {
  const fn = FNS[id];
  if (fn) return fn(g);
  g.ctx.drawImage((g.p < 0.5 ? g.A : g.B) as CanvasImageSource, 0, 0);
}
