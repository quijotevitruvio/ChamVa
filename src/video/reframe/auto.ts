// Reencuadre automático (V8): decodifica el clip a baja resolución en los instantes de SALIDA del clip (así el
// seguimiento coincide con lo que se ve aunque haya curva de velocidad, invertido o bucle), sigue al sujeto
// y devuelve los marcos del reencuadre ya suavizados y reducidos a pocos fotogramas clave.
import type { Clip, MediaAsset, ReframeKey, ReframeSpec } from '../model/types';
import { clipDuration } from '../model/query';
import { sourceAtLocal } from '../speed/clipTime';
import { demux, type DemuxedFile } from '../engine/demux';
import { drawVideoFrame } from '../engine/timeline';
import { DecoderFrameSource, ElementFrameSource, videoDecoderConfig, type FrameSource } from '../engine/videoSource';
import { ReverseFrameSource } from '../engine/reverse';
import { cropSize, framesFromTrack, geometry, type Dims } from './math';
import { TrackAbort, autoSubject, trackSubject, type NBox, type TrackedFrame } from './tracker';

export interface AutoReframeOptions {
  aspect: ReframeSpec['aspect'];
  /** tamaño de la salida del proyecto (px) y encaje, para saber el tamaño del marco */
  out: Dims;
  fit?: 'contain' | 'cover';
  /** sujeto marcado por el usuario (fracción del fotograma de origen); sin él se elige por el movimiento */
  subject?: NBox;
  zoom?: number;
  signal?: AbortSignal;
  /** 0..1 y etapa en español */
  onProgress?: (ratio: number, stage: string) => void;
}

export interface AutoReframeResult {
  keys: ReframeKey[];
  /** sujeto con el que se empezó */
  subject: NBox;
  /** el sujeto se eligió por movimiento con convicción (o lo marcó el usuario) */
  confident: boolean;
  /** tamaño del fotograma de origen que se vio (ya girado) */
  src: Dims;
  /** muestras con confianza 0 (el sujeto se perdió) */
  lost: number;
  samples: number;
  elapsedMs: number;
}

/** Muestras por segundo según la duración (≤ ~600 muestras). */
export function trackingFps(duration: number): number {
  return duration <= 40 ? 10 : duration <= 120 ? 5 : duration <= 300 ? 2 : 1;
}

async function openSource(file: DemuxedFile | null, blob: Blob, reverse: boolean, url: () => string): Promise<{ src: FrameSource; close: () => void }> {
  if (file?.video) {
    const cfg = await videoDecoderConfig(file.video);
    if (cfg) {
      const src = reverse ? new ReverseFrameSource(file.video, blob, cfg) : new DecoderFrameSource(file.video, blob, cfg, 0);
      return { src, close: () => src.close() };
    }
  }
  const src = new ElementFrameSource(url());
  return { src, close: () => src.close() };
}

/** Fotogramas en gris pequeños del clip en los instantes de salida. */
export async function sampleClipFrames(clip: Clip, media: MediaAsset, o: { fps: number; maxSide?: number; signal?: AbortSignal; onProgress?: (r: number) => void }): Promise<{ frames: TrackedFrame[]; src: Dims }> {
  const blob = media.blob ?? (media.url ? await (await fetch(media.url)).blob() : null);
  if (!blob) throw new Error('El medio no está disponible');
  let file: DemuxedFile | null = null;
  try {
    file = await demux(blob);
  } catch {
    file = null;
  }
  let objUrl = '';
  const { src, close } = await openSource(file, blob, !!clip.reverse, () => (objUrl = media.url ?? URL.createObjectURL(blob)));
  const D = clipDuration(clip);
  const n = Math.max(2, Math.floor(D * o.fps) + 1);
  const frames: TrackedFrame[] = [];
  let dims: Dims = { w: 16, h: 9 };
  const maxSide = o.maxSide ?? 160;
  try {
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) throw new TrackAbort();
      const l = Math.min(D - 1e-3, i / o.fps);
      const f = await src.frameAt(sourceAtLocal(clip, Math.max(0, l)));
      if (!f) continue;
      const turned = f.rotation % 180 !== 0;
      const sw = turned ? f.height : f.width;
      const sh = turned ? f.width : f.height;
      dims = { w: sw, h: sh };
      const k = maxSide / Math.max(sw, sh);
      const w = Math.max(8, Math.round(sw * k));
      const h = Math.max(8, Math.round(sh * k));
      if (!canvas || canvas.width !== w || canvas.height !== h) {
        canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      }
      drawVideoFrame(ctx!, f.image, f.width, f.height, w, h, 'contain', f.rotation, 1);
      const rgba = ctx!.getImageData(0, 0, w, h).data;
      const g = new Uint8Array(w * h);
      for (let q = 0, j = 0; q < g.length; q++, j += 4) g[q] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
      frames.push({ t: l, g: { w, h, d: g } });
      o.onProgress?.((i + 1) / n);
    }
  } finally {
    close();
    if (objUrl && !media.url) URL.revokeObjectURL(objUrl);
  }
  return { frames, src: dims };
}

/** Sigue al sujeto y calcula los marcos del reencuadre (con progreso y cancelación). */
export async function autoReframe(clip: Clip, media: MediaAsset, o: AutoReframeOptions): Promise<AutoReframeResult> {
  const t0 = performance.now();
  const D = clipDuration(clip);
  const fps = trackingFps(D);
  o.onProgress?.(0, 'Leyendo el video');
  const { frames, src } = await sampleClipFrames(clip, media, { fps, signal: o.signal, onProgress: (r) => o.onProgress?.(r * 0.7, 'Leyendo el video') });
  if (frames.length < 2) throw new Error('No se pudieron leer fotogramas del clip');
  if (o.signal?.aborted) throw new TrackAbort();
  let subject = o.subject;
  let confident = !!subject;
  if (!subject) {
    o.onProgress?.(0.7, 'Buscando al sujeto');
    const a = autoSubject(frames.slice(0, 24));
    subject = a.box;
    confident = a.confident;
  }
  o.onProgress?.(0.75, 'Siguiendo al sujeto');
  const track = trackSubject(frames, subject, {
    signal: o.signal,
    onProgress: (d, n) => o.onProgress?.(0.75 + (d / n) * 0.2, 'Siguiendo al sujeto'),
  });
  const g = geometry(src, o.out, o.fit ?? 'contain');
  const { cw, ch } = cropSize(g, o.out, o.zoom ?? 1);
  o.onProgress?.(0.96, 'Suavizando el movimiento');
  const keys = framesFromTrack(track, cw, ch, { zoom: o.zoom });
  o.onProgress?.(1, 'Listo');
  return { keys, subject, confident, src, lost: track.filter((p) => p.c === 0).length, samples: track.length, elapsedMs: performance.now() - t0 };
}
