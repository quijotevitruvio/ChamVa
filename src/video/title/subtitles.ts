// Operaciones puras sobre las pistas de subtítulos (V4): cada subtítulo es un clip `subtitle`
// (`start`, duración = `outP`, `text`) y el estilo global vive en `Track.subStyle`.
// Devuelven un proyecto NUEVO, o el MISMO objeto si no aplican (pista bloqueada, id inexistente…).
import { addTrack, addClip, makeClip, removeClip, updateTrack } from '../model/ops';
import { clipDuration, clipEnd, findClip, findTrack } from '../model/query';
import type { Clip, SubtitleStyle, Track, VideoProject } from '../model/types';
import { uid } from '../model/types';
import { wordTimings } from './karaoke';
import { resolveOverlaps, type Cue } from './srt';
import { DEFAULT_SUBTITLE_STYLE } from './style';

/** Duración mínima de un subtítulo (s). */
export const MIN_CUE = 0.1;
/** Duración de un subtítulo nuevo (s). */
export const NEW_CUE = 2;

export const subtitleTracks = (p: VideoProject): Track[] => p.tracks.filter((t) => t.kind === 'subtitle');

/** Subtítulos de una pista, en orden (el final es el del clip, a milisegundos). */
export function cuesOfTrack(t: Track): Cue[] {
  return t.clips
    .filter((c) => c.kind === 'subtitle')
    .map((c) => {
      const cue: Cue = { start: round3(c.start), end: round3(clipEnd(c)), text: c.text ?? '' };
      if (c.words?.length) cue.words = c.words;
      return cue;
    });
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Todos los subtítulos de todas las pistas (se solapan entre pistas), ordenados por inicio. */
export function allCues(p: VideoProject): Cue[] {
  return subtitleTracks(p)
    .flatMap(cuesOfTrack)
    .sort((a, b) => a.start - b.start);
}

export function newSubtitleTrack(p: VideoProject, o: { id?: string; name?: string } = {}): { p: VideoProject; id: string } {
  const id = o.id ?? uid();
  const n = subtitleTracks(p).length;
  return { p: addTrack(p, 'subtitle', { id, name: o.name ?? (n ? `Subtítulos ${n + 1}` : 'Subtítulos') }), id };
}

/** Primera pista de subtítulos (la crea si no hay). */
export function ensureSubtitleTrack(p: VideoProject, id?: string): { p: VideoProject; id: string } {
  const t = subtitleTracks(p)[0];
  return t ? { p, id: t.id } : newSubtitleTrack(p, { id });
}

/**
 * Sustituye todos los subtítulos de la pista por `cues`. Los solapes se resuelven recortando el final del anterior
 * (una pista no admite clips solapados). `ids`: ids de los clips (por orden); los que falten se generan.
 */
export function replaceCues(p: VideoProject, trackId: string, cues: Cue[], o: { ids?: string[] } = {}): { p: VideoProject; ids: string[]; overlapsFixed: number } {
  const t = findTrack(p, trackId);
  if (!t || t.kind !== 'subtitle' || t.locked) return { p, ids: [], overlapsFixed: 0 };
  const sorted = cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.start - b.c.start || a.i - b.i).map((x) => x.c);
  const r = resolveOverlaps(sorted, MIN_CUE);
  const ids: string[] = [];
  const clips: Clip[] = r.cues.map((c, k) => {
    const id = o.ids?.[k] ?? uid();
    ids.push(id);
    return makeClip('subtitle', { id, start: Math.max(0, c.start), inP: 0, outP: round3(Math.max(MIN_CUE, c.end - c.start)), text: c.text, ...(c.words?.length ? { words: c.words } : {}) });
  });
  const tracks = p.tracks.map((x) => (x.id === trackId ? { ...x, clips } : x));
  return { p: { ...p, tracks }, ids, overlapsFixed: r.changed };
}

/** Añade un subtítulo en `at` (por defecto 2 s, recortado para no pisar al siguiente). */
export function addCue(p: VideoProject, trackId: string, at: number, o: { dur?: number; text?: string; id?: string } = {}): { p: VideoProject; id: string | null } {
  const t = findTrack(p, trackId);
  if (!t || t.kind !== 'subtitle' || t.locked) return { p, id: null };
  let start = Math.max(0, at);
  // si cae dentro de otro, va justo detrás
  const within = t.clips.find((c) => c.start <= start && clipEnd(c) > start);
  if (within) start = clipEnd(within);
  const next = t.clips.find((c) => c.start >= start);
  let dur = o.dur ?? NEW_CUE;
  if (next) dur = Math.min(dur, next.start - start);
  if (dur < 0.01) return { p, id: null }; // sin hueco
  const id = o.id ?? uid();
  const clip = makeClip('subtitle', { id, start, inP: 0, outP: round3(dur), text: o.text ?? '' });
  return { p: addClip(p, trackId, clip, { mode: 'reject' }), id };
}

/** Texto de un subtítulo. */
export function setCueText(p: VideoProject, clipId: string, text: string): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || loc.clip.kind !== 'subtitle') return p;
  if (loc.clip.text === text) return p;
  // las palabras con tiempo de otro texto ya no valen
  const clips = loc.track.clips.map((c) => {
    if (c.id !== clipId) return c;
    const { words: _w, ...rest } = c;
    void _w;
    return { ...rest, text };
  });
  return { ...p, tracks: p.tracks.map((x) => (x.id === loc.track.id ? { ...x, clips } : x)) };
}

/**
 * Inicio y/o final de un subtítulo. No pisa a los vecinos: se limita al final del anterior y al inicio del
 * siguiente, y dura al menos `MIN_CUE`.
 */
export function setCueTimes(p: VideoProject, clipId: string, o: { start?: number; end?: number }): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || loc.clip.kind !== 'subtitle') return p;
  const prev = loc.track.clips[loc.clipIndex - 1];
  const next = loc.track.clips[loc.clipIndex + 1];
  const c = loc.clip;
  const lo = prev ? clipEnd(prev) : 0;
  const hi = next ? next.start : Infinity;
  let start = o.start !== undefined && Number.isFinite(o.start) ? o.start : c.start;
  let end = o.end !== undefined && Number.isFinite(o.end) ? o.end : clipEnd(c);
  start = Math.max(lo, start);
  end = Math.min(hi, end);
  if (end - start < MIN_CUE) {
    // se mantiene el borde que no se tocó
    if (o.start !== undefined && o.end === undefined) start = Math.max(lo, end - MIN_CUE);
    else end = Math.min(hi, start + MIN_CUE);
    if (end - start < MIN_CUE) return p;
  }
  start = round3(start);
  end = round3(end);
  if (start === c.start && round3(clipDuration(c)) === round3(end - start)) return p;
  const clips = loc.track.clips.map((x) => (x.id === clipId ? { ...x, start, inP: 0, outP: round3(end - start) } : x));
  return { ...p, tracks: p.tracks.map((x) => (x.id === loc.track.id ? { ...x, clips } : x)) };
}

/** Quita un subtítulo. */
export const removeCue = (p: VideoProject, clipId: string): VideoProject => removeClip(p, clipId);

/**
 * Divide un subtítulo en dos por la posición `charIndex` del texto (el cursor). El tiempo se reparte en proporción
 * a las letras de cada parte. Si el corte cae en un salto de línea, ese salto desaparece. Devuelve el id del 2.º.
 */
export function splitCue(p: VideoProject, clipId: string, charIndex: number, newId: string = uid(), atTime?: number): { p: VideoProject; id: string | null } {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || loc.clip.kind !== 'subtitle' || findClip(p, newId)) return { p, id: null };
  const c = loc.clip;
  const text = c.text ?? '';
  const i = Math.max(0, Math.min(text.length, Math.round(charIndex)));
  const a = text.slice(0, i).trim();
  const b = text.slice(i).trim();
  if (!a || !b) return { p, id: null };
  const dur = clipDuration(c);
  if (dur < 2 * MIN_CUE) return { p, id: null };
  const la = Array.from(a).length;
  const lb = Array.from(b).length;
  let cut = Math.max(MIN_CUE, Math.min(dur - MIN_CUE, (dur * la) / (la + lb)));
  if (atTime !== undefined && Number.isFinite(atTime) && atTime - c.start >= MIN_CUE && c.start + dur - atTime >= MIN_CUE) cut = atTime - c.start; // corte exacto en el cabezal
  const first: Clip = { ...c, text: a, outP: round3(cut) };
  const second: Clip = { ...c, id: newId, text: b, start: round3(c.start + cut), inP: 0, outP: round3(dur - cut) };
  delete first.words;
  delete second.words;
  const clips = loc.track.clips.slice();
  clips.splice(loc.clipIndex, 1, first, second);
  return { p: { ...p, tracks: p.tracks.map((x) => (x.id === loc.track.id ? { ...x, clips } : x)) }, id: newId };
}

/**
 * Divide un subtítulo en el instante t (el cabezal): el texto se corta por el límite de palabra más cercano a la
 * proporción de tiempo transcurrida; el corte de tiempo es exactamente t.
 */
export function splitCueAtTime(p: VideoProject, clipId: string, t: number, newId: string = uid()): { p: VideoProject; id: string | null } {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.kind !== 'subtitle') return { p, id: null };
  const c = loc.clip;
  const text = c.text ?? '';
  const dur = clipDuration(c);
  if (!(t > c.start + MIN_CUE && t < c.start + dur - MIN_CUE)) return { p, id: null };
  const want = (text.length * (t - c.start)) / dur;
  let best = -1;
  for (let i = 1; i < text.length; i++) if (/\s/.test(text[i]) && (best < 0 || Math.abs(i - want) < Math.abs(best - want))) best = i;
  if (best < 0) return { p, id: null };
  return splitCue(p, clipId, best, newId, t);
}

/** Divide un subtítulo de varias líneas en un subtítulo por línea (tiempo repartido por letras). */
export function splitCueLines(p: VideoProject, clipId: string, newIds: string[] = []): { p: VideoProject; ids: string[] } {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || loc.clip.kind !== 'subtitle') return { p, ids: [] };
  const lines = (loc.clip.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { p, ids: [] };
  const c = loc.clip;
  const dur = clipDuration(c);
  if (dur < lines.length * MIN_CUE) return { p, ids: [] };
  const weights = lines.map((l) => Array.from(l).length);
  const total = weights.reduce((a, b) => a + b, 0);
  const clips: Clip[] = [];
  const ids: string[] = [];
  let acc = 0;
  lines.forEach((l, k) => {
    const d0 = (acc / total) * dur;
    acc += weights[k];
    const d1 = (acc / total) * dur;
    const id = k === 0 ? c.id : (newIds[k - 1] ?? uid());
    ids.push(id);
    const clip: Clip = { ...c, id, text: l, start: round3(c.start + d0), inP: 0, outP: Math.max(0.01, round3(d1 - d0)) };
    delete clip.words;
    clips.push(clip);
  });
  const all = loc.track.clips.slice();
  all.splice(loc.clipIndex, 1, ...clips);
  return { p: { ...p, tracks: p.tracks.map((x) => (x.id === loc.track.id ? { ...x, clips: all } : x)) }, ids };
}

/** Une subtítulos consecutivos de una misma pista en uno solo (textos en líneas separadas). Conserva el id del primero. */
export function mergeCues(p: VideoProject, clipIds: string[]): VideoProject {
  const locs = clipIds.map((id) => findClip(p, id)).filter((l): l is NonNullable<typeof l> => !!l && l.clip.kind === 'subtitle');
  if (locs.length < 2) return p;
  const track = locs[0].track;
  if (track.locked || locs.some((l) => l.track.id !== track.id)) return p;
  const sorted = locs.map((l) => l.clip).sort((a, b) => a.start - b.start);
  const ids = new Set(sorted.map((c) => c.id));
  const first = sorted[0];
  const end = Math.max(...sorted.map(clipEnd));
  const text = sorted.map((c) => (c.text ?? '').trim()).filter(Boolean).join('\n');
  const merged: Clip = { ...first, text, inP: 0, outP: round3(end - first.start) };
  delete merged.words;
  const clips = track.clips.filter((c) => !ids.has(c.id) || c.id === first.id).map((c) => (c.id === first.id ? merged : c));
  // el hueco que dejan los no seleccionados entre medias se come: solo se unen vecinos reales
  const between = track.clips.filter((c) => !ids.has(c.id) && c.start >= first.start && c.start < end);
  if (between.length) return p;
  return { ...p, tracks: p.tracks.map((x) => (x.id === track.id ? { ...x, clips } : x)) };
}

/** Desplaza todos los subtítulos de la pista `dt` s (o solo desde el clip `fromId`). Nunca por debajo de 0. */
export function shiftCues(p: VideoProject, trackId: string, dt: number, o: { fromId?: string } = {}): VideoProject {
  const t = findTrack(p, trackId);
  if (!t || t.kind !== 'subtitle' || t.locked || !Number.isFinite(dt) || dt === 0) return p;
  const from = o.fromId ? t.clips.findIndex((c) => c.id === o.fromId) : 0;
  if (from < 0) return p;
  const group = t.clips.slice(from);
  if (!group.length) return p;
  const minStart = Math.min(...group.map((c) => c.start));
  const d = Math.max(dt, -minStart); // no pasar de 0
  const clips = t.clips.map((c, i) => (i >= from ? { ...c, start: round3(c.start + d) } : c));
  return { ...p, tracks: p.tracks.map((x) => (x.id === trackId ? { ...x, clips } : x)) };
}

/** Instantes de corte de escena: inicio y fin de los clips de las pistas de video (sin repetir). */
export function sceneBoundaries(p: VideoProject): number[] {
  const set = new Set<number>();
  for (const t of p.tracks)
    if (t.kind === 'video' && !t.hidden)
      for (const c of t.clips) {
        if (c.kind === 'image' && c.toEnd) continue;
        set.add(round3(c.start));
        if (!c.toEnd) set.add(round3(clipEnd(c)));
      }
  return [...set].sort((a, b) => a - b);
}

/**
 * Ajusta los subtítulos a las escenas: el inicio y el final que quedan a menos de `tolerance` s de un corte de
 * escena se pegan a él (sin cruzarse con el vecino ni quedar por debajo de `MIN_CUE`).
 */
export function fitCuesToScenes(p: VideoProject, trackId: string, o: { tolerance?: number; boundaries?: number[] } = {}): VideoProject {
  const t = findTrack(p, trackId);
  if (!t || t.kind !== 'subtitle' || t.locked) return p;
  const tol = o.tolerance ?? 0.3;
  const cuts = o.boundaries ?? sceneBoundaries(p);
  if (!cuts.length) return p;
  const near = (x: number): number | null => {
    let best: number | null = null;
    let d = tol;
    for (const c of cuts) {
      const dd = Math.abs(c - x);
      if (dd <= d) {
        d = dd;
        best = c;
      }
    }
    return best;
  };
  const clips = t.clips.map((c) => ({ ...c }));
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c.kind !== 'subtitle') continue;
    const prevEnd = i > 0 ? clips[i - 1].start + clips[i - 1].outP : 0;
    const nextStart = i + 1 < clips.length ? clips[i + 1].start : Infinity;
    let s = c.start;
    let e = c.start + c.outP;
    const ns = near(s);
    const ne = near(e);
    if (ns !== null && ns >= prevEnd - 1e-9) s = ns;
    if (ne !== null && ne <= nextStart + 1e-9) e = ne;
    if (e - s < MIN_CUE) continue;
    c.start = round3(s);
    c.inP = 0;
    c.outP = round3(e - s);
  }
  const same = clips.every((c, i) => c.start === t.clips[i].start && c.outP === t.clips[i].outP);
  return same ? p : { ...p, tracks: p.tracks.map((x) => (x.id === trackId ? { ...x, clips } : x)) };
}

/** Cambia el estilo global de la pista (se aplica a todos sus subtítulos). */
export function setSubtitleStyle(p: VideoProject, trackId: string, patch: Partial<Omit<SubtitleStyle, 'style'>> & { style?: Partial<SubtitleStyle['style']> }): VideoProject {
  const t = findTrack(p, trackId);
  if (!t || t.kind !== 'subtitle') return p;
  const cur = t.subStyle ?? { ...DEFAULT_SUBTITLE_STYLE, style: { ...DEFAULT_SUBTITLE_STYLE.style } };
  const { style, ...rest } = patch;
  const next: SubtitleStyle = { ...cur, ...rest, style: style ? { ...cur.style, ...style } : cur.style };
  if ('karaoke' in patch && !patch.karaoke) delete next.karaoke;
  return updateTrack(p, trackId, { subStyle: next });
}

// ---------------- comprobaciones para la tabla ----------------

/** Velocidad de lectura de un subtítulo (caracteres por segundo, sin contar saltos de línea). */
export function readingSpeed(text: string, dur: number): number {
  const n = Array.from(text.replace(/\s+/g, ' ').trim()).length;
  return dur > 0 ? n / dur : Infinity;
}

/** Subtítulos con tiempo de palabra para el karaoke (por si hace falta mostrar el reparto). */
export function cueWordTimes(c: Clip) {
  return wordTimings(c.text ?? '', clipDuration(c), c.words);
}
