// Reflejo en suelo y sombra proyectada de una capa de imagen. Se dibujan en coordenadas LOCALES
// de la capa (0..w, 0..h), así sirven igual para Konva, la exportación a imagen y la SVG.
import type { ImageCastShadow, ImageReflection } from './types';
import { shapePath } from './shapes';
import type { ShapeKind } from './types';

export const DEFAULT_REFLECTION: ImageReflection = { opacity: 0.45, length: 0.5, gap: 4 };
export const DEFAULT_CAST_SHADOW: ImageCastShadow = {
  angle: 90,
  length: 0.7,
  blur: 8,
  opacity: 0.45,
  color: '#000000',
};

export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

// Matriz afín que aplasta la silueta sobre el suelo: la base (y = h) queda fija y lo que está a
// altura u sobre ella se desplaza `u·length` en la dirección del ángulo (la profundidad se
// comprime a la mitad para dar sensación de suelo en perspectiva).
export function shadowMatrix(w: number, h: number, cs: ImageCastShadow): Affine {
  void w;
  const rad = (cs.angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  let sinA = Math.sin(rad);
  if (Math.abs(sinA) < 0.08) sinA = sinA < 0 ? -0.08 : 0.08; // evita aplastarla del todo
  const L = cs.length;
  return {
    a: 1,
    b: 0,
    c: -L * cosA,
    d: (-L * sinA) / 2,
    e: L * cosA * h,
    f: h * (1 + (L * sinA) / 2),
  };
}

// Caja (en coords locales) que ocupa la sombra, ya ensanchada por el desenfoque.
export function shadowBounds(
  w: number,
  h: number,
  cs: ImageCastShadow,
): { x: number; y: number; w: number; h: number } {
  const m = shadowMatrix(w, h, cs);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]) {
    xs.push(m.a * px + m.c * py + m.e);
    ys.push(m.b * px + m.d * py + m.f);
  }
  const pad = Math.ceil(cs.blur * 2) + 2;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
}

type Src = CanvasImageSource;
type Mask = ShapeKind | undefined;

function drawSrc(ctx: CanvasRenderingContext2D, src: Src, w: number, h: number, mask: Mask) {
  if (mask) {
    ctx.save();
    shapePath(ctx, mask, w, h, 0);
    ctx.clip();
    ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(src, 0, 0, w, h);
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// Reflejo: lienzo de w × (h·length) con la imagen volteada y desvanecida; va en (0, h + gap).
export function renderReflection(
  src: Src,
  w: number,
  h: number,
  mask: Mask,
  r: ImageReflection,
): { canvas: HTMLCanvasElement; y: number } {
  const L = Math.max(1, h * Math.min(1, Math.max(0.05, r.length)));
  const c = makeCanvas(w, L);
  const ctx = c.getContext('2d')!;
  const sx = c.width / w;
  const sy = c.height / L;
  ctx.scale(sx, sy);
  ctx.save();
  ctx.translate(0, h);
  ctx.scale(1, -1);
  drawSrc(ctx, src, w, h, mask);
  ctx.restore();
  // Desvanecimiento: opaco junto a la base y transparente al final.
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createLinearGradient(0, 0, 0, L);
  const a = Math.min(1, Math.max(0, r.opacity));
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, L);
  return { canvas: c, y: h + r.gap };
}

// Sombra proyectada: lienzo con la silueta aplastada, teñida y desenfocada. `x, y` es su esquina
// en coordenadas locales de la capa.
export function renderCastShadow(
  src: Src,
  w: number,
  h: number,
  mask: Mask,
  cs: ImageCastShadow,
): { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } {
  const b = shadowBounds(w, h, cs);
  // Limita el tamaño del lienzo temporal.
  const k = Math.min(1, 4096 / Math.max(b.w, b.h));
  const c = makeCanvas(b.w * k, b.h * k);
  const ctx = c.getContext('2d')!;
  ctx.scale(k, k);
  ctx.translate(-b.x, -b.y);
  const m = shadowMatrix(w, h, cs);
  ctx.save();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  drawSrc(ctx, src, w, h, mask);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = cs.color;
  ctx.fillRect(0, 0, c.width, c.height);
  let out = c;
  if (cs.blur > 0 && 'filter' in ctx) {
    const c2 = makeCanvas(c.width, c.height);
    const x2 = c2.getContext('2d')!;
    x2.filter = `blur(${(cs.blur * k).toFixed(2)}px)`;
    x2.drawImage(c, 0, 0);
    out = c2;
  }
  return { canvas: out, x: b.x, y: b.y, w: b.w, h: b.h };
}

// Caché de los lienzos generados (por fuente y parámetros) para no recalcular al redibujar.
const cache = new WeakMap<object, Map<string, unknown>>();
function cached<T>(src: Src, key: string, make: () => T): T {
  let m = cache.get(src as object);
  if (!m) {
    m = new Map();
    cache.set(src as object, m);
  }
  if (m.size > 6) m.clear();
  if (!m.has(key)) m.set(key, make());
  return m.get(key) as T;
}

// Dibuja sombra proyectada y reflejo de la capa (bajo la imagen). `alpha` es la opacidad ya
// aplicada por quien llama (no se vuelve a multiplicar). Requiere ctx en coords locales de la capa.
export function drawGroundFx(
  ctx: CanvasRenderingContext2D,
  src: Src,
  w: number,
  h: number,
  mask: Mask,
  fx: { reflection?: ImageReflection; castShadow?: ImageCastShadow },
) {
  if (fx.castShadow) {
    const cs = fx.castShadow;
    const key = `cs|${w}|${h}|${mask ?? ''}|${cs.angle}|${cs.length}|${cs.blur}|${cs.color}`;
    const s = cached(src, key, () => renderCastShadow(src, w, h, mask, cs));
    ctx.save();
    ctx.globalAlpha *= Math.min(1, Math.max(0, cs.opacity));
    ctx.drawImage(s.canvas, s.x, s.y, s.w, s.h);
    ctx.restore();
  }
  if (fx.reflection) {
    const r = fx.reflection;
    const key = `rf|${w}|${h}|${mask ?? ''}|${r.opacity}|${r.length}|${r.gap}`;
    const rf = cached(src, key, () => renderReflection(src, w, h, mask, r));
    ctx.drawImage(rf.canvas, 0, rf.y, w, rf.canvas.height / (rf.canvas.width / w));
  }
}

export function hasGroundFx(l: { reflection?: ImageReflection; castShadow?: ImageCastShadow }): boolean {
  return !!(l.reflection || l.castShadow);
}
