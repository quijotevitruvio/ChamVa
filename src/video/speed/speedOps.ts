// Operaciones de proyecto de V8: velocidad, curva, invertir, congelar fotograma, bucle y reencuadre. Cada una es UN paso
// de deshacer (devuelve un proyecto nuevo, o el mismo si no aplica).
import type { Fit } from '../engine/timeline';
import { transformAt } from '../fx/keyframes';
import { applyReframe, clearReframe, type Dims } from '../reframe/math';
import { clipDuration, findClip, isStill, sourceTimeAt } from '../model/query';
import { SPLIT_MARGIN, addClip, addMedia, addTrack, makeClip, splitClip, updateClip } from '../model/ops';
import type { Clip, LoopSpec, MediaAsset, ReframeSpec, SpeedCurve, VideoProject } from '../model/types';
import { clampSpeed, constantCurve, presetCurve, sanitizeCurve } from './curve';
import { MAX_LOOP_PASSES } from './clipTime';

const editable = (p: VideoProject, id: string): Clip | null => {
  const loc = findClip(p, id);
  return loc && !loc.track.locked && !isStill(loc.clip) ? loc.clip : null;
};

/** Velocidad constante 0,1×–100× (quita la curva). */
export function setConstantSpeed(p: VideoProject, clipId: string, v: number): VideoProject {
  const c = editable(p, clipId);
  if (!c || !Number.isFinite(v)) return p;
  return updateClip(p, clipId, { speed: clampSpeed(v), curve: undefined });
}

/** Pone, cambia o quita (`null`) la curva de velocidad. */
export function setSpeedCurve(p: VideoProject, clipId: string, curve: SpeedCurve | null): VideoProject {
  const c = editable(p, clipId);
  if (!c) return p;
  if (!curve) return updateClip(p, clipId, { curve: undefined });
  const clean = sanitizeCurve(curve);
  return clean ? updateClip(p, clipId, { curve: clean }) : p;
}

/** Curva de un preajuste sobre el recorte actual del clip. */
export function applySpeedPreset(p: VideoProject, clipId: string, presetId: string): VideoProject {
  const c = editable(p, clipId);
  if (!c) return p;
  const curve = presetCurve(presetId, c.inP, c.outP);
  return curve ? updateClip(p, clipId, { curve }) : p;
}

/** Empieza una curva editable desde la velocidad constante actual. */
export function curveFromSpeed(p: VideoProject, clipId: string): VideoProject {
  const c = editable(p, clipId);
  if (!c || c.curve) return p;
  const v = c.speed || 1;
  return updateClip(p, clipId, { curve: { pts: [{ s: c.inP, v: clampSpeed(v) }, { s: c.outP, v: clampSpeed(v) }] }, speed: 1 });
}

export function setReverse(p: VideoProject, clipId: string, on: boolean): VideoProject {
  const c = editable(p, clipId);
  if (!c || !!c.reverse === on) return p;
  return updateClip(p, clipId, { reverse: on ? true : undefined });
}

export function setPitch(p: VideoProject, clipId: string, on: boolean): VideoProject {
  const c = editable(p, clipId);
  if (!c || !!c.pitch === on) return p;
  return updateClip(p, clipId, { pitch: on ? true : undefined });
}

/** Bucle: `null` lo quita. */
export function setLoop(p: VideoProject, clipId: string, loop: LoopSpec | null): VideoProject {
  const c = editable(p, clipId);
  if (!c) return p;
  if (!loop) return updateClip(p, clipId, { loop: undefined });
  const n = loop.n ? Math.max(2, Math.min(MAX_LOOP_PASSES, Math.round(loop.n))) : undefined;
  const clean: LoopSpec = { ...(n ? { n } : {}), ...(loop.dur && loop.dur > 0 ? { dur: loop.dur } : {}), ...(loop.xf && loop.xf > 0 ? { xf: loop.xf } : {}) };
  return clean.n || clean.dur ? updateClip(p, clipId, { loop: clean }) : p;
}

/**
 * Congelar fotograma: en el instante `t` de la línea de tiempo el clip se divide y entre las dos mitades se inserta un
 * clip de `dur` s que muestra ese fotograma (lo posterior se corre). Si `t` cae en un extremo del clip, el congelado va
 * justo antes o después.
 */
export function freezeFrame(p: VideoProject, clipId: string, t: number, dur: number, newIds: { freeze: string; right: string }): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || loc.clip.kind !== 'video' || !(dur > 0) || !Number.isFinite(t)) return p;
  const c = loc.clip;
  const total = clipDuration(c);
  const local = Math.max(0, Math.min(total, t - c.start));
  const s = sourceTimeAt(c, c.start + local);
  const q = splitClip(p, clipId, c.start + local, newIds.right);
  let at: number;
  let base: Clip;
  if (q !== p) {
    base = findClip(q, clipId)!.clip;
    at = findClip(q, newIds.right)!.clip.start;
  } else {
    // en un extremo (o un clip que no se puede dividir): el congelado va antes o después del clip, nunca en medio
    if (local > SPLIT_MARGIN && local < total - SPLIT_MARGIN) return p;
    base = c;
    at = local <= total / 2 ? c.start : c.start + total;
  }
  const freeze: Clip = makeClip('video', {
    id: newIds.freeze,
    mediaId: c.mediaId,
    name: c.name,
    start: at,
    inP: s,
    outP: s + 0.04,
    freeze: dur,
    volume: 0,
    transform: transformAt(c, c.start + local), // con los fotogramas (p. ej. el marco del reencuadre) en ese instante
    ...(base.fx ? { fx: base.fx } : {}),
    ...(base.blend ? { blend: base.blend } : {}),
  });
  return addClip(q, loc.track.id, freeze, { mode: 'insert' });
}

/** Imagen de un fotograma: añade el medio (la imagen ya codificada) y la pone en una pista nueva encima, en `t`, durante `dur` s. */
export function stillFromFrame(p: VideoProject, media: MediaAsset, t: number, dur: number, ids: { track: string; clip: string }): VideoProject {
  let q = addMedia(p, media);
  q = addTrack(q, 'video', { id: ids.track, index: 0 });
  return addClip(q, ids.track, makeClip('image', { id: ids.clip, mediaId: media.id, name: media.name, start: Math.max(0, t), inP: 0, outP: Math.max(0.1, dur), size: 1 }));
}

/** Aplica un reencuadre (marco fijo o con marcos a lo largo del clip). */
export function setReframe(p: VideoProject, clipId: string, spec: ReframeSpec, src: Dims, out: Dims, fit: Fit = 'contain'): VideoProject {
  const c = editable(p, clipId);
  if (!c || c.kind !== 'video') return p;
  const next = applyReframe(c, spec, src, out, fit);
  return updateClip(p, clipId, { reframe: next.reframe, transform: next.transform, keys: next.keys });
}

export function removeReframe(p: VideoProject, clipId: string): VideoProject {
  const c = editable(p, clipId);
  if (!c || !c.reframe) return p;
  const next = clearReframe(c);
  return updateClip(p, clipId, { reframe: undefined, transform: next.transform, keys: next.keys });
}

export { constantCurve };
