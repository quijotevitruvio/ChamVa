// Consultas puras sobre el modelo v2: duraciones, «qué está activo en t», tiempos de origen.
import { resolveTransitions } from '../fx/transitions';
import { clipDurationOf, sourceAtLocal, type TimeFields } from '../speed/clipTime';
import type { Clip, Track, Transform, VideoProject } from './types';

/** Duración mínima de un clip de video/audio en la línea de tiempo (igual que V1). */
export const MIN_CLIP = 0.01;

export const isStill = (c: Pick<Clip, 'kind'>) => c.kind === 'image' || c.kind === 'text' || c.kind === 'subtitle' || c.kind === 'adjust';
export const isVisual = (c: Pick<Clip, 'kind'>) => c.kind !== 'audio';

/** ¿Este clip puede ir en esta pista? (audio ↔ pista de audio; subtítulo ↔ pista de subtítulos; video/imagen/texto ↔ pista de video) */
export const fitsTrack = (c: Pick<Clip, 'kind'>, t: Pick<Track, 'kind'>) => (c.kind === 'audio') === (t.kind === 'audio') && (c.kind === 'subtitle') === (t.kind === 'subtitle');

/**
 * Duración en la línea de tiempo (sin `toEnd`). Video/audio: recorte ÷ velocidad,
 * mínimo 0,01 s, con la MISMA expresión que V1 (para que los tiempos coincidan bit a bit).
 */
export function clipDuration(c: TimeFields): number {
  if (isStill(c)) return Math.max(0, c.outP - c.inP);
  return clipDurationOf(c); // V8: curva de velocidad, invertir, congelar y bucle (sin ellos, la expresión de V1)
}

/** Fin en la línea de tiempo (sin `toEnd`). */
export const clipEnd = (c: Clip) => c.start + clipDuration(c);

/** Fin efectivo: los `toEnd` llegan hasta el final del proyecto. */
export const effectiveEnd = (c: Clip, projectDur: number) => (c.toEnd ? Math.max(c.start, projectDur) : clipEnd(c));

export function trackEnd(t: Track): number {
  let e = 0;
  for (const c of t.clips) e = Math.max(e, clipEnd(c));
  return e;
}

/**
 * Duración del proyecto: el fin del último clip VISUAL (video/imagen/texto, sin
 * contar los `toEnd`) de cualquier pista de video, oculta o no. El audio que
 * sobresale se corta (como en V1). Si no hay nada visual, manda el audio.
 */
export function projectDuration(p: VideoProject): number {
  let vis = 0;
  let aud = 0;
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (t.kind === 'video') {
        if (!c.toEnd) vis = Math.max(vis, clipEnd(c));
      } else if (t.kind === 'audio') aud = Math.max(aud, clipEnd(c));
    }
  return vis > 0 ? vis : aud;
}

export const isActiveAt = (c: Clip, t: number, projectDur: number) => t >= c.start && t < effectiveEnd(c, projectDur);

export interface ActiveClip {
  track: Track;
  /** índice de la pista en `project.tracks` */
  trackIndex: number;
  clip: Clip;
  /** V6: el clip no está activo en t; se ve solo porque una transición de unión lo necesita (usa los márgenes de recorte) */
  ext?: boolean;
}

/** Pistas de video en orden de dibujo: de la de abajo (última del array) a la de arriba. */
export function videoTracksBottomUp(p: VideoProject): { track: Track; trackIndex: number }[] {
  const out: { track: Track; trackIndex: number }[] = [];
  for (let i = p.tracks.length - 1; i >= 0; i--) if (p.tracks[i].kind === 'video') out.push({ track: p.tracks[i], trackIndex: i });
  return out;
}

/**
 * Clips activos en t. `visual`: lo que se ve, de abajo arriba (orden de dibujo),
 * sin pistas ocultas (los subtítulos van siempre encima de todo). `audible`: lo que suena (clips de video y de audio), sin
 * pistas silenciadas.
 */
export function clipsAt(p: VideoProject, t: number, projectDur = projectDuration(p)): { visual: ActiveClip[]; audible: ActiveClip[] } {
  const visual: ActiveClip[] = [];
  const audible: ActiveClip[] = [];
  for (const { track, trackIndex } of videoTracksBottomUp(p)) {
    const here: ActiveClip[] = [];
    for (const clip of track.clips) {
      if (!isActiveAt(clip, t, projectDur)) continue;
      here.push({ track, trackIndex, clip });
      if (!track.muted && clip.kind === 'video') audible.push({ track, trackIndex, clip });
    }
    // V6: en la ventana de una transición de unión se ven los dos clips (el que ya acabó y el que aún no empieza)
    if (!track.hidden && track.clips.some((c) => c.tin || c.tout)) {
      for (const r of resolveTransitions(track, projectDur)) {
        if (r.kind !== 'junction' || !(t >= r.t0 && t < r.t1)) continue;
        for (const c of [r.a!, r.b!]) if (!here.some((h) => h.clip.id === c.id)) here.push({ track, trackIndex, clip: c, ext: true });
      }
      here.sort((x, y) => x.clip.start - y.clip.start);
    }
    if (!track.hidden) visual.push(...here);
  }
  // Subtítulos: encima de todas las capas (la pista de más arriba en `tracks` queda más arriba).
  for (let trackIndex = p.tracks.length - 1; trackIndex >= 0; trackIndex--) {
    const track = p.tracks[trackIndex];
    if (track.kind !== 'subtitle' || track.hidden) continue;
    for (const clip of track.clips) if (isActiveAt(clip, t, projectDur)) visual.push({ track, trackIndex, clip });
  }
  p.tracks.forEach((track, trackIndex) => {
    if (track.kind !== 'audio' || track.muted) return;
    for (const clip of track.clips) if (isActiveAt(clip, t, projectDur)) audible.push({ track, trackIndex, clip });
  });
  return { visual, audible };
}

/** Instante del archivo de origen que se ve/oye en t (misma fórmula y límites que V1). */
export function sourceTimeAt(c: Clip, t: number): number {
  return sourceAtLocal(c, t - c.start);
}

/** Opacidad del fundido de imagen en t (0..1), como `fadeAlpha` de V1. */
export function clipFadeAlpha(c: Clip, t: number, projectDur: number): number {
  const local = t - c.start;
  // clipDuration y no (fin − inicio): así da el mismo número que V1 (seg.dur), sin redondeo extra.
  const dur = c.toEnd ? Math.max(0, projectDur - c.start) : clipDuration(c);
  let a = 1;
  if (c.fadeIn > 0 && local < c.fadeIn) a = local / c.fadeIn;
  if (c.fadeOut > 0 && dur - local < c.fadeOut) a = Math.min(a, (dur - local) / c.fadeOut);
  return Math.max(0, Math.min(1, a));
}

export function isIdentityTransform(tr: Transform | undefined): boolean {
  return !tr || (tr.x === 0.5 && tr.y === 0.5 && tr.scale === 1 && tr.rotation === 0 && tr.opacity === 1);
}

export interface ClipLocation {
  track: Track;
  trackIndex: number;
  clip: Clip;
  clipIndex: number;
}

export function findClip(p: VideoProject, clipId: string): ClipLocation | null {
  for (let ti = 0; ti < p.tracks.length; ti++) {
    const ci = p.tracks[ti].clips.findIndex((c) => c.id === clipId);
    if (ci >= 0) return { track: p.tracks[ti], trackIndex: ti, clip: p.tracks[ti].clips[ci], clipIndex: ci };
  }
  return null;
}

export const findTrack = (p: VideoProject, trackId: string) => p.tracks.find((t) => t.id === trackId) ?? null;

/** Ids de medios que usa algún clip. */
export function usedMediaIds(p: VideoProject): Set<string> {
  const s = new Set<string>();
  for (const t of p.tracks) for (const c of t.clips) if (c.mediaId) s.add(c.mediaId);
  return s;
}

/** Recuento rápido (para verificar migraciones y guardados). */
export function projectCounts(p: VideoProject) {
  let clips = 0;
  for (const t of p.tracks) clips += t.clips.length;
  const media = Object.values(p.media);
  return { tracks: p.tracks.length, clips, media: media.length, mediaWithBlob: media.filter((m) => !!m.blob).length };
}
