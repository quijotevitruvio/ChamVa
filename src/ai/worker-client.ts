// Cliente del worker de IA: misma API que background-removal.ts / upscale.ts,
// pero los modelos pesados (RMBG y Swin2SR) corren en un Web Worker para no
// congelar la interfaz. Si el worker falla, cae al hilo principal.
// cancelAI() aborta el trabajo en curso terminando el worker.
import {
  removeImageBackground as removeOnMain,
  type BgQuality,
  type EdgeMode,
  type BgOptions,
} from './background-removal';
import { upscaleImage as upscaleOnMain, type UpscaleResult } from './upscale';

export type { BgQuality, EdgeMode, BgOptions };
export type { UpscaleResult };

type Progress = (ratio: number, stage: string) => void;

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  onProgress?: Progress;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./ai.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (e) => {
    const { id, progress, stage, done, error, ...rest } = e.data ?? {};
    const p = pending.get(id);
    if (!p) return;
    if (typeof progress === 'number') {
      // Aviso global para la insignia «todo local» (ui/LocalBadge.tsx).
      if (String(stage ?? '').startsWith('fetch'))
        window.dispatchEvent(new CustomEvent('chamva:net', { detail: { downloading: progress < 1 } }));
      p.onProgress?.(progress, stage ?? '');
      return;
    }
    pending.delete(id);
    if (error) {
      const err = new Error(error);
      if (e.data.gpuUnavailable) err.name = 'GpuUnavailableError';
      p.reject(err);
    } else if (done) p.resolve(rest);
  };
  worker.onerror = () => {
    // Fallo global del worker: rechazar todo lo pendiente (los llamadores
    // reintentan en el hilo principal).
    failAll(new Error('worker-error'));
  };
  return worker;
}

function failAll(err: Error) {
  pending.forEach((p) => p.reject(err));
  pending.clear();
  worker?.terminate();
  worker = null;
}

// Cancela cualquier trabajo de IA en curso (el próximo uso re-crea el worker,
// pero los modelos ya descargados siguen en la caché del navegador).
export function cancelAI() {
  epoch++;
  failAll(new Error('cancelado'));
}

// Cada cancelAI() sube la época: un trabajo que ya corría en el hilo principal
// (reintento sin worker, que no se puede terminar) ignora su resultado y
// termina como «cancelado». También acepta un AbortSignal opcional.
let epoch = 0;
async function cancelable<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new Error('cancelado');
  const started = epoch;
  const onAbort = () => cancelAI();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const out = await run();
    if (epoch !== started) throw new Error('cancelado');
    return out;
  } catch (e) {
    if (epoch !== started) throw new Error('cancelado');
    throw e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function call<T>(
  msg: Record<string, unknown>,
  onProgress?: Progress,
): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, ...msg });
  });
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

// --- API pública (misma forma que los módulos originales) ---

export function removeImageBackground(
  src: string,
  options: BgOptions & { signal?: AbortSignal } = {},
): Promise<string> {
  return cancelable(() => removeBgImpl(src, options), options.signal);
}

async function removeBgImpl(src: string, options: BgOptions): Promise<string> {
  const { quality = 'modnet', edges = 'auto', onProgress } = options;
  try {
    const { blob } = await call<{ blob: Blob }>(
      { op: 'removeBg', src, quality, edges },
      onProgress,
    );
    return await blobToDataURL(blob);
  } catch (e) {
    const err = e as Error;
    if (err.message === 'cancelado') throw err;
    // El motor de GPU no está disponible: se lo comunicamos al llamador
    // (que cambia a MODNet) en vez de reintentar a ciegas.
    if (err.name === 'GpuUnavailableError') throw err;
    // Reintento en el hilo principal si el worker no está disponible.
    return removeOnMain(src, options);
  }
}

export function upscaleImage(
  src: string,
  onProgress?: Progress,
  signal?: AbortSignal,
): Promise<UpscaleResult> {
  return cancelable(() => upscaleImpl(src, onProgress), signal);
}

async function upscaleImpl(src: string, onProgress?: Progress): Promise<UpscaleResult> {
  let result: UpscaleResult;
  try {
    const { blob, width, height } = await call<{
      blob: Blob;
      width: number;
      height: number;
    }>({ op: 'upscale', src }, onProgress);
    result = { dataUrl: await blobToDataURL(blob), width, height };
  } catch (e) {
    if ((e as Error).message === 'cancelado') throw e;
    result = await upscaleOnMain(src, onProgress);
  }
  return restoreAlpha(src, result);
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

// Swin2SR solo devuelve RGB: una imagen con fondo quitado perdería su
// transparencia al optimizar. Reescalamos el canal alfa original al nuevo
// tamaño (bilineal) y lo volvemos a aplicar.
async function restoreAlpha(
  src: string,
  res: UpscaleResult,
): Promise<UpscaleResult> {
  const orig = await loadImg(src);
  const probe = document.createElement('canvas');
  probe.width = orig.naturalWidth;
  probe.height = orig.naturalHeight;
  const pctx = probe.getContext('2d')!;
  pctx.drawImage(orig, 0, 0);
  const px = pctx.getImageData(0, 0, probe.width, probe.height).data;
  let hasAlpha = false;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 255) {
      hasAlpha = true;
      break;
    }
  }
  if (!hasAlpha) return res;

  const { width, height } = res;
  const alphaC = document.createElement('canvas');
  alphaC.width = width;
  alphaC.height = height;
  const actx = alphaC.getContext('2d')!;
  actx.imageSmoothingQuality = 'high';
  actx.drawImage(orig, 0, 0, width, height);
  const alpha = actx.getImageData(0, 0, width, height).data;

  const up = await loadImg(res.dataUrl);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const octx = out.getContext('2d')!;
  octx.drawImage(up, 0, 0);
  const img = octx.getImageData(0, 0, width, height);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = alpha[i];
  octx.putImageData(img, 0, 0);
  return { dataUrl: out.toDataURL('image/png'), width, height };
}

export function prefetchBgModel(
  onProgress?: Progress,
  quality: BgQuality = 'modnet',
  signal?: AbortSignal,
): Promise<void> {
  return cancelable(() => prefetchBgImpl(onProgress, quality), signal);
}

async function prefetchBgImpl(onProgress: Progress | undefined, quality: BgQuality): Promise<void> {
  try {
    await call({ op: 'prefetchBg', quality }, onProgress);
  } catch (e) {
    if ((e as Error).message === 'cancelado') throw e;
    const { prefetchBgModel: main } = await import('./background-removal');
    await main(onProgress, quality);
  }
}

export function prefetchUpscaleModel(
  onProgress?: Progress,
  signal?: AbortSignal,
): Promise<void> {
  return cancelable(() => prefetchUpImpl(onProgress), signal);
}

async function prefetchUpImpl(onProgress?: Progress): Promise<void> {
  try {
    await call({ op: 'prefetchUp' }, onProgress);
  } catch (e) {
    if ((e as Error).message === 'cancelado') throw e;
    const { prefetchUpscaleModel: main } = await import('./upscale');
    await main(onProgress);
  }
}
