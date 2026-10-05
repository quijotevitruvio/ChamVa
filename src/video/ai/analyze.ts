// V9: cálculo (en el navegador) de lo que luego LEEN la vista previa y la exportación:
//  - `computeMatte`: máscara por fotograma con el modelo (worker), a la caché `matteCache`.
//  - `computeStabilization`: movimiento de cámara entre fotogramas, a `motionCache`.
// Solo se calcula lo que falta (por clave y fotograma): repetir no recalcula. Progreso con tiempo estimado, cancelación
// con AbortSignal. Los fotogramas se leen del archivo con el decodificador del motor (no salen del equipo).
import type { Clip, MediaAsset, VideoProject } from '../model/types';
import { findClip } from '../model/query';
import { demux, type DemuxedFile } from '../engine/demux';
import { DecoderFrameSource, ElementFrameSource, videoDecoderConfig, type FrameSource } from '../engine/videoSource';
import { browserStorageEnv, type StorageEnv } from '../../ai/transcribe/store';
import { matteCache, matteKey, motionCache, stabKey, type MaskCache, type MotionCache } from './cache';
import { aiParamsOf, clipSourceRange } from './aiFrame';
import { EtaMeter, MATTE_FPS, estimateMatte, inferSize, type MatteEstimate, type MatteMode } from './matteMath';
import { estimateMotion } from './stabMath';
import { matteModelStatus } from './models';
import type { Gray } from '../reframe/tracker';

export interface AiProgress {
  stage: string;
  done: number;
  total: number;
  ratio: number;
  /** s restantes estimados */
  eta?: number;
  msPerFrame?: number;
}

export class AiAbort extends Error {
  constructor() {
    super('Cálculo cancelado');
    this.name = 'AbortError';
  }
}

/** Motor de máscaras: recibe un fotograma RGBA al tamaño de inferencia y devuelve la máscara (0..255, w·h). */
export interface MatteEngine {
  id: string;
  infer(img: ImageData): Promise<Uint8Array>;
  close(): void;
}

export class MissingMatteModelError extends Error {
  constructor(msg = 'El modelo de «quitar fondo» no está descargado en este equipo. Descárgalo primero (te diremos el tamaño); después funciona sin conexión.') {
    super(msg);
    this.name = 'MissingModelError';
  }
}

/** MODNet en un worker (red cortada: solo usa el modelo ya descargado con permiso). */
export async function createModnetEngine(storage: StorageEnv = browserStorageEnv()): Promise<MatteEngine & { loadMs: number }> {
  if (!(await matteModelStatus(storage)).installed) throw new MissingMatteModelError();
  const w = new Worker(new URL('./matte.worker.ts', import.meta.url), { type: 'module' });
  let seq = 0;
  const waiting = new Map<number, { res: (d: any) => void; rej: (e: Error) => void }>();
  w.onmessage = (e) => {
    const d = e.data ?? {};
    const p = waiting.get(d.id);
    if (!p) return;
    waiting.delete(d.id);
    if (d.error) p.rej(d.code === 'missing-model' ? new MissingMatteModelError(d.error) : new Error(d.error));
    else p.res(d);
  };
  w.onerror = (e) => {
    for (const p of waiting.values()) p.rej(new Error(e.message || 'El proceso de «quitar fondo» falló.'));
    waiting.clear();
  };
  const call = (msg: Record<string, unknown>, tr: Transferable[] = []) =>
    new Promise<any>((res, rej) => {
      const id = ++seq;
      waiting.set(id, { res, rej });
      w.postMessage({ id, ...msg }, tr);
    });
  const t0 = performance.now();
  try {
    await call({ op: 'load' });
  } catch (e) {
    w.terminate();
    throw e;
  }
  return {
    id: 'modnet',
    loadMs: performance.now() - t0,
    async infer(img) {
      const buf = img.data.slice().buffer;
      const d = await call({ op: 'infer', w: img.width, h: img.height, rgba: buf }, [buf]);
      return new Uint8Array(d.mask);
    },
    close: () => w.terminate(),
  };
}

async function openFrames(media: MediaAsset, start: number): Promise<{ src: FrameSource; close: () => void }> {
  const blob = media.blob ?? (media.url ? await (await fetch(media.url)).blob() : null);
  if (!blob) throw new Error('El medio no está disponible');
  let file: DemuxedFile | null = null;
  try {
    file = await demux(blob);
  } catch {
    file = null;
  }
  if (file?.video) {
    const cfg = await videoDecoderConfig(file.video);
    if (cfg) {
      const src = new DecoderFrameSource(file.video, blob, cfg, start);
      return { src, close: () => src.close() };
    }
  }
  const url = media.url ?? URL.createObjectURL(blob);
  const src = new ElementFrameSource(url);
  return {
    src,
    close: () => {
      src.close();
      if (!media.url) URL.revokeObjectURL(url);
    },
  };
}

function canvas2d(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

export interface MatteJob {
  /** tramo del archivo (s); por defecto el que usa el clip */
  range?: [number, number];
  mode?: MatteMode;
  engine: MatteEngine;
  signal?: AbortSignal;
  onProgress?: (p: AiProgress) => void;
  cache?: MaskCache;
}

export interface MatteResult {
  key: string;
  computed: number;
  skipped: number;
  total: number;
  ms: number;
  msPerFrame: number;
  inW: number;
  inH: number;
}

/** Estimación previa para el diálogo (duración y memoria) del clip, contando lo ya calculado. */
export function estimateClipMatte(p: VideoProject, clipId: string, srcW: number, srcH: number, mode: MatteMode, msPerFrame?: number, cache: MaskCache = matteCache): MatteEstimate | null {
  const c = findClip(p, clipId)?.clip;
  if (!c?.mediaId) return null;
  const [a, b] = clipSourceRange(c);
  const cov = cache.coverage(matteKey(c.mediaId, mode), a, b, MATTE_FPS);
  return estimateMatte({ seconds: b - a, srcW, srcH, mode, msPerFrame, cached: cov.have });
}

/** Calcula las máscaras que faltan del clip (o del tramo) y las deja en la caché. */
export async function computeMatte(p: VideoProject, clipId: string, job: MatteJob): Promise<MatteResult> {
  const t0 = performance.now();
  const hit = findClip(p, clipId);
  const clip = hit?.clip as Clip | undefined;
  if (!clip || clip.kind !== 'video' || !clip.mediaId) throw new Error('El clip no es de video');
  const media = p.media[clip.mediaId];
  if (!media || media.missing) throw new Error('Falta el archivo del clip');
  const mode = job.mode ?? aiParamsOf(clip, clip.start).matte?.mode ?? 'quality';
  const [a, b] = job.range ?? clipSourceRange(clip);
  const cache = job.cache ?? matteCache;
  const key = matteKey(clip.mediaId, mode);
  const i0 = Math.round(a * MATTE_FPS + 1e-6);
  const i1 = Math.max(i0, Math.round(b * MATTE_FPS + 1e-6));
  const total = i1 - i0 + 1;
  const { src, close } = await openFrames(media, a);
  let computed = 0;
  let skipped = 0;
  let inW = 0;
  let inH = 0;
  let ctx: CanvasRenderingContext2D | null = null;
  let eta: EtaMeter | null = null;
  try {
    for (let i = i0; i <= i1; i++) {
      if (job.signal?.aborted) throw new AiAbort();
      if (inW && cache.has(key, i)) {
        skipped++;
        continue;
      }
      const tf = performance.now();
      const f = await src.frameAt(i / MATTE_FPS);
      if (!f) {
        skipped++;
        continue;
      }
      if (!inW) {
        ({ w: inW, h: inH } = inferSize(f.width, f.height, mode));
        cache.track(key, inW, inH, MATTE_FPS);
        ctx = canvas2d(inW, inH);
        // lo que ya estaba (otra pasada) no se repite
        if (cache.has(key, i)) {
          skipped++;
          continue;
        }
      }
      if (!eta) {
        let todo = 0;
        for (let k = i; k <= i1; k++) if (!cache.has(key, k)) todo++;
        eta = new EtaMeter(todo);
      }
      // fotograma SIN girar (la máscara va en las coordenadas del fotograma que dibuja la composición)
      ctx!.drawImage(f.image, 0, 0, inW, inH);
      const img = ctx!.getImageData(0, 0, inW, inH);
      const mask = await job.engine.infer(img);
      if (job.signal?.aborted) throw new AiAbort();
      cache.put(key, i, mask);
      computed++;
      const left = eta.tick(performance.now() - tf);
      const done = i - i0 + 1;
      job.onProgress?.({ stage: 'Quitando el fondo', done, total, ratio: done / total, eta: left, msPerFrame: eta.msPerFrame });
    }
  } finally {
    close();
  }
  const ms = performance.now() - t0;
  return { key, computed, skipped, total, ms, msPerFrame: computed ? ms / computed : 0, inW, inH };
}

export interface StabJob {
  range?: [number, number];
  /** lado largo del análisis (px, def. 320) */
  side?: number;
  signal?: AbortSignal;
  onProgress?: (p: AiProgress) => void;
  cache?: MotionCache;
}

/** Analiza el movimiento de cámara del tramo del clip (lo ya analizado no se repite). */
export async function computeStabilization(p: VideoProject, clipId: string, job: StabJob = {}): Promise<{ key: string; computed: number; total: number; ms: number; w: number; h: number }> {
  const t0 = performance.now();
  const clip = findClip(p, clipId)?.clip;
  if (!clip || clip.kind !== 'video' || !clip.mediaId) throw new Error('El clip no es de video');
  const media = p.media[clip.mediaId];
  if (!media || media.missing) throw new Error('Falta el archivo del clip');
  const [a, b] = job.range ?? clipSourceRange(clip);
  const cache = job.cache ?? motionCache;
  const key = stabKey(clip.mediaId);
  const fps = MATTE_FPS;
  const i0 = Math.round(a * fps + 1e-6);
  const i1 = Math.max(i0, Math.round(b * fps + 1e-6));
  const total = i1 - i0 + 1;
  const { src, close } = await openFrames(media, a);
  let prev: Gray | null = null;
  let w = 0;
  let h = 0;
  let ctx: CanvasRenderingContext2D | null = null;
  let computed = 0;
  const eta = new EtaMeter(total);
  try {
    for (let i = i0; i <= i1; i++) {
      if (job.signal?.aborted) throw new AiAbort();
      const tf = performance.now();
      const tr = cache.peek(key);
      // ya medido y el anterior también: no hace falta ni decodificar (pero sí para seguir la cadena)
      const f = await src.frameAt(i / fps);
      if (!f) continue;
      if (!w) {
        const side = job.side ?? 320;
        const k = side / Math.max(f.width, f.height);
        w = Math.max(16, Math.round(f.width * k));
        h = Math.max(16, Math.round(f.height * k));
        ctx = canvas2d(w, h);
        cache.track(key, w, h, fps);
      }
      const known = tr && tr.w === w && tr.h === h && tr.motion.has(i) && (i === i0 || tr.motion.has(i - 1));
      ctx!.drawImage(f.image, 0, 0, w, h);
      const rgba = ctx!.getImageData(0, 0, w, h).data;
      const g = new Float32Array(w * h);
      for (let q = 0, j = 0; q < g.length; q++, j += 4) g[q] = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
      const cur: Gray = { w, h, d: g };
      if (!known) {
        // el primero del tramo es la referencia (sin movimiento), si no hay nada antes
        const m = prev ? estimateMotion(prev, cur) : { dx: 0, dy: 0, da: 0, ds: 0, ok: true };
        cache.put(key, i, { dx: m.dx, dy: m.dy, da: m.da, ds: m.ds, ok: m.ok });
        computed++;
      }
      prev = cur;
      const left = eta.tick(performance.now() - tf);
      const done = i - i0 + 1;
      job.onProgress?.({ stage: 'Analizando el movimiento', done, total, ratio: done / total, eta: left, msPerFrame: eta.msPerFrame });
    }
  } finally {
    close();
  }
  return { key, computed, total, ms: performance.now() - t0, w, h };
}
