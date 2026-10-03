// Planificador de precarga («lookahead»): dado el proyecto y el instante t, dice qué clips de
// video/audio deben tener su elemento listo y en qué punto del archivo. Puro (sin DOM).
//
//  - Clips activos: se reproducen en su tiempo de origen.
//  - Clips que empiezan dentro del horizonte: su elemento se crea y se coloca (pre-seek) en el
//    primer fotograma; cuando faltan ≤ `lead` s empieza a reproducirse ya (el fundido de audio aún
//    es 0) para que al llegar el corte esté a velocidad y sin tirón.
//  - Un clip que CONTINÚA al anterior (mismo archivo, mismo punto de salida/entrada, misma velocidad)
//    reutiliza el elemento que ya suena: no necesita precarga.
import { clipDuration, clipEnd, clipsAt, effectiveEnd, projectDuration, sourceTimeAt } from '../../../video/model/query';
import type { Clip, VideoProject } from '../../../video/model/types';

export interface PlanItem {
  clip: Clip;
  clipId: string;
  mediaId: string;
  kind: 'video' | 'audio';
  /** segundos hasta que el clip empieza (≤ 0: ya está activo) */
  startsIn: number;
  active: boolean;
  /** el clip se ve ahora (capa de video visible) */
  visible: boolean;
  /** el clip debe sonar ahora (audible) */
  audible: boolean;
  /** punto del archivo (s) en el que debe estar el elemento ahora */
  seekTo: number;
  /** ¿debe estar reproduciendo ya? */
  play: boolean;
  /** si continúa a otro clip: id del clip anterior cuyo elemento se reutiliza */
  continuesFrom?: string;
}

export interface PlanOptions {
  /** cuántos segundos hacia delante se prepara */
  horizon?: number;
  /** cuánto antes de un corte empieza a correr el siguiente clip */
  lead?: number;
  /** máximo de clips por venir que se preparan */
  maxUpcoming?: number;
}

const EPS = 0.02;

/** ¿`b` es la continuación natural de otro clip (mismo archivo, sin salto ni cambio de velocidad)? */
export function continuesFrom(p: VideoProject, b: Clip): Clip | null {
  if ((b.kind !== 'video' && b.kind !== 'audio') || !b.mediaId) return null;
  let best: Clip | null = null;
  for (const tr of p.tracks)
    for (const a of tr.clips) {
      if (a.id === b.id || a.kind !== b.kind || a.mediaId !== b.mediaId) continue;
      if ((a.speed || 1) !== (b.speed || 1)) continue;
      if (Math.abs(clipEnd(a) - b.start) > 1e-3) continue;
      if (Math.abs(a.outP - b.inP) > EPS) continue;
      best = a;
    }
  return best;
}

export function planPreload(p: VideoProject, t: number, opts: PlanOptions = {}): PlanItem[] {
  const horizon = opts.horizon ?? 2;
  const lead = opts.lead ?? 0.15;
  const maxUp = opts.maxUpcoming ?? 4;
  const dur = projectDuration(p);
  const { visual, audible } = clipsAt(p, t, dur);
  const items = new Map<string, PlanItem>();
  const add = (c: Clip, patch: Partial<PlanItem>) => {
    const prev = items.get(c.id);
    const speed = c.speed || 1;
    const startsIn = c.start - t;
    const base: PlanItem = {
      clip: c,
      clipId: c.id,
      mediaId: c.mediaId!,
      kind: c.kind as 'video' | 'audio',
      startsIn,
      active: startsIn <= 0 && t < effectiveEnd(c, dur),
      visible: false,
      audible: false,
      seekTo: 0,
      play: false,
    };
    const it = { ...(prev ?? base), ...patch };
    if (it.active) {
      it.seekTo = Math.min(c.outP, Math.max(c.inP, sourceTimeAt(c, t)));
      it.play = true;
    } else {
      const lag = Math.min(lead, c.inP / speed);
      it.play = startsIn <= lag;
      // si ya debe correr, el punto exacto para llegar a inP justo al empezar; si no, el primer fotograma
      it.seekTo = it.play ? Math.max(0, c.inP - startsIn * speed) : c.inP;
    }
    items.set(c.id, it);
  };
  for (const v of visual) if (v.clip.kind === 'video' && v.clip.mediaId) add(v.clip, { visible: true });
  for (const a of audible) if (a.clip.mediaId) add(a.clip, { audible: true });

  const up: Clip[] = [];
  for (const tr of p.tracks)
    for (const c of tr.clips) {
      if ((c.kind !== 'video' && c.kind !== 'audio') || !c.mediaId || items.has(c.id)) continue;
      const startsIn = c.start - t;
      if (startsIn > 0 && startsIn <= horizon && clipDuration(c) > 0) up.push(c);
    }
  up.sort((x, y) => x.start - y.start);
  for (const c of up.slice(0, maxUp)) add(c, {});
  // quién continúa a quién (para reutilizar el elemento al cortar)
  for (const it of items.values()) {
    const c = findClipById(p, it.clipId);
    const prev = c ? continuesFrom(p, c) : null;
    if (prev) it.continuesFrom = prev.id;
  }
  return [...items.values()].sort((a, b) => a.startsIn - b.startsIn);
}

function findClipById(p: VideoProject, id: string): Clip | null {
  for (const tr of p.tracks) for (const c of tr.clips) if (c.id === id) return c;
  return null;
}

/** Corrección de deriva de un elemento respecto al reloj maestro: salto duro, ajuste fino de velocidad o nada. */
export function driftCorrection(diff: number, rate: number, opts: { hard?: number; soft?: number } = {}): { seekBy?: number; rate: number } {
  const hard = opts.hard ?? 0.25;
  const soft = opts.soft ?? 0.04;
  const ad = Math.abs(diff);
  if (ad > hard) return { seekBy: -diff, rate };
  // diff = elemento − deseado: adelantado (> 0) → frena un poco; atrasado → acelera un poco
  if (ad > soft) return { rate: rate * (diff > 0 ? 0.96 : 1.04) };
  return { rate };
}

/**
 * Qué elementos soltar: los que no están en el plan y llevan más de `grace` s sin usarse, y
 * además, si hay más de `max`, los menos recientes fuera del plan hasta quedar en `max`.
 */
export function pickReleases(have: { clipId: string; lastUsed: number }[], planned: Set<string>, max: number, now: number, grace = 1.5): string[] {
  const idle = have.filter((h) => !planned.has(h.clipId)).sort((a, b) => a.lastUsed - b.lastUsed);
  const out: string[] = [];
  let total = have.length;
  for (const h of idle) {
    if (total > max || now - h.lastUsed > grace) {
      out.push(h.clipId);
      total--;
    }
  }
  return out;
}
