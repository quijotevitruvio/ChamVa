// Retoque de píxeles en capas de imagen (lógica pura, sin DOM): clonar, curar, eliminar mancha,
// esquivar/quemar, desenfocar, enfocar y dedo.
//
// Modelo NO destructivo («capa de retoque»): la capa conserva `src` intacto y guarda `retouch`, un PNG
// RGBA con SOLO los píxeles cambiados (alfa 0 donde no se tocó), en coordenadas de píxel de `src`
// (caja `x,y,w,h` sobre una fuente de `bw`×`bh`). Al dibujar se compone ENCIMA de `src` y ANTES de
// recorte, volteo, ajustes, filtros, máscara y forma: así recorte/giro/máscara lo respetan y lienzo,
// exportación (PNG/JPG/PDF/SVG), miniaturas y páginas apiladas ven lo mismo (misma composición).
// Campo aditivo: sin `retouch` la capa se dibuja exactamente como antes.
//
// Los pinceles trabajan sobre un búfer RGBA (`Pix`) con un `RetouchStroke`: cobertura máxima por píxel
// contra el estado al INICIO del trazo (pasar dos veces por el mismo sitio no acumula; con opacidad 1
// y dureza 1 el píxel llega EXACTO al valor objetivo), salvo desenfocar/enfocar/dedo, que acumulan.
import { brushCoverage } from './maskEdit';
import { invertMatrix, layerMatrix } from './layerMask';
import { displayBox, fullSize } from './imageCrop';
import type { ImageLayer } from './types';

export type RetouchTool = 'clone' | 'heal' | 'spot' | 'dodge' | 'burn' | 'blur' | 'sharpen' | 'smudge';
export const RETOUCH_TOOLS: RetouchTool[] = ['clone', 'heal', 'spot', 'dodge', 'burn', 'blur', 'sharpen', 'smudge'];
export const isRetouchTool = (t: string): t is RetouchTool => (RETOUCH_TOOLS as string[]).includes(t);

/** Búfer RGBA (no premultiplicado). */
export interface Pix {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Capa de retoque guardada en la capa de imagen. */
export interface RetouchRef {
  src: string; // PNG RGBA (dataURL o «asset:…» al guardar) de la caja
  x: number;
  y: number;
  w: number;
  h: number;
  bw: number; // tamaño de la fuente cuando se retocó (si `src` cambia de resolución, se escala)
  bh: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Retoque válido (o undefined): tolera datos viejos, ajenos o corruptos. */
export function validRetouch(r: unknown): RetouchRef | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const o = r as Record<string, unknown>;
  if (typeof o.src !== 'string' || !o.src) return undefined;
  if (![o.x, o.y, o.w, o.h, o.bw, o.bh].every(finite)) return undefined;
  const { x, y, w, h, bw, bh } = o as unknown as RetouchRef;
  if (w < 1 || h < 1 || bw < 1 || bh < 1 || x < 0 || y < 0 || x + w > bw + 1e-6 || y + h > bh + 1e-6) return undefined;
  return { src: o.src, x, y, w, h, bw, bh };
}

export const hasRetouch = (l: { retouch?: unknown }): boolean => !!validRetouch(l.retouch);

// ---------------------------------------------------------------------------
// Geometría: documento ↔ píxel de la fuente (respeta giro, escala, recorte y volteo)
// ---------------------------------------------------------------------------

export interface SourceMapper {
  toSrc(dx: number, dy: number): [number, number];
  fromSrc(sx: number, sy: number): [number, number];
  /** Píxeles de fuente por píxel de documento (media de los dos ejes). */
  pxPerDoc: number;
}

type MapLayer = Pick<ImageLayer, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'naturalWidth' | 'naturalHeight' | 'crop' | 'flipX' | 'flipY'>;

export function sourceMapper(l: MapLayer, srcW: number, srcH: number): SourceMapper | null {
  const m = layerMatrix(l);
  const inv = invertMatrix(m);
  if (!inv) return null;
  const full = fullSize(l);
  const db = displayBox(l);
  const kx = srcW / full.w;
  const ky = srcH / full.h;
  const fx = !!l.flipX;
  const fy = !!l.flipY;
  const toSrc = (dx: number, dy: number): [number, number] => {
    const lx = inv[0] * dx + inv[2] * dy + inv[4];
    const ly = inv[1] * dx + inv[3] * dy + inv[5];
    const px = lx + db.x;
    const py = ly + db.y;
    return [(fx ? full.w - px : px) * kx, (fy ? full.h - py : py) * ky];
  };
  const fromSrc = (sx: number, sy: number): [number, number] => {
    const nx = sx / kx;
    const ny = sy / ky;
    const px = fx ? full.w - nx : nx;
    const py = fy ? full.h - ny : ny;
    const lx = px - db.x;
    const ly = py - db.y;
    return [m[0] * lx + m[2] * ly + m[4], m[1] * lx + m[3] * ly + m[5]];
  };
  const s = (Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3])) / 2;
  return { toSrc, fromSrc, pxPerDoc: s > 0 ? (kx + ky) / 2 / s : 1 };
}

// ---------------------------------------------------------------------------
// Utilidades de píxeles
// ---------------------------------------------------------------------------

export function newPix(w: number, h: number): Pix {
  return { data: new Uint8ClampedArray(w * h * 4), w, h };
}

export function clonePix(p: Pix): Pix {
  return { data: new Uint8ClampedArray(p.data), w: p.w, h: p.h };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

const lum = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** Muestra el color (RGBA) en un píxel; fuera de la imagen repite el borde. */
export type Sampler = (x: number, y: number) => [number, number, number, number];

export function pixSampler(p: Pix): Sampler {
  return (x, y) => {
    const xi = clamp(Math.round(x), 0, p.w - 1);
    const yi = clamp(Math.round(y), 0, p.h - 1);
    const i = (yi * p.w + xi) * 4;
    return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
  };
}

/** Selección de píxeles → 0..1 por píxel de la fuente (null = sin límite). */
export type Limit = ((x: number, y: number) => number) | null;

// ---------------------------------------------------------------------------
// Pincel: parámetros y trazo
// ---------------------------------------------------------------------------

export type DodgeRange = 'shadows' | 'midtones' | 'highlights';

export interface StrokeParams {
  tool: RetouchTool;
  /** Radio en píxeles de la fuente. */
  radius: number;
  hardness: number; // 0..1
  /** Opacidad (clonar/curar) o fuerza (resto), 0..1. */
  opacity: number;
  range?: DodgeRange;
  exposure?: number; // 0..1 (esquivar/quemar)
  limit?: Limit;
  /** Muestreo del origen (clonar/curar). Por defecto, el propio búfer en vivo. */
  sampler?: Sampler;
}

const TILE = 64;

/** Peso del rango tonal (0..1) para una luminancia 0..1. */
export function rangeWeight(range: DodgeRange, L: number): number {
  if (range === 'shadows') return (1 - L) * (1 - L);
  if (range === 'highlights') return L * L;
  return 4 * L * (1 - L);
}

/** Valor objetivo de esquivar (aclara) o quemar (oscurece) para un píxel; `a` = exposición·peso del rango. */
export function dodgeBurnTarget(c: [number, number, number], dodge: boolean, range: DodgeRange, exposure: number): [number, number, number] {
  const w = rangeWeight(range, lum(c[0], c[1], c[2])) * clamp(exposure, 0, 1);
  return dodge
    ? [c[0] + (255 - c[0]) * w, c[1] + (255 - c[1]) * w, c[2] + (255 - c[2]) * w]
    : [c[0] * (1 - w), c[1] * (1 - w), c[2] * (1 - w)];
}

/** Desenfoque de caja separable de la región `rc` (radio k) leyendo de `p` (borde repetido); RGBA de la región. */
export function boxBlurRegion(p: Pix, rc: Rect, k: number): Float32Array {
  const { w, h, data } = p;
  const eh = rc.h + 2 * k;
  const tmp = new Float32Array(rc.w * eh * 4); // horizontal sobre las filas ampliadas
  const norm = 1 / (2 * k + 1);
  for (let y = 0; y < eh; y++) {
    const sy = clamp(rc.y + y - k, 0, h - 1);
    for (let x = 0; x < rc.w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let d = -k; d <= k; d++) {
        const i = (sy * w + clamp(rc.x + x + d, 0, w - 1)) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
      }
      const o = (y * rc.w + x) * 4;
      tmp[o] = r * norm; tmp[o + 1] = g * norm; tmp[o + 2] = b * norm; tmp[o + 3] = a * norm;
    }
  }
  const out = new Float32Array(rc.w * rc.h * 4);
  for (let y = 0; y < rc.h; y++) {
    for (let x = 0; x < rc.w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let d = 0; d <= 2 * k; d++) {
        const o = ((y + d) * rc.w + x) * 4;
        r += tmp[o]; g += tmp[o + 1]; b += tmp[o + 2]; a += tmp[o + 3];
      }
      const o = (y * rc.w + x) * 4;
      out[o] = r * norm; out[o + 1] = g * norm; out[o + 2] = b * norm; out[o + 3] = a * norm;
    }
  }
  return out;
}

export class RetouchStroke {
  /** Unión de las regiones tocadas en este trazo. */
  dirty: Rect | null = null;
  private snaps = new Map<number, Uint8ClampedArray>();
  private covs = new Map<number, Uint8Array>();
  private tilesX: number;
  private carry: Float32Array | null = null;
  private carryR = 0;

  constructor(
    readonly pix: Pix,
    readonly p: StrokeParams,
  ) {
    this.tilesX = Math.ceil(pix.w / TILE);
  }

  private tile(tx: number, ty: number): { snap: Uint8ClampedArray; cov: Uint8Array } {
    const key = ty * this.tilesX + tx;
    let snap = this.snaps.get(key);
    let cov = this.covs.get(key);
    if (!snap || !cov) {
      const { w, h, data } = this.pix;
      snap = new Uint8ClampedArray(TILE * TILE * 4);
      cov = new Uint8Array(TILE * TILE);
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      for (let y = 0; y < TILE && y0 + y < h; y++) {
        const n = Math.min(TILE, w - x0) * 4;
        const s = ((y0 + y) * w + x0) * 4;
        snap.set(data.subarray(s, s + n), y * TILE * 4);
      }
      this.snaps.set(key, snap);
      this.covs.set(key, cov);
    }
    return { snap, cov };
  }

  /** Color de un píxel al INICIO del trazo. */
  private before(x: number, y: number): [number, number, number, number] {
    const tx = (x / TILE) | 0;
    const ty = (y / TILE) | 0;
    const key = ty * this.tilesX + tx;
    const s = this.snaps.get(key);
    if (!s) {
      const i = (y * this.pix.w + x) * 4;
      const d = this.pix.data;
      return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    }
    const i = ((y - ty * TILE) * TILE + (x - tx * TILE)) * 4;
    return [s[i], s[i + 1], s[i + 2], s[i + 3]];
  }

  private region(cx: number, cy: number): Rect | null {
    const { w, h } = this.pix;
    const r = this.p.radius;
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
    const y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
    return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  private cover(dist: number, x: number, y: number): number {
    const p = this.p;
    const lim = p.limit ? p.limit(x, y) : 1;
    return brushCoverage(dist, p.radius, p.hardness) * clamp(p.opacity, 0, 1) * lim;
  }

  private write(x: number, y: number, rgba: ArrayLike<number>, cv255: number, cumulative: boolean) {
    const tx = (x / TILE) | 0;
    const ty = (y / TILE) | 0;
    const { snap, cov } = this.tile(tx, ty);
    const ti = (y - ty * TILE) * TILE + (x - tx * TILE);
    const d = this.pix.data;
    const i = (y * this.pix.w + x) * 4;
    if (cumulative) {
      const f = cv255 / 255;
      for (let c = 0; c < 4; c++) d[i + c] = d[i + c] + (rgba[c] - d[i + c]) * f;
      return;
    }
    if (cv255 <= cov[ti]) return;
    cov[ti] = cv255;
    const f = cv255 / 255;
    for (let c = 0; c < 4; c++) {
      const b = snap[ti * 4 + c];
      d[i + c] = cv255 >= 255 ? rgba[c] : b + (rgba[c] - b) * f;
    }
  }

  private mark(rc: Rect) {
    this.dirty = unionRect(this.dirty, rc);
  }

  /** Clonar: copia el origen `p + (ox, oy)` (desplazamiento entero) bajo el pincel. */
  clone(cx: number, cy: number, ox: number, oy: number): Rect | null {
    const rc = this.region(cx, cy);
    if (!rc) return null;
    const sampler = this.p.sampler ?? pixSampler(this.pix);
    // Se leen los orígenes ANTES de escribir: el origen puede solaparse con el destino.
    const vals: [number, number, number, number][] = [];
    for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) vals.push(sampler(x + ox, y + oy));
    let k = 0;
    for (let y = rc.y; y < rc.y + rc.h; y++) {
      for (let x = rc.x; x < rc.x + rc.w; x++, k++) {
        const cv = Math.round(this.cover(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), x, y) * 255);
        if (cv > 0) this.write(x, y, vals[k], cv, false);
      }
    }
    this.mark(rc);
    return rc;
  }

  /**
   * Curar (pincel corrector): textura del origen con el color/luminosidad del entorno del destino.
   * objetivo = origen + (media del anillo del destino − media del anillo del origen).
   */
  heal(cx: number, cy: number, ox: number, oy: number): Rect | null {
    const rc = this.region(cx, cy);
    if (!rc) return null;
    const sampler = this.p.sampler ?? pixSampler(this.pix);
    const r = this.p.radius;
    const inner = r * 0.65;
    let n = 0;
    const md = [0, 0, 0];
    const ms = [0, 0, 0];
    const vals: [number, number, number, number][] = [];
    for (let y = rc.y; y < rc.y + rc.h; y++) {
      for (let x = rc.x; x < rc.x + rc.w; x++) {
        const s = sampler(x + ox, y + oy);
        vals.push(s);
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (dist >= inner && dist <= r) {
          const b = this.before(x, y);
          md[0] += b[0]; md[1] += b[1]; md[2] += b[2];
          ms[0] += s[0]; ms[1] += s[1]; ms[2] += s[2];
          n++;
        }
      }
    }
    const dr = n ? (md[0] - ms[0]) / n : 0;
    const dg = n ? (md[1] - ms[1]) / n : 0;
    const db = n ? (md[2] - ms[2]) / n : 0;
    let k = 0;
    for (let y = rc.y; y < rc.y + rc.h; y++) {
      for (let x = rc.x; x < rc.x + rc.w; x++, k++) {
        const cv = Math.round(this.cover(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), x, y) * 255);
        if (cv <= 0) continue;
        const s = vals[k];
        this.write(x, y, [clamp(s[0] + dr, 0, 255), clamp(s[1] + dg, 0, 255), clamp(s[2] + db, 0, 255), s[3]], cv, false);
      }
    }
    this.mark(rc);
    return rc;
  }

  /** Esquivar / quemar bajo el pincel. */
  dodgeBurn(cx: number, cy: number, dodge: boolean): Rect | null {
    const rc = this.region(cx, cy);
    if (!rc) return null;
    const range = this.p.range ?? 'midtones';
    const expo = this.p.exposure ?? 0.5;
    for (let y = rc.y; y < rc.y + rc.h; y++) {
      for (let x = rc.x; x < rc.x + rc.w; x++) {
        const cv = Math.round(this.cover(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), x, y) * 255);
        if (cv <= 0) continue;
        const b = this.before(x, y);
        const t = dodgeBurnTarget([b[0], b[1], b[2]], dodge, range, expo);
        this.write(x, y, [t[0], t[1], t[2], b[3]], cv, false);
      }
    }
    this.mark(rc);
    return rc;
  }

  /** Desenfocar / enfocar (local, acumulan). */
  filter(cx: number, cy: number, sharpen: boolean): Rect | null {
    const rc = this.region(cx, cy);
    if (!rc) return null;
    const k = clamp(Math.round(this.p.radius / 8), 1, 5);
    const bl = boxBlurRegion(this.pix, rc, k);
    const d = this.pix.data;
    for (let y = 0; y < rc.h; y++) {
      for (let x = 0; x < rc.w; x++) {
        const px = rc.x + x;
        const py = rc.y + y;
        const cv = Math.round(this.cover(Math.hypot(px + 0.5 - cx, py + 0.5 - cy), px, py) * 255);
        if (cv <= 0) continue;
        const i = (py * this.pix.w + px) * 4;
        const o = (y * rc.w + x) * 4;
        const t = sharpen
          ? [d[i] + (d[i] - bl[o]) * 1.5, d[i + 1] + (d[i + 1] - bl[o + 1]) * 1.5, d[i + 2] + (d[i + 2] - bl[o + 2]) * 1.5, d[i + 3]]
          : [bl[o], bl[o + 1], bl[o + 2], d[i + 3]];
        this.write(px, py, t.map((v) => clamp(v, 0, 255)), cv, true);
      }
    }
    this.mark(rc);
    return rc;
  }

  /** Dedo: arrastra el color del punto anterior a lo largo del trazo. */
  smudge(cx: number, cy: number): Rect | null {
    const rc = this.region(cx, cy);
    if (!rc) return null;
    const d = this.pix.data;
    const r = this.p.radius;
    const size = rc.w * rc.h * 4;
    if (!this.carry || this.carryR !== size) {
      // Primer toque: recoge el color bajo el pincel, no pinta.
      this.carry = new Float32Array(size);
      this.carryR = size;
      for (let y = 0; y < rc.h; y++) for (let x = 0; x < rc.w; x++) {
        const i = ((rc.y + y) * this.pix.w + rc.x + x) * 4;
        for (let c = 0; c < 4; c++) this.carry[(y * rc.w + x) * 4 + c] = d[i + c];
      }
      return null;
    }
    const carry = this.carry;
    const fresh = new Float32Array(size);
    for (let y = 0; y < rc.h; y++) for (let x = 0; x < rc.w; x++) {
      const px = rc.x + x;
      const py = rc.y + y;
      const i = (py * this.pix.w + px) * 4;
      const o = (y * rc.w + x) * 4;
      for (let c = 0; c < 4; c++) fresh[o + c] = d[i + c];
      const cv = Math.round(this.cover(Math.hypot(px + 0.5 - cx, py + 0.5 - cy), px, py) * 255);
      if (cv > 0) this.write(px, py, [carry[o], carry[o + 1], carry[o + 2], carry[o + 3]], cv, true);
    }
    // El color arrastrado se mezcla con lo que hay ahora bajo el pincel.
    const keep = clamp(0.35 + 0.6 * this.p.opacity, 0, 0.97);
    for (let k = 0; k < size; k++) carry[k] = carry[k] * keep + fresh[k] * (1 - keep);
    void r;
    this.mark(rc);
    return rc;
  }
}

/** Puntos intermedios de a → b cada `spacing` px (incluye b, no a). */
export function strokePoints(ax: number, ay: number, bx: number, by: number, spacing: number): [number, number][] {
  const dist = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(dist / Math.max(1, spacing)));
  const out: [number, number][] = [];
  for (let i = 1; i <= n; i++) out.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
  return out;
}

// ---------------------------------------------------------------------------
// Origen del clonado: alineado o fijo
// ---------------------------------------------------------------------------

export interface CloneSource {
  /** Punto de origen fijado con Alt+clic (píxeles de la fuente). */
  src: [number, number] | null;
  aligned: boolean;
  /** Desplazamiento entero origen−destino (se fija en el primer toque tras Alt+clic). */
  offset: [number, number] | null;
}

export const newCloneSource = (aligned = true): CloneSource => ({ src: null, aligned, offset: null });

/** Alt+clic: fija el origen y borra el desplazamiento (se recalcula en el siguiente trazo). */
export function setCloneOrigin(cs: CloneSource, x: number, y: number): CloneSource {
  return { ...cs, src: [x, y], offset: null };
}

/**
 * Al empezar un trazo en `(x, y)`: devuelve el desplazamiento a usar y el estado nuevo.
 *  · Alineado: el primer trazo tras fijar el origen calcula el desplazamiento y los siguientes lo
 *    conservan, aunque se suelte el ratón (el origen «sigue» al pincel).
 *  · Fijo: cada trazo parte otra vez del punto de origen.
 */
export function cloneOffsetForStroke(cs: CloneSource, x: number, y: number): { offset: [number, number]; state: CloneSource } | null {
  if (!cs.src) return null;
  if (cs.aligned && cs.offset) return { offset: cs.offset, state: cs };
  const off: [number, number] = [Math.round(cs.src[0] - x), Math.round(cs.src[1] - y)];
  return { offset: off, state: { ...cs, offset: off } };
}

// ---------------------------------------------------------------------------
// Poisson / clonado «seamless» aproximado en baja resolución
// ---------------------------------------------------------------------------

/**
 * Rellena la región (máscara 0..255) de `dest` con la TEXTURA de `src` corrigiendo color y luminosidad
 * para que empalme con el entorno: resultado = src + h, con h armónica en la región (laplaciano 0) y
 * h = dest − src justo fuera de ella (clonado de Poisson / valores medios). Se resuelve en una
 * rejilla gruesa (≤ ~`maxNodes` nodos) con SOR y se interpola de forma bilineal.
 * `dest`, `src` y `mask` miden w×h; devuelve RGBA nuevo (fuera de la máscara = dest).
 */
export function poissonClone(dest: Uint8ClampedArray, src: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, maxNodes = 40000): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dest);
  let any = false;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 0) { any = true; break; }
  if (!any) return out;
  const f = Math.max(1, Math.ceil(Math.sqrt((w * h) / maxNodes)));
  const gw = Math.ceil(w / f);
  const gh = Math.ceil(h / f);
  // Rejilla gruesa: diferencia media (dest−src) por bloque y «dentro» si el bloque es mayoritariamente región.
  const diff = new Float32Array(gw * gh * 3);
  const inside = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let n = 0, m = 0;
      let r = 0, g = 0, b = 0;
      for (let y = gy * f; y < Math.min(h, gy * f + f); y++) {
        for (let x = gx * f; x < Math.min(w, gx * f + f); x++) {
          const i = y * w + x;
          n++;
          if (mask[i] >= 128) m++;
          r += dest[i * 4] - src[i * 4];
          g += dest[i * 4 + 1] - src[i * 4 + 1];
          b += dest[i * 4 + 2] - src[i * 4 + 2];
        }
      }
      const o = gy * gw + gx;
      diff[o * 3] = r / n; diff[o * 3 + 1] = g / n; diff[o * 3 + 2] = b / n;
      inside[o] = m * 2 > n ? 1 : 0;
    }
  }
  // Nodos interiores = incógnitas (los demás son condición de contorno con su diferencia real).
  const hv = new Float32Array(diff);
  let sum = [0, 0, 0];
  let nb = 0;
  for (let o = 0; o < gw * gh; o++) {
    if (inside[o]) continue;
    const gx = o % gw;
    const gy = (o / gw) | 0;
    const near = (gx > 0 && inside[o - 1]) || (gx < gw - 1 && inside[o + 1]) || (gy > 0 && inside[o - gw]) || (gy < gh - 1 && inside[o + gw]);
    if (near) { sum[0] += diff[o * 3]; sum[1] += diff[o * 3 + 1]; sum[2] += diff[o * 3 + 2]; nb++; }
  }
  const init = nb ? [sum[0] / nb, sum[1] / nb, sum[2] / nb] : [0, 0, 0];
  for (let o = 0; o < gw * gh; o++) if (inside[o]) { hv[o * 3] = init[0]; hv[o * 3 + 1] = init[1]; hv[o * 3 + 2] = init[2]; }
  const omega = 1.85;
  for (let it = 0; it < 600; it++) {
    let maxd = 0;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const o = gy * gw + gx;
        if (!inside[o]) continue;
        for (let c = 0; c < 3; c++) {
          let s = 0, k = 0;
          if (gx > 0) { s += hv[(o - 1) * 3 + c]; k++; }
          if (gx < gw - 1) { s += hv[(o + 1) * 3 + c]; k++; }
          if (gy > 0) { s += hv[(o - gw) * 3 + c]; k++; }
          if (gy < gh - 1) { s += hv[(o + gw) * 3 + c]; k++; }
          if (!k) continue;
          const nv = hv[o * 3 + c] + omega * (s / k - hv[o * 3 + c]);
          const dd = Math.abs(nv - hv[o * 3 + c]);
          if (dd > maxd) maxd = dd;
          hv[o * 3 + c] = nv;
        }
      }
    }
    if (maxd < 0.02) break;
  }
  // Interpolación bilineal de h (nodos en el centro de cada bloque) y mezcla con la máscara.
  for (let y = 0; y < h; y++) {
    const fy = clamp((y + 0.5) / f - 0.5, 0, gh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const mk = mask[i];
      if (!mk) continue;
      const fx = clamp((x + 0.5) / f - 0.5, 0, gw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const a = (y0 * gw + x0) * 3;
      const b = (y0 * gw + x1) * 3;
      const c = (y1 * gw + x0) * 3;
      const d = (y1 * gw + x1) * 3;
      const k = mk / 255;
      for (let ch = 0; ch < 3; ch++) {
        const hh = (hv[a + ch] * (1 - tx) + hv[b + ch] * tx) * (1 - ty) + (hv[c + ch] * (1 - tx) + hv[d + ch] * tx) * ty;
        const res = clamp(src[i * 4 + ch] + hh, 0, 255);
        out[i * 4 + ch] = dest[i * 4 + ch] + (res - dest[i * 4 + ch]) * k;
      }
      out[i * 4 + 3] = dest[i * 4 + 3] + (src[i * 4 + 3] - dest[i * 4 + 3]) * k;
    }
  }
  return out;
}

/** Máscara 0..255 de un disco con borde suave (coordenadas locales de una caja w×h). */
export function discMask(w: number, h: number, cx: number, cy: number, r: number, hardness: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = Math.round(brushCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), r, hardness) * 255);
  return m;
}

export interface PoissonJob {
  /** Caja (en la fuente) donde se aplica; `dest` y `src` ya recortados a ella. */
  rect: Rect;
  dest: Uint8ClampedArray;
  src: Uint8ClampedArray;
  mask: Uint8Array;
}

/**
 * Elige el mejor origen para tapar una mancha en `(cx, cy)` radio `r`: 8 direcciones × 3 distancias,
 * puntuadas por la diferencia del anillo exterior del destino con el del candidato.
 * Devuelve el desplazamiento entero (origen − destino).
 */
export function pickSpotOffset(pix: Pix, cx: number, cy: number, r: number, sampler: Sampler = pixSampler(pix)): [number, number] {
  let best: [number, number] = [Math.round(2.4 * r), 0];
  let bestScore = Infinity;
  const ring: [number, number][] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring.push([Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35]);
  }
  for (const dist of [2.6, 3.4, 4.6]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const ox = Math.round(Math.cos(a) * r * dist);
      const oy = Math.round(Math.sin(a) * r * dist);
      const x = cx + ox;
      const y = cy + oy;
      if (x < r || y < r || x > pix.w - r || y > pix.h - r) continue;
      let s = 0;
      for (const [rx, ry] of ring) {
        const d = sampler(cx + rx, cy + ry);
        const c = sampler(x + rx, y + ry);
        s += (d[0] - c[0]) ** 2 + (d[1] - c[1]) ** 2 + (d[2] - c[2]) ** 2;
      }
      if (s < bestScore) { bestScore = s; best = [ox, oy]; }
    }
  }
  return best;
}

/** Trabajo de «eliminar mancha»: caja, destino, origen vecino elegido y máscara de disco (o null si no cabe). */
export function buildSpotJob(pix: Pix, cx: number, cy: number, r: number, hardness = 0.6, limit: Limit = null): PoissonJob | null {
  const margin = Math.ceil(r * 1.6) + 2;
  const x0 = Math.max(0, Math.floor(cx - margin));
  const y0 = Math.max(0, Math.floor(cy - margin));
  const x1 = Math.min(pix.w, Math.ceil(cx + margin));
  const y1 = Math.min(pix.h, Math.ceil(cy + margin));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 3 || h < 3) return null;
  const [ox, oy] = pickSpotOffset(pix, Math.round(cx), Math.round(cy), r);
  const sampler = pixSampler(pix);
  const dest = new Uint8ClampedArray(w * h * 4);
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = sampler(x0 + x, y0 + y);
    const s = sampler(x0 + x + ox, y0 + y + oy);
    for (let c = 0; c < 4; c++) { dest[i + c] = d[c]; src[i + c] = s[c]; }
  }
  const mask = discMask(w, h, cx - x0, cy - y0, r, hardness);
  if (limit) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = Math.round(mask[y * w + x] * limit(x0 + x, y0 + y));
  return { rect: { x: x0, y: y0, w, h }, dest, src, mask };
}

/**
 * Eliminar mancha: tapa el disco de radio `r` en `(cx, cy)` con la textura de un vecino parecido,
 * empalmada por Poisson. Devuelve la caja tocada (modifica `pix`) o null.
 */
export function removeSpot(pix: Pix, cx: number, cy: number, r: number, hardness = 0.6, limit: Limit = null): Rect | null {
  const job = buildSpotJob(pix, cx, cy, r, hardness, limit);
  if (!job) return null;
  writeRegion(pix, job.rect, runPoissonJob(job));
  return job.rect;
}

// ---------------------------------------------------------------------------
// Parche (selección arrastrada sobre el origen)
// ---------------------------------------------------------------------------

/**
 * Parche: la zona `sel` (0..255 por píxel de la fuente, caja `rect`) se rellena con la textura de la zona
 * desplazada `(ox, oy)`, empalmada por Poisson. Devuelve el RGBA resultante de `rect` o null.
 */
export function buildPatchJob(pix: Pix, rect: Rect, sel: Uint8Array, ox: number, oy: number, margin = 3): PoissonJob {
  const x0 = Math.max(0, rect.x - margin);
  const y0 = Math.max(0, rect.y - margin);
  const x1 = Math.min(pix.w, rect.x + rect.w + margin);
  const y1 = Math.min(pix.h, rect.y + rect.h + margin);
  const w = x1 - x0;
  const h = y1 - y0;
  const sampler = pixSampler(pix);
  const dest = new Uint8ClampedArray(w * h * 4);
  const src = new Uint8ClampedArray(w * h * 4);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = sampler(x0 + x, y0 + y);
    const s = sampler(x0 + x + ox, y0 + y + oy);
    for (let c = 0; c < 4; c++) { dest[i + c] = d[c]; src[i + c] = s[c]; }
    const sx = x0 + x - rect.x;
    const sy = y0 + y - rect.y;
    if (sx >= 0 && sy >= 0 && sx < rect.w && sy < rect.h) mask[y * w + x] = sel[sy * rect.w + sx];
  }
  return { rect: { x: x0, y: y0, w, h }, dest, src, mask };
}

export function runPoissonJob(j: PoissonJob): Uint8ClampedArray {
  return poissonClone(j.dest, j.src, j.mask, j.rect.w, j.rect.h);
}

export function writeRegion(pix: Pix, rc: Rect, data: Uint8ClampedArray) {
  for (let y = 0; y < rc.h; y++) pix.data.set(data.subarray(y * rc.w * 4, (y + 1) * rc.w * 4), ((rc.y + y) * pix.w + rc.x) * 4);
}

// ---------------------------------------------------------------------------
// Capa de retoque ↔ búfer de trabajo
// ---------------------------------------------------------------------------

/** Caja mínima donde `work` difiere de `base` dentro de `within` (o null si son iguales). */
export function diffBounds(base: Pix, work: Pix, within: Rect): Rect | null {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  const x1 = Math.min(base.w, within.x + within.w);
  const y1 = Math.min(base.h, within.y + within.h);
  for (let y = Math.max(0, within.y); y < y1; y++) {
    for (let x = Math.max(0, within.x); x < x1; x++) {
      const i = (y * base.w + x) * 4;
      if (base.data[i] !== work.data[i] || base.data[i + 1] !== work.data[i + 1] || base.data[i + 2] !== work.data[i + 2] || base.data[i + 3] !== work.data[i + 3]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** RGBA de la capa de retoque para `rc`: píxeles cambiados con su color, el resto alfa 0. */
export function extractPatch(base: Pix, work: Pix, rc: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rc.w * rc.h * 4);
  for (let y = 0; y < rc.h; y++) {
    for (let x = 0; x < rc.w; x++) {
      const i = ((rc.y + y) * base.w + rc.x + x) * 4;
      if (base.data[i] === work.data[i] && base.data[i + 1] === work.data[i + 1] && base.data[i + 2] === work.data[i + 2] && base.data[i + 3] === work.data[i + 3]) continue;
      const o = (y * rc.w + x) * 4;
      out[o] = work.data[i];
      out[o + 1] = work.data[i + 1];
      out[o + 2] = work.data[i + 2];
      // Alfa 0 = «no tocado»: un píxel retocado transparente se guarda como casi transparente.
      out[o + 3] = Math.max(1, work.data[i + 3]);
    }
  }
  return out;
}

/** Compone la capa de retoque (mismo tamaño que `base`, desplazada a `rc`) sobre `base`: pura, para pruebas. */
export function overPatch(base: Pix, patch: Uint8ClampedArray, rc: Rect): Pix {
  const out = clonePix(base);
  for (let y = 0; y < rc.h; y++) {
    for (let x = 0; x < rc.w; x++) {
      const o = (y * rc.w + x) * 4;
      const a = patch[o + 3];
      if (!a) continue;
      const i = ((rc.y + y) * base.w + rc.x + x) * 4;
      if (a === 255) {
        out.data[i] = patch[o]; out.data[i + 1] = patch[o + 1]; out.data[i + 2] = patch[o + 2]; out.data[i + 3] = 255;
      } else {
        const f = a / 255;
        const ba = out.data[i + 3] / 255;
        const oa = f + ba * (1 - f);
        for (let c = 0; c < 3; c++) out.data[i + c] = (patch[o + c] * f + out.data[i + c] * ba * (1 - f)) / (oa || 1);
        out.data[i + 3] = oa * 255;
      }
    }
  }
  return out;
}
