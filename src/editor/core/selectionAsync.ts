// Trabajos de selección y de máscara fuera del hilo principal cuando son grandes.
// A 12 MP la varita, expandir/contraer o desvanecer pasan de ~50 ms: van al pool de workers
// (cola, progreso en «Procesando…», cancelación). Por debajo, o sin worker, en el hilo principal
// con LA MISMA función pura (resultado idéntico byte a byte).
import { getPixelPool } from './pixelPool';
import { runSelJob, type SelJob } from './selection';
import { featherAlpha } from './layerMask';

/** Desde aquí compensa el viaje al worker (≈ 2 MP: unos 10–30 ms en el hilo principal). */
export const SEL_WORKER_PIXELS = 2_000_000;

export interface SelRunOpts {
  signal?: AbortSignal;
  label?: string;
}

async function viaPool(
  input: { op: 'sel' | 'maskFeather'; buffer: ArrayBuffer; width: number; height: number; sel?: SelJob; radius?: number },
  opts: SelRunOpts,
): Promise<Uint8Array | null> {
  const pool = getPixelPool();
  if (!pool.available() || input.width * input.height < SEL_WORKER_PIXELS) return null;
  try {
    const out = await pool.run(input, { signal: opts.signal, priority: 0, label: opts.label });
    return new Uint8Array(out);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    return null; // el worker falló: se hace en el hilo principal
  }
}

/** `src` NO se modifica (se copia antes de transferir). */
export async function runSelJobAsync(job: SelJob, src: Uint8Array | Uint8ClampedArray, w: number, h: number, opts: SelRunOpts = {}): Promise<Uint8Array> {
  const copy = new Uint8Array(src.length);
  copy.set(src);
  const r = await viaPool({ op: 'sel', buffer: copy.buffer as ArrayBuffer, width: w, height: h, sel: job }, { label: 'Selección', ...opts });
  if (r) return r;
  if (opts.signal?.aborted) throw new DOMException('cancelado', 'AbortError');
  return runSelJob(job, src, w, h);
}

export async function featherAlphaAsync(src: Uint8Array, w: number, h: number, radius: number, opts: SelRunOpts = {}): Promise<Uint8Array> {
  if (!(radius >= 0.5)) return new Uint8Array(src);
  const copy = new Uint8Array(src);
  const r = await viaPool({ op: 'maskFeather', buffer: copy.buffer as ArrayBuffer, width: w, height: h, radius }, { label: 'Máscara', ...opts });
  if (r) return r;
  if (opts.signal?.aborted) throw new DOMException('cancelado', 'AbortError');
  return featherAlpha(src, w, h, radius);
}
