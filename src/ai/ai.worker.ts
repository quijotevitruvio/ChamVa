/// <reference lib="webworker" />
// Worker de IA: ejecuta RMBG-1.4 (quitar fondo) y Swin2SR (upscale) fuera del
// hilo de la UI para que la interfaz no se congele. Protocolo por mensajes:
//   → { id, op: 'removeBg' | 'upscale' | 'prefetchBg' | 'prefetchUp', src? }
//   ← { id, progress, stage }               (avances)
//   ← { id, done: true, ...resultado }      (fin)
//   ← { id, error: string }                 (fallo)

interface Req {
  id: number;
  op: 'removeBg' | 'upscale' | 'prefetchBg' | 'prefetchUp';
  src?: string;
  refine?: boolean;
}

const RMBG_ID = 'briaai/RMBG-1.4';
const UPSCALE_ID = 'Xenova/swin2SR-classical-sr-x2-64';

let rmbgModel: Promise<unknown> | null = null;
let rmbgProcessor: Promise<unknown> | null = null;
let upscaler: Promise<unknown> | null = null;

type Progress = (ratio: number, stage: string) => void;

async function getRMBG(onProgress?: Progress) {
  const { AutoModel, AutoProcessor } = await import('@huggingface/transformers');
  if (!rmbgModel) {
    rmbgModel = AutoModel.from_pretrained(RMBG_ID, {
      config: { model_type: 'custom' },
      progress_callback: (p: any) =>
        onProgress?.((p?.progress ?? 0) / 100, 'fetch'),
    } as any);
  }
  if (!rmbgProcessor) {
    rmbgProcessor = AutoProcessor.from_pretrained(RMBG_ID, {
      config: {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: [0.5, 0.5, 0.5],
        image_std: [1, 1, 1],
        resample: 2,
        rescale_factor: 0.00392156862745098,
        size: { width: 1024, height: 1024 },
      },
    } as any);
  }
  return {
    model: (await rmbgModel) as any,
    processor: (await rmbgProcessor) as any,
  };
}

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

// dataURL → ImageBitmap (en worker no hay <img>).
async function bitmapFromDataURL(src: string): Promise<ImageBitmap> {
  const blob = await (await fetch(src)).blob();
  return createImageBitmap(blob);
}

async function canvasToPngBlob(canvas: OffscreenCanvas): Promise<Blob> {
  return canvas.convertToBlob({ type: 'image/png' });
}

async function removeBg(
  src: string,
  refine: boolean,
  onProgress: Progress,
): Promise<Blob> {
  const { RawImage } = await import('@huggingface/transformers');
  const { model, processor } = await getRMBG(onProgress);
  onProgress(0.5, 'process');

  const image = await RawImage.fromURL(src);
  const { pixel_values } = await processor(image);
  const { output } = await model({ input: pixel_values });

  const maskTensor = (output as any)[0].mul(255).to('uint8');
  const mask = await RawImage.fromTensor(maskTensor).resize(
    image.width,
    image.height,
  );

  const original = await bitmapFromDataURL(src);
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(original, 0, 0);
  original.close();
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < mask.data.length; i++) {
    px.data[i * 4 + 3] = mask.data[i];
  }
  if (refine) refineAlpha(px, canvas.width, canvas.height, 1, 1);
  ctx.putImageData(px, 0, 0);
  onProgress(1, 'process');
  return canvasToPngBlob(canvas);
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
    } else if (channels === 3) {
      rgba[i * 4] = data[s];
      rgba[i * 4 + 1] = data[s + 1];
      rgba[i * 4 + 2] = data[s + 2];
      rgba[i * 4 + 3] = 255;
    } else {
      rgba[i * 4] = data[s];
      rgba[i * 4 + 1] = data[s + 1];
      rgba[i * 4 + 2] = data[s + 2];
      rgba[i * 4 + 3] = data[s + 3];
    }
  }
  const canvas = new OffscreenCanvas(width, height);
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(rgba, width, height), 0, 0);
  onProgress(1, 'process');
  return { blob: await canvasToPngBlob(canvas), width, height };
}

// Refina el alfa in place: erosión 1px + suavizado 1px (quita el halo del borde).
function refineAlpha(
  px: ImageData,
  w: number,
  h: number,
  erode: number,
  feather: number,
) {
  const n = w * h;
  let alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = px.data[i * 4 + 3];
  alpha = minFilter(alpha, w, h, erode);
  alpha = boxBlur(alpha, w, h, feather);
  for (let i = 0; i < n; i++) {
    px.data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(alpha[i])));
  }
}

function minFilter(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx));
        m = Math.min(m, src[y * w + xx]);
      }
      tmp[y * w + x] = m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        m = Math.min(m, tmp[yy * w + x]);
      }
      out[y * w + x] = m;
    }
  return out;
}

function boxBlur(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx));
        sum += src[y * w + xx];
      }
      tmp[y * w + x] = sum / win;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        sum += tmp[yy * w + x];
      }
      out[y * w + x] = sum / win;
    }
  return out;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, op, src, refine } = e.data;
  const onProgress: Progress = (progress, stage) =>
    (self as unknown as Worker).postMessage({ id, progress, stage });
  try {
    if (op === 'removeBg') {
      const blob = await removeBg(src!, refine ?? true, onProgress);
      (self as unknown as Worker).postMessage({ id, done: true, blob });
    } else if (op === 'upscale') {
      const res = await upscale(src!, onProgress);
      (self as unknown as Worker).postMessage({ id, done: true, ...res });
    } else if (op === 'prefetchBg') {
      await getRMBG(onProgress);
      (self as unknown as Worker).postMessage({ id, done: true });
    } else if (op === 'prefetchUp') {
      await getUpscaler(onProgress);
      (self as unknown as Worker).postMessage({ id, done: true });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: (err as Error)?.message ?? String(err),
    });
  }
};
