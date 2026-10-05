// Máscaras de capa NO destructivas (lógica pura, sin DOM).
//
// Modelo (campo aditivo `mask?` en cualquier capa; sin él la capa se dibuja como siempre):
//  · La máscara vive en el marco LOCAL de la capa (antes de x/y, rotación y escala), así que sigue a
//    la capa al moverla, girarla, escalarla o voltearla. `rect` = rectángulo local que cubre la
//    máscara; fuera de él vale `outside` (0 = oculto, 255 = visible).
//  · Ráster: alfa de 8 bits (`w`×`h`) estirado sobre `rect`, guardado comprimido (PackBits + base64)
//    como `data:application/x-chamva-mask;base64,…`. Al persistir se deshidrata como cualquier imagen
//    (io/assets.ts), así que el autoguardado y el historial guardado solo llevan una referencia.
//  · Vectorial: rectángulo/elipse con borde suave, o degradado lineal/radial, calculado al dibujar.
//  · `feather` (px locales) desenfoca la máscara ráster; en las vectoriales es el ancho del borde.
//  · `invert` la invierte (también el valor de fuera). `enabled: false` = desactivada (no se aplica).
//  · Lo mismo para el lienzo, la exportación PNG/JPG/PDF, el SVG y las miniaturas: todos llaman a
//    `maskAlpha` (este archivo) y a `maskRender.ts`.

export interface MaskRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type VectorMaskShape =
  // Fracciones del rect: centro y semiejes. Dentro = visible (255), fuera = `outside`.
  | { type: 'rect'; cx: number; cy: number; rx: number; ry: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  // De p0 (0, oculto) a p1 (255, visible), fracciones del rect.
  | { type: 'linear'; x0: number; y0: number; x1: number; y1: number }
  // Radial (elíptico, se ajusta al rect): visible hasta r0, oculto desde r1 (fracciones del rect).
  | { type: 'radial'; cx: number; cy: number; r0: number; r1: number };

export interface LayerMask {
  kind: 'raster' | 'vector';
  rect: MaskRect;
  enabled?: boolean; // false = desactivada
  invert?: boolean;
  feather?: number; // px locales
  outside?: 0 | 255; // valor fuera del rect (def. 0)
  // ráster
  w?: number;
  h?: number;
  data?: string; // MASK_PREFIX + base64(PackBits(alfa)) o «asset:…» deshidratada
  // vectorial
  shape?: VectorMaskShape;
}

export const MASK_PREFIX = 'data:application/x-chamva-mask;base64,';
/** Lado máximo de una máscara ráster (alfa de 8 bits): 4096² = 16 MB en memoria como mucho. */
export const MASK_MAX_SIDE = 4096;
/** Lado máximo al calcular una máscara vectorial (es suave: se estira sin perder). */
export const VECTOR_MAX_SIDE = 2048;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Codificación: PackBits sobre los bytes de alfa, luego base64.
// ---------------------------------------------------------------------------

/**
 * RLE tipo PackBits: [n 0..127] = n+1 bytes literales; [n 129..255] = repetir el siguiente byte
 * n-127 veces (2..128); [128] = repetición larga: 4 bytes (uint32 LE) de cuenta y el byte.
 * Una máscara uniforme de 12 MP ocupa unos pocos bytes.
 */
export function packBits(src: Uint8Array): Uint8Array {
  const n = src.length;
  const out = new Uint8Array(n * 2 + 8);
  let o = 0;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run < n && src[i + run] === src[i]) run++;
    if (run > 128) {
      out[o++] = 128;
      out[o++] = run & 255;
      out[o++] = (run >>> 8) & 255;
      out[o++] = (run >>> 16) & 255;
      out[o++] = (run >>> 24) & 255;
      out[o++] = src[i];
      i += run;
      continue;
    }
    if (run >= 2) {
      out[o++] = run + 127;
      out[o++] = src[i];
      i += run;
      continue;
    }
    // Literal: hasta 128 bytes o hasta que empiece una repetición de 2+.
    const start = i;
    let len = 0;
    while (i < n && len < 128) {
      if (i + 1 < n && src[i + 1] === src[i]) break;
      i++;
      len++;
    }
    out[o++] = len - 1;
    out.set(src.subarray(start, start + len), o);
    o += len;
  }
  return out.slice(0, o);
}

/** Inversa de packBits. `size` = nº de bytes esperado (los que falten quedan a 0; los que sobren se ignoran). */
export function unpackBits(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let o = 0;
  let i = 0;
  while (i < src.length && o < size) {
    const c = src[i++];
    if (c < 128) {
      const len = Math.min(c + 1, size - o, src.length - i);
      out.set(src.subarray(i, i + len), o);
      o += len;
      i += c + 1;
    } else if (c === 128) {
      const cnt = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16)) + src[i + 3] * 16777216;
      i += 4;
      const len = Math.min(cnt, size - o);
      out.fill(src[i++] ?? 0, o, o + len);
      o += len;
    } else {
      const len = Math.min(c - 127, size - o);
      out.fill(src[i++] ?? 0, o, o + len);
      o += len;
    }
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeAlpha(alpha: Uint8Array): string {
  return MASK_PREFIX + toBase64(packBits(alpha));
}

/** null si la cadena no es una máscara codificada (p. ej. referencia «asset:» sin hidratar). */
export function decodeAlpha(data: string | undefined, w: number, h: number): Uint8Array | null {
  if (!data || !data.startsWith(MASK_PREFIX) || !(w > 0) || !(h > 0)) return null;
  try {
    return unpackBits(fromBase64(data.slice(MASK_PREFIX.length)), w * h);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validación / migración (idempotente)
// ---------------------------------------------------------------------------

function validRect(r: unknown): MaskRect | null {
  if (!r || typeof r !== 'object') return null;
  const { x, y, w, h } = r as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function validShape(s: unknown): VectorMaskShape | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const nums = (...k: string[]) => k.every((key) => finite(o[key]));
  if ((o.type === 'rect' || o.type === 'ellipse') && nums('cx', 'cy', 'rx', 'ry'))
    return { type: o.type, cx: o.cx as number, cy: o.cy as number, rx: Math.abs(o.rx as number), ry: Math.abs(o.ry as number) };
  if (o.type === 'linear' && nums('x0', 'y0', 'x1', 'y1'))
    return { type: 'linear', x0: o.x0 as number, y0: o.y0 as number, x1: o.x1 as number, y1: o.y1 as number };
  if (o.type === 'radial' && nums('cx', 'cy', 'r0', 'r1'))
    return { type: 'radial', cx: o.cx as number, cy: o.cy as number, r0: Math.max(0, o.r0 as number), r1: Math.max(0, o.r1 as number) };
  return null;
}

/** Máscara guardada válida (o null). Acepta datos «asset:» (deshidratados) sin decodificarlos. */
export function validMask(m: unknown): LayerMask | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const rect = validRect(o.rect);
  if (!rect) return null;
  const base: LayerMask = { kind: 'raster', rect };
  if (o.enabled === false) base.enabled = false;
  if (o.invert === true) base.invert = true;
  if (finite(o.feather) && o.feather > 0) base.feather = Math.min(o.feather, 1000);
  if (o.outside === 255) base.outside = 255;
  if (o.kind === 'vector') {
    const shape = validShape(o.shape);
    if (!shape) return null;
    return { ...base, kind: 'vector', shape };
  }
  if (o.kind !== 'raster') return null;
  const w = o.w;
  const h = o.h;
  if (!finite(w) || !finite(h) || w < 1 || h < 1 || w > MASK_MAX_SIDE || h > MASK_MAX_SIDE) return null;
  if (typeof o.data !== 'string' || !o.data) return null;
  return { ...base, w: Math.round(w), h: Math.round(h), data: o.data };
}

/** Migración al abrir: quita máscaras inválidas, deja las buenas tal cual (sin campo = sin cambios). */
export function normalizeLayerMasks<T extends { layers: unknown[] }>(doc: T): T {
  for (const l of doc.layers as { mask?: unknown }[]) {
    if (!l || typeof l !== 'object' || !('mask' in l)) continue;
    const m = validMask(l.mask);
    if (m) l.mask = m;
    else delete l.mask;
  }
  return doc;
}

/** ¿Hay que aplicar la máscara al dibujar? */
export function maskActive(m: LayerMask | undefined | null): m is LayerMask {
  return !!m && m.enabled !== false;
}

// ---------------------------------------------------------------------------
// Rasterizado
// ---------------------------------------------------------------------------

/** Resolución de cálculo de una máscara vectorial sobre `rect` (mínimo 1 px, tope VECTOR_MAX_SIDE). */
export function vectorResolution(rect: MaskRect, k = 1): { w: number; h: number } {
  let w = Math.max(1, Math.round(rect.w * k));
  let h = Math.max(1, Math.round(rect.h * k));
  const big = Math.max(w, h);
  if (big > VECTOR_MAX_SIDE) {
    const s = VECTOR_MAX_SIDE / big;
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
  }
  return { w, h };
}

const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * Alfa (0..255) de una forma vectorial en una rejilla w×h que cubre `rect`.
 * `featherPx` = ancho del borde suave en px locales (≥ 1 px de antialias).
 */
export function rasterizeVector(shape: VectorMaskShape, rect: MaskRect, w: number, h: number, featherPx = 0): Uint8Array {
  const out = new Uint8Array(w * h);
  const sx = rect.w / w; // px locales por píxel de máscara
  const sy = rect.h / h;
  const aa = Math.max(Math.min(sx, sy), 1e-6);
  const f = Math.max(featherPx, aa); // ancho de la transición en px locales
  for (let j = 0; j < h; j++) {
    const ly = (j + 0.5) * sy; // px locales desde el borde del rect
    const v = (j + 0.5) / h; // fracción
    for (let i = 0; i < w; i++) {
      const lx = (i + 0.5) * sx;
      const u = (i + 0.5) / w;
      let a: number;
      if (shape.type === 'rect') {
        const hx = shape.rx * rect.w;
        const hy = shape.ry * rect.h;
        const dx = Math.abs(lx - shape.cx * rect.w) - hx;
        const dy = Math.abs(ly - shape.cy * rect.h) - hy;
        // Distancia con signo a un rectángulo (negativa dentro).
        const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
        const dist = outside > 0 ? outside : Math.max(dx, dy);
        a = clamp(0.5 - dist / f, 0, 1);
      } else if (shape.type === 'ellipse') {
        const rx = Math.max(1e-6, shape.rx * rect.w);
        const ry = Math.max(1e-6, shape.ry * rect.h);
        const nx = (lx - shape.cx * rect.w) / rx;
        const ny = (ly - shape.cy * rect.h) / ry;
        const d = Math.hypot(nx, ny);
        // Distancia aproximada al borde en px locales (exacta en el círculo).
        const dist = (d - 1) * (d > 0 ? Math.hypot(nx * rx, ny * ry) / d : Math.min(rx, ry));
        a = clamp(0.5 - dist / f, 0, 1);
      } else if (shape.type === 'linear') {
        const dx = (shape.x1 - shape.x0) * rect.w;
        const dy = (shape.y1 - shape.y0) * rect.h;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 1e-12 ? ((lx - shape.x0 * rect.w) * dx + (ly - shape.y0 * rect.h) * dy) / len2 : 1;
        a = clamp(t, 0, 1);
      } else {
        const d = Math.hypot(u - shape.cx, v - shape.cy);
        const r0 = Math.min(shape.r0, shape.r1);
        const r1 = Math.max(shape.r0, shape.r1);
        a = r1 - r0 < 1e-9 ? (d <= r1 ? 1 : 0) : 1 - smooth((d - r0) / (r1 - r0));
      }
      out[j * w + i] = Math.round(a * 255);
    }
  }
  return out;
}

/** Desenfoque de caja horizontal + vertical (radio r, bordes replicados) de un plano de 1 canal. */
function boxBlurPass(src: Uint8Array, w: number, h: number, r: number, tmp: Float32Array, out: Uint8Array) {
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / (n * n));
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

/**
 * Desvanecer (feather): tres pasadas de caja ≈ gaussiana de sigma ≈ `radius`/2. Radio en px del plano.
 * Determinista (mismo resultado en el hilo principal y en el worker). Radio < 0.5 → copia.
 */
export function featherAlpha(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (!(radius >= 0.5) || w < 1 || h < 1) return new Uint8Array(src);
  const r = Math.max(1, Math.round(radius / 2));
  const tmp = new Float32Array(w * h);
  let a = new Uint8Array(src);
  let b = new Uint8Array(w * h);
  for (let p = 0; p < 3; p++) {
    boxBlurPass(a, w, h, r, tmp, b);
    const t = a;
    a = b;
    b = t;
  }
  return a;
}

export function invertAlpha(a: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = 255 - a[i];
  return out;
}

export interface MaskPlane {
  w: number;
  h: number;
  alpha: Uint8Array; // valor final (ya desvanecido e invertido) dentro del rect
  outside: number; // valor final fuera del rect (ya invertido)
}

/** Píxeles de máscara por px local (para pasar `feather` a píxeles del plano). */
export function planeScale(m: LayerMask, w: number, h: number): number {
  return Math.min(w / m.rect.w, h / m.rect.h);
}

/**
 * Plano final de la máscara (lo que se aplica al dibujar). `base` = alfa ya decodificado (ráster);
 * si falta se decodifica. null = no se puede (datos sin hidratar o dañados).
 * `skipFeather` = vista en vivo mientras se pinta (sin desenfocar, mucho más rápido).
 */
export function maskPlane(m: LayerMask, base?: Uint8Array | null, skipFeather = false): MaskPlane | null {
  let w: number;
  let h: number;
  let alpha: Uint8Array | null;
  if (m.kind === 'vector') {
    if (!m.shape) return null;
    ({ w, h } = vectorResolution(m.rect));
    alpha = rasterizeVector(m.shape, m.rect, w, h, m.feather ?? 0);
  } else {
    w = m.w ?? 0;
    h = m.h ?? 0;
    alpha = base ?? decodeAlpha(m.data, w, h);
    if (!alpha || alpha.length !== w * h) return null;
    const f = (m.feather ?? 0) * planeScale(m, w, h);
    if (!skipFeather && f >= 0.5) alpha = featherAlpha(alpha, w, h, f);
  }
  let outside = m.outside ?? 0;
  if (m.invert) {
    alpha = invertAlpha(alpha);
    outside = 255 - outside;
  }
  return { w, h, alpha, outside };
}

/** Valor final (0..255) de la máscara en un punto LOCAL (muestreo bilineal), para pruebas y selección. */
export function sampleMask(p: MaskPlane, rect: MaskRect, lx: number, ly: number): number {
  const fx = ((lx - rect.x) / rect.w) * p.w - 0.5;
  const fy = ((ly - rect.y) / rect.h) * p.h - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > p.w - 0.5 || fy > p.h - 0.5) return p.outside;
  const x0 = clamp(Math.floor(fx), 0, p.w - 1);
  const y0 = clamp(Math.floor(fy), 0, p.h - 1);
  const x1 = Math.min(p.w - 1, x0 + 1);
  const y1 = Math.min(p.h - 1, y0 + 1);
  const tx = clamp(fx - x0, 0, 1);
  const ty = clamp(fy - y0, 0, 1);
  const a = p.alpha;
  const top = a[y0 * p.w + x0] * (1 - tx) + a[y0 * p.w + x1] * tx;
  const bot = a[y1 * p.w + x0] * (1 - tx) + a[y1 * p.w + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

// ---------------------------------------------------------------------------
// Crear / modificar
// ---------------------------------------------------------------------------

/** Resolución de una máscara ráster nueva para un rect local (k = píxeles por px local). */
export function rasterResolution(rect: MaskRect, k = 1): { w: number; h: number } {
  let w = Math.max(1, Math.round(rect.w * k));
  let h = Math.max(1, Math.round(rect.h * k));
  const big = Math.max(w, h);
  if (big > MASK_MAX_SIDE) {
    const s = MASK_MAX_SIDE / big;
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
  }
  return { w, h };
}

export function solidMask(rect: MaskRect, value: 0 | 255, k = 1): LayerMask {
  const { w, h } = rasterResolution(rect, k);
  return { kind: 'raster', rect: { ...rect }, w, h, data: encodeAlpha(new Uint8Array(w * h).fill(value)), outside: value };
}

export function rasterMask(rect: MaskRect, w: number, h: number, alpha: Uint8Array, outside: 0 | 255 = 0): LayerMask {
  return { kind: 'raster', rect: { ...rect }, w, h, data: encodeAlpha(alpha), ...(outside === 255 ? { outside: 255 as const } : {}) };
}

export function vectorMask(rect: MaskRect, shape: VectorMaskShape, feather = 0): LayerMask {
  return { kind: 'vector', rect: { ...rect }, shape, ...(feather > 0 ? { feather } : {}) };
}

/**
 * Alfa base editable de una máscara (para pintar sobre ella): ráster = sus datos; vectorial =
 * rasterizada a la resolución dada, con su borde y SIN invertir (la inversión sigue siendo un campo).
 */
export function editableAlpha(m: LayerMask, k = 1): { w: number; h: number; alpha: Uint8Array } | null {
  if (m.kind === 'raster') {
    const w = m.w ?? 0;
    const h = m.h ?? 0;
    const alpha = decodeAlpha(m.data, w, h);
    return alpha ? { w, h, alpha } : null;
  }
  if (!m.shape) return null;
  const { w, h } = rasterResolution(m.rect, k);
  return { w, h, alpha: rasterizeVector(m.shape, m.rect, w, h, m.feather ?? 0) };
}

/** Convierte una máscara (vectorial o ráster) en ráster con el alfa dado, conservando el resto de campos. */
export function withAlpha(m: LayerMask, w: number, h: number, alpha: Uint8Array): LayerMask {
  const out: LayerMask = { ...m, kind: 'raster', w, h, data: encodeAlpha(alpha) };
  delete out.shape;
  // En una vectorial el borde ya va dentro del alfa: no se vuelve a desenfocar.
  if (m.kind === 'vector') delete out.feather;
  return out;
}

/** Multiplica (intersección) dos planos del mismo tamaño: a·b/255. */
export function multiplyAlpha(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round((a[i] * b[i]) / 255);
  return out;
}

// ---------------------------------------------------------------------------
// Pincel sobre la máscara
// ---------------------------------------------------------------------------

/**
 * Cobertura (0–1) del pincel a `dist` del centro: opaco hasta r·dureza y luego baja linealmente.
 * Igual que el borrador de recorte (maskEdit.brushCoverage).
 */
export function dabCoverage(dist: number, radius: number, hardness: number): number {
  const inner = radius * clamp(hardness, 0, 1);
  if (dist <= inner) return 1;
  if (dist >= radius) return 0;
  const span = radius - inner;
  if (span < 1) return clamp(radius - dist + 0.5, 0, 1);
  return (radius - dist) / span;
}

export interface MaskBrushParams {
  value: 0 | 255; // 255 = pintar blanco (mostrar), 0 = negro (ocultar)
  size: number; // diámetro en píxeles del plano
  hardness: number; // 0..1
  opacity: number; // 0..1: tope de lo que cambia un trazo
}

/**
 * Un trazo sobre el plano de la máscara. Cada píxel guarda la cobertura MÁXIMA del trazo y el valor
 * se calcula desde el estado previo al trazo: pasar dos veces no acumula, y con opacidad 1 el píxel
 * llega exactamente a 0 o 255. Devuelve la región tocada de cada gota (para repintar solo eso).
 */
export class MaskStroke {
  private base: Uint8Array;
  private cov: Uint8Array;
  dirty: MaskRect | null = null;

  constructor(
    private plane: Uint8Array,
    private w: number,
    private h: number,
    private p: MaskBrushParams,
  ) {
    this.base = new Uint8Array(plane);
    this.cov = new Uint8Array(w * h);
  }

  dab(x: number, y: number, pressure = 1): MaskRect | null {
    const { w, h, p } = this;
    const r = Math.max(0.5, (p.size / 2) * pressure);
    const x0 = Math.max(0, Math.floor(x - r - 1));
    const y0 = Math.max(0, Math.floor(y - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(x + r + 1));
    const y1 = Math.min(h - 1, Math.ceil(y + r + 1));
    if (x1 < x0 || y1 < y0) return null;
    let touched = false;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const cv = Math.round(dabCoverage(Math.hypot(px + 0.5 - x, py + 0.5 - y), r, p.hardness) * clamp(p.opacity, 0, 1) * 255);
        const i = py * w + px;
        if (cv <= this.cov[i]) continue;
        this.cov[i] = cv;
        const b = this.base[i];
        this.plane[i] = cv >= 255 ? p.value : Math.round(b + ((p.value - b) * cv) / 255);
        touched = true;
      }
    }
    if (!touched) return null;
    const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    const d = this.dirty;
    this.dirty = d
      ? { x: Math.min(d.x, rect.x), y: Math.min(d.y, rect.y), w: Math.max(d.x + d.w, rect.x + rect.w) - Math.min(d.x, rect.x), h: Math.max(d.y + d.h, rect.y + rect.h) - Math.min(d.y, rect.y) }
      : rect;
    return rect;
  }

  /** Trazo de a → b con gotas cada size/4 px. */
  line(ax: number, ay: number, bx: number, by: number, pressure = 1): MaskRect | null {
    const dist = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(dist / Math.max(1, this.p.size / 4)));
    let out: MaskRect | null = null;
    for (let i = 1; i <= n; i++) {
      const r = this.dab(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, pressure);
      if (r) out = out ? { x: Math.min(out.x, r.x), y: Math.min(out.y, r.y), w: Math.max(out.x + out.w, r.x + r.w) - Math.min(out.x, r.x), h: Math.max(out.y + out.h, r.y + r.h) - Math.min(out.y, r.y) } : r;
    }
    return out;
  }

  /** ¿Cambió algún píxel respecto al inicio del trazo? */
  changed(): boolean {
    const d = this.dirty;
    if (!d) return false;
    for (let y = d.y; y < d.y + d.h; y++)
      for (let x = d.x; x < d.x + d.w; x++) if (this.plane[y * this.w + x] !== this.base[y * this.w + x]) return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Geometría: marco local de una capa ↔ documento
// ---------------------------------------------------------------------------

export interface LayerXform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** Matriz afín local → documento (Konva: T(x,y)·R(rot)·S(sx,sy)) como [a,b,c,d,e,f]. */
export function layerMatrix(l: LayerXform): [number, number, number, number, number, number] {
  const r = ((l.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * l.scaleX, sin * l.scaleX, -sin * l.scaleY, cos * l.scaleY, l.x, l.y];
}

export function invertMatrix(m: [number, number, number, number, number, number]): [number, number, number, number, number, number] | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
