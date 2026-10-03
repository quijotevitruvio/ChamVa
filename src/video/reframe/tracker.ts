// Seguimiento de un sujeto para el reencuadre automático (V8). Propio y sin dependencias: correlación normalizada (ZNCC) de
// una plantilla en un fotograma pequeño en gris, con búsqueda alrededor de la posición prevista, plantilla adaptativa, ancla
// del primer fotograma contra la deriva y «perdido» cuando la correlación cae (se mantiene el último sitio).
//
// No usa OpenCV.js: no trae los clasificadores de caras (habría que descargarlos, y el editor es offline) y la plantilla
// funciona igual de bien con una persona, un animal o un objeto. La caja inicial la elige el usuario o `autoSubject`
// (centro de movimiento de los primeros fotogramas).
import type { TrackPoint } from './math';

export interface Gray {
  w: number;
  h: number;
  d: Float32Array | Uint8Array | Uint8ClampedArray;
}

/** Caja normalizada (fracción del fotograma): centro y tamaño. */
export interface NBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface TrackedFrame {
  t: number;
  g: Gray;
}

export interface TrackerOptions {
  /** radio de búsqueda por fotograma (fracción del lado corto, def. 0,2) */
  search?: number;
  /** cuánto se actualiza la plantilla en cada acierto (def. 0,12) */
  adapt?: number;
  /** correlación mínima para dar por bueno un acierto (def. 0,35) */
  minScore?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export class TrackAbort extends Error {
  constructor() {
    super('Seguimiento cancelado');
    this.name = 'AbortError';
  }
}

function patch(g: Gray, x0: number, y0: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const yy = Math.max(0, Math.min(g.h - 1, y0 + y));
    for (let x = 0; x < w; x++) out[y * w + x] = g.d[yy * g.w + Math.max(0, Math.min(g.w - 1, x0 + x))];
  }
  return out;
}

interface Tpl {
  d: Float32Array;
  w: number;
  h: number;
  mean: number;
  norm: number;
}

function makeTpl(d: Float32Array, w: number, h: number): Tpl {
  let m = 0;
  for (let i = 0; i < d.length; i++) m += d[i];
  m /= d.length;
  let n = 0;
  for (let i = 0; i < d.length; i++) n += (d[i] - m) * (d[i] - m);
  return { d, w, h, mean: m, norm: Math.sqrt(n) };
}

/** ZNCC de la plantilla con el trozo de `g` cuya esquina es (x0, y0). −1..1; 0 si la plantilla o el trozo son planos. */
function zncc(g: Gray, tpl: Tpl, x0: number, y0: number): number {
  const { w, h, d, mean, norm } = tpl;
  if (norm < 1e-6 || x0 < 0 || y0 < 0 || x0 + w > g.w || y0 + h > g.h) return -1;
  let sum = 0;
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * g.w + x0;
    for (let x = 0; x < w; x++) sum += g.d[row + x];
  }
  const pm = sum / (w * h);
  let num = 0;
  let pn = 0;
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * g.w + x0;
    for (let x = 0; x < w; x++) {
      const a = g.d[row + x] - pm;
      num += a * (d[y * w + x] - mean);
      pn += a * a;
    }
  }
  const den = Math.sqrt(pn) * norm;
  return den < 1e-6 ? 0 : num / den;
}

/** Mejor desplazamiento en una ventana (grueso con paso 2 y luego fino). */
function bestMatch(g: Gray, tpl: Tpl, cx: number, cy: number, radius: number): { x: number; y: number; score: number } {
  const bx = Math.round(cx - tpl.w / 2);
  const by = Math.round(cy - tpl.h / 2);
  let best = { x: bx, y: by, score: -2 };
  const step = radius > 8 ? 2 : 1;
  for (let dy = -radius; dy <= radius; dy += step)
    for (let dx = -radius; dx <= radius; dx += step) {
      const s = zncc(g, tpl, bx + dx, by + dy);
      if (s > best.score) best = { x: bx + dx, y: by + dy, score: s };
    }
  if (step > 1)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const s = zncc(g, tpl, best.x + dx, best.y + dy);
        if (s > best.score) best = { x: best.x + dx, y: best.y + dy, score: s };
      }
  return best;
}

/**
 * Sigue la caja `init` (en el primer fotograma) por todos los fotogramas. Devuelve el centro del sujeto
 * (fracción del fotograma) y la confianza (la correlación, 0 si se perdió) de cada uno.
 */
export function trackSubject(frames: TrackedFrame[], init: NBox, o: TrackerOptions = {}): TrackPoint[] {
  if (!frames.length) return [];
  const g0 = frames[0].g;
  const tw = Math.max(6, Math.round(init.w * g0.w));
  const th = Math.max(6, Math.round(init.h * g0.h));
  let cx = init.cx * g0.w;
  let cy = init.cy * g0.h;
  const anchor = makeTpl(patch(g0, Math.round(cx - tw / 2), Math.round(cy - th / 2), tw, th), tw, th);
  let live = anchor;
  const adapt = o.adapt ?? 0.12;
  const minScore = o.minScore ?? 0.35;
  const radius = Math.max(4, Math.round((o.search ?? 0.2) * Math.min(g0.w, g0.h)));
  const out: TrackPoint[] = [{ t: frames[0].t, x: init.cx, y: init.cy, c: 1 }];
  let vx = 0;
  let vy = 0;
  for (let i = 1; i < frames.length; i++) {
    if (o.signal?.aborted) throw new TrackAbort();
    const g = frames[i].g;
    const px = cx + vx;
    const py = cy + vy;
    let m = bestMatch(g, live, px, py, radius);
    if (m.score < minScore && live !== anchor) {
      const a = bestMatch(g, anchor, px, py, radius);
      if (a.score > m.score) m = a;
    }
    if (m.score >= minScore) {
      const nx = m.x + tw / 2;
      const ny = m.y + th / 2;
      vx = 0.6 * vx + 0.4 * (nx - cx);
      vy = 0.6 * vy + 0.4 * (ny - cy);
      cx = nx;
      cy = ny;
      // la plantilla se actualiza despacio solo con aciertos claros (si no, se arrastraría el fondo)
      if (m.score > 0.7) {
        const np = patch(g, m.x, m.y, tw, th);
        const mixed = new Float32Array(np.length);
        for (let k = 0; k < np.length; k++) mixed[k] = live.d[k] * (1 - adapt) + np[k] * adapt;
        live = makeTpl(mixed, tw, th);
      }
      out.push({ t: frames[i].t, x: cx / g.w, y: cy / g.h, c: Math.max(0, m.score) });
    } else {
      // perdido: se queda donde estaba (con la velocidad apagándose)
      vx *= 0.5;
      vy *= 0.5;
      out.push({ t: frames[i].t, x: cx / g.w, y: cy / g.h, c: 0 });
    }
    o.onProgress?.(i + 1, frames.length);
  }
  return out;
}

/**
 * Elige el sujeto sin que el usuario lo marque: el centro de más movimiento entre los primeros fotogramas
 * (ventana deslizante del tamaño de la caja); si no hay movimiento, el centro del fotograma.
 */
export function autoSubject(frames: TrackedFrame[], size = 0.2): { box: NBox; confident: boolean } {
  const g0 = frames[0]?.g;
  const fallback: NBox = { cx: 0.5, cy: 0.5, w: size, h: size };
  if (!g0 || frames.length < 2) return { box: fallback, confident: false };
  const { w, h } = g0;
  const E = new Float32Array(w * h);
  const pairs = Math.min(frames.length - 1, 8);
  // se comparan fotogramas separados (no consecutivos) para que el movimiento lento también se note
  const gap = Math.max(1, Math.floor((frames.length - 1) / pairs));
  let used = 0;
  for (let i = 0; i + gap < frames.length && used < pairs; i += gap, used++) {
    const a = frames[i].g.d;
    const b = frames[i + gap].g.d;
    for (let k = 0; k < E.length; k++) E[k] += Math.abs(a[k] - b[k]);
  }
  const bw = Math.max(4, Math.round(size * w));
  const bh = Math.max(4, Math.round(size * h));
  // imagen integral para sumar ventanas rápido
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += E[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  let best = -1;
  let bx = 0;
  let by = 0;
  let total = I[(h + 1) * (w + 1) - 1];
  for (let y = 0; y + bh <= h; y += 2)
    for (let x = 0; x + bw <= w; x += 2) {
      const s = I[(y + bh) * (w + 1) + x + bw] - I[y * (w + 1) + x + bw] - I[(y + bh) * (w + 1) + x] + I[y * (w + 1) + x];
      if (s > best) {
        best = s;
        bx = x;
        by = y;
      }
    }
  total = Math.max(total, 1);
  // ¿hay movimiento de verdad? (la ventana debe concentrar mucho más que su parte del área)
  const share = best / total;
  const area = (bw * bh) / (w * h);
  if (best <= 0 || share < area * 2.5) return { box: fallback, confident: false };
  return { box: { cx: (bx + bw / 2) / w, cy: (by + bh / 2) / h, w: size, h: size }, confident: true };
}
