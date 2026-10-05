// Remuestreo de una imagen completa: en el worker (cancelable, con progreso) o, si no hay
// worker, en el hilo principal. El resultado es el mismo en ambos casos (misma función).
import { resampleRGBA, type ResampleMethod } from './resample';
import { getPixelPool, MIN_WORKER_PIXELS, type PixelRunOpts } from './pixelPool';

export async function resampleAsync(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  method: ResampleMethod,
  opts: PixelRunOpts = {},
): Promise<Uint8ClampedArray> {
  const pool = getPixelPool();
  if (pool.available() && sw * sh >= MIN_WORKER_PIXELS) {
    // El búfer se transfiere: se trabaja con una copia para poder reintentar en el principal.
    const copy = new Uint8ClampedArray(src);
    try {
      const out = await pool.run(
        { op: 'resample', buffer: copy.buffer as ArrayBuffer, width: sw, height: sh, dw, dh, method },
        opts,
      );
      return new Uint8ClampedArray(out);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
    }
  }
  if (opts.signal?.aborted) throw new DOMException('cancelado', 'AbortError');
  return resampleRGBA(src, sw, sh, dw, dh, method, opts.onProgress && ((f) => opts.onProgress!(f, 'Remuestreo')));
}
