// Migración del proyecto de video guardado por V1 (clave `videoProject`) al modelo v2.
//
// V1 = { clips: [{type:'video'|'audio', blob, inP, outP, speed, effect, volume, fadeIn, fadeOut, …}],
//        overlays: [{kind:'text'|'image', text, color, size, xf, yf, start, end, blob?}], eq, normalize }
// con 1 pista de video en secuencia desde 0, 1 de audio en secuencia desde 0 y las capas encima.
//
// Reglas: NO muta la entrada; los Blob se reutilizan (no se copian); ids deterministas
// (migrar dos veces da lo mismo); lo que V1 no podía usar (clips sin archivo, tipos
// desconocidos) se guarda en `legacy` en vez de perderse; números inválidos se reparan
// y se anotan en el informe. La imagen y el sonido resultantes son los mismos que V1.
import { sanitizeBlend, sanitizeFxList, sanitizeKeys, sanitizeTransition } from '../fx/sanitize';
import { IDENTITY_TRANSFORM, VIDEO_PROJECT_VERSION, type Clip, type ClipKind, type MediaAsset, type MediaKind, type Track, type Transform, type VideoProject } from './types';
import { createProject, createTrack, normalizeTrack } from './ops';
import { clipEnd } from './query';
import { DEFAULT_SUBTITLE_STYLE, sanitizeAnim, sanitizeSubtitleStyle, sanitizeTitleStyle, sanitizeWords } from '../title/style';

export type StoredVersion = 'empty' | 1 | 2 | 'future' | 'unknown';

export interface MigrationReport {
  from: StoredVersion;
  v1Clips: number;
  v1Overlays: number;
  clips: number;
  overlays: number;
  orphanClips: number;
  orphanOverlays: number;
  /** campos reparados (valor inválido → valor por defecto) */
  repaired: string[];
  /** todos los clips y capas del original están en el proyecto o en `legacy` */
  complete: boolean;
}

/** «Hasta el final» en V1: las capas nuevas se creaban con end = 9999. */
export const V1_END_SENTINEL = 9000;
/** V1 mostraba la capa también en t = end (inclusivo); v2 es [inicio, fin): se suma esto. */
export const V1_INCLUSIVE_EPS = 1e-6;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isBlobLike = (b: unknown): b is Blob => isObj(b) && typeof (b as unknown as Blob).size === 'number' && typeof (b as unknown as Blob).slice === 'function';
/** número válido (se admite +Infinity: V1 guardaba así la duración de las grabaciones WebM) */
const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);
const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function detectVersion(raw: unknown): StoredVersion {
  if (raw === null || raw === undefined) return 'empty';
  if (!isObj(raw)) return 'unknown';
  if (raw.v === VIDEO_PROJECT_VERSION) return 2;
  if (typeof raw.v === 'number' && raw.v > VIDEO_PROJECT_VERSION) return 'future';
  if (raw.v === undefined && (Array.isArray(raw.clips) || Array.isArray(raw.overlays) || 'eq' in raw || 'normalize' in raw)) return 1;
  return 'unknown';
}

function sanitizeEq(eq: unknown): VideoProject['eq'] {
  const e = isObj(eq) ? eq : {};
  return { low: isFin(e.low) ? e.low : 0, mid: isFin(e.mid) ? e.mid : 0, high: isFin(e.high) ? e.high : 0 };
}

// ---------------- núcleo común: secuencia V1 → pistas v2 ----------------

export interface SeqOverlay {
  clip: Clip; // kind text/image, sin tiempos
  start: number;
  end: number;
}

/**
 * Coloca como V1: video en secuencia desde 0, audio en secuencia desde 0 y cada capa
 * en su propia pista encima del video (la última capa, arriba del todo). Lo usan la
 * migración y la API antigua del motor (`renderVideo`), así que el resultado es el mismo.
 */
export function sequenceToProject(input: {
  media: Record<string, MediaAsset>;
  video: Clip[];
  audio: Clip[];
  overlays: SeqOverlay[];
  eq: VideoProject['eq'];
  normalize: boolean;
  ids?: { video: string; audio: string; overlay: (i: number) => string };
}): VideoProject {
  const ids = input.ids ?? { video: 'v1-video', audio: 'v1-audio', overlay: (i: number) => `v1-ov-${i}` };
  const seq = (clips: Clip[]) => {
    const out: Clip[] = [];
    let at = 0;
    for (const c of clips) {
      const n = { ...c, start: at };
      out.push(n);
      at = clipEnd(n);
    }
    return out;
  };
  const video = seq(input.video);
  const videoEnd = video.length ? clipEnd(video[video.length - 1]) : 0;
  const overlayTracks: Track[] = input.overlays.map((o, i) => {
    const start = o.start;
    const end = o.end;
    let clip: Clip;
    if (end >= V1_END_SENTINEL || (videoEnd > 0 && end >= videoEnd)) {
      // hasta el final: se guarda la longitud original (no se pierde) pero manda el final del proyecto
      clip = { ...o.clip, start, inP: 0, outP: Math.max(0, end - start), toEnd: true };
    } else {
      clip = { ...o.clip, start, inP: 0, outP: end >= start ? end - start + V1_INCLUSIVE_EPS : 0 };
    }
    return normalizeTrack(createTrack('video', { id: ids.overlay(i), name: o.clip.kind === 'text' ? 'Texto' : 'Imagen', clips: [clip] }));
  });
  overlayTracks.reverse(); // la última capa de V1 se dibujaba encima
  const main = normalizeTrack(createTrack('video', { id: ids.video, name: 'Video', magnet: true, clips: video }));
  const audio = normalizeTrack(createTrack('audio', { id: ids.audio, name: 'Audio', magnet: true, clips: seq(input.audio) }));
  return { v: VIDEO_PROJECT_VERSION, media: input.media, tracks: [...overlayTracks, main, audio], eq: input.eq, normalize: input.normalize };
}

// ---------------- V1 → v2 ----------------

function migrateV1(raw: Record<string, unknown>): { project: VideoProject; report: MigrationReport } {
  const repaired: string[] = [];
  const rawClips = Array.isArray(raw.clips) ? raw.clips : [];
  const rawOverlays = Array.isArray(raw.overlays) ? raw.overlays : [];
  const media: Record<string, MediaAsset> = {};
  const byBlob = new Map<Blob, string>();
  const usedIds = new Set<string>();
  const uniqueId = (want: unknown, fallback: string) => {
    let id = typeof want === 'string' && want ? want : fallback;
    if (usedIds.has(id)) {
      let k = 2;
      while (usedIds.has(`${id}~${k}`)) k++;
      id = `${id}~${k}`;
    }
    usedIds.add(id);
    return id;
  };
  const mediaFor = (blob: Blob, kind: MediaKind, name: string, duration: number, thumb: unknown, clipId: string) => {
    const known = byBlob.get(blob);
    if (known) return known;
    const id = `m-${clipId}`;
    media[id] = { id, kind, name, duration, blob, ...(typeof thumb === 'string' && thumb ? { thumb } : {}) };
    byBlob.set(blob, id);
    return id;
  };

  const orphanClips: unknown[] = [];
  const video: Clip[] = [];
  const audio: Clip[] = [];
  rawClips.forEach((rc, i) => {
    if (!isObj(rc) || (rc.type !== 'video' && rc.type !== 'audio') || !isBlobLike(rc.blob)) {
      // V1 tampoco podía usarlos (sin archivo o tipo desconocido): se conservan aparte.
      orphanClips.push(isObj(rc) ? { ...rc, url: '' } : rc);
      return;
    }
    const id = uniqueId(rc.id, `v1c-${i}`);
    const fix = (field: string, ok: boolean) => !ok && repaired.push(`clip ${id}: ${field}`);
    const inP = isFin(rc.inP) && rc.inP >= 0 ? rc.inP : 0;
    fix('inP', isFin(rc.inP) && rc.inP >= 0);
    const duration = isNum(rc.duration) && rc.duration >= 0 ? rc.duration : 0;
    fix('duration', isNum(rc.duration) && rc.duration >= 0);
    let outP: number;
    if (isNum(rc.outP) && rc.outP >= inP) outP = rc.outP;
    else {
      outP = duration > inP ? duration : inP;
      repaired.push(`clip ${id}: outP`);
    }
    const speed = isFin(rc.speed) && rc.speed > 0 ? rc.speed : 1;
    fix('speed', rc.speed === undefined || (isFin(rc.speed) && rc.speed > 0));
    const volume = isFin(rc.volume) && rc.volume >= 0 ? rc.volume : 1;
    fix('volume', isFin(rc.volume) && rc.volume >= 0);
    const fade = (v: unknown) => (isFin(v) && v > 0 ? v : 0);
    const kind: ClipKind = rc.type;
    const name = typeof rc.name === 'string' ? rc.name : '';
    const clip: Clip = {
      id,
      kind,
      mediaId: mediaFor(rc.blob, kind, name, duration, rc.thumb, id),
      name,
      start: 0,
      inP,
      outP,
      speed,
      volume,
      effect: typeof rc.effect === 'string' ? rc.effect : 'none',
      // V1: el fundido era solo de imagen (a negro); el sonido no se fundía.
      fadeIn: fade(rc.fadeIn),
      fadeOut: fade(rc.fadeOut),
      audioFadeIn: 0,
      audioFadeOut: 0,
      transform: { ...IDENTITY_TRANSFORM },
    };
    (kind === 'video' ? video : audio).push(clip);
  });

  const orphanOverlays: unknown[] = [];
  const overlays: SeqOverlay[] = [];
  rawOverlays.forEach((ro, i) => {
    if (!isObj(ro) || (ro.kind !== 'text' && ro.kind !== 'image')) {
      orphanOverlays.push(isObj(ro) ? { ...ro, img: undefined, src: undefined } : ro);
      return;
    }
    const id = uniqueId(ro.id, `v1o-${i}`);
    const kind = ro.kind;
    const size = isFin(ro.size) && ro.size > 0 ? ro.size : kind === 'text' ? 60 : 0.3;
    if (!(isFin(ro.size) && ro.size > 0)) repaired.push(`capa ${id}: size`);
    const start = isFin(ro.start) && ro.start >= 0 ? ro.start : 0;
    if (!(isFin(ro.start) && ro.start >= 0)) repaired.push(`capa ${id}: start`);
    const end = isNum(ro.end) ? ro.end : 9999;
    if (!isNum(ro.end)) repaired.push(`capa ${id}: end`);
    const transform: Transform = { ...IDENTITY_TRANSFORM, x: isFin(ro.xf) ? ro.xf : 0.5, y: isFin(ro.yf) ? ro.yf : 0.5 };
    let mediaId: string | undefined;
    if (kind === 'image') {
      if (isBlobLike(ro.blob)) mediaId = mediaFor(ro.blob, 'image', 'Imagen', 0, undefined, id);
      else {
        // V1 conservaba la capa pero sin imagen (no se veía): igual aquí.
        mediaId = `m-${id}`;
        media[mediaId] = { id: mediaId, kind: 'image', name: 'Imagen', duration: 0, missing: true };
      }
    }
    const clip: Clip = {
      id,
      kind,
      ...(mediaId ? { mediaId } : {}),
      start: 0,
      inP: 0,
      outP: 0,
      speed: 1,
      volume: 1,
      effect: 'none',
      fadeIn: 0,
      fadeOut: 0,
      audioFadeIn: 0,
      audioFadeOut: 0,
      transform,
      size,
      ...(kind === 'text' ? { text: typeof ro.text === 'string' ? ro.text : String(ro.text ?? ''), color: typeof ro.color === 'string' ? ro.color : '#ffffff' } : {}),
    };
    overlays.push({ clip, start, end });
  });

  const project = sequenceToProject({ media, video, audio, overlays, eq: sanitizeEq(raw.eq), normalize: raw.normalize === true });
  if (orphanClips.length || orphanOverlays.length)
    project.legacy = { from: 1, ...(orphanClips.length ? { orphanClips } : {}), ...(orphanOverlays.length ? { orphanOverlays } : {}) };
  const clips = video.length + audio.length;
  return {
    project,
    report: {
      from: 1,
      v1Clips: rawClips.length,
      v1Overlays: rawOverlays.length,
      clips,
      overlays: overlays.length,
      orphanClips: orphanClips.length,
      orphanOverlays: orphanOverlays.length,
      repaired,
      complete: clips + orphanClips.length === rawClips.length && overlays.length + orphanOverlays.length === rawOverlays.length,
    },
  };
}

// ---------------- v2 tolerante ----------------

const CLIP_KINDS: ClipKind[] = ['video', 'audio', 'image', 'text', 'subtitle', 'adjust'];
const MEDIA_KINDS: MediaKind[] = ['video', 'audio', 'image'];

/** Lee un v2 guardado rellenando lo que falte. No muta la entrada; descarta las URL (son de otra sesión). */
export function normalizeV2(raw: Record<string, unknown>): VideoProject {
  const p = createProject();
  const orphanClips: unknown[] = [];
  if (isObj(raw.media))
    for (const [key, rm] of Object.entries(raw.media)) {
      if (!isObj(rm)) continue;
      const id = typeof rm.id === 'string' && rm.id ? rm.id : key;
      const m: MediaAsset = {
        id,
        kind: MEDIA_KINDS.includes(rm.kind as MediaKind) ? (rm.kind as MediaKind) : 'video',
        name: typeof rm.name === 'string' ? rm.name : '',
        duration: isNum(rm.duration) && rm.duration >= 0 ? rm.duration : 0,
      };
      if (isBlobLike(rm.blob)) m.blob = rm.blob;
      if (typeof rm.thumb === 'string' && rm.thumb) m.thumb = rm.thumb;
      if (!m.blob) m.missing = true;
      p.media[id] = m;
    }
  const seen = new Set<string>();
  const rawTracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  rawTracks.forEach((rt, ti) => {
    if (!isObj(rt)) return;
    const kind = rt.kind === 'audio' ? 'audio' : rt.kind === 'subtitle' ? 'subtitle' : 'video';
    let tid = typeof rt.id === 'string' && rt.id ? rt.id : `t-${ti}`;
    while (p.tracks.some((t) => t.id === tid)) tid += '~';
    const clips: Clip[] = [];
    (Array.isArray(rt.clips) ? rt.clips : []).forEach((rc, ci) => {
      if (!isObj(rc) || !CLIP_KINDS.includes(rc.kind as ClipKind) || (rc.kind === 'audio') !== (kind === 'audio') || (rc.kind === 'subtitle') !== (kind === 'subtitle')) {
        orphanClips.push(rc);
        return;
      }
      let id = typeof rc.id === 'string' && rc.id ? rc.id : `c-${ti}-${ci}`;
      while (seen.has(id)) id += '~';
      seen.add(id);
      const ck = rc.kind as ClipKind;
      const still = ck === 'image' || ck === 'text' || ck === 'subtitle' || ck === 'adjust';
      const rtr = isObj(rc.transform) ? rc.transform : {};
      const trn = (k: keyof Transform) => (isFin(rtr[k]) ? (rtr[k] as number) : IDENTITY_TRANSFORM[k]);
      const inP = isFin(rc.inP) && rc.inP >= 0 ? rc.inP : 0;
      const c: Clip = {
        id,
        kind: ck,
        start: isFin(rc.start) && rc.start >= 0 ? rc.start : 0,
        inP,
        outP: isNum(rc.outP) && rc.outP >= inP ? rc.outP : inP,
        speed: still ? 1 : isFin(rc.speed) && rc.speed > 0 ? rc.speed : 1,
        volume: isFin(rc.volume) && rc.volume >= 0 ? rc.volume : 1,
        effect: typeof rc.effect === 'string' ? rc.effect : 'none',
        fadeIn: isFin(rc.fadeIn) && rc.fadeIn > 0 ? rc.fadeIn : 0,
        fadeOut: isFin(rc.fadeOut) && rc.fadeOut > 0 ? rc.fadeOut : 0,
        audioFadeIn: isFin(rc.audioFadeIn) && rc.audioFadeIn > 0 ? rc.audioFadeIn : 0,
        audioFadeOut: isFin(rc.audioFadeOut) && rc.audioFadeOut > 0 ? rc.audioFadeOut : 0,
        transform: { x: trn('x'), y: trn('y'), scale: trn('scale'), rotation: trn('rotation'), opacity: Math.max(0, Math.min(1, trn('opacity'))) },
      };
      if (typeof rc.mediaId === 'string') c.mediaId = rc.mediaId;
      if (typeof rc.name === 'string') c.name = rc.name;
      if (isObj(rc.voice) && isFin(rc.voice.hp) && isFin(rc.voice.lp) && isFin(rc.voice.echo))
        c.voice = { hp: rc.voice.hp, lp: rc.voice.lp, echo: rc.voice.echo, gate: rc.voice.gate === true };
      if (isFin(rc.size)) c.size = rc.size;
      if (typeof rc.text === 'string') c.text = rc.text;
      if (typeof rc.color === 'string') c.color = rc.color;
      if (rc.toEnd === true) c.toEnd = true;
      const ts = sanitizeTitleStyle(rc.tstyle);
      if (ts && ck === 'text') c.tstyle = ts;
      const an = sanitizeAnim(rc.anim);
      if (an && ck !== 'subtitle') c.anim = an;
      const wd = sanitizeWords(rc.words);
      if (wd && (ck === 'text' || ck === 'subtitle')) c.words = wd;
      // V6 (todo opcional): transiciones, pila de efectos, fusión y fotogramas clave
      if (ck !== 'audio' && ck !== 'subtitle') {
        const tin = sanitizeTransition(rc.tin);
        if (tin) c.tin = tin;
        const tout = sanitizeTransition(rc.tout);
        if (tout) c.tout = tout;
        const fxl = sanitizeFxList(rc.fx);
        if (fxl) c.fx = fxl;
        const bl = sanitizeBlend(rc.blend);
        if (bl && ck !== 'adjust') c.blend = bl;
      }
      if (ck !== 'subtitle') {
        const ks = sanitizeKeys(rc.keys);
        if (ks) c.keys = ks;
      }
      clips.push(c);
    });
    const subStyle = kind === 'subtitle' ? (sanitizeSubtitleStyle(rt.subStyle) ?? { ...DEFAULT_SUBTITLE_STYLE, style: { ...DEFAULT_SUBTITLE_STYLE.style } }) : undefined;
    p.tracks.push(
      normalizeTrack({
        id: tid,
        kind,
        name: typeof rt.name === 'string' ? rt.name : kind === 'video' ? 'Video' : kind === 'subtitle' ? 'Subtítulos' : 'Audio',
        ...(subStyle ? { subStyle } : {}),
        muted: rt.muted === true,
        locked: rt.locked === true,
        hidden: rt.hidden === true,
        magnet: rt.magnet === true,
        clips,
      }),
    );
  });
  p.eq = sanitizeEq(raw.eq);
  p.normalize = raw.normalize === true;
  const legacy = isObj(raw.legacy) ? raw.legacy : null;
  const keepOrphans = [...(legacy && Array.isArray(legacy.orphanClips) ? legacy.orphanClips : []), ...orphanClips];
  const keepOverlays = legacy && Array.isArray(legacy.orphanOverlays) ? legacy.orphanOverlays : [];
  if (keepOrphans.length || keepOverlays.length)
    p.legacy = { from: 1, ...(keepOrphans.length ? { orphanClips: keepOrphans } : {}), ...(keepOverlays.length ? { orphanOverlays: keepOverlays } : {}) };
  return p;
}

/**
 * Convierte cualquier proyecto guardado a v2. Idempotente: un v2 se devuelve
 * normalizado (mismo contenido). Una versión futura o un valor irreconocible
 * dan un proyecto vacío con `complete: false` (quien guarda NO debe pisarlos).
 */
export function migrateVideoProject(raw: unknown): { project: VideoProject; report: MigrationReport } {
  const from = detectVersion(raw);
  const empty = (complete: boolean): { project: VideoProject; report: MigrationReport } => ({
    project: createProject(),
    report: { from, v1Clips: 0, v1Overlays: 0, clips: 0, overlays: 0, orphanClips: 0, orphanOverlays: 0, repaired: [], complete },
  });
  if (from === 1) return migrateV1(raw as Record<string, unknown>);
  if (from === 2) {
    const project = normalizeV2(raw as Record<string, unknown>);
    let clips = 0;
    for (const t of project.tracks) clips += t.clips.length;
    return { project, report: { from, v1Clips: 0, v1Overlays: 0, clips, overlays: 0, orphanClips: project.legacy?.orphanClips?.length ?? 0, orphanOverlays: 0, repaired: [], complete: true } };
  }
  return empty(from === 'empty');
}

/** Copia para guardar: sin URLs de objeto y sin medios que ya no usa ningún clip. */
export function serializeProject(p: VideoProject): VideoProject {
  const used = new Set<string>();
  for (const t of p.tracks) for (const c of t.clips) if (c.mediaId) used.add(c.mediaId);
  const media: Record<string, MediaAsset> = {};
  for (const [id, m] of Object.entries(p.media)) {
    if (!used.has(id)) continue;
    const { url: _url, ...rest } = m;
    media[id] = rest;
  }
  return { ...p, media, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, transform: { ...c.transform } })) })) };
}

