// Aplicar una plantilla (puro): como proyecto nuevo o insertada en el cabezal. Cada una es UNA sola operación sobre el
// proyecto, así que en la interfaz es un único paso de deshacer.
import * as VM from '../model';
import { mainVideoTrack, splitAt, withNewTrack } from '../../ui/video/editing';
import type { VideoTemplate } from './templates';

/** Proyecto nuevo: el de la plantilla tal cual (el anterior se recupera con Ctrl+Z). */
export const applyAsProject = (tp: VM.VideoProject): VM.VideoProject => tp;

export interface InsertOptions {
  /** s de la línea de tiempo donde entra */
  at: number;
  /** meter el material de la pista de abajo en la pista principal y empujar lo que sigue (intro, cierre, cuenta) */
  ripple: boolean;
  newId?: () => string;
}

const EPS = 1e-6;

/**
 * Inserta el proyecto `tp` (de una plantilla) en `p` a partir de `at`.
 * - Los medios se añaden a la biblioteca.
 * - Con `ripple` y una pista principal: los clips que cruzan `at` se dividen, lo que sigue (en todas las pistas sin imán) se
 *   corre lo que dura la plantilla, y el material de su pista de abajo entra en la pista principal (`insert`: la pista con
 *   imán se reordena sola). Sin pista principal se crea una (con imán).
 * - El resto de las pistas de la plantilla (títulos, logos…) van como pistas nuevas encima, desplazadas a `at`.
 */
export function insertTemplate(p0: VM.VideoProject, tp: VM.VideoProject, o: InsertOptions): VM.VideoProject {
  const newId = o.newId ?? VM.uid;
  const at = Math.max(0, o.at);
  const dur = VM.projectDuration(tp);
  let p = p0;
  for (const m of Object.values(tp.media)) p = VM.addMedia(p, m);
  const tracks = tp.tracks;
  // la pista de abajo de la plantilla = su último track de video
  const baseIdx = o.ripple ? (() => { for (let i = tracks.length - 1; i >= 0; i--) if (tracks[i].kind === 'video') return i; return -1; })() : -1;

  if (o.ripple && baseIdx >= 0) {
    // 1) dividir lo que cruza el cabezal y 2) correr lo posterior de las pistas sin imán
    p = splitAt(p, [], at, newId).p;
    const main = mainVideoTrack(p);
    const shift: string[] = [];
    for (const t of p.tracks) {
      if (t.magnet || t.locked || (main && t.id === main.id)) continue;
      for (const c of t.clips) if (c.start >= at - EPS) shift.push(c.id);
    }
    // de derecha a izquierda para que no se empujen entre sí
    for (const id of shift.sort((a, b) => (VM.findClip(p, b)?.clip.start ?? 0) - (VM.findClip(p, a)?.clip.start ?? 0))) {
      const loc = VM.findClip(p, id);
      if (loc) p = VM.moveClip(p, id, { start: loc.clip.start + dur });
    }
    // 3) el fondo de la plantilla entra en la pista principal
    let mainId = main?.id;
    if (!mainId) {
      const nt = withNewTrack(p, 'video', undefined, true);
      p = nt.p;
      mainId = nt.id;
    }
    for (const c of tracks[baseIdx].clips) p = VM.addClip(p, mainId, { ...c, start: at + c.start }, { mode: 'insert' });
  }

  // el resto de pistas: nuevas, encima (las de video/subtítulos) o al final (audio), en el mismo orden relativo
  const rest = tracks.filter((_, i) => i !== baseIdx);
  const above = rest.filter((t) => t.kind !== 'audio');
  const below = rest.filter((t) => t.kind === 'audio');
  const place = (t: VM.Track, index: number) => {
    p = VM.addTrack(p, t.kind, { id: newId(), name: t.name, index, magnet: false, ...(t.subStyle ? { subStyle: t.subStyle } : {}) });
    const id = p.tracks[Math.max(0, Math.min(p.tracks.length - 1, index))].id;
    for (const c of t.clips) p = VM.addClip(p, id, { ...c, id: newId(), start: at + c.start });
  };
  above.forEach((t, i) => place(t, i));
  below.forEach((t) => place(t, p.tracks.length));
  return p;
}

/** Cómo se aplica: proyecto nuevo, o insertada (solo las que lo permiten). */
export function applyTemplate(p: VM.VideoProject, t: VideoTemplate, tp: VM.VideoProject, how: 'project' | 'insert', at: number, newId?: () => string): VM.VideoProject {
  if (how === 'insert' && t.insertable) return insertTemplate(p, tp, { at, ripple: t.ripple, newId });
  return applyAsProject(tp);
}
