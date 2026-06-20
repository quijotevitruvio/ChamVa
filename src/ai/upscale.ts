// Super-resolución (Optimizador / HD) con Swin2SR ×2, local vía Transformers.js.
let upscaler: Promise<any> | null = null;

const MODEL_ID = 'Xenova/swin2SR-classical-sr-x2-64';

async function getUpscaler(onProgress?: (ratio: number, stage: string) => void) {
  const { pipeline } = await import('@huggingface/transformers');
  if (!upscaler) {
    upscaler = pipeline('image-to-image', MODEL_ID, {
      progress_callback: (p: any) =>
        onProgress?.((p?.progress ?? 0) / 100, 'fetch'),
    } as any);
  }
  return upscaler;
}

// Precarga el modelo de upscale (para cachearlo y usar offline después).
export async function prefetchUpscaleModel(
  onProgress?: (ratio: number, stage: string) => void,
): Promise<void> {
  await getUpscaler(onProgress);
}

export interface UpscaleResult {
  dataUrl: string;
  width: number;
  height: number;
}

export async function upscaleImage(
  src: string,
  onProgress?: (ratio: number, stage: string) => void,
): Promise<UpscaleResult> {
  const pipe = await getUpscaler(onProgress);
  onProgress?.(0.5, 'process');
  const output = await pipe(src);
  onProgress?.(1, 'process');
  return rawToResult(output);
}

function rawToResult(img: {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
}): UpscaleResult {
  const { data, width, height, channels } = img;
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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}
