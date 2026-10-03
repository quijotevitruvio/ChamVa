// Operaciones de proyecto del audio de V7 (puras: devuelven un proyecto NUEVO o el mismo si no cambia nada).
// Cada llamada es un paso de deshacer. Los valores neutros (pan 0, 0 dB, sin ruido, EQ plano…) quitan el
// campo en vez de guardarlo, así un proyecto sin ajustes sigue siendo idéntico al de V6.
import type { BeatInfo, Clip, ProjectAudio, Track, VideoProject } from '../model/types';
import { eqIsFlat, type EqBand } from './eq';
import { DEFAULT_DUCK, type DuckSpec } from './duck';
import { sanitizeAmount, sanitizeBeats, sanitizeDuck, sanitizeGainDb, sanitizePan, sanitizeProjectAudio } from './sanitize';

export interface ClipAudioPatch {
  pan?: number | null;
  gainDb?: number | null;
  eq?: EqBand[] | null;
  denoise?: number | null;
}

function setOrDelete<T extends object>(o: T, key: keyof T, v: unknown) {
  if (v === undefined) delete o[key];
  else (o as Record<string, unknown>)[key as string] = v;
}

/** Ajustes de audio de un clip. `null` quita el campo. Respeta pistas bloqueadas. */
export function setClipAudio(p: VideoProject, clipId: string, patch: ClipAudioPatch): VideoProject {
  for (let ti = 0; ti < p.tracks.length; ti++) {
    const t = p.tracks[ti];
    const ci = t.clips.findIndex((c) => c.id === clipId);
    if (ci < 0) continue;
    if (t.locked) return p;
    const c = t.clips[ci];
    if (c.kind !== 'video' && c.kind !== 'audio') return p;
    const n: Clip = { ...c };
    if ('pan' in patch) setOrDelete(n, 'pan', patch.pan === null ? undefined : sanitizePan(patch.pan));
    if ('gainDb' in patch) setOrDelete(n, 'gainDb', patch.gainDb === null ? undefined : sanitizeGainDb(patch.gainDb));
    if ('denoise' in patch) setOrDelete(n, 'denoise', patch.denoise === null ? undefined : sanitizeAmount(patch.denoise));
    if ('eq' in patch) setOrDelete(n, 'eq', !patch.eq || eqIsFlat(patch.eq) ? undefined : patch.eq);
    const keys = new Set([...Object.keys(c), ...Object.keys(n)]);
    let same = true;
    for (const k of keys) if ((c as unknown as Record<string, unknown>)[k] !== (n as unknown as Record<string, unknown>)[k]) same = false;
    if (same) return p;
    const clips = t.clips.slice();
    clips[ci] = n;
    const tracks = p.tracks.slice();
    tracks[ti] = { ...t, clips };
    return { ...p, tracks };
  }
  return p;
}

export interface TrackMixPatch {
  gainDb?: number | null;
  pan?: number | null;
  solo?: boolean | null;
  eq?: EqBand[] | null;
  duck?: Partial<DuckSpec> | null;
}

/** Mezclador de una pista (se permite aunque esté bloqueada, como silenciar). */
export function setTrackMix(p: VideoProject, trackId: string, patch: TrackMixPatch): VideoProject {
  const ti = p.tracks.findIndex((t) => t.id === trackId);
  if (ti < 0 || p.tracks[ti].kind === 'subtitle') return p;
  const t = p.tracks[ti];
  const n: Track = { ...t };
  if ('gainDb' in patch) setOrDelete(n, 'gainDb', patch.gainDb === null ? undefined : sanitizeGainDb(patch.gainDb));
  if ('pan' in patch) setOrDelete(n, 'pan', patch.pan === null ? undefined : sanitizePan(patch.pan));
  if ('solo' in patch) setOrDelete(n, 'solo', patch.solo ? true : undefined);
  if ('eq' in patch) setOrDelete(n, 'eq', !patch.eq || eqIsFlat(patch.eq) ? undefined : patch.eq);
  if ('duck' in patch) {
    if (patch.duck === null) delete n.duck;
    else {
      const d = sanitizeDuck({ ...(t.duck ?? DEFAULT_DUCK), ...patch.duck });
      if (d) n.duck = d;
    }
  }
  const keys = new Set([...Object.keys(t), ...Object.keys(n)]);
  let same = true;
  for (const k of keys) if ((t as unknown as Record<string, unknown>)[k] !== (n as unknown as Record<string, unknown>)[k]) same = false;
  if (same) return p;
  const tracks = p.tracks.slice();
  tracks[ti] = n;
  return { ...p, tracks };
}

/** Ajustes de audio del proyecto (EQ maestro, sonoridad, fundido cruzado, ritmo). `undefined` en un campo lo quita. */
export function setProjectAudio(p: VideoProject, patch: Partial<ProjectAudio>): VideoProject {
  const merged: Record<string, unknown> = { ...(p.audio ?? {}), ...patch };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  if (merged.eq && eqIsFlat(merged.eq as EqBand[])) delete merged.eq;
  const next = sanitizeProjectAudio(merged);
  if (JSON.stringify(next ?? null) === JSON.stringify(p.audio ?? null)) return p;
  const out = { ...p };
  if (next) out.audio = next;
  else delete out.audio;
  return out;
}

/** Guarda (o quita con null) el ritmo detectado de un medio. */
export function setMediaBeats(p: VideoProject, mediaId: string, beats: BeatInfo | null): VideoProject {
  const m = p.media[mediaId];
  if (!m) return p;
  const b = beats ? sanitizeBeats(beats) : undefined;
  if (!b && !m.beats) return p;
  const nm = { ...m };
  if (b) nm.beats = b;
  else delete nm.beats;
  return { ...p, media: { ...p.media, [mediaId]: nm } };
}
