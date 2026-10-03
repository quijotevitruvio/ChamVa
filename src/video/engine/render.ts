// Motor de exportación de video: proyecto multipista (modelo v2) → MP4 (H.264 +
// AAC/Opus) o WebM (VP9/VP8 + Opus), fotograma a fotograma y en streaming:
//
//   archivo ─(lectura por trozos)→ VideoDecoder/AudioDecoder → lienzo por capas + mezclador
//          → VideoEncoder/AudioEncoder → mp4-muxer/webm-muxer → destino por trozos
//
// Nada se carga entero en memoria: ni los archivos de entrada, ni el audio de
// toda la duración, ni el archivo de salida. Se puede cancelar con AbortSignal.
// `renderVideo` (API de V1: 1 pista de video + 1 de audio + capas) se traduce al
// modelo v2 con la misma colocación que la migración y pasa por el mismo camino.
import { Muxer as Mp4Muxer, StreamTarget as Mp4StreamTarget } from 'mp4-muxer';
import { Muxer as WebmMuxer, StreamTarget as WebmStreamTarget } from 'webm-muxer';
import { sequenceToProject, type SeqOverlay } from '../model/migrate';
import { makeClip } from '../model/ops';
import { clipsAt, isStill, projectDuration, sourceTimeAt, videoTracksBottomUp } from '../model/query';
import { extendedSourceTime } from '../fx/transitions';
import { IDENTITY_TRANSFORM, type Clip, type MediaAsset, type VideoProject } from '../model/types';
import { BufferAudioSource, DecoderAudioSource, audioDecoderConfig } from './audioSource';
import { ensureTitleFonts } from './titleFonts';
import { buildProjectMixEntries, composeFrame, type ComposedFrame, type StillImage } from './compose';
import { type DemuxedFile, demux } from './demux';
import type { ClipAudioFx } from './dsp';
import { findAudioConfig, negotiateVideo, type AudioChoice, type VideoChoice } from './encoderConfig';
import { AUDIO_SAMPLE_RATE, type Container } from './formats';
import { TimelineMixer, type PcmSource } from './mixer';
import type { ByteSink } from './sink';
import { type Fit, type RenderOverlay, frameCount } from './timeline';
import { DecoderFrameSource, ElementFrameSource, type FrameSource, videoDecoderConfig } from './videoSource';

export interface RenderClip extends ClipAudioFx {
  /** Archivo original (se lee por trozos). Si falta, se obtiene de `url`. */
  blob?: Blob;
  url: string;
  inP: number;
  outP: number;
  speed: number;
  fadeIn: number;
  fadeOut: number;
}

export interface RenderProgress {
  ratio: number; // 0..1
  stage: 'preparando' | 'video' | 'cerrando' | 'listo';
  frame: number;
  frames: number;
  /** segundos restantes estimados */
  eta?: number;
}

/** Ganchos de prueba: ven el fotograma compuesto y el audio mezclado ANTES de codificar. */
export interface RenderTap {
  frame?: (i: number, ctx: CanvasRenderingContext2D) => void;
  audio?: (L: Float32Array, R: Float32Array, n: number) => void;
}

export interface RenderProjectOptions {
  container: Container;
  /** Tamaños a intentar, del pedido a los de respaldo. */
  sizes: { width: number; height: number; label: string }[];
  fps: number;
  fit?: Fit;
  sink: ByteSink;
  signal?: AbortSignal;
  onProgress?: (p: RenderProgress) => void;
  /** Avisos de degradación (en español) para mostrar al usuario. */
  onNotice?: (msg: string) => void;
  /** Imágenes ya cargadas por id de medio (si faltan, se cargan del Blob). */
  images?: Map<string, StillImage>;
  /** Subtítulos quemados en la imagen (por defecto sí). `false`: se exporta sin ellos (p. ej. para entregarlos en un .srt aparte). */
  burnSubtitles?: boolean;
  tap?: RenderTap;
}

export interface RenderVideoOptions extends Omit<RenderProjectOptions, 'images'> {
  videoClips: RenderClip[];
  audioClips: RenderClip[];
  overlays: RenderOverlay[];
  eq: { low: number; mid: number; high: number };
  normalize: boolean;
}

export interface RenderResult {
  blob: Blob | null;
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
  videoCodec: string;
  audioCodec: string | null;
  notices: string[];
  elapsedMs: number;
  /** Fotogramas obtenidos por la ruta de respaldo con <video>. */
  fallbackFrames: number;
  peakIn: number;
  peakOut: number;
}

export class ExportUnsupportedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ExportUnsupportedError';
  }
}

const abortError = () => new DOMException('Exportación cancelada', 'AbortError');

interface Probe {
  blob: Blob;
  file: DemuxedFile | null;
  error?: string;
}

export interface MuxerHandle {
  addVideo: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void;
  addAudio: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void;
  finalize: () => void;
}

/** Multiplexor MP4 o WebM que escribe en streaming al destino. */
export function createMuxer(container: Container, vc: VideoChoice, ac: AudioChoice | null, sink: ByteSink): MuxerHandle {
  const onData = (data: Uint8Array, position: number) => sink.write(data, position);
  const { width, height, fps } = vc;
  if (container === 'mp4') {
    const mux = new Mp4Muxer({
      target: new Mp4StreamTarget({ onData }),
      video: { codec: 'avc', width, height, frameRate: fps },
      audio: ac ? { codec: ac.muxCodec as 'aac' | 'opus', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2 } : undefined,
      fastStart: false, // moov al final: no hace falta tener el archivo en memoria
      firstTimestampBehavior: 'offset',
    });
    return { addVideo: (c, m) => mux.addVideoChunk(c, m), addAudio: (c, m) => mux.addAudioChunk(c, m), finalize: () => mux.finalize() };
  }
  const mux = new WebmMuxer({
    target: new WebmStreamTarget({ onData }),
    video: { codec: vc.muxCodec, width, height, frameRate: fps },
    audio: ac ? { codec: 'A_OPUS', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2 } : undefined,
    firstTimestampBehavior: 'offset',
  });
  return { addVideo: (c, m) => mux.addVideoChunk(c, m), addAudio: (c, m) => mux.addAudioChunk(c, m), finalize: () => mux.finalize() };
}

/** Medio utilizable para exportar (tiene archivo o URL). */
const usable = (m: MediaAsset | undefined): m is MediaAsset => !!m && !m.missing && (!!m.blob || !!m.url);

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

export async function renderProject(project: VideoProject, opts: RenderProjectOptions): Promise<RenderResult> {
  const t0 = performance.now();
  // sin subtítulos incrustados: las pistas de subtítulos se ocultan (el proyecto original no se toca)
  const p = opts.burnSubtitles === false && project.tracks.some((t) => t.kind === 'subtitle' && !t.hidden) ? { ...project, tracks: project.tracks.map((t) => (t.kind === 'subtitle' ? { ...t, hidden: true } : t)) } : project;
  const { container, sink, signal } = opts;
  const fit = opts.fit ?? 'contain';
  const notices: string[] = [];
  const notice = (m: string) => {
    notices.push(m);
    opts.onNotice?.(m);
  };
  const timelineDur = projectDuration(p);
  if (!(timelineDur > 0)) throw new Error('No hay clips de video');
  if (!Number.isFinite(timelineDur)) throw new Error('Un clip no tiene duración conocida: recórtalo antes de exportar.');
  opts.onProgress?.({ ratio: 0, stage: 'preparando', frame: 0, frames: 0 });

  // --- códecs ---
  const neg = await negotiateVideo(container, opts.sizes, opts.fps);
  if (!neg)
    throw new ExportUnsupportedError(
      container === 'mp4'
        ? 'Este equipo no puede codificar video H.264 (MP4). Prueba a exportar en WebM.'
        : 'Este equipo no puede codificar video VP9/VP8 (WebM). Prueba a exportar en MP4.',
    );
  neg.notices.forEach(notice);
  const vc: VideoChoice = neg.video;
  const { width: w, height: h, fps } = vc;

  // --- medios: cada archivo distinto se desmultiplexa (solo índices) una vez ---
  const createdUrls: string[] = [];
  const urlOf = (m: MediaAsset) => {
    if (m.url) return m.url;
    const u = URL.createObjectURL(m.blob!);
    createdUrls.push(u);
    return u;
  };
  const visualVideo: Clip[] = [];
  const stills: Clip[] = [];
  for (const { track } of videoTracksBottomUp(p))
    for (const c of track.clips) {
      if (c.kind === 'video' && (!track.hidden || !track.muted)) visualVideo.push(c);
      else if (isStill(c) && !track.hidden) stills.push(c);
    }
  const audioOnly: Clip[] = [];
  for (const t of p.tracks) if (t.kind === 'audio' && !t.muted) audioOnly.push(...t.clips);
  const byKey = new Map<Blob | string, Promise<Probe>>();
  const probeOf = new Map<string, Probe>(); // id de medio → sondeo
  for (const c of [...visualVideo, ...audioOnly]) {
    const m = c.mediaId ? p.media[c.mediaId] : undefined;
    if (!usable(m) || probeOf.has(m.id)) continue;
    const key = m.blob ?? m.url!;
    if (!byKey.has(key))
      byKey.set(
        key,
        (async () => {
          const blob = m.blob ?? (await (await fetch(m.url!)).blob());
          try {
            return { blob, file: await demux(blob) };
          } catch (e) {
            console.warn('[video] no se pudo leer por trozos, se usa la ruta de respaldo:', e);
            return { blob, file: null, error: (e as Error).message };
          }
        })(),
      );
    probeOf.set(m.id, await byKey.get(key)!);
  }
  if (signal?.aborted) throw abortError();
  const playable = (c: Clip) => !!c.mediaId && probeOf.has(c.mediaId);

  const frames = frameCount(timelineDur, fps);
  const duration = frames / fps;
  const openPcm = (clip: Clip) => async (): Promise<PcmSource | null> => {
    const pr = probeOf.get(clip.mediaId!)!;
    if (pr.file) {
      if (!pr.file.audio) return null;
      const cfg = await audioDecoderConfig(pr.file.audio);
      if (cfg) return new DecoderAudioSource(pr.file.audio, pr.blob, cfg, clip.inP);
    }
    // Respaldo: decodificar el archivo entero (solo formatos que el motor no sabe trocear).
    try {
      const ctx = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
      return new BufferAudioSource(await ctx.decodeAudioData(await pr.blob.arrayBuffer()));
    } catch {
      return null;
    }
  };
  const mixEntries = buildProjectMixEntries(p, duration, openPcm, playable);
  // ¿Hace falta pista de audio? Como V1: si algún archivo que puede sonar tiene audio (o no se sabe).
  const audible = [...videoTracksBottomUp(p).filter(({ track }) => !track.muted).flatMap(({ track }) => track.clips.filter((c) => c.kind === 'video')), ...audioOnly];
  const anyAudio = audible.some((c) => {
    const pr = playable(c) ? probeOf.get(c.mediaId!) : undefined;
    return !!pr && (!pr.file || !!pr.file.audio);
  });
  let ac: AudioChoice | null = null;
  if (anyAudio) {
    const a = await findAudioConfig(container);
    ac = a.audio;
    if (a.notice) notice(a.notice);
  }

  // --- fuentes de títulos y subtítulos (un canvas no espera a que se descarguen) ---
  await ensureTitleFonts(p);

  // --- imágenes ---
  const images = new Map<string, StillImage | null>();
  for (const c of stills) {
    if (c.kind !== 'image' || !c.mediaId || images.has(c.mediaId)) continue;
    const given = opts.images?.get(c.mediaId);
    const m = p.media[c.mediaId];
    images.set(c.mediaId, given ?? (usable(m) ? await loadImage(urlOf(m)) : null));
  }

  const { addVideo, addAudio, finalize: finalizeMux } = createMuxer(container, vc, ac, sink);

  let encodeError: Error | null = null;
  const fail = (e: unknown) => (encodeError ??= e instanceof Error ? e : new Error(String(e)));
  const videoEncoder = new VideoEncoder({ output: (c, m) => addVideo(c, m), error: fail });
  videoEncoder.configure(vc.config);
  const audioEncoder = ac ? new AudioEncoder({ output: (c, m) => addAudio(c, m), error: fail }) : null;
  audioEncoder?.configure(ac!.config);

  // --- fuentes de fotogramas: una por pista de video ---
  const sources: FrameSource[] = [];
  // Una fuente por «ranura»: la de la pista (clip activo) y la `#x` (clip que solo se ve por una transición de unión).
  const current = new Map<string, { src: FrameSource; clip: Clip; blob: Blob }>();
  const slotKey = (trackId: string, ext: boolean) => (ext ? `${trackId}#x` : trackId);
  let fallbackFrames = 0;
  const openFrameSource = async (key: string, clip: Clip, ext: boolean, want: number): Promise<FrameSource> => {
    const pr = probeOf.get(clip.mediaId!)!;
    const cur = current.get(key);
    // Reutilizar el decodificador si el clip sigue al anterior en el mismo archivo
    // (clip dividido con «S»): no hay que volver a decodificar desde el clave.
    if (
      !ext &&
      cur &&
      cur.blob === pr.blob &&
      (cur.clip.speed || 1) === (clip.speed || 1) &&
      clip.inP >= cur.src.lastTime &&
      clip.inP - cur.src.lastTime < 1
    ) {
      cur.clip = clip;
      return cur.src;
    }
    if (cur) cur.src.close();
    let src: FrameSource | null = null;
    if (pr.file?.video) {
      const cfg = await videoDecoderConfig(pr.file.video);
      if (cfg) src = new DecoderFrameSource(pr.file.video, pr.blob, cfg, ext ? Math.min(clip.inP, want) : clip.inP);
      else notice(`El códec de video «${pr.file.video.codec}» no se puede decodificar por trozos aquí; se usa la ruta lenta.`);
    }
    if (!src) src = new ElementFrameSource(urlOf(p.media[clip.mediaId!]));
    sources.push(src);
    current.set(key, { src, clip, blob: pr.blob });
    return src;
  };
  /** Fuente del clip: la que ya lo tenga (en cualquiera de las dos ranuras; si está en la otra se intercambian) o una nueva. */
  const sourceFor = async (trackId: string, clip: Clip, ext: boolean, want: number): Promise<FrameSource> => {
    const key = slotKey(trackId, ext);
    const other = slotKey(trackId, !ext);
    const cur = current.get(key);
    if (cur && cur.clip.id === clip.id) return cur.src;
    const oth = current.get(other);
    if (oth && oth.clip.id === clip.id) {
      current.set(key, oth);
      if (cur) current.set(other, cur);
      else current.delete(other);
      return oth.src;
    }
    return openFrameSource(key, clip, ext, want);
  };

  const mixer = ac ? new TimelineMixer(mixEntries, { eq: p.eq, normalize: p.normalize }, duration) : null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const keyEvery = Math.max(1, Math.round(fps * 2));
  const AUDIO_BLOCK = 4800; // 100 ms

  const cleanup = () => {
    for (const s of sources) s.close();
    mixer?.close();
    for (const u of createdUrls) URL.revokeObjectURL(u);
    for (const enc of [videoEncoder, audioEncoder])
      try {
        if (enc && enc.state !== 'closed') enc.close();
      } catch {
        /* noop */
      }
  };

  try {
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw abortError();
      if (encodeError) throw encodeError;
      const t = i / fps;
      const { visual } = clipsAt(p, t, timelineDur);
      // Fotogramas de video de las capas (decodificación asíncrona) y composición común.
      const seen = new Set<string>();
      const got = new Map<string, ComposedFrame | null>();
      for (const { track, clip, ext } of visual) {
        if (clip.kind !== 'video' || !playable(clip)) continue;
        seen.add(slotKey(track.id, !!ext));
        // un clip que solo se ve por una transición usa los márgenes de recorte (hasta los límites del archivo)
        const want = ext ? extendedSourceTime(clip, t, p.media[clip.mediaId!]?.duration ?? 0) : sourceTimeAt(clip, t);
        const src = await sourceFor(track.id, clip, !!ext, want);
        const f = await src.frameAt(want);
        if (src instanceof ElementFrameSource) fallbackFrames++;
        got.set(clip.id, f ? { image: f.image, width: f.width, height: f.height, rotation: f.rotation } : null);
      }
      composeFrame(
        ctx,
        p,
        t,
        timelineDur,
        w,
        h,
        fit,
        { video: (c) => got.get(c.id) ?? null, image: (c) => (c.mediaId ? (images.get(c.mediaId) ?? null) : null) },
        visual,
      );
      // Cerrar los decodificadores de pistas sin clip ahora ni en el próximo segundo.
      for (const [key, cur] of current) {
        if (seen.has(key)) continue;
        const track = p.tracks.find((x) => x.id === key.replace(/#x$/, ''));
        if (track?.clips.some((c) => c.kind === 'video' && c.start >= t && c.start - t < 1)) continue;
        cur.src.close();
        current.delete(key);
      }
      opts.tap?.frame?.(i, ctx);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();

      // Audio intercalado: hasta el final de este fotograma.
      if (mixer && audioEncoder) {
        const until = Math.min(mixer.totalSamples, Math.round(((i + 1) / fps) * AUDIO_SAMPLE_RATE));
        while (mixer.position < until) {
          const blk = await mixer.render(Math.min(AUDIO_BLOCK, until - mixer.position));
          if (!blk.frames) break;
          opts.tap?.audio?.(blk.L, blk.R, blk.frames);
          const planar = new Float32Array(blk.frames * 2);
          planar.set(blk.L, 0);
          planar.set(blk.R, blk.frames);
          const data = new AudioData({
            format: 'f32-planar',
            sampleRate: AUDIO_SAMPLE_RATE,
            numberOfFrames: blk.frames,
            numberOfChannels: 2,
            timestamp: Math.round((blk.startSample / AUDIO_SAMPLE_RATE) * 1e6),
            data: planar,
          });
          audioEncoder.encode(data);
          data.close();
        }
      }

      // Contrapresión: codificadores y disco.
      while (videoEncoder.encodeQueueSize > 4 || (audioEncoder && audioEncoder.encodeQueueSize > 8)) {
        if (encodeError) throw encodeError;
        await new Promise((r) => setTimeout(r, 1));
      }
      if (sink.pending > 32 << 20) await sink.drain();

      if (opts.onProgress && (i % 3 === 0 || i === frames - 1)) {
        const el = (performance.now() - t0) / 1000;
        const done = (i + 1) / frames;
        opts.onProgress({ ratio: 0.02 + done * 0.96, stage: 'video', frame: i + 1, frames, eta: done > 0.02 ? (el / done) * (1 - done) : undefined });
      }
    }
    opts.onProgress?.({ ratio: 0.99, stage: 'cerrando', frame: frames, frames });
    await videoEncoder.flush();
    if (audioEncoder) await audioEncoder.flush();
    if (encodeError) throw encodeError;
    finalizeMux();
    const peakIn = mixer?.master.limiter.peakIn ?? 0;
    const peakOut = mixer?.master.limiter.peakOut ?? 0;
    cleanup();
    const blob = await sink.close();
    opts.onProgress?.({ ratio: 1, stage: 'listo', frame: frames, frames });
    return {
      blob,
      width: w,
      height: h,
      fps,
      frames,
      duration,
      videoCodec: vc.config.codec,
      audioCodec: ac ? ac.config.codec : null,
      notices,
      elapsedMs: performance.now() - t0,
      fallbackFrames,
      peakIn,
      peakOut,
    };
  } catch (e) {
    cleanup();
    await sink.abort();
    throw e;
  }
}

/**
 * Traduce la entrada de V1 (secuencia de video + secuencia de audio + capas) al
 * modelo v2, con la misma colocación que la migración del proyecto guardado.
 */
export function legacyInputToProject(o: Pick<RenderVideoOptions, 'videoClips' | 'audioClips' | 'overlays' | 'eq' | 'normalize'>): { project: VideoProject; images: Map<string, StillImage> } {
  const media: Record<string, MediaAsset> = {};
  const keys = new Map<Blob | string, string>();
  const mediaOf = (c: RenderClip, kind: 'video' | 'audio') => {
    const key = c.blob ?? c.url;
    let id = keys.get(key);
    if (!id) {
      id = `m${keys.size}`;
      keys.set(key, id);
      media[id] = { id, kind, name: '', duration: 0, ...(c.blob ? { blob: c.blob } : {}), ...(c.url ? { url: c.url } : {}) };
    }
    return id;
  };
  let n = 0;
  const toClip = (c: RenderClip, kind: 'video' | 'audio'): Clip =>
    makeClip(kind, {
      id: `c${n++}`,
      mediaId: mediaOf(c, kind),
      inP: c.inP,
      outP: c.outP,
      speed: c.speed,
      volume: c.volume,
      voice: { hp: c.hp, lp: c.lp, echo: c.echo, gate: !!c.gate },
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut,
    });
  const images = new Map<string, StillImage>();
  const overlays: SeqOverlay[] = o.overlays.map((ov, i) => {
    let mediaId: string | undefined;
    if (ov.kind === 'image') {
      mediaId = `img${i}`;
      media[mediaId] = { id: mediaId, kind: 'image', name: '', duration: 0 };
      if (ov.img) images.set(mediaId, ov.img);
    }
    const clip = makeClip(ov.kind, {
      id: `o${i}`,
      mediaId,
      size: ov.size,
      ...(ov.kind === 'text' ? { text: ov.text, color: ov.color } : {}),
      transform: { ...IDENTITY_TRANSFORM, x: ov.xf, y: ov.yf },
    });
    return { clip, start: ov.start, end: ov.end };
  });
  // makeClip normaliza la velocidad: la de V1 se usa tal cual (`speed || 1`) para no cambiar tiempos.
  const video = o.videoClips.map((c) => ({ ...toClip(c, 'video'), speed: c.speed }));
  const audio = o.audioClips.map((c) => ({ ...toClip(c, 'audio'), speed: c.speed }));
  const project = sequenceToProject({ media, video, audio, overlays, eq: o.eq, normalize: o.normalize });
  return { project, images };
}

/** API de V1 (la usan el banco y la ruta antigua): pasa por el motor multipista. */
export async function renderVideo(opts: RenderVideoOptions): Promise<RenderResult> {
  if (!opts.videoClips.length) throw new Error('No hay clips de video');
  const { project, images } = legacyInputToProject(opts);
  // Las imágenes de V1 sin cargar no se ven (igual que antes): el motor no las busca en otra parte.
  for (const [id, m] of Object.entries(project.media)) if (m.kind === 'image' && !images.has(id)) m.missing = true;
  return renderProject(project, { ...opts, images });
}
