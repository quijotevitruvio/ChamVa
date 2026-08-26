// Cliente del worker de IA: misma API que background-removal.ts / upscale.ts,
// pero los modelos pesados (RMBG y Swin2SR) corren en un Web Worker para no
// congelar la interfaz. Si el worker falla, cae al hilo principal.
// cancelAI() aborta el trabajo en curso terminando el worker.
import {
  removeImageBackground as removeOnMain,
  type BgQuality,
} from './background-removal';
import { upscaleImage as upscaleOnMain, type UpscaleResult } from './upscale';

export type { BgQuality };
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
      p.onProgress?.(progress, stage ?? '');
      return;
    }
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else if (done) p.resolve(rest);
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
  failAll(new Error('cancelado'));
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

export async function removeImageBackground(
  src: string,
  options: {
    quality?: BgQuality;
    refine?: boolean;
    onProgress?: Progress;
  } = {},
): Promise<string> {
  const { quality = 'maxima', refine = true, onProgress } = options;
  // imgly (alta/rapido) sigue en el hilo principal: su bundle no está
  // preparado para workers. RMBG (máxima) sí va al worker.
  if (quality !== 'maxima') {
    return removeOnMain(src, options);
  }
  try {
    const { blob } = await call<{ blob: Blob }>(
      { op: 'removeBg', src, refine },
      onProgress,
    );
    return await blobToDataURL(blob);
  } catch (e) {
    if ((e as Error).message === 'cancelado') throw e;
    // Reintento en el hilo principal si el worker no está disponible.
    return removeOnMain(src, options);
  }
}

export async function upscaleImage(
  src: string,
  onProgress?: Progress,
): Promise<UpscaleResult> {
  try {
    const { blob, width, height } = await call<{
      blob: Blob;
      width: number;
      height: number;
    }>({ op: 'upscale', src }, onProgress);
    return { dataUrl: await blobToDataURL(blob), width, height };
  } catch (e) {
    if ((e as Error).message === 'cancelado') throw e;
    return upscaleOnMain(src, onProgress);
  }
}

export async function prefetchBgModel(onProgress?: Progress): Promise<void> {
  try {
    await call({ op: 'prefetchBg' }, onProgress);
  } catch (e) {
    if ((e as Error).message === 'cancelado') throw e;
    const { prefetchBgModel: main } = await import('./background-removal');
    await main(onProgress);
  }
}

export async function prefetchUpscaleModel(
  onProgress?: Progress,
): Promise<void> {
  try {
    await call({ op: 'prefetchUp' }, onProgress);
  } catch (e) {
    if ((e as Error).message === 'cancelado') throw e;
    const { prefetchUpscaleModel: main } = await import('./upscale');
    await main(onProgress);
  }
}
