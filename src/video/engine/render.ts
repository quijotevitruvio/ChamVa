// Motor de exportación de video (V1): línea de tiempo → MP4 (H.264 + AAC/Opus)
// o WebM (VP9/VP8 + Opus), fotograma a fotograma y en streaming:
//
//   archivo ─(lectura por trozos)→ VideoDecoder/AudioDecoder → lienzo + mezclador
//          → VideoEncoder/AudioEncoder → mp4-muxer/webm-muxer → destino por trozos
//
// Nada se carga entero en memoria: ni los archivos de entrada, ni el audio de
// toda la duración, ni el archivo de salida. Se puede cancelar con AbortSignal.
import { Muxer as Mp4Muxer, StreamTarget as Mp4StreamTarget } from 'mp4-muxer';
import { Muxer as WebmMuxer, StreamTarget as WebmStreamTarget } from 'webm-muxer';
import { BufferAudioSource, DecoderAudioSource, audioDecoderConfig } from './audioSource';
import { type DemuxedFile, demux } from './demux';
import type { ClipAudioFx } from './dsp';
import { findAudioConfig, negotiateVideo, type AudioChoice, type VideoChoice } from './encoderConfig';
import { AUDIO_SAMPLE_RATE, type Container } from './formats';
import { TimelineMixer, buildMixEntries, type PcmSource } from './mixer';
import type { ByteSink } from './sink';
import {
  type Fit,
  type RenderOverlay,
  type Segment,
  buildSegments,
  drawOverlays,
  drawVideoFrame,
  fadeAlpha,
  frameCount,
  segmentIndexAt,
  sourceTimeAt,
  totalDuration,
} from './timeline';
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

export interface RenderVideoOptions {
  container: Container;
  /** Tamaños a intentar, del pedido a los de respaldo. */
  sizes: { width: number; height: number; label: string }[];
  fps: number;
  videoClips: RenderClip[];
  audioClips: RenderClip[];
  overlays: RenderOverlay[];
  eq: { low: number; mid: number; high: number };
  normalize: boolean;
  fit?: Fit;
  sink: ByteSink;
  signal?: AbortSignal;
  onProgress?: (p: RenderProgress) => void;
  /** Avisos de degradación (en español) para mostrar al usuario. */
  onNotice?: (msg: string) => void;
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

/** Desmultiplexa (solo índices) cada archivo distinto una vez. */
async function probeAll(clips: RenderClip[]): Promise<Map<RenderClip, Probe>> {
  const byKey = new Map<Blob | string, Promise<Probe>>();
  const out = new Map<RenderClip, Probe>();
  for (const c of clips) {
    const key = c.blob ?? c.url;
    if (!byKey.has(key))
      byKey.set(
        key,
        (async () => {
          const blob = c.blob ?? (await (await fetch(c.url)).blob());
          try {
            return { blob, file: await demux(blob) };
          } catch (e) {
            console.warn('[video] no se pudo leer por trozos, se usa la ruta de respaldo:', e);
            return { blob, file: null, error: (e as Error).message };
          }
        })(),
      );
    out.set(c, await byKey.get(key)!);
  }
  return out;
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

export async function renderVideo(opts: RenderVideoOptions): Promise<RenderResult> {
  const t0 = performance.now();
  const { container, sink, signal } = opts;
  const fit = opts.fit ?? 'contain';
  const notices: string[] = [];
  const notice = (m: string) => {
    notices.push(m);
    opts.onNotice?.(m);
  };
  const segs = buildSegments(opts.videoClips);
  const timelineDur = totalDuration(segs);
  if (!segs.length || timelineDur <= 0) throw new Error('No hay clips de video');
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

  const probes = await probeAll([...opts.videoClips, ...opts.audioClips]);
  if (signal?.aborted) throw abortError();
  const anyAudio = [...probes.values()].some((p) => !p.file || !!p.file.audio);
  let ac: AudioChoice | null = null;
  if (anyAudio) {
    const a = await findAudioConfig(container);
    ac = a.audio;
    if (a.notice) notice(a.notice);
  }

  const { addVideo, addAudio, finalize: finalizeMux } = createMuxer(container, vc, ac, sink);

  let encodeError: Error | null = null;
  const fail = (e: unknown) => (encodeError ??= e instanceof Error ? e : new Error(String(e)));
  const videoEncoder = new VideoEncoder({ output: (c, m) => addVideo(c, m), error: fail });
  videoEncoder.configure(vc.config);
  const audioEncoder = ac ? new AudioEncoder({ output: (c, m) => addAudio(c, m), error: fail }) : null;
  audioEncoder?.configure(ac!.config);

  // --- fuentes ---
  const sources: FrameSource[] = [];
  let current: { src: FrameSource; seg: Segment<RenderClip>; blob: Blob } | null = null;
  let fallbackFrames = 0;
  const openFrameSource = async (seg: Segment<RenderClip>): Promise<FrameSource> => {
    const p = probes.get(seg.clip)!;
    // Reutilizar el decodificador si el tramo sigue al anterior en el mismo archivo
    // (clip dividido con «S»): no hay que volver a decodificar desde el clave.
    if (
      current &&
      current.blob === p.blob &&
      (current.seg.clip.speed || 1) === (seg.clip.speed || 1) &&
      seg.clip.inP >= current.src.lastTime &&
      seg.clip.inP - current.src.lastTime < 1
    ) {
      current.seg = seg;
      return current.src;
    }
    if (current) current.src.close();
    let src: FrameSource | null = null;
    if (p.file?.video) {
      const cfg = await videoDecoderConfig(p.file.video);
      if (cfg) src = new DecoderFrameSource(p.file.video, p.blob, cfg, seg.clip.inP);
      else notice(`El códec de video «${p.file.video.codec}» no se puede decodificar por trozos aquí; se usa la ruta lenta.`);
    }
    if (!src) src = new ElementFrameSource(seg.clip.url);
    sources.push(src);
    current = { src, seg, blob: p.blob };
    return src;
  };

  const openPcm = (clip: RenderClip) => async (): Promise<PcmSource | null> => {
    const p = probes.get(clip)!;
    if (p.file) {
      if (!p.file.audio) return null;
      const cfg = await audioDecoderConfig(p.file.audio);
      if (cfg) return new DecoderAudioSource(p.file.audio, p.blob, cfg, clip.inP);
    }
    // Respaldo: decodificar el archivo entero (solo formatos que el motor no sabe trocear).
    try {
      const ctx = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
      return new BufferAudioSource(await ctx.decodeAudioData(await p.blob.arrayBuffer()));
    } catch {
      return null;
    }
  };

  const frames = frameCount(timelineDur, fps);
  const duration = frames / fps;
  const mixer = ac ? new TimelineMixer(buildMixEntries(segs, opts.audioClips, duration, openPcm), { eq: opts.eq, normalize: opts.normalize }, duration) : null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const keyEvery = Math.max(1, Math.round(fps * 2));
  const AUDIO_BLOCK = 4800; // 100 ms

  const cleanup = () => {
    for (const s of sources) s.close();
    mixer?.close();
    for (const enc of [videoEncoder, audioEncoder])
      try {
        if (enc && enc.state !== 'closed') enc.close();
      } catch {
        /* noop */
      }
  };

  try {
    let segIdx = -1;
    let src: FrameSource | null = null;
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw abortError();
      if (encodeError) throw encodeError;
      const t = i / fps;
      const si = segmentIndexAt(segs, t);
      const seg = segs[si];
      if (si !== segIdx) {
        src = await openFrameSource(seg);
        segIdx = si;
      }
      const f = await src!.frameAt(sourceTimeAt(seg, t));
      if (src instanceof ElementFrameSource) fallbackFrames++;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      if (f) drawVideoFrame(ctx, f.image, f.width, f.height, w, h, fit, f.rotation, fadeAlpha(seg, t));
      drawOverlays(ctx, w, h, opts.overlays, t);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();

      // Audio intercalado: hasta el final de este fotograma.
      if (mixer && audioEncoder) {
        const until = Math.min(mixer.totalSamples, Math.round(((i + 1) / fps) * AUDIO_SAMPLE_RATE));
        while (mixer.position < until) {
          const blk = await mixer.render(Math.min(AUDIO_BLOCK, until - mixer.position));
          if (!blk.frames) break;
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
