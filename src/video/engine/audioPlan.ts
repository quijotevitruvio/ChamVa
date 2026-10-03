// Plan de mezcla de V7 (puro): de un proyecto saca las entradas del mezclador, los ajustes de cada pista
// (mezclador, ducking con sus pistas de control ya resueltas, silencio y solo) y la cadena maestra. Lo usan
// la exportación (render.ts, audioExport.ts) y —con `resolveTrackPlan`— la vista previa en vivo, así que
// el criterio de qué suena y qué dispara qué es UNO solo.
import { clipEnd, clipDuration } from '../model/query';
import type { Clip, Track, VideoProject } from '../model/types';
import { buildProjectMixEntries } from './compose';
import type { MasterOptions, TrackFx } from './dsp';
import { TRUE_PEAK_CEILING_DB } from './dsp';
import type { MixEntry, MixTrack, PcmSource } from './mixer';

export interface TrackPlan {
  id: string;
  /** suena (no silenciada y, si hay solos, en solo) */
  active: boolean;
  fx: TrackFx;
  /** pistas cuya señal dispara el ducking de esta (solo si `fx.duck.on`) */
  key: string[];
}

/** Ajustes de mezclador de una pista como los lee la cadena (solo lo definido). */
export function trackFxOf(t: Track): TrackFx {
  const fx: TrackFx = {};
  if (t.gainDb) fx.gainDb = t.gainDb;
  if (t.pan) fx.pan = t.pan;
  if (t.eq?.length) fx.eq = t.eq;
  if (t.duck?.on) fx.duck = t.duck;
  return fx;
}

/** ¿Hay alguna pista en solo? */
export const anySolo = (p: VideoProject): boolean => p.tracks.some((t) => t.kind !== 'subtitle' && t.solo === true);

/**
 * Pistas de audio del proyecto con su estado de silencio/solo y las pistas de control de su ducking.
 * Una pista con ducking nunca es control de otra (sin bucles de realimentación).
 */
export function resolveTrackPlan(p: VideoProject): Map<string, TrackPlan> {
  const solo = anySolo(p);
  const out = new Map<string, TrackPlan>();
  for (const t of p.tracks) {
    if (t.kind === 'subtitle') continue;
    out.set(t.id, { id: t.id, active: !t.muted && (!solo || t.solo === true), fx: trackFxOf(t), key: [] });
  }
  for (const t of p.tracks) {
    const plan = out.get(t.id);
    if (!plan || !plan.fx.duck?.on) continue;
    const by = t.duck?.by?.length ? new Set(t.duck.by) : null;
    for (const o of out.values()) {
      if (o.id === t.id || !o.active || o.fx.duck?.on) continue;
      if (by && !by.has(o.id)) continue;
      plan.key.push(o.id);
    }
  }
  return out;
}

export interface CrossfadeWin {
  in?: { pre: number; len: number };
  out?: { post: number; len: number };
}

const timeSpecial = (c: Clip) => !!(c.curve || c.reverse || c.freeze || c.loop || (c.pitch && (c.speed || 1) !== 1));

/**
 * Fundidos cruzados en las uniones de una pista (clips contiguos de archivos distintos, o del mismo archivo con salto).
 * Cada lado se prolonga por el margen de recorte que tenga en el archivo; si falta margen la ventana se acorta
 * (y si queda por debajo de 10 ms no hay fundido). Un clip que continúa al anterior (mismo archivo y punto) no lleva.
 */
export function crossfadeWindows(p: VideoProject, track: Track, d: number): Map<string, CrossfadeWin> {
  const out = new Map<string, CrossfadeWin>();
  if (!(d > 0)) return out;
  const cs = track.clips.filter((c) => (c.kind === 'video' || c.kind === 'audio') && !!c.mediaId && !p.media[c.mediaId!]?.missing);
  for (let i = 0; i + 1 < cs.length; i++) {
    const a = cs[i];
    const b = cs[i + 1];
    if (Math.abs(clipEnd(a) - b.start) > 0.02) continue;
    if (timeSpecial(a) || timeSpecial(b)) continue;
    const sa = a.speed || 1;
    const sb = b.speed || 1;
    if (a.mediaId === b.mediaId && sa === sb && Math.abs(a.outP - b.inP) <= 0.05) continue; // continuación: no hay nada que fundir
    const durA = p.media[a.mediaId!]?.duration ?? 0;
    const mA = durA > 0 ? Math.max(0, (durA - a.outP) / sa) : 0;
    const mB = Math.max(0, b.inP / sb);
    const cap = 0.5 * Math.min(clipDuration(a), clipDuration(b));
    let hB = Math.min(d / 2, mB, cap);
    const hA = Math.min(d - hB, mA, cap);
    hB = Math.min(d - hA, mB, cap);
    const len = hA + hB;
    if (len < 0.01) continue;
    out.set(a.id, { ...(out.get(a.id) ?? {}), out: { post: hA, len } });
    out.set(b.id, { ...(out.get(b.id) ?? {}), in: { pre: hB, len } });
  }
  return out;
}

export interface MixPlan {
  entries: MixEntry[];
  tracks: Record<string, MixTrack>;
  master: MasterOptions;
}

/** Ajustes de la cadena maestra del proyecto; `gainDb` es la ganancia de sonoridad ya calculada. */
export function masterOf(p: VideoProject, gainDb = 0): MasterOptions {
  return { eq: p.eq, normalize: p.normalize, ...(p.audio?.eq?.length ? { eqBands: p.audio.eq } : {}), ...(gainDb ? { gainDb } : {}), ceilingDb: TRUE_PEAK_CEILING_DB };
}

/**
 * Entradas del mezclador y ajustes de pista. Las entradas de cada clip salen de `buildProjectMixEntries`
 * (compose.ts: volumen con fotogramas clave, fundidos, velocidad especial…) pista a pista, y aquí se les
 * añade la pista y los fundidos cruzados.
 */
export function planProjectMix(
  p: VideoProject,
  duration: number,
  open: (clip: Clip, startAt?: number) => () => Promise<PcmSource | null>,
  playable: (clip: Clip) => boolean,
  gainDb = 0,
): MixPlan {
  const plan = resolveTrackPlan(p);
  const entries: MixEntry[] = [];
  const tracks: Record<string, MixTrack> = {};
  const xfade = p.audio?.xfade ?? 0;
  // orden de suma como siempre: capas de video de abajo arriba y luego las pistas de audio
  const order = [...p.tracks.filter((t) => t.kind === 'video').reverse(), ...p.tracks.filter((t) => t.kind === 'audio')];
  for (const track of order) {
    const tp = plan.get(track.id);
    if (!tp || !tp.active) continue;
    tracks[track.id] = { fx: tp.fx, key: tp.key };
    const xfs = crossfadeWindows(p, track, xfade);
    const openX = (clip: Clip, startAt?: number) => {
      const w = xfs.get(clip.id)?.in;
      return open(clip, startAt ?? (w ? Math.max(0, clip.inP - w.pre * (clip.speed || 1)) : undefined));
    };
    const sub: VideoProject = { ...p, tracks: [{ ...track, muted: false }] };
    const built = buildProjectMixEntries(sub, duration, openX, playable);
    for (const e of built) {
      const c = track.clips.find((x) => x.start === e.start && (x.kind === 'video' || x.kind === 'audio'));
      e.trackId = track.id;
      const w = c ? xfs.get(c.id) : undefined;
      if (w?.in) e.xfIn = w.in;
      if (w?.out) e.xfOut = w.out;
      entries.push(e);
    }
  }
  return { entries, tracks, master: masterOf(p, gainDb) };
}

/** Ventanas de fundido cruzado de un clip en tiempo ABSOLUTO de la línea de tiempo (para la vista previa). */
export interface XfAbs {
  in?: { w0: number; len: number };
  out?: { w0: number; len: number };
}

/** Ventanas de fundido cruzado de todas las pistas (vacío si el proyecto no lo usa). */
export function crossfadeAbs(p: VideoProject): Map<string, XfAbs> {
  const out = new Map<string, XfAbs>();
  const d = p.audio?.xfade ?? 0;
  if (!(d > 0)) return out;
  for (const t of p.tracks) {
    if (t.kind === 'subtitle') continue;
    for (const [id, w] of crossfadeWindows(p, t, d)) {
      const c = t.clips.find((x) => x.id === id)!;
      const x: XfAbs = {};
      if (w.in) x.in = { w0: c.start - w.in.pre, len: w.in.len };
      if (w.out) x.out = { w0: clipEnd(c) + w.out.post - w.out.len, len: w.out.len };
      out.set(id, x);
    }
  }
  return out;
}

/** Ganancia de fundido cruzado de un clip en el instante t: seno de entrada × coseno de salida (potencia constante). 1 fuera de las ventanas. */
export function xfGain(x: XfAbs | undefined, t: number): number {
  if (!x) return 1;
  let g = 1;
  if (x.in) {
    const u = (t - x.in.w0) / x.in.len;
    g *= u <= 0 ? 0 : u >= 1 ? 1 : Math.sin((Math.PI / 2) * u);
  }
  if (x.out) {
    const u = (t - x.out.w0) / x.out.len;
    g *= u <= 0 ? 1 : u >= 1 ? 0 : Math.cos((Math.PI / 2) * u);
  }
  return g;
}
