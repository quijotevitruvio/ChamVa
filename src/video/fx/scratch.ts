// Lienzos de trabajo reutilizables (capas, transiciones, efectos). Se crean una vez por tamaño y se reciclan:
// un fotograma no reserva memoria nueva. Solo en el navegador (usa lienzos); la lógica pura no pasa por aquí.
export type Canvas2 = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2 = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface Scratch {
  canvas: Canvas2;
  ctx: Ctx2;
  w: number;
  h: number;
}

const pool = new Map<string, Scratch>();

function make(w: number, h: number): Scratch {
  const canvas: Canvas2 = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx2;
  return { canvas, ctx, w, h };
}

/** Lienzo de trabajo nº `slot` de tamaño w×h, borrado (transparente) y con el estado restablecido. */
export function getScratch(slot: string | number, w: number, h: number, clear = true): Scratch {
  const key = `${slot}`;
  let s = pool.get(key);
  if (!s || s.w !== w || s.h !== h) {
    s = make(w, h);
    pool.set(key, s);
  }
  s.ctx.setTransform(1, 0, 0, 1, 0, 0);
  s.ctx.globalAlpha = 1;
  s.ctx.globalCompositeOperation = 'source-over';
  s.ctx.shadowColor = 'transparent';
  s.ctx.shadowBlur = 0;
  if (clear) s.ctx.clearRect(0, 0, w, h);
  return s;
}

/** Libera todos los lienzos de trabajo (al cerrar el editor). */
export function releaseScratch() {
  pool.clear();
}
