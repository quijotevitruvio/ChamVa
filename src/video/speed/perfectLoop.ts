// «Bucle perfecto» (puro): busca el mejor punto de unión de un clip para que repetido (V8: `loop`) no se note el salto.
//
// Imagen: se comparan miniaturas en gris (fotogramas muestreados) del TRAMO FINAL con las del INICIO y se elige el par
// (inicio, final) de menor diferencia. Una pasada del bucle es [inicio, final): el fotograma `final` no se muestra y tras
// el último visible (final − paso) viene `inicio`, así que el mejor final es el que MÁS SE PARECE al inicio. Además se
// mira un fotograma más adelante en ambos (continuidad del movimiento). Entre empates se prefiere el bucle más largo.
// Audio: el cruce por cero ascendente más cercano a cada punto (sin chasquido), y para audio solo, el final cuya forma de
// onda siguiente se parece más a la del inicio.
import { findClip, isStill } from '../model/query';
import { updateClip } from '../model/ops';
import type { LoopSpec, VideoProject } from '../model/types';

/** Miniatura en gris de un fotograma (valores 0..255, tamaño fijo para todas). */
export interface LumaSample {
  /** s del ARCHIVO */
  t: number;
  px: ArrayLike<number>;
}

export interface LoopScanOptions {
  /** s hacia atrás desde el final actual donde se busca el nuevo final (ventana configurable) */
  endWindow: number;
  /** s hacia delante desde el inicio actual donde se puede mover el inicio (0 = el inicio no se mueve) */
  startWindow: number;
  /** el bucle no puede durar menos de esto (s) */
  minLen: number;
  /** cuántos candidatos devolver */
  top: number;
}
export const DEFAULT_LOOP_SCAN: Readonly<LoopScanOptions> = Object.freeze({ endWindow: 2, startWindow: 0.5, minLen: 1, top: 3 });

export interface LoopCandidate {
  inP: number;
  outP: number;
  /** diferencia entre el fotograma final y el inicial, 0 (idénticos) … 1 (blanco contra negro) */
  cost: number;
  /** diferencia solo del par final/inicial (sin la continuidad) */
  diff: number;
}

/** Diferencia media absoluta entre dos miniaturas, 0..1. */
export function lumaDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 1;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n / 255;
}

const TIE = 0.002;

/**
 * Candidatos de unión entre las muestras del inicio y las del final (cada lista ordenada por `t` y a paso regular).
 * Devuelve los `top` mejores, de menor a mayor costo; entre costos casi iguales (±0,002) va primero el bucle más largo.
 */
export function findLoopCandidates(starts: LumaSample[], ends: LumaSample[], o: Partial<LoopScanOptions> = {}, neighbors: { start?: boolean; end?: boolean } = {}): LoopCandidate[] {
  const opt = { ...DEFAULT_LOOP_SCAN, ...o };
  const all: LoopCandidate[] = [];
  // con `neighbors`, la última muestra de la lista solo sirve de «fotograma siguiente», no de candidato
  const ni = starts.length - (neighbors.start ? 1 : 0);
  const nj = ends.length - (neighbors.end ? 1 : 0);
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      const len = ends[j].t - starts[i].t;
      if (len < opt.minLen - 1e-9) continue;
      const diff = lumaDiff(starts[i].px, ends[j].px);
      const nextA = starts[i + 1];
      const nextB = ends[j + 1];
      const cost = nextA && nextB ? diff + 0.5 * lumaDiff(nextA.px, nextB.px) : diff * 1.5;
      all.push({ inP: starts[i].t, outP: ends[j].t, cost: cost / 1.5, diff });
    }
  }
  all.sort((a, b) => (Math.abs(a.cost - b.cost) <= TIE ? b.outP - b.inP - (a.outP - a.inP) : a.cost - b.cost));
  // candidatos distintos: no repetir el mismo final (ni uno pegado)
  const out: LoopCandidate[] = [];
  const step = ends.length > 1 ? ends[1].t - ends[0].t : 0.1;
  for (const c of all) {
    if (out.some((k) => Math.abs(k.outP - c.outP) < step * 1.5 && Math.abs(k.inP - c.inP) < step * 1.5)) continue;
    out.push(c);
    if (out.length >= opt.top) break;
  }
  return out;
}

/** Palabras para la calidad de la unión (a partir de la diferencia del par). */
export function joinQuality(diff: number): { label: 'Perfecta' | 'Muy buena' | 'Aceptable' | 'Se notará'; level: 0 | 1 | 2 | 3 } {
  if (diff < 0.01) return { label: 'Perfecta', level: 0 };
  if (diff < 0.03) return { label: 'Muy buena', level: 1 };
  if (diff < 0.08) return { label: 'Aceptable', level: 2 };
  return { label: 'Se notará', level: 3 };
}

// ---------------- audio ----------------

/**
 * Cruce por cero ascendente (la muestra pasa de ≤ 0 a > 0) más cercano a `t`, dentro de ±`maxShift` s.
 * Devuelve el instante (interpolado entre las dos muestras) o null si no hay.
 */
export function nearestZeroCrossing(samples: ArrayLike<number>, sampleRate: number, t: number, maxShift: number): number | null {
  const n = samples.length;
  if (n < 2 || !(sampleRate > 0)) return null;
  const center = Math.round(t * sampleRate);
  const reach = Math.max(1, Math.round(maxShift * sampleRate));
  const rising = (k: number) => k >= 1 && k < n && samples[k - 1] <= 0 && samples[k] > 0;
  for (let d = 0; d <= reach; d++) {
    for (const k of d === 0 ? [center] : [center - d, center + d]) {
      if (rising(k)) {
        const a = samples[k - 1];
        const b = samples[k];
        return (k - 1 + (b === a ? 0 : -a / (b - a))) / sampleRate;
      }
    }
  }
  return null;
}

/** Todos los cruces por cero ascendentes de [t0, t1]. */
export function zeroCrossings(samples: ArrayLike<number>, sampleRate: number, t0: number, t1: number): number[] {
  const out: number[] = [];
  const a = Math.max(1, Math.floor(t0 * sampleRate));
  const b = Math.min(samples.length - 1, Math.ceil(t1 * sampleRate));
  for (let k = a; k <= b; k++) if (samples[k - 1] <= 0 && samples[k] > 0) out.push((k - 1 + -samples[k - 1] / (samples[k] - samples[k - 1])) / sampleRate);
  return out;
}

/** Diferencia (RMS de la resta) entre `win` s de audio que siguen a `ta` y `win` s que siguen a `tb`. */
export function audioJoinCost(samples: ArrayLike<number>, sampleRate: number, ta: number, tb: number, win = 0.01): number {
  const n = Math.max(8, Math.round(win * sampleRate));
  const a0 = Math.round(ta * sampleRate);
  const b0 = Math.round(tb * sampleRate);
  if (a0 < 0 || b0 < 0 || a0 + n > samples.length || b0 + n > samples.length) return Infinity;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = samples[a0 + i] - samples[b0 + i];
    s += d * d;
  }
  return Math.sqrt(s / n);
}

/** Lleva el inicio y el final de un candidato al cruce por cero ascendente más cercano (si no hay, se queda como está). */
export function snapToZeroCrossings(c: LoopCandidate, samples: ArrayLike<number>, sampleRate: number, maxShift = 1 / 60): LoopCandidate {
  const a = nearestZeroCrossing(samples, sampleRate, c.inP, maxShift);
  const b = nearestZeroCrossing(samples, sampleRate, c.outP, maxShift);
  return { ...c, inP: a ?? c.inP, outP: b ?? c.outP };
}

/**
 * Bucle de AUDIO solo: el inicio se lleva al primer cruce por cero ascendente (hasta `startWindow` s) y, entre los cruces de
 * la ventana final, se elige el que mejor continúa (la forma de onda que sigue al final se parece a la que sigue al inicio).
 */
export function findAudioLoop(samples: ArrayLike<number>, sampleRate: number, range: { inP: number; outP: number }, o: Partial<LoopScanOptions> = {}): LoopCandidate[] {
  const opt = { ...DEFAULT_LOOP_SCAN, ...o };
  const zs = zeroCrossings(samples, sampleRate, range.inP, range.inP + Math.max(0.05, opt.startWindow));
  const startsZ = zs.length ? zs.slice(0, 16) : [range.inP];
  const ends = zeroCrossings(samples, sampleRate, Math.max(range.inP + opt.minLen, range.outP - opt.endWindow), range.outP);
  const all: LoopCandidate[] = [];
  for (const s of startsZ) {
    for (const e of ends) {
      if (e - s < opt.minLen) continue;
      const cost = audioJoinCost(samples, sampleRate, s, e);
      if (isFinite(cost)) all.push({ inP: s, outP: e, cost, diff: cost });
    }
  }
  all.sort((a, b) => (Math.abs(a.cost - b.cost) <= 1e-3 ? b.outP - b.inP - (a.outP - a.inP) : a.cost - b.cost));
  const out: LoopCandidate[] = [];
  for (const c of all) {
    if (out.some((k) => Math.abs(k.outP - c.outP) < 0.02)) continue;
    out.push(c);
    if (out.length >= opt.top) break;
  }
  return out;
}

// ---------------- aplicar ----------------

export interface ApplyLoopOptions {
  /** duración del archivo (límite del recorte) */
  mediaDuration?: number;
  /** bucle a poner si el clip aún no tiene (por defecto 3 pasadas, sin fundido: la unión ya es buena) */
  loop?: LoopSpec;
}

/**
 * Recorta el clip a [inP, outP) del archivo y activa el bucle (conserva el que ya tenía). UN paso de deshacer (una sola
 * operación). Devuelve el mismo proyecto si el clip no admite bucle (imagen, texto, congelado, pista bloqueada).
 */
export function applyPerfectLoop(p: VideoProject, clipId: string, c: Pick<LoopCandidate, 'inP' | 'outP'>, o: ApplyLoopOptions = {}): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || isStill(loc.clip) || (loc.clip.kind !== 'video' && loc.clip.kind !== 'audio') || loc.clip.freeze) return p;
  const max = o.mediaDuration && o.mediaDuration > 0 ? o.mediaDuration : Infinity;
  const inP = Math.max(0, Math.min(c.inP, max));
  const outP = Math.min(Math.max(c.outP, inP + 0.1), max);
  if (!(outP > inP)) return p;
  const loop: LoopSpec = loc.clip.loop ?? o.loop ?? { n: 3 };
  return updateClip(p, clipId, { inP, outP, loop });
}

// ---------------- plan de muestreo ----------------

export interface ScanPlan {
  /** instantes del archivo donde se mira el inicio (de menor a mayor; el último solo sirve de «siguiente») */
  starts: number[];
  /** instantes donde se mira el final (de menor a mayor; el último puede pasar `outP` un paso, solo como «siguiente») */
  ends: number[];
  /** la última muestra de cada lista solo es el fotograma «siguiente» (no un candidato) */
  startNeighbor: boolean;
  endNeighbor: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Instantes a muestrear para buscar la unión de un clip recortado a [inP, outP] (paso `dt`, p. ej. 1/12 s). null si el tramo es más corto que `minLen`. */
export function planScanTimes(range: { inP: number; outP: number }, o: Partial<LoopScanOptions> = {}, dt = 1 / 12, mediaDuration = Infinity): ScanPlan | null {
  const opt = { ...DEFAULT_LOOP_SCAN, ...o };
  if (!(dt > 0) || !(range.outP - range.inP >= opt.minLen - 1e-9)) return null;
  const starts: number[] = [];
  let startNeighbor = false;
  const ns = Math.floor(Math.max(0, opt.startWindow) / dt + 1e-9);
  for (let k = 0; k <= ns + 1; k++) {
    const t = range.inP + k * dt;
    if (t < range.outP - opt.minLen + 1e-9 || k === 0) {
      starts.push(r3(t));
      startNeighbor = k === ns + 1;
    }
  }
  const ends: number[] = [];
  const ne = Math.floor(Math.max(0, opt.endWindow) / dt + 1e-9);
  for (let k = ne; k >= 0; k--) {
    const t = range.outP - k * dt;
    if (t - range.inP >= opt.minLen - 1e-9) ends.push(r3(t));
  }
  const next = range.outP + dt;
  const endNeighbor = ends.length > 0 && next <= mediaDuration - 0.02;
  if (endNeighbor) ends.push(r3(next));
  return ends.length ? { starts, ends, startNeighbor, endNeighbor } : null;
}
