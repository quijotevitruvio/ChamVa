// Transiciones: catálogo y semántica (pura, sin lienzo). El dibujo está en transitionDraw.ts.
//
// SEMÁNTICA (documentada también en model/README.md):
//  - Una transición es un dato del clip: `tin` (entrada) y `tout` (salida). El modelo NO permite solapar clips en
//    una pista, así que la transición no mueve ni recorta nada: usa los márgenes de recorte.
//  - UNIÓN: A y B son contiguos en la misma pista si |fin(A) − inicio(B)| ≤ JOIN_EPS. La transición de la unión es
//    `B.tin ?? A.tout` (la de entrada de B manda). Su duración efectiva es min(dur, dur(A), dur(B)) (así las ventanas
//    de las dos uniones de un clip nunca se pisan) y se CENTRA en el corte: ventana [corte − d/2, corte + d/2].
//    Durante la ventana se ven A y B a la vez: A sigue avanzando más allá de su punto de salida (usa el margen de
//    recorte del archivo, hasta su final; sin margen se queda en el último fotograma) y B empieza antes de su punto
//    de entrada (margen anterior, hasta 0 s del archivo; sin margen, congelado en el primero). Imágenes y textos no
//    necesitan margen. La duración del proyecto y el audio no cambian.
//  - ENTRADA/SALIDA (sin vecino contiguo): `tin` en [inicio, inicio + d] y `tout` en [fin − d, fin], con d ≤ duración
//    del clip; el clip entra desde (o sale hacia) lo que haya debajo.
//  - Si los clips dejan de ser contiguos (se mueven, se recortan…) la transición no se pierde: pasa a ser de entrada
//    o de salida del clip que la tiene.
import { applyEase } from './ease';
import type { Clip, EaseId, Track, TransitionSpec } from '../model/types';
import { clipDuration, clipEnd, effectiveEnd } from '../model/query';

export const JOIN_EPS = 0.02;
export const MIN_TRANS = 0.1;
export const MAX_TRANS = 3;
export const DEFAULT_TRANS = 0.8;

export type TransGroup = 'Fundidos' | 'Deslizar' | 'Empujar' | 'Zoom' | 'Formas' | 'Efectos';
export interface TransitionInfo {
  id: string;
  label: string;
  group: TransGroup;
}

const T = (id: string, label: string, group: TransGroup): TransitionInfo => ({ id, label, group });

/** Catálogo (27). El orden es el de la interfaz. */
export const TRANSITIONS: TransitionInfo[] = [
  T('fade', 'Fundido', 'Fundidos'),
  T('dissolve', 'Disolución', 'Fundidos'),
  T('fadeBlack', 'Fundido a negro', 'Fundidos'),
  T('fadeWhite', 'Fundido a blanco', 'Fundidos'),
  T('slideLeft', 'Deslizar ←', 'Deslizar'),
  T('slideRight', 'Deslizar →', 'Deslizar'),
  T('slideUp', 'Deslizar ↑', 'Deslizar'),
  T('slideDown', 'Deslizar ↓', 'Deslizar'),
  T('pushLeft', 'Empujar ←', 'Empujar'),
  T('pushRight', 'Empujar →', 'Empujar'),
  T('pushUp', 'Empujar ↑', 'Empujar'),
  T('pushDown', 'Empujar ↓', 'Empujar'),
  T('cover', 'Cubrir', 'Deslizar'),
  T('reveal', 'Revelar', 'Deslizar'),
  T('zoomIn', 'Zoom adentro', 'Zoom'),
  T('zoomOut', 'Zoom afuera', 'Zoom'),
  T('wipe', 'Barrido', 'Formas'),
  T('circle', 'Cortina circular', 'Formas'),
  T('bars', 'Cortina de barras', 'Formas'),
  T('diagonal', 'Cortina diagonal', 'Formas'),
  T('clock', 'Reloj', 'Formas'),
  T('flip', 'Giro 3D', 'Efectos'),
  T('pixelate', 'Pixelado', 'Efectos'),
  T('blur', 'Desenfoque', 'Efectos'),
  T('flash', 'Brillo / flash', 'Efectos'),
  T('glitch', 'Glitch', 'Efectos'),
  T('ink', 'Mancha de tinta', 'Efectos'),
];

export const transitionInfo = (id: string): TransitionInfo | undefined => TRANSITIONS.find((t) => t.id === id);

/** Duración de la transición limitada a lo permitido (0,1–3 s). */
export const clampTransDur = (d: number) => Math.max(MIN_TRANS, Math.min(MAX_TRANS, Number.isFinite(d) ? d : DEFAULT_TRANS));

export function makeTransition(type: string, o: Partial<TransitionSpec> = {}): TransitionSpec {
  return { type, dur: clampTransDur(o.dur ?? DEFAULT_TRANS), ease: o.ease ?? 'smooth', ...(o.bz ? { bz: o.bz } : {}) };
}

/** Una transición ya resuelta sobre la línea de tiempo. */
export interface ResolvedTransition {
  kind: 'junction' | 'in' | 'out';
  spec: TransitionSpec;
  /** duración efectiva (s) */
  dur: number;
  /** ventana [t0, t1) en la línea de tiempo */
  t0: number;
  t1: number;
  /** saliente (unión y salida) */
  a?: Clip;
  /** entrante (unión y entrada) */
  b?: Clip;
}

const contiguous = (a: Clip, b: Clip) => Math.abs(clipEnd(a) - b.start) <= JOIN_EPS;

/** Duración efectiva de una transición de unión. */
export const junctionDur = (spec: TransitionSpec, a: Clip, b: Clip) => Math.max(0, Math.min(clampTransDur(spec.dur), clipDuration(a), clipDuration(b)));

/** Todas las transiciones de una pista (ordenadas por inicio). Solo pistas de video; `projectDur` para clips «hasta el final». */
export function resolveTransitions(track: Track, projectDur: number): ResolvedTransition[] {
  const out: ResolvedTransition[] = [];
  if (track.kind !== 'video') return out;
  const cs = track.clips;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.kind === 'audio') continue;
    const prev = i > 0 ? cs[i - 1] : undefined;
    const next = i < cs.length - 1 ? cs[i + 1] : undefined;
    const joinedPrev = !!prev && !c.toEnd && !prev.toEnd && contiguous(prev, c);
    // entrada o unión con el anterior
    if (joinedPrev) {
      const spec = c.tin ?? prev!.tout;
      if (spec) {
        const d = junctionDur(spec, prev!, c);
        if (d > 0) out.push({ kind: 'junction', spec, dur: d, t0: c.start - d / 2, t1: c.start + d / 2, a: prev, b: c });
      }
    } else if (c.tin) {
      const d = Math.min(clampTransDur(c.tin.dur), Math.max(0, effectiveEnd(c, projectDur) - c.start));
      if (d > 0) out.push({ kind: 'in', spec: c.tin, dur: d, t0: c.start, t1: c.start + d, b: c });
    }
    // salida sin siguiente contiguo
    const joinedNext = !!next && !c.toEnd && contiguous(c, next);
    if (!joinedNext && c.tout) {
      const end = effectiveEnd(c, projectDur);
      const d = Math.min(clampTransDur(c.tout.dur), Math.max(0, end - c.start));
      if (d > 0) out.push({ kind: 'out', spec: c.tout, dur: d, t0: end - d, t1: end, a: c });
    }
  }
  return out;
}

/** Progreso lineal 0..1 de la ventana en t (null si t no cae dentro). */
export function windowProgress(r: Pick<ResolvedTransition, 't0' | 't1'>, t: number): number | null {
  if (!(t >= r.t0 && t < r.t1)) return null;
  return (t - r.t0) / (r.t1 - r.t0);
}

export interface TransitionState {
  tr: ResolvedTransition;
  /** progreso lineal 0..1 */
  raw: number;
  /** progreso con la curva de aceleración aplicada */
  eased: number;
}

/** La transición activa de la pista en t (como mucho una: las ventanas de una misma pista no se pisan). */
export function transitionAt(resolved: ResolvedTransition[], t: number): TransitionState | null {
  for (const tr of resolved) {
    const raw = windowProgress(tr, t);
    if (raw === null) continue;
    return { tr, raw, eased: applyEase(tr.spec.ease as EaseId | undefined, raw, tr.spec.bz) };
  }
  return null;
}

/** Transiciones de la pista cuyo clip entrante/saliente no puede ser ninguna otra cosa: ¿tiene algo este clip? */
export const clipHasTransition = (c: Clip) => !!c.tin || !!c.tout;

/** Marca de la unión entre dos clips contiguos de una pista: devuelve el par (A, B) si lo son. */
export function junctionOf(track: Track, clipIdB: string): { a: Clip; b: Clip } | null {
  const i = track.clips.findIndex((c) => c.id === clipIdB);
  if (i <= 0) return null;
  const a = track.clips[i - 1];
  const b = track.clips[i];
  if (a.kind === 'audio' || b.kind === 'audio' || a.toEnd || !contiguous(a, b)) return null;
  return { a, b };
}

/** ¿Los dos clips son una unión válida? (contiguos y de video/imagen/texto/ajuste) */
export const areJoined = (a: Clip, b: Clip) => a.kind !== 'audio' && b.kind !== 'audio' && !a.toEnd && contiguous(a, b);

/**
 * Instante del archivo para un clip que se muestra fuera de su rango (ventana de unión): el tiempo avanza con la
 * velocidad del clip y se limita al archivo (no al recorte), es decir, usa los márgenes de recorte.
 */
export function extendedSourceTime(c: Pick<Clip, 'inP' | 'start' | 'speed'>, t: number, mediaDur: number): number {
  const s = c.inP + (t - c.start) * (c.speed || 1);
  const hi = mediaDur > 0 ? Math.max(0, mediaDur - 0.001) : Infinity;
  return Math.max(0, Math.min(hi, s));
}
