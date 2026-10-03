// «MP4 (animación)» del diseño con el mismo motor: cada fotograma se pinta con
// renderDocToCanvas(doc, …, t) y va directo a VideoEncoder. Antes: GIF de 600 px
// y 256 colores → ffmpeg.wasm descargado de unpkg (GPL) → MP4.
import type { Doc } from '../../editor/core/types';
import { animTotalFor } from '../../editor/core/animations';
import { renderDocToCanvas } from '../../io/export';
import { negotiateVideo } from './encoderConfig';
import type { Container } from './formats';
import { ExportUnsupportedError, createMuxer } from './render';
import type { ByteSink } from './sink';

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Tamaños a intentar: lado largo ≤ maxSide, y respaldos 1920 → 1280. */
export function docVideoSizes(docW: number, docH: number, maxSide = 1920) {
  const out: { width: number; height: number; label: string; scale: number }[] = [];
  for (const side of [maxSide, 1920, 1280].filter((v, i, a) => a.indexOf(v) === i && v <= maxSide)) {
    const scale = Math.min(1, side / Math.max(docW, docH));
    const width = even(docW * scale);
    const height = even(docH * scale);
    if (!out.some((o) => o.width === width)) out.push({ width, height, label: `${width}×${height}`, scale });
  }
  return out;
}

export async function renderDocAnimation(
  doc: Doc,
  o: {
    container?: Container;
    fps?: number;
    maxSide?: number;
    background?: string;
    sink: ByteSink;
    signal?: AbortSignal;
    onProgress?: (ratio: number) => void;
    onNotice?: (msg: string) => void;
  },
): Promise<{ blob: Blob | null; width: number; height: number; frames: number; container: Container }> {
  const fps = o.fps ?? 30;
  const container = o.container ?? 'mp4';
  const total = Math.max(0.5, animTotalFor(doc.layers));
  const sizes = docVideoSizes(doc.width, doc.height, o.maxSide ?? 1920);
  const neg = await negotiateVideo(container, sizes, fps);
  if (!neg) throw new ExportUnsupportedError('Este equipo no puede codificar video H.264 (MP4) con WebCodecs.');
  neg.notices.forEach((n) => o.onNotice?.(n));
  const vc = neg.video;
  const scale = sizes.find((s) => s.width === vc.width)?.scale ?? 1;
  const mux = createMuxer(container, vc, null, o.sink);
  let err: Error | null = null;
  const enc = new VideoEncoder({ output: (c, m) => mux.addVideo(c, m), error: (e) => (err ??= e as Error) });
  enc.configure(vc.config);
  const frames = Math.max(2, Math.ceil(total * fps));
  const canvas = document.createElement('canvas');
  canvas.width = vc.width;
  canvas.height = vc.height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  try {
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new DOMException('Exportación cancelada', 'AbortError');
      if (err) throw err;
      const t = Math.min(total, i / fps);
      const src = await renderDocToCanvas(doc, scale, o.background ?? '#ffffff', t, total);
      ctx.fillStyle = o.background ?? '#ffffff';
      ctx.fillRect(0, 0, vc.width, vc.height);
      ctx.drawImage(src, 0, 0, vc.width, vc.height);
      const f = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(f, { keyFrame: i % (fps * 2) === 0 });
      f.close();
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      if (o.sink.pending > 32 << 20) await o.sink.drain();
      o.onProgress?.((i + 1) / frames);
    }
    await enc.flush();
    if (err) throw err;
    mux.finalize();
    enc.close();
    const blob = await o.sink.close();
    return { blob, width: vc.width, height: vc.height, frames, container };
  } catch (e) {
    try {
      if (enc.state !== 'closed') enc.close();
    } catch {
      /* noop */
    }
    await o.sink.abort();
    throw e;
  }
}
