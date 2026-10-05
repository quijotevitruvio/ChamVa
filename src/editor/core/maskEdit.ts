// Edición no destructiva del recorte (quitar fondo) — lógica pura, sin DOM.
//
// Modelo: `orig` (RGBA de la foto original) NUNCA se modifica. `cur` es el recorte
// vigente (RGBA no premultiplicado). Borrar baja el alfa de `cur` (el color no se toca);
// Restaurar acerca cada píxel al de `orig` (con cobertura 1 queda IDÉNTICO, byte a byte).
// Cada operación devuelve un parche (región + antes/después) para el historial:
// el historial guarda diferencias de la región tocada, nunca copias de la imagen.

export interface MaskPatch {
  /** 'img' = recorte RGBA (4 canales); 'mark' = marcas del pincel mágico (1 canal). */
  plane: 'img' | 'mark';
  x: number;
  y: number;
  w: number;
  h: number;
  ch: number;
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const patchBytes = (p: MaskPatch): number => p.before.length + p.after.length;

/** Región mínima donde `prev` y `next` difieren, o null si son iguales. */
export function diffPatch(
  prev: Uint8ClampedArray,
  next: Uint8ClampedArray,
  w: number,
  h: number,
  ch: number,
  plane: 'img' | 'mark',
): MaskPatch | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      let same = true;
      for (let c = 0; c < ch; c++) {
        if (prev[i + c] !== next[i + c]) {
          same = false;
          break;
        }
      }
      if (!same) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return cropPatch(prev, next, w, ch, plane, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
}

function cropPatch(
  prev: Uint8ClampedArray,
  next: Uint8ClampedArray,
  w: number,
  ch: number,
  plane: 'img' | 'mark',
  r: Rect,
): MaskPatch {
  const before = new Uint8ClampedArray(r.w * r.h * ch);
  const after = new Uint8ClampedArray(r.w * r.h * ch);
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y + y) * w + r.x) * ch;
    before.set(prev.subarray(s, s + r.w * ch), y * r.w * ch);
    after.set(next.subarray(s, s + r.w * ch), y * r.w * ch);
  }
  return { plane, ...r, ch, before, after };
}

/** Escribe `after` (rehacer) o `before` (deshacer) en el búfer completo. */
export function applyPatch(buf: Uint8ClampedArray, w: number, p: MaskPatch, dir: 'undo' | 'redo'): Rect {
  const src = dir === 'undo' ? p.before : p.after;
  for (let y = 0; y < p.h; y++) {
    const d = ((p.y + y) * w + p.x) * p.ch;
    buf.set(src.subarray(y * p.w * p.ch, (y + 1) * p.w * p.ch), d);
  }
  return { x: p.x, y: p.y, w: p.w, h: p.h };
}

/** Une dos rectángulos (null = vacío). */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// ---------- Pincel ----------

/**
 * Cobertura (0–1) del pincel a `dist` px del centro: opaco hasta r·dureza y
 * luego se desvanece linealmente hasta 0 en el borde. Dureza 1 = borde nítido (1 px de antialias).
 */
export function brushCoverage(dist: number, radius: number, hardness: number): number {
  const inner = radius * Math.max(0, Math.min(1, hardness));
  if (dist <= inner) return 1;
  if (dist >= radius) return 0;
  const span = radius - inner;
  if (span < 1) return Math.max(0, Math.min(1, radius - dist + 0.5));
  return (radius - dist) / span;
}

/** Suavizado del trazo: acerca el punto anterior al nuevo; 0 = sin suavizar, 0.95 = muy lento. */
export function smoothPoint(
  prev: { x: number; y: number } | null,
  next: { x: number; y: number },
  smoothing: number,
): { x: number; y: number } {
  if (!prev) return next;
  const k = 1 - Math.max(0, Math.min(0.95, smoothing));
  return { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k };
}

export type BrushMode = 'erase' | 'restore';

export interface BrushParams {
  mode: BrushMode;
  /** Diámetro en píxeles de la imagen. */
  size: number;
  /** 0–1. */
  hardness: number;
  /** 0–1: tope de lo que un trazo puede borrar/restaurar. */
  opacity: number;
}

const TILE = 64;

interface Tile {
  base: Uint8ClampedArray; // RGBA antes del trazo (TILE × TILE)
  cov: Uint8Array; // cobertura máxima alcanzada en el trazo (0–255)
}

/** Mezcla un píxel base con el original según la cobertura (0–255) y escribe en `out`. */
export function blendPixel(
  mode: BrushMode,
  base: ArrayLike<number>,
  bi: number,
  orig: ArrayLike<number>,
  oi: number,
  cv: number,
  out: Uint8ClampedArray,
  oo: number,
): void {
  if (mode === 'erase') {
    out[oo] = base[bi];
    out[oo + 1] = base[bi + 1];
    out[oo + 2] = base[bi + 2];
    out[oo + 3] = cv >= 255 ? 0 : Math.round((base[bi + 3] * (255 - cv)) / 255);
    return;
  }
  if (cv >= 255) {
    out[oo] = orig[oi];
    out[oo + 1] = orig[oi + 1];
    out[oo + 2] = orig[oi + 2];
    out[oo + 3] = orig[oi + 3];
    return;
  }
  const k = cv / 255;
  const ab = base[bi + 3];
  out[oo + 3] = Math.round(ab + (orig[oi + 3] - ab) * k);
  if (ab === 0) {
    out[oo] = orig[oi];
    out[oo + 1] = orig[oi + 1];
    out[oo + 2] = orig[oi + 2];
  } else {
    out[oo] = Math.round(base[bi] + (orig[oi] - base[bi]) * k);
    out[oo + 1] = Math.round(base[bi + 1] + (orig[oi + 1] - base[bi + 1]) * k);
    out[oo + 2] = Math.round(base[bi + 2] + (orig[oi + 2] - base[bi + 2]) * k);
  }
}

/**
 * Un trazo = muchas «gotas». La cobertura de cada píxel es el MÁXIMO alcanzado en el trazo,
 * y el resultado se calcula siempre desde el estado previo al trazo: pasar dos veces por el
 * mismo sitio no acumula opacidad, y con opacidad 1 Restaurar devuelve el original exacto.
 * La memoria extra son solo los bloques de 64×64 que el trazo toca.
 */
export class BrushStroke {
  private tiles = new Map<number, Tile>();
  private tilesX: number;
  private dirty: Rect | null = null;

  constructor(
    private cur: Uint8ClampedArray,
    private orig: Uint8ClampedArray,
    private w: number,
    private h: number,
    private params: BrushParams,
  ) {
    this.tilesX = Math.ceil(w / TILE);
  }

  private tile(tx: number, ty: number): Tile {
    const key = ty * this.tilesX + tx;
    let t = this.tiles.get(key);
    if (!t) {
      const base = new Uint8ClampedArray(TILE * TILE * 4);
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const wd = Math.min(TILE, this.w - x0);
      const hd = Math.min(TILE, this.h - y0);
      for (let y = 0; y < hd; y++) {
        const s = ((y0 + y) * this.w + x0) * 4;
        base.set(this.cur.subarray(s, s + wd * 4), y * TILE * 4);
      }
      t = { base, cov: new Uint8Array(TILE * TILE) };
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Una gota en (x, y). `pressure` (0–1) escala el radio y suaviza el borde. Devuelve la región tocada. */
  dab(x: number, y: number, pressure = 1): Rect | null {
    const { w, h, params } = this;
    const r = Math.max(0.5, (params.size / 2) * pressure);
    const hard = params.hardness * (0.5 + 0.5 * pressure);
    const x0 = Math.max(0, Math.floor(x - r - 1));
    const y0 = Math.max(0, Math.floor(y - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(x + r + 1));
    const y1 = Math.min(h - 1, Math.ceil(y + r + 1));
    let rect: Rect | null = null;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const c = brushCoverage(Math.hypot(px + 0.5 - x, py + 0.5 - y), r, hard) * params.opacity;
        const cv = Math.round(c * 255);
        if (cv <= 0) continue;
        const tx = Math.floor(px / TILE);
        const ty = Math.floor(py / TILE);
        const t = this.tile(tx, ty);
        const li = (py - ty * TILE) * TILE + (px - tx * TILE);
        if (cv <= t.cov[li]) continue;
        t.cov[li] = cv;
        const gi = (py * w + px) * 4;
        blendPixel(params.mode, t.base, li * 4, this.orig, gi, cv, this.cur, gi);
        rect = unionRect(rect, { x: px, y: py, w: 1, h: 1 });
      }
    }
    this.dirty = unionRect(this.dirty, rect);
    return rect;
  }

  /** Cierra el trazo y devuelve el parche del historial (null si no cambió nada). */
  finish(): MaskPatch | null {
    const r = this.dirty;
    if (!r) return null;
    const before = new Uint8ClampedArray(r.w * r.h * 4);
    const after = new Uint8ClampedArray(r.w * r.h * 4);
    let changed = false;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const px = r.x + x;
        const py = r.y + y;
        const gi = (py * this.w + px) * 4;
        const o = (y * r.w + x) * 4;
        const tx = Math.floor(px / TILE);
        const ty = Math.floor(py / TILE);
        const t = this.tiles.get(ty * this.tilesX + tx);
        const li = t ? ((py - ty * TILE) * TILE + (px - tx * TILE)) * 4 : -1;
        for (let c = 0; c < 4; c++) {
          const b = t ? t.base[li + c] : this.cur[gi + c];
          before[o + c] = b;
          after[o + c] = this.cur[gi + c];
          if (b !== this.cur[gi + c]) changed = true;
        }
      }
    }
    if (!changed) return null;
    return { plane: 'img', ...r, ch: 4, before, after };
  }
}

// ---------- Operaciones sobre toda la imagen ----------

/** Aplica `next` sobre `cur` y devuelve el parche (null si no cambió). */
export function commitFull(
  cur: Uint8ClampedArray,
  next: Uint8ClampedArray,
  w: number,
  h: number,
): MaskPatch | null {
  const p = diffPatch(cur, next, w, h, 4, 'img');
  if (p) applyPatch(cur, w, p, 'redo');
  return p;
}

/** Vuelve al original completo, sin quitar fondo. */
export function restoreAll(cur: Uint8ClampedArray, orig: Uint8ClampedArray, w: number, h: number): MaskPatch | null {
  return commitFull(cur, new Uint8ClampedArray(orig), w, h);
}

/** Deja toda la imagen transparente (el color se conserva debajo, por si luego se restaura). */
export function eraseAll(cur: Uint8ClampedArray, w: number, h: number): MaskPatch | null {
  const next = new Uint8ClampedArray(cur);
  for (let i = 3; i < next.length; i += 4) next[i] = 0;
  return commitFull(cur, next, w, h);
}

/** Desenfoque de caja (radio r, bordes replicados) de un plano de 1 canal. */
export function boxBlur1(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / n);
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Suaviza los bordes del recorte (desenfoca solo el alfa); lo ya liso no cambia. */
export function smoothEdges(
  cur: Uint8ClampedArray,
  orig: Uint8ClampedArray,
  w: number,
  h: number,
  radius = 1,
): MaskPatch | null {
  const a = new Uint8ClampedArray(w * h);
  for (let i = 0; i < a.length; i++) a[i] = cur[i * 4 + 3];
  const b = boxBlur1(a, w, h, Math.max(1, Math.round(radius)));
  const next = new Uint8ClampedArray(cur);
  for (let i = 0; i < a.length; i++) {
    next[i * 4 + 3] = b[i];
    if (a[i] === 0 && b[i] > 0) {
      next[i * 4] = orig[i * 4];
      next[i * 4 + 1] = orig[i * 4 + 1];
      next[i * 4 + 2] = orig[i * 4 + 2];
    }
  }
  return commitFull(cur, next, w, h);
}
