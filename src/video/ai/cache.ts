// Cachés de V9 (en memoria, por sesión): máscaras de «quitar fondo» y movimiento de la estabilización, por MEDIO y por
// clave de cálculo, indexadas por fotograma del ARCHIVO (n = round(t · fps)). Puras (sin lienzo): se prueban con Vitest.
//
// Regla: la vista previa y la exportación LEEN de aquí; nunca calculan. Si falta un fotograma, la composición dibuja el
// original y `aiCoverage` / `aiNoticesAt` lo avisan. Así reproducir no recalcula nada y lo que se exporta es exactamente
// lo que se calculó (y lo que se ve).
import { MATTE_CACHE_BUDGET, type MatteMode } from './matteMath';

export interface MaskTrack {
  key: string;
  w: number;
  h: number;
  fps: number;
  frames: Map<number, Uint8Array>;
  /** contador de uso (para soltar primero lo menos usado si se pasa del tope) */
  used: number;
}

/** Clave de las máscaras: medio + modo (resolución de inferencia) + modelo. */
export const matteKey = (mediaId: string, mode: MatteMode, model = 'modnet') => `${model}|${mode}|${mediaId}`;
/** Clave del movimiento de la estabilización (no depende del suavizado: eso se calcula al vuelo). */
export const stabKey = (mediaId: string) => `stab|${mediaId}`;

export class CacheFullError extends Error {
  constructor(mb: number) {
    super(`La caché de máscaras llegó a su tope (${mb} MB). Calcula un tramo más corto o usa el modo rápido.`);
    this.name = 'CacheFullError';
  }
}

export class MaskCache {
  private tracks = new Map<string, MaskTrack>();
  private tick = 0;
  /** versión: cambia con cada escritura (las memorias de máscaras ya refinadas se invalidan con ella) */
  version = 0;
  constructor(public budget = MATTE_CACHE_BUDGET) {}

  get bytes(): number {
    let b = 0;
    for (const t of this.tracks.values()) b += t.frames.size * t.w * t.h;
    return b;
  }

  /** Pista de la clave (se crea; si cambia el tamaño o los fps se vacía). */
  track(key: string, w: number, h: number, fps: number): MaskTrack {
    let t = this.tracks.get(key);
    if (!t || t.w !== w || t.h !== h || t.fps !== fps) {
      t = { key, w, h, fps, frames: new Map(), used: ++this.tick };
      this.tracks.set(key, t);
      this.version++;
    }
    return t;
  }

  peek(key: string): MaskTrack | undefined {
    return this.tracks.get(key);
  }

  put(key: string, idx: number, mask: Uint8Array): void {
    const t = this.tracks.get(key);
    if (!t) throw new Error(`Sin pista de caché «${key}»`);
    if (mask.length !== t.w * t.h) throw new Error('Máscara de tamaño inesperado');
    if (!t.frames.has(idx) && this.bytes + mask.length > this.budget) {
      // se sueltan pistas enteras menos usadas (nunca la que se está llenando)
      const others = [...this.tracks.values()].filter((x) => x !== t).sort((a, b) => a.used - b.used);
      while (this.bytes + mask.length > this.budget && others.length) this.tracks.delete(others.shift()!.key);
      if (this.bytes + mask.length > this.budget) throw new CacheFullError(Math.round(this.budget / 1048576));
    }
    t.frames.set(idx, mask);
    t.used = ++this.tick;
    this.version++;
  }

  has(key: string, idx: number): boolean {
    return !!this.tracks.get(key)?.frames.has(idx);
  }

  get(key: string, idx: number): Uint8Array | undefined {
    const t = this.tracks.get(key);
    const m = t?.frames.get(idx);
    if (m && t) t.used = ++this.tick;
    return m;
  }

  /** Máscara del instante t (s del archivo): la de su fotograma, o la de un vecino a ±1 si esa falta (fps distintos). */
  lookup(key: string, t: number): { idx: number; mask: Uint8Array; track: MaskTrack } | null {
    const tr = this.tracks.get(key);
    if (!tr) return null;
    const i = Math.round(t * tr.fps + 1e-6);
    for (const k of [i, i - 1, i + 1]) {
      const m = tr.frames.get(k);
      if (m) {
        tr.used = ++this.tick;
        return { idx: k, mask: m, track: tr };
      }
    }
    return null;
  }

  /** Cuántos fotogramas de [t0, t1] (s del archivo) hay calculados, y los tramos que faltan (en s). */
  coverage(key: string, t0: number, t1: number, fps: number): { have: number; total: number; missing: [number, number][] } {
    const tr = this.tracks.get(key);
    const a = Math.round(t0 * fps + 1e-6);
    const b = Math.max(a, Math.round(t1 * fps + 1e-6));
    let have = 0;
    const missing: [number, number][] = [];
    let run = -1;
    for (let i = a; i <= b; i++) {
      const ok = !!tr && tr.fps === fps && tr.frames.has(i);
      if (ok) {
        have++;
        if (run >= 0) missing.push([run / fps, (i - 1) / fps]), (run = -1);
      } else if (run < 0) run = i;
    }
    if (run >= 0) missing.push([run / fps, b / fps]);
    return { have, total: b - a + 1, missing };
  }

  clear(key?: string): void {
    if (key) this.tracks.delete(key);
    else this.tracks.clear();
    this.version++;
  }
}

/** Movimiento medido entre fotogramas consecutivos del archivo (para la estabilización). */
export interface MotionTrack {
  key: string;
  fps: number;
  /** tamaño del fotograma analizado (px) */
  w: number;
  h: number;
  /** movimiento del fotograma idx respecto a idx − 1 (dx, dy en px del análisis; da en rad; ds = log de escala) */
  motion: Map<number, { dx: number; dy: number; da: number; ds: number; ok: boolean }>;
}

export class MotionCache {
  private tracks = new Map<string, MotionTrack>();
  version = 0;
  track(key: string, w: number, h: number, fps: number): MotionTrack {
    let t = this.tracks.get(key);
    if (!t || t.w !== w || t.h !== h || t.fps !== fps) {
      t = { key, w, h, fps, motion: new Map() };
      this.tracks.set(key, t);
      this.version++;
    }
    return t;
  }
  peek(key: string) {
    return this.tracks.get(key);
  }
  put(key: string, idx: number, m: MotionTrack['motion'] extends Map<number, infer V> ? V : never) {
    const t = this.tracks.get(key);
    if (!t) throw new Error(`Sin pista de movimiento «${key}»`);
    t.motion.set(idx, m);
    this.version++;
  }
  clear(key?: string) {
    if (key) this.tracks.delete(key);
    else this.tracks.clear();
    this.version++;
  }
}

/** Cachés únicas de la sesión: las comparten la vista previa, la exportación y el cálculo. */
export const matteCache = new MaskCache();
export const motionCache = new MotionCache();
