// Órdenes de edición de la línea de tiempo, puras: componen las operaciones del
// modelo (src/video/model) para actuar sobre varios clips a la vez. Devuelven un
// proyecto nuevo (o el mismo si no aplican) y, cuando crean clips, sus ids.
import * as VM from '../../video/model';
import { DEFAULT_TITLE_STYLE } from '../../video/title/style';
import { splitCueAtTime } from '../../video/title/subtitles';
import { applyPreset, type TitlePair, type TitlePreset } from '../../video/title/presets';

export interface Result {
  p: VM.VideoProject;
  /** clips creados (para seleccionarlos) */
  ids: string[];
}

const startOf = (p: VM.VideoProject, id: string) => VM.findClip(p, id)?.clip.start ?? 0;

/** Los ids que existen, ordenados por inicio. */
export function existingSorted(p: VM.VideoProject, ids: readonly string[]): string[] {
  return ids.filter((id) => VM.findClip(p, id)).sort((a, b) => startOf(p, a) - startOf(p, b));
}

/**
 * Mueve clips `dt` segundos. Con un solo clip puede cambiar de pista (`trackId`).
 * Se procesan de derecha a izquierda al ir hacia delante (y al revés), para que los
 * propios clips movidos no se empujen entre sí.
 */
export function moveClips(p: VM.VideoProject, ids: readonly string[], dt: number, trackId?: string): VM.VideoProject {
  const order = existingSorted(p, ids);
  if (!order.length) return p;
  if (dt > 0) order.reverse();
  const base = new Map(order.map((id) => [id, startOf(p, id)]));
  let out = p;
  for (const id of order) {
    const to: { start: number; trackId?: string } = { start: Math.max(0, base.get(id)! + dt) };
    if (order.length === 1 && trackId) to.trackId = trackId;
    out = VM.moveClip(out, id, to);
  }
  return out;
}

/** Elimina clips. Con `ripple`, lo posterior de cada pista se cierra (de derecha a izquierda para que los desplazamientos no se acumulen mal). */
export function deleteClips(p: VM.VideoProject, ids: readonly string[], ripple = false): VM.VideoProject {
  const order = existingSorted(p, ids).reverse();
  let out = p;
  for (const id of order) out = VM.removeClip(out, id, { ripple });
  return out;
}

/** Clips que cruza el instante t (en pistas no bloqueadas), con el margen de corte del modelo. */
export function clipsUnder(p: VM.VideoProject, t: number): string[] {
  const out: string[] = [];
  const dur = VM.projectDuration(p);
  for (const tr of p.tracks) {
    if (tr.locked) continue;
    for (const c of tr.clips) if (t > c.start + VM.SPLIT_MARGIN && t < VM.effectiveEnd(c, dur) - VM.SPLIT_MARGIN) out.push(c.id);
  }
  return out;
}

/** Divide en t los clips indicados (o, si no hay ninguno, todos los que cruza el cabezal). */
export function splitAt(p: VM.VideoProject, ids: readonly string[], t: number, newId: () => string = VM.uid): Result {
  const targets = ids.length ? ids.filter((id) => VM.findClip(p, id)) : clipsUnder(p, t);
  let out = p;
  const created: string[] = [];
  for (const id of targets) {
    const nid = newId();
    const sub = VM.findClip(out, id)?.clip.kind === 'subtitle';
    const next = sub ? splitCueAtTime(out, id, t, nid).p : VM.splitClip(out, id, t, nid);
    if (next !== out) created.push(nid);
    out = next;
  }
  return { p: out, ids: created };
}

/** Duplica clips (cada copia va justo detrás de su original). De derecha a izquierda. */
export function duplicateClips(p: VM.VideoProject, ids: readonly string[], newId: () => string = VM.uid): Result {
  let out = p;
  const created: string[] = [];
  for (const id of existingSorted(p, ids).reverse()) {
    const nid = newId();
    const next = VM.duplicateClip(out, id, nid);
    if (next !== out) created.push(nid);
    out = next;
  }
  return { p: out, ids: created };
}

// ---------- portapapeles ----------
export interface ClipboardItem {
  clip: VM.Clip;
  trackId: string;
  kind: VM.TrackKind;
  /** s desde el inicio del primer clip copiado */
  offset: number;
}

/** Copia clips (sin `toEnd`: se fija a la duración que tenían en pantalla). */
export function copyClips(p: VM.VideoProject, ids: readonly string[]): ClipboardItem[] {
  const order = existingSorted(p, ids);
  if (!order.length) return [];
  const dur = VM.projectDuration(p);
  const first = startOf(p, order[0]);
  return order.map((id) => {
    const loc = VM.findClip(p, id)!;
    const { toEnd: _t, ...c } = loc.clip;
    const clip: VM.Clip = loc.clip.toEnd ? { ...c, inP: 0, outP: Math.max(0.05, VM.effectiveEnd(loc.clip, dur) - loc.clip.start) } : { ...c };
    return { clip, trackId: loc.track.id, kind: loc.track.kind, offset: loc.clip.start - first };
  });
}

/**
 * Pega en t. Cada clip vuelve a su pista de origen si existe y no está bloqueada;
 * si no, a la primera pista compatible libre; si no hay, se crea una pista.
 */
export function pasteClips(p: VM.VideoProject, items: readonly ClipboardItem[], t: number, newId: () => string = VM.uid): Result {
  let out = p;
  const created: string[] = [];
  for (const it of items) {
    const kindOk = (tr: VM.Track) => tr.kind === it.kind && !tr.locked;
    let dest = out.tracks.find((tr) => tr.id === it.trackId && kindOk(tr)) ?? out.tracks.find(kindOk);
    if (!dest) {
      const id = VM.uid();
      out = VM.addTrack(out, it.kind, it.kind === 'subtitle' ? { id, name: 'Subtítulos' } : { id, name: it.kind === 'audio' ? 'Audio' : 'Video', index: it.kind === 'video' ? 0 : out.tracks.length });
      dest = VM.findTrack(out, id)!;
    }
    const clip: VM.Clip = { ...it.clip, id: newId(), start: Math.max(0, t + it.offset) };
    out = VM.addClip(out, dest.id, clip);
    created.push(clip.id);
  }
  return { p: out, ids: created };
}

// ---------- colocar medios ----------
export interface MediaInfo {
  id: string;
  kind: VM.MediaKind;
  duration: number;
}

const stillSeconds = 5;

/** ¿Cabe [s, s+d) en la pista sin tocar a otro clip? */
function freeAt(tr: VM.Track, s: number, d: number): boolean {
  return !tr.clips.some((c) => c.start < s + d && VM.clipEnd(c) > s);
}

/** Nueva pista del tipo adecuado: las de video van arriba de todo; las de audio, al final. */
export function withNewTrack(p: VM.VideoProject, kind: VM.TrackKind, name?: string, magnet = false): { p: VM.VideoProject; id: string } {
  const id = VM.uid();
  const firstAudio = p.tracks.findIndex((t) => t.kind === 'audio');
  const index = kind === 'video' ? 0 : kind === 'subtitle' ? (firstAudio < 0 ? p.tracks.length : firstAudio) : p.tracks.length;
  const n = name ?? (kind === 'subtitle' ? (p.tracks.some((t) => t.kind === 'subtitle') ? `Subtítulos ${p.tracks.filter((t) => t.kind === 'subtitle').length + 1}` : 'Subtítulos') : kind === 'video' ? (p.tracks.some((t) => t.kind === 'video') ? `Video ${p.tracks.filter((t) => t.kind === 'video').length + 1}` : 'Video') : p.tracks.some((t) => t.kind === 'audio') ? `Audio ${p.tracks.filter((t) => t.kind === 'audio').length + 1}` : 'Audio');
  return { p: VM.addTrack(p, kind, { id, index, name: n, magnet }), id };
}

/** Pista principal de video: la de abajo (última de video). */
export const mainVideoTrack = (p: VM.VideoProject): VM.Track | undefined => [...p.tracks].reverse().find((t) => t.kind === 'video');

/**
 * Añade un medio como clip.
 * - `trackId` + `at`: en esa pista (si es de su tipo y no está bloqueada) a partir de `at`.
 * - Sin pista: al final de la pista principal (video/imagen) o de la primera de audio; si no existe, se crea
 *   (la primera pista de video nace con imán, como la secuencia de V1).
 * - Si la pista elegida no es de su tipo, o está bloqueada, se crea una nueva.
 */
export function placeMedia(p: VM.VideoProject, m: MediaInfo, o: { trackId?: string; at?: number; name?: string; clipId?: string } = {}): { p: VM.VideoProject; clipId: string; trackId: string } {
  const clipKind: VM.ClipKind = m.kind;
  const trackKind: VM.TrackKind = m.kind === 'audio' ? 'audio' : 'video';
  const still = m.kind === 'image';
  const len = still ? stillSeconds : Math.max(m.duration, 0.1);
  const clip = VM.makeClip(clipKind, {
    id: o.clipId,
    mediaId: m.id,
    name: o.name,
    inP: 0,
    outP: len,
  });
  let out = p;
  let tr = o.trackId ? out.tracks.find((t) => t.id === o.trackId) : undefined;
  if (tr && (tr.kind !== trackKind || tr.locked)) tr = undefined;
  let at = o.at;
  if (!tr && o.trackId === undefined) {
    // sin pista pedida: pista principal / primera de audio
    tr = trackKind === 'video' ? mainVideoTrack(out) : out.tracks.find((t) => t.kind === 'audio');
    if (tr?.locked) tr = undefined;
    if (tr && at === undefined) at = VM.trackEnd(tr);
    if (tr && at !== undefined && !tr.magnet && !freeAt(tr, at, len)) at = VM.trackEnd(tr);
  }
  if (!tr) {
    const first = !out.tracks.some((t) => t.kind === trackKind);
    const nt = withNewTrack(out, trackKind, undefined, first && trackKind === 'video');
    out = nt.p;
    tr = VM.findTrack(out, nt.id)!;
  }
  const start = Math.max(0, at ?? 0);
  out = VM.addClip(out, tr.id, { ...clip, start });
  return { p: out, clipId: clip.id, trackId: tr.id };
}

/** Clip de texto (con estilo propio, V4) en una pista nueva encima de todo, en t. */
export function addTextClip(p: VM.VideoProject, t: number, text = 'Texto'): { p: VM.VideoProject; clipId: string } {
  const nt = withNewTrack(p, 'video', 'Texto');
  const clip = VM.makeClip('text', {
    text,
    color: '#ffffff',
    size: 60,
    start: Math.max(0, t),
    outP: stillSeconds,
    tstyle: { ...DEFAULT_TITLE_STYLE },
    anim: { in: 'fade', out: 'fade', inDur: 0.4, outDur: 0.4 },
    transform: { ...VM.IDENTITY_TRANSFORM, x: 0.5, y: 0.5 },
  });
  return { p: VM.addClip(nt.p, nt.id, clip), clipId: clip.id };
}

/** Título con un preajuste en una pista nueva encima de todo, en t (5 s, o lo que dure la entrada y la salida más 2 s). */
export function addTitleClip(p: VM.VideoProject, t: number, preset: TitlePreset): { p: VM.VideoProject; clipId: string } {
  const nt = withNewTrack(p, 'video', preset.category === 'Tercios inferiores' ? 'Tercio inferior' : 'Título');
  const base = VM.makeClip('text', { text: preset.text, color: '#ffffff', size: 60, start: Math.max(0, t), outP: stillSeconds, transform: { ...VM.IDENTITY_TRANSFORM } });
  const clip = applyPreset(base, preset);
  return { p: VM.addClip(nt.p, nt.id, clip), clipId: clip.id };
}

/** Par de fuentes: título y cuerpo en dos pistas nuevas. */
export function addTitlePair(p: VM.VideoProject, t: number, pair: TitlePair): { p: VM.VideoProject; ids: string[] } {
  let out = p;
  const ids: string[] = [];
  for (const [part, name] of [[pair.body, 'Cuerpo'], [pair.title, 'Título']] as const) {
    const nt = withNewTrack(out, 'video', name);
    const clip = VM.makeClip('text', {
      text: part.text,
      color: '#ffffff',
      size: 60,
      start: Math.max(0, t),
      outP: stillSeconds,
      tstyle: { ...part.style },
      anim: { in: 'fade', out: 'fade', inDur: 0.4, outDur: 0.4 },
      transform: { ...VM.IDENTITY_TRANSFORM, y: part.y },
    });
    out = VM.addClip(nt.p, nt.id, clip);
    ids.push(clip.id);
  }
  return { p: out, ids };
}

/** Aplica un preajuste a un texto que ya está en la línea de tiempo (conserva su texto, tiempos y posición). */
export function applyTitlePreset(p: VM.VideoProject, clipId: string, preset: TitlePreset): VM.VideoProject {
  const loc = VM.findClip(p, clipId);
  if (!loc || loc.clip.kind !== 'text') return p;
  const next = applyPreset(loc.clip, preset, { keepText: true, keepPosition: true });
  return VM.updateClip(p, clipId, { tstyle: next.tstyle, anim: next.anim });
}

/** Tiempo de un clip (en la línea de tiempo) de la unión de los seleccionados: [inicio, fin]. */
export function selectionSpan(p: VM.VideoProject, ids: readonly string[]): { start: number; end: number } | null {
  const dur = VM.projectDuration(p);
  let s = Infinity;
  let e = -Infinity;
  for (const id of ids) {
    const loc = VM.findClip(p, id);
    if (!loc) continue;
    s = Math.min(s, loc.clip.start);
    e = Math.max(e, VM.effectiveEnd(loc.clip, dur));
  }
  return s === Infinity ? null : { start: s, end: e };
}
