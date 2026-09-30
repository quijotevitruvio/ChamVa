/// <reference lib="webworker" />
// Worker de IA: ejecuta BiRefNet-lite (quitar fondo) y Swin2SR (upscale) fuera
// del hilo de la UI para que la interfaz no se congele. Protocolo por mensajes:
//   → { id, op: 'removeBg' | 'upscale' | 'prefetchBg' | 'prefetchUp', ... }
//   ← { id, progress, stage }               (avances)
//   ← { id, done: true, ...resultado }      (fin)
//   ← { id, error: string }                 (fallo)
import {
  getBgModel,
  removeBackgroundCore,
  type BgQuality,
  type EdgeMode,
  type Progress,
} from './bgcore';

interface Req {
  id: number;
  op: 'removeBg' | 'upscale' | 'prefetchBg' | 'prefetchUp';
  src?: string;
  quality?: BgQuality;
  edges?: EdgeMode;
}

const UPSCALE_ID = 'Xenova/swin2SR-classical-sr-x2-64';
let upscaler: Promise<unknown> | null = null;

async function getUpscaler(onProgress?: Progress) {
  const { pipeline } = await import('@huggingface/transformers');
  if (!upscaler) {
    upscaler = pipeline('image-to-image', UPSCALE_ID, {
      progress_callback: (p: any) =>
        onProgress?.((p?.progress ?? 0) / 100, 'fetch'),
    } as any);
  }
  return (await upscaler) as any;
}

async function upscale(
  src: string,
  onProgress: Progress,
): Promise<{ blob: Blob; width: number; height: number }> {
  const pipe = await getUpscaler(onProgress);
  onProgress(0.5, 'process');
  const out = await pipe(src);
  onProgress(0.95, 'process');
  const { data, width, height, channels } = out as {
    data: Uint8Array | Uint8ClampedArray;
    width: number;
    height: number;
    channels: number;
  };
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    if (channels === 1) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[s];
      rgba[i * 4 + 3] = 255;
    } else {
      rgba[i * 4] = data[s];
      rgba[i * 4 + 1] = data[s + 1];
      rgba[i * 4 + 2] = data[s + 2];
      rgba[i * 4 + 3] = channels === 4 ? data[s + 3] : 255;
    }
  }
  const canvas = new OffscreenCanvas(width, height);
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(rgba, width, height), 0, 0);
  onProgress(1, 'process');
  return { blob: await canvas.convertToBlob({ type: 'image/png' }), width, height };
}

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, op, src, quality, edges } = e.data;
  const onProgress: Progress = (progress, stage) => post({ id, progress, stage });
  try {
    if (op === 'removeBg') {
      const blob = await removeBackgroundCore(
        src!,
        quality ?? 'modnet',
        edges ?? 'auto',
        onProgress,
      );
      post({ id, done: true, blob });
    } else if (op === 'upscale') {
      post({ id, done: true, ...(await upscale(src!, onProgress)) });
    } else if (op === 'prefetchBg') {
      await getBgModel(quality ?? 'modnet', onProgress);
      post({ id, done: true });
    } else if (op === 'prefetchUp') {
      await getUpscaler(onProgress);
      post({ id, done: true });
    }
  } catch (err) {
    const e = err as Error;
    post({
      id,
      error: e?.message ?? String(err),
      gpuUnavailable: e?.name === 'GpuUnavailableError',
    });
  }
};
