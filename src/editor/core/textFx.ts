// Efectos de texto avanzados: relleno con imagen, sombra larga / extrusión 3D,
// contornos múltiples, tinta desgastada, resaltador y texto sobre trazado.
//
// Casi todo es lógica PURA (números, listas de puntos), testeada en textFx.test.ts.
// La parte con Canvas (`drawTextWithFx`) envuelve al dibujo normal del texto:
// styledText.ts y curvedText.ts solo le pasan una función `draw(ctx, pass?)` que
// dibuja el texto tal cual (o, con `pass`, en un solo color y con un contorno dado,
// sin sombra/fondo/eco). Un texto SIN ninguno de estos campos no pasa por aquí.
import type { TextExtrude, TextHighlight, TextLayer, TextOutline } from './types';

export const MAX_EXTRUDE_DEPTH = 200;
export const MAX_OUTLINES = 4;
const MAX_EXTRUDE_STEPS = 120;

type Pt = { x: number; y: number };

// ---------------------------------------------------------------------------
// ¿Qué efectos tiene la capa?
// ---------------------------------------------------------------------------

export const hasExtrude = (l: TextLayer): boolean => !!l.extrude && l.extrude.depth >= 1;
export const hasOutlines = (l: TextLayer): boolean => !!l.outlines && l.outlines.some((o) => o.width > 0);
export const hasInk = (l: TextLayer): boolean => !!l.inkTexture && l.inkTexture.amount > 0;
export const hasHighlight = (l: TextLayer): boolean => !!l.highlight && l.highlight.opacity > 0;
export const hasImageFill = (l: TextLayer): boolean => !!l.imageFill && !!l.imageFill.src;
export const hasPathText = (l: TextLayer): boolean => !!l.pathText && l.pathText.points.length >= 4;

/** ¿La capa usa algún efecto de este módulo (salvo el trazado, que es otra geometría)? */
export function hasTextFx(l: TextLayer): boolean {
  return hasExtrude(l) || hasOutlines(l) || hasInk(l) || hasHighlight(l) || hasImageFill(l);
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Extrusión y sombra larga
// ---------------------------------------------------------------------------

/** Mezcla un color #rgb/#rrggbb con negro (amt 0..1). Otros formatos se devuelven igual. */
export function shadeHex(color: string, amt: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const f = 1 - clamp(amt, 0, 1);
  const c = [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export interface ExtrudeCopy {
  dx: number;
  dy: number;
  color: string;
}

/** Nº de copias: paso adaptativo (≈1,5 px) con tope, no una copia por píxel. */
export function extrudeSteps(depth: number): number {
  const d = clamp(depth, 0, MAX_EXTRUDE_DEPTH);
  if (d < 1) return 0;
  return Math.min(MAX_EXTRUDE_STEPS, Math.max(1, Math.ceil(d / 1.5)));
}

/**
 * Copias apiladas del texto, de la más lejana a la más cercana (se dibujan en ese
 * orden). 'long' = sombra larga plana de un solo color; 'solid' = extrusión cuyo
 * color se oscurece hacia el fondo. Determinista.
 */
export function extrudeCopies(ex: TextExtrude | undefined): ExtrudeCopy[] {
  if (!ex) return [];
  const steps = extrudeSteps(ex.depth);
  if (steps === 0) return [];
  const depth = clamp(ex.depth, 0, MAX_EXTRUDE_DEPTH);
  const a = (ex.angle * Math.PI) / 180;
  const out: ExtrudeCopy[] = [];
  for (let i = steps; i >= 1; i--) {
    const d = (depth * i) / steps;
    out.push({
      dx: Math.cos(a) * d,
      dy: Math.sin(a) * d,
      color: ex.mode === 'solid' ? shadeHex(ex.color, 0.5 * (i / steps)) : ex.color,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contornos múltiples
// ---------------------------------------------------------------------------

export interface RingPass {
  color: string;
  lineWidth: number; // grosor de trazo centrado en el borde del glifo
}

/**
 * Anillos concéntricos del exterior al interior (orden de dibujo). `outlines` va
 * del interior al exterior; cada `width` es lo que añade ese anillo. El primer
 * anillo arranca donde termina el contorno propio de la capa (`baseStroke`).
 */
export function ringPasses(outlines: TextOutline[] | undefined, baseStroke: number): RingPass[] {
  const list = (outlines ?? []).filter((o) => o.width > 0).slice(0, MAX_OUTLINES);
  const base = Math.max(0, baseStroke);
  let acc = 0;
  const rings = list.map((o) => {
    acc += o.width;
    return { color: o.color, lineWidth: base + 2 * acc };
  });
  return rings.reverse();
}

/** Grosor de trazo del contorno más exterior (contorno propio + anillos). */
export function outerStrokeWidth(l: TextLayer): number {
  const sw = l.strokeWidth ?? 0; // proyectos antiguos pueden no traerlo
  const rings = ringPasses(l.outlines, sw);
  return rings.length ? rings[0].lineWidth : Math.max(0, sw);
}

/** Lo que el efecto sobresale del cuadro del texto, en px. */
export function fxMargin(l: TextLayer): number {
  const ex = hasExtrude(l) ? clamp(l.extrude!.depth, 0, MAX_EXTRUDE_DEPTH) : 0;
  const sh = l.shadow ? l.shadowBlur * 2 + Math.max(Math.abs(l.shadowX), Math.abs(l.shadowY)) : 0;
  return Math.ceil(ex + outerStrokeWidth(l) / 2 + sh + l.fontSize * 0.3 + 4);
}

// ---------------------------------------------------------------------------
// Relleno con imagen
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Destino de la imagen en modo «cubrir»: centrada, escala 1 = justo cubre el cuadro. */
export function coverRect(boxW: number, boxH: number, iw: number, ih: number, scale: number, ox: number, oy: number): Rect {
  const k = Math.max(boxW / Math.max(1, iw), boxH / Math.max(1, ih)) * clamp(scale, 0.05, 20);
  const w = iw * k;
  const h = ih * k;
  return { x: (boxW - w) / 2 + ox, y: (boxH - h) / 2 + oy, w, h };
}

const MAX_TILES = 2500;

/** Posiciones de los mosaicos que cubren el cuadro (con margen `m` alrededor). */
export function tileGrid(boxW: number, boxH: number, iw: number, ih: number, scale: number, ox: number, oy: number, m = 0): { tiles: Pt[]; tw: number; th: number } {
  let tw = Math.max(1, iw * clamp(scale, 0.02, 20));
  let th = Math.max(1, ih * clamp(scale, 0.02, 20));
  const x0 = -m;
  const y0 = -m;
  const x1 = boxW + m;
  const y1 = boxH + m;
  // Si saldrían demasiados mosaicos se agrandan (mantiene la proporción).
  const count = (Math.ceil((x1 - x0) / tw) + 1) * (Math.ceil((y1 - y0) / th) + 1);
  if (count > MAX_TILES) {
    const f = Math.sqrt(count / MAX_TILES);
    tw *= f;
    th *= f;
  }
  const startX = x0 - mod(x0 - ox, tw);
  const startY = y0 - mod(y0 - oy, th);
  const tiles: Pt[] = [];
  for (let y = startY; y < y1; y += th) for (let x = startX; x < x1; x += tw) tiles.push({ x, y });
  return { tiles, tw, th };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

// ---------------------------------------------------------------------------
// Tinta desgastada: ruido determinista independiente de la resolución
// ---------------------------------------------------------------------------

/** Hash entero (x, y, semilla) → [0, 1). */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul((seed | 0) + 0x9e3779b9, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Ruido de valor suave en [0, 1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Cuánto se borra el punto (x, y) del texto, 0..1 (1 = borrado del todo). Mezcla
 * manchas grandes, motas medianas y grano fino. `scale` ≈ tamaño de las manchas (px).
 * Con `amount` mayor se borra siempre al menos lo mismo (monótono).
 */
export function inkRemoval(x: number, y: number, amount: number, seed: number, scale: number): number {
  const am = clamp(amount, 0, 1);
  if (am <= 0) return 0;
  const s = Math.max(1, scale);
  const n =
    valueNoise(x / s, y / s, seed) * 0.5 +
    valueNoise(x / (s * 0.33) + 17.3, y / (s * 0.33) - 4.1, seed + 7) * 0.32 +
    valueNoise(x / 1.7 + 3.9, y / 1.7 + 11.2, seed + 13) * 0.18;
  const cut = am * 0.75;
  return clamp((cut - n) / 0.06 + 0.5, 0, 1);
}

/**
 * Rellena un buffer RGBA (w×h) con la máscara de borrado (negro con alfa = borrado)
 * para un cuadro local desplazado `margin`, muestreado a `k` píxeles por unidad.
 */
export function fillInkMask(data: Uint8ClampedArray, w: number, h: number, k: number, margin: number, amount: number, seed: number, scale: number) {
  for (let py = 0; py < h; py++) {
    const ly = (py + 0.5) / k - margin;
    for (let px = 0; px < w; px++) {
      const lx = (px + 0.5) / k - margin;
      const i = (py * w + px) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = Math.round(inkRemoval(lx, ly, amount, seed, scale) * 255);
    }
  }
}

// ---------------------------------------------------------------------------
// Resaltador / subrayado / tachado de rotulador
// ---------------------------------------------------------------------------

export interface LineRect {
  x: number; // inicio del texto de la línea
  y: number; // arriba de la línea
  w: number; // ancho del texto
}

/** Grosor por defecto (relativo al tamaño de fuente) de cada modo. */
export const HIGHLIGHT_DEFAULT_THICKNESS = { marker: 0.8, underline: 0.14, strike: 0.12 } as const;

/**
 * Polígono cerrado de la pincelada de una línea: bordes con ondulación suave y
 * extremos que se pasan un poco, como un rotulador. Determinista (semilla + línea).
 */
export function highlightPolygon(rect: LineRect, fontSize: number, hl: Pick<TextHighlight, 'mode' | 'thickness'>, seed: number, line: number): Pt[] {
  const fs = fontSize;
  const thick = clamp(hl.thickness, 0.04, 1.6);
  const center = hl.mode === 'underline' ? rect.y + fs * 1.0 : rect.y + fs * 0.58;
  const hh = (fs * thick) / 2;
  const bleed = hl.mode === 'marker' ? fs * 0.1 : fs * 0.03;
  const x0 = rect.x - bleed;
  const x1 = rect.x + rect.w + bleed;
  const n = Math.max(2, Math.ceil((x1 - x0) / (fs * 0.4)));
  const amp = Math.min(fs * 0.05, hh * 0.35);
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const jt = (valueNoise(i * 0.8, line * 3.7, seed) * 2 - 1) * amp;
    const jb = (valueNoise(i * 0.8 + 50, line * 3.7 + 9, seed + 1) * 2 - 1) * amp;
    // Los extremos se inclinan un poco (punta de rotulador).
    const slant = i === 0 ? fs * 0.04 : i === n ? -fs * 0.04 : 0;
    top.push({ x: x + slant, y: center - hh + jt });
    bottom.push({ x: x - slant, y: center + hh + jb });
  }
  return [...top, ...bottom.reverse()];
}

// ---------------------------------------------------------------------------
// Trazado: curva Bézier cúbica (o encadenada) con tabla de longitud de arco
// ---------------------------------------------------------------------------

export interface ArcTable {
  points: Pt[];
  segments: number;
  ts: number[]; // parámetro global: segmento + t (0..segments)
  cum: number[]; // longitud acumulada en cada muestra
  length: number;
}

const SAMPLES_PER_SEGMENT = 48;

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function cubicTangent(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

function segPoints(points: Pt[], seg: number): [Pt, Pt, Pt, Pt] {
  const i = seg * 3;
  return [points[i], points[i + 1], points[i + 2], points[i + 3]];
}

/** Punto de la curva en el parámetro global g (0..segments). */
function evalAt(points: Pt[], segments: number, g: number): { p: Pt; tan: Pt } {
  const seg = Math.min(segments - 1, Math.max(0, Math.floor(g)));
  const t = clamp(g - seg, 0, 1);
  const [a, b, c, d] = segPoints(points, seg);
  return { p: cubic(a, b, c, d, t), tan: cubicTangent(a, b, c, d, t) };
}

/** Tabla de longitud de arco de una Bézier de 4 puntos (o 3k+1 puntos encadenados). */
export function buildArcTable(points: Pt[]): ArcTable {
  const segments = Math.max(0, Math.floor((points.length - 1) / 3));
  const ts = [0];
  const cum = [0];
  if (segments === 0) return { points, segments, ts, cum, length: 0 };
  let prev = points[0];
  let len = 0;
  for (let s = 0; s < segments; s++) {
    const [a, b, c, d] = segPoints(points, s);
    for (let i = 1; i <= SAMPLES_PER_SEGMENT; i++) {
      const p = cubic(a, b, c, d, i / SAMPLES_PER_SEGMENT);
      len += Math.hypot(p.x - prev.x, p.y - prev.y);
      ts.push(s + i / SAMPLES_PER_SEGMENT);
      cum.push(len);
      prev = p;
    }
  }
  return { points, segments, ts, cum, length: len };
}

export interface PathPoint {
  x: number;
  y: number;
  angle: number; // radianes, dirección de la tangente
}

/**
 * Punto y ángulo a `s` unidades de longitud desde el inicio. Antes del inicio o
 * después del final se prolonga en línea recta siguiendo la tangente.
 */
export function pointAtLength(table: ArcTable, s: number): PathPoint {
  if (table.segments === 0) {
    const p = table.points[0] ?? { x: 0, y: 0 };
    return { x: p.x, y: p.y, angle: 0 };
  }
  const angleOf = (t: Pt, fallback: number) => (Math.hypot(t.x, t.y) < 1e-9 ? fallback : Math.atan2(t.y, t.x));
  if (s <= 0) {
    const e = evalAt(table.points, table.segments, 0);
    const a = angleOf(e.tan, firstAngle(table.points));
    return { x: e.p.x + Math.cos(a) * s, y: e.p.y + Math.sin(a) * s, angle: a };
  }
  if (s >= table.length) {
    const e = evalAt(table.points, table.segments, table.segments);
    const a = angleOf(e.tan, lastAngle(table.points));
    const d = s - table.length;
    return { x: e.p.x + Math.cos(a) * d, y: e.p.y + Math.sin(a) * d, angle: a };
  }
  // Búsqueda binaria del tramo [i, i+1] que contiene s.
  let lo = 0;
  let hi = table.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = table.cum[hi] - table.cum[lo];
  const f = span > 0 ? (s - table.cum[lo]) / span : 0;
  const g = table.ts[lo] + (table.ts[hi] - table.ts[lo]) * f;
  const e = evalAt(table.points, table.segments, g);
  return { x: e.p.x, y: e.p.y, angle: angleOf(e.tan, firstAngle(table.points)) };
}

function firstAngle(points: Pt[]): number {
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[0].x;
    const dy = points[i].y - points[0].y;
    if (Math.hypot(dx, dy) > 1e-9) return Math.atan2(dy, dx);
  }
  return 0;
}

function lastAngle(points: Pt[]): number {
  const n = points.length - 1;
  for (let i = n - 1; i >= 0; i--) {
    const dx = points[n].x - points[i].x;
    const dy = points[n].y - points[i].y;
    if (Math.hypot(dx, dy) > 1e-9) return Math.atan2(dy, dx);
  }
  return 0;
}

/** Caja que ocupa la curva (muestreada, no los puntos de control). */
export function curveBounds(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const t = buildArcTable(points);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const src = t.segments === 0 ? points : t.ts.map((g) => evalAt(points, t.segments, g).p);
  for (const p of src) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Margen alrededor del trazado para que quepan los glifos (rotados). */
export const pathPad = (fontSize: number) => fontSize * 1.1;

/** Tamaño de la caja de una capa con texto sobre trazado (los puntos ya normalizados). */
export function pathBox(points: Pt[], fontSize: number): { width: number; height: number } {
  const b = curveBounds(points);
  const pad = pathPad(fontSize);
  return { width: Math.max(1, b.maxX + pad), height: Math.max(1, b.maxY + pad) };
}

/**
 * Desplaza los puntos para que la curva empiece en (pad, pad). Devuelve también el
 * desplazamiento aplicado a los puntos (la capa debe moverse en sentido contrario).
 */
export function normalizePathPoints(points: Pt[], fontSize: number): { points: Pt[]; shift: Pt } {
  const b = curveBounds(points);
  const pad = pathPad(fontSize);
  const shift = { x: pad - b.minX, y: pad - b.minY };
  return { points: points.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y })), shift };
}

/** Curva inicial razonable para un texto de ancho `w`: una S suave. */
export function defaultPathPoints(w: number, fontSize: number): Pt[] {
  const width = Math.max(fontSize * 3, w);
  const amp = fontSize * 1.2;
  const pad = pathPad(fontSize);
  return [
    { x: pad, y: pad + amp },
    { x: pad + width * 0.33, y: pad - amp * 0.2 },
    { x: pad + width * 0.66, y: pad + amp * 2.2 },
    { x: pad + width, y: pad + amp },
  ];
}

/** Dibuja la curva en un Path2D-like (moveTo/bezierCurveTo) y devuelve el `d` SVG. */
export function pathToSvgD(points: Pt[]): string {
  if (points.length < 4) return '';
  const f = (n: number) => +n.toFixed(2);
  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let i = 1; i + 2 < points.length; i += 3) {
    d += ` C${f(points[i].x)},${f(points[i].y)} ${f(points[i + 1].x)},${f(points[i + 1].y)} ${f(points[i + 2].x)},${f(points[i + 2].y)}`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Dibujo con Canvas 2D
// ---------------------------------------------------------------------------

/** Pasada «plana» del dibujo: un solo color, contorno dado, sin sombra / fondo / eco. */
export interface FxPass {
  color: string;
  strokeWidth: number;
}

export type FxDraw = (ctx: CanvasRenderingContext2D, pass?: FxPass) => void;

export interface FxGeom {
  width: number;
  height: number;
  /** Líneas de texto (solo texto recto) para el resaltador. */
  lines?: LineRect[];
}

// Imágenes de los rellenos (decodificadas de forma asíncrona, como la doble exposición).
const fxImages = new Map<string, HTMLImageElement>();

export function preloadTextFxImages(l: TextLayer): Promise<void> {
  const src = l.imageFill?.src;
  if (!src || fxImages.has(src) || typeof Image === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const el = new Image();
    el.onload = () => {
      if (fxImages.size > 8) fxImages.clear();
      fxImages.set(src, el);
      resolve();
    };
    el.onerror = () => resolve();
    el.src = src;
  });
}

export function textFxImagesReady(l: TextLayer): boolean {
  const src = l.imageFill?.src;
  return !src || fxImages.has(src);
}

interface Aux {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  k: number;
  margin: number;
}

const MAX_AUX_SIDE = 4096;

// Escala (píxeles de dispositivo por unidad local) del contexto actual.
function deviceScale(ctx: CanvasRenderingContext2D): number {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const k = t ? Math.hypot(t.a, t.b) : 1;
  return Number.isFinite(k) && k > 0 ? clamp(k, 0.1, 8) : 1;
}

function makeAux(parent: CanvasRenderingContext2D, geom: FxGeom, margin: number): Aux | null {
  if (typeof document === 'undefined') return null;
  let k = deviceScale(parent);
  const side = Math.max(geom.width, geom.height) + margin * 2;
  if (side * k > MAX_AUX_SIDE) k = MAX_AUX_SIDE / side;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((geom.width + margin * 2) * k));
  canvas.height = Math.max(1, Math.ceil((geom.height + margin * 2) * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(k, 0, 0, k, margin * k, margin * k);
  return { canvas, ctx, k, margin };
}

function blitAux(ctx: CanvasRenderingContext2D, a: Aux) {
  ctx.drawImage(a.canvas, -a.margin, -a.margin, a.canvas.width / a.k, a.canvas.height / a.k);
}

// Máscaras de desgaste ya calculadas (el ruido es lo más caro; se reutiliza al arrastrar).
const maskCache = new Map<string, HTMLCanvasElement>();

function inkMask(a: Aux, amount: number, seed: number, scale: number): HTMLCanvasElement {
  const key = [a.canvas.width, a.canvas.height, a.k.toFixed(3), a.margin, amount, seed, scale.toFixed(2)].join('|');
  const hit = maskCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = a.canvas.width;
  c.height = a.canvas.height;
  const cx = c.getContext('2d')!;
  const img = cx.createImageData(c.width, c.height);
  fillInkMask(img.data, c.width, c.height, a.k, a.margin, amount, seed, scale);
  cx.putImageData(img, 0, 0);
  if (maskCache.size >= 6) maskCache.delete(maskCache.keys().next().value as string);
  maskCache.set(key, c);
  return c;
}

function paintHighlight(ctx: CanvasRenderingContext2D, l: TextLayer, geom: FxGeom) {
  const hl = l.highlight!;
  if (!geom.lines?.length) return;
  const seed = Math.round((l.inkTexture?.seed ?? 0) + hl.thickness * 100);
  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * clamp(hl.opacity, 0, 1);
  ctx.fillStyle = hl.color;
  geom.lines.forEach((r, i) => {
    if (r.w <= 0) return;
    const poly = highlightPolygon(r, l.fontSize, hl, seed, i);
    ctx.beginPath();
    poly.forEach((p, j) => (j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
}

function paintImageFill(ctx: CanvasRenderingContext2D, l: TextLayer, geom: FxGeom, draw: FxDraw, img: HTMLImageElement) {
  const f = l.imageFill!;
  const margin = Math.ceil(l.fontSize * 0.3 + 2);
  const aux = makeAux(ctx, geom, margin);
  if (!aux) return;
  const c = aux.ctx;
  draw(c, { color: '#000000', strokeWidth: 0 }); // solo la silueta del relleno
  c.globalCompositeOperation = 'source-in';
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (f.fit === 'tile') {
    const g = tileGrid(geom.width, geom.height, iw, ih, f.scale, f.x, f.y, margin);
    for (const t of g.tiles) c.drawImage(img, t.x, t.y, g.tw, g.th);
  } else {
    const r = coverRect(geom.width, geom.height, iw, ih, f.scale, f.x, f.y);
    c.drawImage(img, r.x, r.y, r.w, r.h);
  }
  c.globalCompositeOperation = 'source-over';
  blitAux(ctx, aux);
}

/**
 * Dibuja el texto con los efectos de la capa. El llamador pasa `draw` (el dibujo
 * normal) y la geometría del cuadro; el orden es: resaltador → extrusión →
 * contornos → texto → relleno con imagen, y todo menos el resaltador pasa por el
 * desgaste de tinta si está activo.
 */
export function drawTextWithFx(ctx: CanvasRenderingContext2D, l: TextLayer, geom: FxGeom, draw: FxDraw) {
  if (hasHighlight(l)) paintHighlight(ctx, l, geom);

  const paintAll = (c: CanvasRenderingContext2D) => {
    const outer = outerStrokeWidth(l);
    for (const e of extrudeCopies(hasExtrude(l) ? l.extrude : undefined)) {
      c.save();
      c.translate(e.dx, e.dy);
      draw(c, { color: e.color, strokeWidth: outer });
      c.restore();
    }
    for (const r of ringPasses(l.outlines, l.strokeWidth)) draw(c, { color: r.color, strokeWidth: r.lineWidth });
    draw(c);
    const img = hasImageFill(l) ? fxImages.get(l.imageFill!.src) : undefined;
    if (img) paintImageFill(c, l, geom, draw, img);
  };

  if (hasInk(l)) {
    const aux = makeAux(ctx, geom, fxMargin(l));
    if (aux) {
      paintAll(aux.ctx);
      const ink = l.inkTexture!;
      aux.ctx.save();
      aux.ctx.setTransform(1, 0, 0, 1, 0, 0);
      aux.ctx.globalCompositeOperation = 'destination-out';
      aux.ctx.drawImage(inkMask(aux, ink.amount, ink.seed, Math.max(3, l.fontSize / 5)), 0, 0);
      aux.ctx.restore();
      blitAux(ctx, aux);
      return;
    }
  }
  paintAll(ctx);
}
