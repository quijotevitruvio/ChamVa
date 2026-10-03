// Operaciones puras sobre el modelo v2. Nunca mutan la entrada: devuelven un
// proyecto nuevo, o EL MISMO objeto si la operación no aplica (pista bloqueada,
// clip inexistente, corte fuera de rango…). Así el historial no apila pasos vacíos.
//
// Invariantes que mantiene `normalizeTrack` tras cada operación:
//  - los clips de una pista están ordenados por `start`, empiezan en ≥ 0 y no se solapan
//    (si una operación provoca un solape, el clip posterior se EMPUJA a la derecha; nunca se borra);
//  - pista con imán: clips en secuencia desde 0 sin huecos, en el orden del array;
//  - `toEnd` solo puede tenerlo el último clip de su pista.
import { IDENTITY_TRANSFORM, type Clip, type ClipKind, type MediaAsset, type Track, type TrackKind, type Transform, type VideoProject, uid, VIDEO_PROJECT_VERSION } from './types';
import { DEFAULT_SUBTITLE_STYLE } from '../title/style';
import { MIN_CLIP, clipDuration, clipEnd, findClip, fitsTrack, isStill, projectDuration } from './query';

/** Margen mínimo (s) de cada mitad al dividir, como el atajo «S» de V1. */
export const SPLIT_MARGIN = 0.05;

export type PlaceMode = 'push' | 'insert' | 'reject';

export function createProject(): VideoProject {
  return { v: VIDEO_PROJECT_VERSION, media: {}, tracks: [], eq: { low: 0, mid: 0, high: 0 }, normalize: false };
}

export function createTrack(kind: TrackKind, o: Partial<Omit<Track, 'kind'>> = {}): Track {
  return {
    id: o.id ?? uid(),
    kind,
    name: o.name ?? (kind === 'video' ? 'Video' : kind === 'subtitle' ? 'Subtítulos' : 'Audio'),
    muted: o.muted ?? false,
    locked: o.locked ?? false,
    hidden: o.hidden ?? false,
    magnet: o.magnet ?? false,
    clips: o.clips ?? [],
    ...(o.subStyle ? { subStyle: o.subStyle } : kind === 'subtitle' ? { subStyle: { ...DEFAULT_SUBTITLE_STYLE, style: { ...DEFAULT_SUBTITLE_STYLE.style } } } : {}),
  };
}

/** Clip con valores por defecto (los campos que falten se rellenan). */
export function makeClip(kind: ClipKind, o: Partial<Clip> = {}): Clip {
  const still = kind === 'image' || kind === 'text' || kind === 'subtitle';
  return {
    id: o.id ?? uid(),
    kind,
    mediaId: o.mediaId,
    name: o.name,
    start: o.start ?? 0,
    inP: o.inP ?? 0,
    outP: o.outP ?? (still ? 5 : 0),
    speed: still ? 1 : (o.speed ?? 1),
    volume: o.volume ?? 1,
    effect: o.effect ?? 'none',
    ...(o.voice ? { voice: o.voice } : {}),
    fadeIn: o.fadeIn ?? 0,
    fadeOut: o.fadeOut ?? 0,
    audioFadeIn: o.audioFadeIn ?? 0,
    audioFadeOut: o.audioFadeOut ?? 0,
    transform: { ...IDENTITY_TRANSFORM, ...o.transform },
    ...(o.size !== undefined ? { size: o.size } : {}),
    ...(o.text !== undefined ? { text: o.text } : {}),
    ...(o.color !== undefined ? { color: o.color } : {}),
    ...(o.toEnd ? { toEnd: true } : {}),
    ...(o.tstyle ? { tstyle: o.tstyle } : {}),
    ...(o.anim ? { anim: o.anim } : {}),
    ...(o.words ? { words: o.words } : {}),
  };
}

// ---------------- normalización ----------------

const withStart = (c: Clip, start: number) => (c.start === start ? c : { ...c, start });

/** Reimpone las invariantes de una pista. Devuelve la misma pista si ya se cumplían. */
export function normalizeTrack(t: Track): Track {
  let clips: Clip[];
  if (t.magnet) {
    let at = 0;
    clips = t.clips.map((c) => {
      const n = withStart(c, at);
      at = clipEnd(n);
      return n;
    });
  } else {
    const sorted = t.clips
      .map((c, i) => ({ c, i }))
      .sort((a, b) => a.c.start - b.c.start || a.i - b.i)
      .map((x) => x.c);
    let prevEnd = 0;
    clips = sorted.map((c) => {
      const s = Number.isFinite(c.start) ? Math.max(0, c.start, prevEnd) : prevEnd;
      const n = withStart(c, s);
      prevEnd = clipEnd(n);
      return n;
    });
  }
  clips = clips.map((c, i) => (c.toEnd && i < clips.length - 1 ? stripToEnd(c) : c));
  const same = clips.length === t.clips.length && clips.every((c, i) => c === t.clips[i]);
  return same ? t : { ...t, clips };
}

function stripToEnd(c: Clip): Clip {
  const { toEnd: _drop, ...rest } = c;
  return rest;
}

function replaceTrack(p: VideoProject, index: number, t: Track): VideoProject {
  const n = normalizeTrack(t);
  if (n === p.tracks[index]) return p;
  const tracks = p.tracks.slice();
  tracks[index] = n;
  return { ...p, tracks };
}

const trackIndex = (p: VideoProject, trackId: string) => p.tracks.findIndex((t) => t.id === trackId);

function editableTrack(p: VideoProject, trackId: string): number {
  const i = trackIndex(p, trackId);
  return i >= 0 && !p.tracks[i].locked ? i : -1;
}

// ---------------- pistas ----------------

/** Añade una pista. `index`: posición en `tracks` (0 = arriba del todo); por defecto, encima de las de su tipo. */
export function addTrack(p: VideoProject, kind: TrackKind, o: Partial<Omit<Track, 'kind'>> & { index?: number } = {}): VideoProject {
  const { index, ...rest } = o;
  const t = normalizeTrack(createTrack(kind, rest));
  if (p.tracks.some((x) => x.id === t.id)) throw new Error(`Ya existe la pista ${t.id}`);
  const tracks = p.tracks.slice();
  let at = index ?? tracks.findIndex((x) => x.kind === kind);
  if (at < 0) at = kind === 'video' ? 0 : kind === 'subtitle' ? Math.max(0, tracks.findIndex((x) => x.kind === 'audio') < 0 ? tracks.length : tracks.findIndex((x) => x.kind === 'audio')) : tracks.length;
  tracks.splice(Math.max(0, Math.min(tracks.length, at)), 0, t);
  return { ...p, tracks };
}

export function removeTrack(p: VideoProject, trackId: string): VideoProject {
  const i = editableTrack(p, trackId);
  if (i < 0) return p;
  return { ...p, tracks: p.tracks.filter((_, k) => k !== i) };
}

/** Cambia el orden de capas: mueve la pista a la posición `toIndex` de `tracks`. */
export function moveTrack(p: VideoProject, trackId: string, toIndex: number): VideoProject {
  const i = trackIndex(p, trackId);
  if (i < 0) return p;
  const to = Math.max(0, Math.min(p.tracks.length - 1, Math.round(toIndex)));
  if (to === i) return p;
  const tracks = p.tracks.slice();
  const [t] = tracks.splice(i, 1);
  tracks.splice(to, 0, t);
  return { ...p, tracks };
}

/** Nombre, silencio, bloqueo, ocultar, imán. Se permite aunque esté bloqueada (para desbloquearla). */
export function updateTrack(p: VideoProject, trackId: string, patch: Partial<Pick<Track, 'name' | 'muted' | 'locked' | 'hidden' | 'magnet' | 'subStyle'>>): VideoProject {
  const i = trackIndex(p, trackId);
  if (i < 0) return p;
  const t = p.tracks[i];
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.every((k) => patch[k] === undefined || patch[k] === t[k])) return p;
  return replaceTrack(p, i, { ...t, ...patch });
}

/** Imán: compacta la pista (sin huecos, desde 0) sin activar el imán. */
export function closeGaps(p: VideoProject, trackId: string): VideoProject {
  const i = editableTrack(p, trackId);
  if (i < 0) return p;
  const n = normalizeTrack({ ...p.tracks[i], magnet: true });
  return replaceTrack(p, i, { ...n, magnet: p.tracks[i].magnet });
}

// ---------------- medios ----------------

export function addMedia(p: VideoProject, m: MediaAsset): VideoProject {
  return { ...p, media: { ...p.media, [m.id]: m } };
}

export function updateMedia(p: VideoProject, id: string, patch: Partial<Omit<MediaAsset, 'id'>>): VideoProject {
  const m = p.media[id];
  if (!m) return p;
  return { ...p, media: { ...p.media, [id]: { ...m, ...patch } } };
}

/** Quita los medios que ya no usa ningún clip. */
export function pruneMedia(p: VideoProject): VideoProject {
  const used = new Set<string>();
  for (const t of p.tracks) for (const c of t.clips) if (c.mediaId) used.add(c.mediaId);
  const ids = Object.keys(p.media);
  if (ids.every((id) => used.has(id))) return p;
  const media: Record<string, MediaAsset> = {};
  for (const id of ids) if (used.has(id)) media[id] = p.media[id];
  return { ...p, media };
}

export function updateProject(p: VideoProject, patch: Partial<Pick<VideoProject, 'eq' | 'normalize'>>): VideoProject {
  const eq = patch.eq ? { ...p.eq, ...patch.eq } : p.eq;
  const normalize = patch.normalize ?? p.normalize;
  if (eq.low === p.eq.low && eq.mid === p.eq.mid && eq.high === p.eq.high && normalize === p.normalize) return p;
  return { ...p, eq, normalize };
}

// ---------------- clips ----------------

/** Índice de inserción en una pista con imán según el instante pedido (antes del clip cuyo centro queda después). */
function magnetIndex(clips: Clip[], start: number): number {
  const i = clips.findIndex((c) => c.start + clipDuration(c) / 2 > start);
  return i < 0 ? clips.length : i;
}

function placeIn(t: Track, clip: Clip, mode: PlaceMode, projectDur: number): Track | null {
  if (t.magnet) {
    const clips = t.clips.slice();
    clips.splice(magnetIndex(clips, clip.start), 0, clip);
    return { ...t, clips };
  }
  const s = Math.max(0, clip.start);
  const c = withStart(clip, s);
  const dur = c.toEnd ? Math.max(0, projectDur - s) : clipDuration(c);
  const e = s + dur;
  const overlaps = t.clips.filter((x) => x.start < e && clipEnd(x) > s);
  if (mode === 'reject' && overlaps.length) return null;
  if (mode === 'insert') {
    // si cae dentro de un clip, va justo después de él; todo lo posterior se corre `dur`
    const straddle = t.clips.find((x) => x.start < s && clipEnd(x) > s);
    const at = straddle ? clipEnd(straddle) : s;
    const placed = withStart(c, at);
    const shift = clipDuration(placed);
    const clips = t.clips.map((x) => (x.start >= at ? withStart(x, x.start + shift) : x));
    return { ...t, clips: [...clips, placed] };
  }
  return { ...t, clips: [...t.clips, c] };
}

/** Añade un clip a una pista en `clip.start`. `mode`: push (por defecto) / insert (desplaza lo posterior) / reject (no si se solapa). */
export function addClip(p: VideoProject, trackId: string, clip: Clip, o: { mode?: PlaceMode } = {}): VideoProject {
  const i = editableTrack(p, trackId);
  if (i < 0) return p;
  const t = p.tracks[i];
  if (!fitsTrack(clip, t)) throw new Error(`Un clip de ${clip.kind} no va en una pista de ${t.kind}`);
  if (findClip(p, clip.id)) throw new Error(`Ya existe el clip ${clip.id}`);
  const placed = placeIn(t, clip, o.mode ?? 'push', projectDuration(p));
  return placed ? replaceTrack(p, i, placed) : p;
}

/** Añade un clip al final de la pista. */
export function appendClip(p: VideoProject, trackId: string, clip: Clip): VideoProject {
  const t = p.tracks.find((x) => x.id === trackId);
  if (!t) return p;
  const end = t.clips.reduce((e, c) => Math.max(e, clipEnd(c)), 0);
  return addClip(p, trackId, withStart(clip, end));
}

type ClipPatch = Partial<Omit<Clip, 'id' | 'kind' | 'transform'>> & { transform?: Partial<Transform> };

const finiteOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Cambia propiedades de un clip (recorte, velocidad, volumen, efecto, fundidos, transformación, texto…). */
export function updateClip(p: VideoProject, clipId: string, patch: ClipPatch): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked) return p;
  const c = loc.clip;
  const { transform, ...rest } = patch;
  let tr = c.transform;
  if (transform) {
    const merged = { ...c.transform };
    for (const k of Object.keys(transform) as (keyof Transform)[]) merged[k] = finiteOr(transform[k], c.transform[k]);
    merged.opacity = Math.max(0, Math.min(1, merged.opacity));
    if ((Object.keys(merged) as (keyof Transform)[]).some((k) => merged[k] !== c.transform[k])) tr = merged;
  }
  const next: Clip = { ...c, ...rest, transform: tr };
  // números inválidos: se conserva el valor anterior
  for (const k of ['start', 'inP', 'outP', 'volume', 'fadeIn', 'fadeOut', 'audioFadeIn', 'audioFadeOut'] as const)
    next[k] = Math.max(0, finiteOr(next[k], c[k]));
  const sp = finiteOr(next.speed, c.speed);
  next.speed = isStill(c) ? 1 : sp > 0 ? sp : c.speed;
  if (next.outP < next.inP) next.outP = next.inP;
  if ('toEnd' in patch && !patch.toEnd) delete next.toEnd;
  const changed = (Object.keys(next) as (keyof Clip)[]).some((k) => next[k] !== c[k]) || Object.keys(c).length !== Object.keys(next).length;
  if (!changed) return p;
  const clips = loc.track.clips.slice();
  clips[loc.clipIndex] = next;
  return replaceTrack(p, loc.trackIndex, { ...loc.track, clips });
}

/** Mueve un clip a otro instante y/o pista. En pistas con imán decide el orden y se compacta. */
export function moveClip(p: VideoProject, clipId: string, to: { start?: number; trackId?: string }, o: { mode?: PlaceMode } = {}): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked) return p;
  const destId = to.trackId ?? loc.track.id;
  const di = editableTrack(p, destId);
  if (di < 0 || !fitsTrack(loc.clip, p.tracks[di])) return p;
  const start = Math.max(0, finiteOr(to.start, loc.clip.start));
  if (destId === loc.track.id && start === loc.clip.start) return p;
  const projectDur = projectDuration(p);
  const without = { ...loc.track, clips: loc.track.clips.filter((c) => c.id !== clipId) };
  const destBase = destId === loc.track.id ? without : p.tracks[di];
  const placed = placeIn(destBase, withStart(loc.clip, start), o.mode ?? 'push', projectDur);
  if (!placed) return p;
  const tracks = p.tracks.slice();
  tracks[loc.trackIndex] = normalizeTrack(without);
  tracks[di] = normalizeTrack(placed);
  return { ...p, tracks };
}

/** Reordena un clip dentro de su pista con imán (como arrastrar en V1: va al índice `toIndex`). */
export function moveClipToIndex(p: VideoProject, clipId: string, toIndex: number): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || !loc.track.magnet) return p;
  const to = Math.max(0, Math.min(loc.track.clips.length - 1, Math.round(toIndex)));
  if (to === loc.clipIndex) return p;
  const clips = loc.track.clips.slice();
  const [c] = clips.splice(loc.clipIndex, 1);
  clips.splice(to, 0, c);
  return replaceTrack(p, loc.trackIndex, { ...loc.track, clips });
}

/**
 * Divide un clip en el instante t de la línea de tiempo. La 1.ª mitad conserva el
 * id (y el fundido de entrada); la 2.ª recibe `newId` (y el fundido de salida).
 */
export function splitClip(p: VideoProject, clipId: string, t: number, newId: string = uid()): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || findClip(p, newId)) return p;
  const c = loc.clip;
  let a: Clip;
  let b: Clip;
  if (isStill(c)) {
    const local = t - c.start;
    const len = c.toEnd ? projectDuration(p) - c.start : clipDuration(c);
    if (!(local > SPLIT_MARGIN && local < len - SPLIT_MARGIN)) return p;
    a = stripToEnd({ ...c, inP: 0, outP: local, fadeOut: 0, audioFadeOut: 0 });
    b = { ...c, id: newId, start: c.start + local, inP: 0, outP: Math.max(0, c.outP - c.inP - local), fadeIn: 0, audioFadeIn: 0 };
  } else {
    const src = c.inP + (t - c.start) * (c.speed || 1);
    if (!(src > c.inP + SPLIT_MARGIN && src < c.outP - SPLIT_MARGIN)) return p;
    a = { ...c, outP: src, fadeOut: 0, audioFadeOut: 0 };
    b = { ...c, id: newId, inP: src, fadeIn: 0, audioFadeIn: 0 };
    b.start = clipEnd(a);
  }
  const clips = loc.track.clips.slice();
  clips.splice(loc.clipIndex, 1, a, b);
  return replaceTrack(p, loc.trackIndex, { ...loc.track, clips });
}

/**
 * Recorta un borde llevándolo al instante t de la línea de tiempo.
 * - Sin ripple (pista sin imán): el otro borde no se mueve y no se invade al vecino.
 * - Con ripple (o imán): el clip conserva su inicio y lo posterior se corre lo mismo.
 * `mediaDuration` limita el punto de salida (si se conoce).
 */
export function trimClip(p: VideoProject, clipId: string, edge: 'in' | 'out', t: number, o: { ripple?: boolean } = {}): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || !Number.isFinite(t)) return p;
  const { track, clipIndex: ci } = loc;
  const c = loc.clip;
  const ripple = !!o.ripple || track.magnet;
  const prev = track.clips[ci - 1];
  const nextClip = track.clips[ci + 1];
  const sp = c.speed || 1;
  const mediaDur = c.mediaId ? p.media[c.mediaId]?.duration || 0 : 0;
  const still = isStill(c);
  const minLen = still ? SPLIT_MARGIN : MIN_CLIP;
  let n: Clip;
  if (edge === 'in') {
    let delta = t - c.start; // >0 acorta
    const maxDelta = clipDuration(c) - minLen;
    const minDelta = still ? -Infinity : -c.inP / sp; // no antes del inicio del archivo
    delta = Math.max(minDelta, Math.min(maxDelta, delta));
    if (!ripple) delta = Math.max(delta, (prev ? clipEnd(prev) : 0) - c.start);
    if (delta === 0) return p;
    n = still ? { ...c, outP: c.outP - delta } : { ...c, inP: c.inP + delta * sp };
    if (!ripple) n.start = c.start + delta;
  } else {
    if (c.toEnd) n = stripToEnd({ ...c, outP: Math.max(minLen, Math.min(c.outP, projectDuration(p) - c.start)) });
    else n = { ...c };
    let len = t - c.start;
    len = Math.max(minLen, len);
    if (!still && mediaDur > 0) len = Math.min(len, (mediaDur - c.inP) / sp);
    if (!ripple && nextClip) len = Math.min(len, nextClip.start - c.start);
    if (still) n.outP = n.inP + len;
    else n.outP = c.inP + len * sp;
    if (n.outP === c.outP && !c.toEnd) return p;
  }
  const clips = track.clips.slice();
  clips[ci] = n;
  if (ripple && !track.magnet) {
    const shift = clipEnd(n) - clipEnd(c);
    for (let k = ci + 1; k < clips.length; k++) clips[k] = withStart(clips[k], clips[k].start + shift);
  }
  return replaceTrack(p, loc.trackIndex, { ...track, clips });
}

/** Elimina un clip. `ripple`: lo posterior se corre a la izquierda la duración del clip (imán: siempre). */
export function removeClip(p: VideoProject, clipId: string, o: { ripple?: boolean } = {}): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked) return p;
  const dur = clipEnd(loc.clip) - loc.clip.start;
  const clips = loc.track.clips
    .filter((c) => c.id !== clipId)
    .map((c, k) => (o.ripple && !loc.track.magnet && k >= loc.clipIndex ? withStart(c, c.start - dur) : c));
  return replaceTrack(p, loc.trackIndex, { ...loc.track, clips });
}

/** Duplica un clip justo detrás del original; lo posterior de la pista se corre. */
export function duplicateClip(p: VideoProject, clipId: string, newId: string = uid()): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || findClip(p, newId)) return p;
  const copy: Clip = stripToEnd({ ...loc.clip, id: newId, start: clipEnd(loc.clip) });
  const shift = clipDuration(copy);
  const clips = loc.track.clips.map((c, k) => (k > loc.clipIndex && !loc.track.magnet ? withStart(c, c.start + shift) : c));
  clips.splice(loc.clipIndex + 1, 0, copy);
  return replaceTrack(p, loc.trackIndex, { ...loc.track, clips });
}

// ---------------- imán de bordes ----------------

export interface SnapResult {
  time: number;
  /** a qué se pegó (null = no se pegó) */
  target: 'zero' | 'playhead' | 'clip' | null;
}

function snapCandidates(p: VideoProject, o: { playhead?: number; exclude?: string }) {
  const out: { t: number; target: 'zero' | 'playhead' | 'clip' }[] = [{ t: 0, target: 'zero' }];
  if (o.playhead !== undefined && Number.isFinite(o.playhead)) out.push({ t: o.playhead, target: 'playhead' });
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (c.id === o.exclude) continue;
      out.push({ t: c.start, target: 'clip' });
      if (!c.toEnd) out.push({ t: clipEnd(c), target: 'clip' });
    }
  return out;
}

/** Pega t al borde de clip / cabezal / 0 más cercano a menos de `threshold` s. */
export function snapTime(p: VideoProject, t: number, o: { threshold: number; playhead?: number; exclude?: string }): SnapResult {
  let best: SnapResult = { time: t, target: null };
  let dist = o.threshold;
  for (const k of snapCandidates(p, o)) {
    const d = Math.abs(k.t - t);
    if (d <= dist) {
      dist = d;
      best = { time: k.t, target: k.target };
    }
  }
  return best;
}

/** Inicio propuesto para arrastrar un clip, pegando su borde de inicio O de fin. */
export function snapClipStart(p: VideoProject, clipId: string, proposedStart: number, o: { threshold: number; playhead?: number }): SnapResult {
  const loc = findClip(p, clipId);
  if (!loc) return { time: proposedStart, target: null };
  const dur = clipDuration(loc.clip);
  const a = snapTime(p, proposedStart, { ...o, exclude: clipId });
  const b = snapTime(p, proposedStart + dur, { ...o, exclude: clipId });
  const da = a.target ? Math.abs(a.time - proposedStart) : Infinity;
  const db = b.target ? Math.abs(b.time - (proposedStart + dur)) : Infinity;
  if (da === Infinity && db === Infinity) return { time: Math.max(0, proposedStart), target: null };
  return da <= db ? { time: Math.max(0, a.time), target: a.target } : { time: Math.max(0, b.time - dur), target: b.target };
}
