// Ayudas del banco de pruebas de «Grabar, plantillas y bucle perfecto» (solo desarrollo, no entra en el build): se importan
// desde la página del editor (`import('/src/video/bench/recordBench.ts')`) para exportar un proyecto con el motor REAL,
// medir fotogramas y fabricar un clip sintético periódico. No tiene página propia: lo usa el script de verificación.
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { renderProject } from '../engine/render';
import { BlobPartsSink } from '../engine/sink';
import type { Container } from '../engine/formats';
import type { VideoProject } from '../model';

export interface FrameStat {
  i: number;
  mean: number;
  std: number;
  /** nº de colores distintos (cuantizados) en el fotograma */
  colors: number;
}

export interface QuickExport {
  bytes: number;
  duration: number;
  frames: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  notices: string[];
  stats: FrameStat[];
  blobUrl: string;
}

/** Exporta con el motor real a poca resolución y mide algunos fotogramas (cada `every`). */
export async function quickExport(project: VideoProject, o: { container?: Container; w?: number; h?: number; fps?: number; every?: number } = {}): Promise<QuickExport> {
  const { container = 'webm', w = 640, h = 360, fps = 15, every = 8 } = o;
  const stats: FrameStat[] = [];
  const sink = new BlobPartsSink(container === 'mp4' ? 'video/mp4' : 'video/webm');
  const r = await renderProject(project, {
    container,
    sizes: [{ width: w, height: h, label: `${w}×${h}` }],
    fps,
    sink,
    tap: {
      frame: (i, ctx) => {
        if (i % every !== 0) return;
        const { width, height } = ctx.canvas;
        const d = ctx.getImageData(0, 0, width, height).data;
        let s = 0;
        let s2 = 0;
        const seen = new Set<number>();
        const n = width * height;
        for (let k = 0; k < n; k++) {
          const y = 0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2];
          s += y;
          s2 += y * y;
          seen.add(((d[k * 4] >> 4) << 8) | ((d[k * 4 + 1] >> 4) << 4) | (d[k * 4 + 2] >> 4));
        }
        const mean = s / n;
        stats.push({ i, mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), colors: seen.size });
      },
    },
  });
  const blob = r.blob!;
  return { bytes: blob.size, duration: r.duration, frames: r.frames, width: r.width, height: r.height, videoCodec: r.videoCodec, audioCodec: r.audioCodec, notices: r.notices, stats, blobUrl: URL.createObjectURL(blob) };
}

/** Duración que lee un `<video>` del archivo (null si no lo abre). */
export function probeVideo(url: string): Promise<{ duration: number; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => resolve({ duration: v.duration, w: v.videoWidth, h: v.videoHeight });
    v.onerror = () => resolve(null);
    v.src = url;
  });
}

/**
 * Clip WebM sintético PERIÓDICO (periodo `P` s): una barra blanca que gira sobre un fondo de degradado; el fotograma en t es
 * idéntico al de t + P. Sirve para comprobar que «Bucle perfecto» elige una unión que coincide con el periodo.
 */
export async function makePeriodicClip(o: { P: number; seconds: number; w?: number; h?: number; fps?: number }): Promise<Blob> {
  const { P, seconds, w = 320, h = 180, fps = 24 } = o;
  const target = new WebmTarget();
  const mux = new WebmMuxer({ target, video: { codec: 'V_VP8', width: w, height: h } });
  let err: unknown = null;
  const enc = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: (e) => (err = e) });
  enc.configure({ codec: 'vp8', width: w, height: h, bitrate: 1_500_000, framerate: fps });
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    if (err) throw err;
    const t = i / fps;
    const a = (2 * Math.PI * t) / P;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#102040');
    g.addColorStop(1, '#a04020');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = h * 0.08;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + Math.cos(a) * h * 0.42, h / 2 + Math.sin(a) * h * 0.42);
    ctx.stroke();
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.arc(w / 2 + Math.cos(a * 2) * h * 0.3, h / 2 + Math.sin(a * 2) * h * 0.3, h * 0.07, 0, Math.PI * 2);
    ctx.fill();
    const f = new VideoFrame(c, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
    enc.encode(f, { keyFrame: i % 12 === 0 });
    f.close();
    while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
  }
  await enc.flush();
  enc.close();
  mux.finalize();
  return new Blob([target.buffer], { type: 'video/webm' });
}
