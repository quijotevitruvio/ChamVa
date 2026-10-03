// Tiempo de un clip de video/audio (V8): una sola fuente de verdad para «qué instante del archivo se ve/oye a los
// `local` segundos del inicio del clip». La usan `clipDuration`, `sourceTimeAt`, la exportación, la vista previa y el
// audio, así que todo coincide. Sin curva, sin invertir, sin congelar y sin bucle, las fórmulas son las de V1
// (misma expresión: salen los mismos números bit a bit).
import type { Clip, LoopSpec } from '../model/types';
import { clampSpeed, speedAt, speedMap } from './curve';

export type TimeFields = Pick<Clip, 'kind' | 'inP' | 'outP' | 'speed'> & Partial<Pick<Clip, 'curve' | 'reverse' | 'freeze' | 'loop' | 'xlayer'>>;

/** Duración mínima de un clip de video/audio (igual que `MIN_CLIP` del modelo). */
const MIN = 0.01;

/** Máximo de pasadas de un bucle (para no generar proyectos absurdos). */
export const MAX_LOOP_PASSES = 500;

const isMedia = (c: Pick<Clip, 'kind'>) => c.kind === 'video' || c.kind === 'audio';

/** ¿El clip usa algo de V8 que cambia el mapeo de tiempo? */
export const isTimeSpecial = (c: Partial<Pick<Clip, 'curve' | 'reverse' | 'freeze' | 'loop'>>): boolean => !!(c.curve || c.reverse || c.freeze || c.loop);

/** Duración de UNA pasada (sin bucle), en segundos de salida. */
export function passDuration(c: TimeFields): number {
  if (c.freeze && c.freeze > 0 && c.kind === 'video') return Math.max(MIN, c.freeze);
  if (c.curve && isMedia(c)) {
    const hi = Math.max(c.inP, c.outP);
    return Math.max(MIN, c.inP < hi ? speedMap(c.curve, c.inP, hi).duration : 0);
  }
  return Math.max(MIN, (c.outP - c.inP) / (c.speed || 1));
}

export interface LoopInfo {
  /** una pasada */
  B: number;
  /** fundido cruzado efectivo (≤ B/2) */
  xf: number;
  /** avance entre pasadas (B − xf) */
  P: number;
  passes: number;
  total: number;
}

export function loopInfo(c: TimeFields): LoopInfo | null {
  const l = c.loop;
  if (!l || !isMedia(c)) return null;
  const B = passDuration(c);
  const xf = Math.max(0, Math.min(B / 2, l.xf ?? 0));
  const P = Math.max(MIN, B - xf);
  let passes: number;
  let total: number;
  if (l.dur && l.dur > 0) {
    total = Math.max(MIN, l.dur);
    passes = Math.min(MAX_LOOP_PASSES, Math.max(1, Math.ceil((total - B) / P - 1e-9) + 1));
  } else {
    passes = Math.min(MAX_LOOP_PASSES, Math.max(1, Math.round(l.n ?? 1)));
    total = (passes - 1) * P + B;
  }
  return { B, xf, P, passes, total };
}

/** Duración total del clip en la línea de tiempo (con bucle). Sin nada de V8, la misma expresión que V1. */
export function clipDurationOf(c: TimeFields): number {
  const li = loopInfo(c);
  if (li) return li.total;
  return passDuration(c);
}

/** Instante del archivo dentro de UNA pasada, a los `x` s de su inicio (sin limitar). */
export function passSource(c: TimeFields, x: number): number {
  if (c.freeze && c.freeze > 0 && c.kind === 'video') return c.inP;
  if (c.curve) {
    const hi = Math.max(c.inP, c.outP);
    if (!(c.inP < hi)) return c.inP;
    const m = speedMap(c.curve, c.inP, hi);
    return c.reverse ? m.toSource(Math.max(0, m.duration - x)) : m.toSource(x);
  }
  const sp = c.speed || 1;
  return c.reverse ? c.outP - x * sp : c.inP + x * sp;
}

const clampSrc = (c: TimeFields, s: number) => Math.max(c.inP, Math.min(c.outP - 0.001, s));

export interface Layer {
  /** instante del archivo */
  s: number;
  /** pasada (0..) */
  pass: number;
  /** opacidad con la que se dibuja la capa (la saliente va primero a 1, la entrante encima) */
  a: number;
  /** ganancia del sonido de la capa */
  g: number;
}

/**
 * Capas visibles a los `local` s del inicio del clip: una, o dos en el fundido cruzado de un bucle
 * (la saliente primero, la entrante después).
 */
export function layersAt(c: TimeFields, local: number): Layer[] {
  const li = loopInfo(c);
  if (!li) return [{ s: clampSrc(c, passSource(c, Math.max(0, local))), pass: 0, a: 1, g: 1 }];
  const l = Math.max(0, Math.min(li.total, local));
  let k = Math.min(li.passes - 1, Math.floor(l / li.P + 1e-9));
  let x = l - k * li.P;
  if (x > li.B) {
    // pasada final recortada por `dur` o redondeo: se queda en el último fotograma
    x = li.B;
  }
  if (k >= 1 && li.xf > 0 && x < li.xf) {
    const w = x / li.xf;
    return [
      { s: clampSrc(c, passSource(c, x + li.P)), pass: k - 1, a: 1, g: 1 - w },
      { s: clampSrc(c, passSource(c, x)), pass: k, a: w, g: w },
    ];
  }
  if (k < 0) k = 0;
  return [{ s: clampSrc(c, passSource(c, x)), pass: k, a: 1, g: 1 }];
}

/**
 * Instante del archivo que se ve a los `local` s del inicio del clip. Con `xlayer` (copia del clip que dibuja la pasada
 * saliente de un fundido cruzado) es el de esa capa.
 */
export function sourceAtLocal(c: TimeFields, local: number): number {
  if (!isTimeSpecial(c)) {
    const s = c.inP + local * (c.speed || 1);
    return Math.max(c.inP, Math.min(c.outP - 0.001, s));
  }
  const ls = layersAt(c, local);
  return c.xlayer && ls.length > 1 ? ls[0].s : ls[ls.length - 1].s;
}

/** Posición en la línea de tiempo (s desde el inicio del clip) a la que se ve el instante de archivo `s` en la 1.ª pasada. */
export function localOfSource(c: TimeFields, s: number): number {
  if (c.freeze && c.freeze > 0) return 0;
  const sc = Math.max(c.inP, Math.min(c.outP, s));
  if (c.curve) {
    const hi = Math.max(c.inP, c.outP);
    if (!(c.inP < hi)) return 0;
    const m = speedMap(c.curve, c.inP, hi);
    const f = m.toLocal(sc);
    return c.reverse ? Math.max(0, m.duration - f) : f;
  }
  const sp = c.speed || 1;
  return c.reverse ? (c.outP - sc) / sp : (sc - c.inP) / sp;
}

/** Velocidad instantánea (s de archivo por s de salida; negativa si va al revés) a los `local` s. */
export function rateAt(c: TimeFields, local: number): number {
  if (c.freeze && c.freeze > 0) return 0;
  const li = loopInfo(c);
  let x = Math.max(0, local);
  if (li) {
    const k = Math.min(li.passes - 1, Math.floor(Math.min(li.total, x) / li.P + 1e-9));
    x = Math.min(li.B, x - k * li.P);
  }
  let v: number;
  if (c.curve) v = speedAt(c.curve, passSource(c, x));
  else v = c.speed || 1;
  return c.reverse ? -v : v;
}

/**
 * Instante del archivo para un clip que se muestra FUERA de su rango (ventana de una transición de unión): fuera del
 * recorte el tiempo sigue con la velocidad del borde, y se limita al archivo (márgenes de recorte).
 */
export function extendedSourceAt(c: TimeFields, local: number, mediaDur: number): number {
  let s: number;
  if (!isTimeSpecial(c)) s = c.inP + local * (c.speed || 1);
  else {
    const D = passDuration(c);
    if (local >= 0 && local <= D) s = passSource(c, local);
    else if (local < 0) s = passSource(c, 0) + local * rateAt(c, 0);
    else s = passSource(c, D) + (local - D) * rateAt(c, D);
  }
  const hi = mediaDur > 0 ? Math.max(0, mediaDur - 0.001) : Infinity;
  return Math.max(0, Math.min(hi, s));
}

/** Velocidad «de resumen» para mostrar (media del tramo: archivo / salida). */
export function averageSpeed(c: TimeFields): number {
  const d = passDuration(c);
  return d > 0 ? Math.max(0, c.outP - c.inP) / d : 1;
}

// ---------------- lectura segura ----------------

export function sanitizeLoop(raw: unknown): LoopSpec | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: LoopSpec = {};
  if (typeof r.n === 'number' && Number.isFinite(r.n) && r.n >= 2) out.n = Math.min(MAX_LOOP_PASSES, Math.round(r.n));
  if (typeof r.dur === 'number' && Number.isFinite(r.dur) && r.dur > 0) out.dur = r.dur;
  if (typeof r.xf === 'number' && Number.isFinite(r.xf) && r.xf > 0) out.xf = Math.min(30, r.xf);
  return out.n || out.dur ? out : undefined;
}

export const sanitizeFreeze = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(3600, v) : undefined);

/** Velocidad constante válida (0,1×–100×). */
export { clampSpeed };

// ---------------- recorte y división con tiempo especial ----------------

/**
 * Recorta un borde de un clip con curva / invertido / congelado / bucle llevándolo a la posición de salida `local`
 * (`edge 'in'`: s de salida que se quitan por delante, negativo = alargar; `'out'`: nueva duración).
 * Devuelve los campos del clip que cambian, o null si no se puede (bucle por delante).
 */
export function trimSpecial(c: TimeFields, edge: 'in' | 'out', local: number, mediaDur: number): Partial<Pick<Clip, 'inP' | 'outP' | 'freeze' | 'loop'>> | null {
  if (c.freeze && c.freeze > 0) return { freeze: Math.max(MIN, edge === 'in' ? c.freeze - local : local) };
  if (c.loop) {
    if (edge === 'in') return null;
    return { loop: { ...c.loop, n: undefined, dur: Math.max(MIN, local) } };
  }
  const s = extendedSourceAt(c, edge === 'in' ? local : local, mediaDur);
  if (edge === 'in') return c.reverse ? { outP: Math.max(c.inP, s) } : { inP: Math.min(c.outP, s) };
  return c.reverse ? { inP: Math.min(c.outP, s) } : { outP: Math.max(c.inP, s) };
}

/** Cuánto se puede alargar por delante (s de salida, positivo): hasta el borde del archivo. */
export function maxExtendFront(c: TimeFields, mediaDur: number): number {
  if (c.freeze || c.loop) return c.freeze ? Infinity : 0;
  const r = Math.abs(rateAt(c, 0)) || 1;
  if (c.reverse) return mediaDur > 0 ? Math.max(0, (mediaDur - c.outP) / r) : Infinity;
  return c.inP / r;
}

/**
 * Divide un clip especial a los `local` s: devuelve los campos de la primera y la segunda mitad, o null si no se puede
 * (bucle) o el corte cae en un extremo.
 */
export function splitSpecial(c: TimeFields, local: number, margin: number): { a: Partial<Clip>; b: Partial<Clip> } | null {
  if (c.loop) return null;
  if (c.freeze && c.freeze > 0) {
    if (!(local > margin && local < c.freeze - margin)) return null;
    return { a: { freeze: local }, b: { freeze: c.freeze - local } };
  }
  const src = passSource(c, local);
  if (!(src > c.inP + margin && src < c.outP - margin)) return null;
  return c.reverse ? { a: { inP: src }, b: { outP: src } } : { a: { outP: src }, b: { inP: src } };
}
