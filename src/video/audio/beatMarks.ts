// Marcas de ritmo en la línea de tiempo: instantes del proyecto (s) de los pulsos de cada clip con
// audio cuyo medio tiene el ritmo detectado. Se muestran en la regla y sirven de imán.
import type { Clip, VideoProject } from '../model/types';

/** Pulsos de un clip en tiempo de la línea de tiempo (solo los que caen dentro del tramo del clip). */
export function clipBeatTimes(p: VideoProject, c: Clip): number[] {
  if ((c.kind !== 'video' && c.kind !== 'audio') || !c.mediaId) return [];
  const info = p.media[c.mediaId]?.beats;
  if (!info) return [];
  const speed = c.speed || 1;
  const out: number[] = [];
  for (const b of info.beats) {
    if (b < c.inP) continue;
    if (b >= c.outP) break;
    out.push(c.start + (b - c.inP) / speed);
  }
  return out;
}

/** Todas las marcas del proyecto, ordenadas y sin repetidos (a menos de 5 ms). */
export function projectBeatMarks(p: VideoProject): number[] {
  const all: number[] = [];
  for (const t of p.tracks) {
    if (t.kind === 'subtitle' || t.muted) continue;
    for (const c of t.clips) all.push(...clipBeatTimes(p, c));
  }
  all.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) if (!out.length || t - out[out.length - 1] > 0.005) out.push(t);
  return out;
}

/** El pulso más cercano a `t` a menos de `threshold` s, o null. */
export function nearestBeat(marks: readonly number[], t: number, threshold: number): number | null {
  let lo = 0;
  let hi = marks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  let best: number | null = null;
  let bd = threshold;
  for (const i of [lo - 1, lo, lo + 1]) {
    if (i < 0 || i >= marks.length) continue;
    const d = Math.abs(marks[i] - t);
    if (d <= bd) {
      bd = d;
      best = marks[i];
    }
  }
  return best;
}
