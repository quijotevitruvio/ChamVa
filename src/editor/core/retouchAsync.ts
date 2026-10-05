// Cálculo pesado del retoque (parche / eliminar mancha) en el pool de workers, con cancelación.
// Por debajo de ~12 000 píxeles se hace en el momento (más barato que el viaje al worker); por encima
// va al worker para no bloquear la interfaz más de ~50 ms, y se puede abortar (Esc, trazo nuevo).
import { getPixelPool } from './pixelPool';
import { runPoissonJob, type PoissonJob } from './retouch';

export const POISSON_INLINE_PIXELS = 12_000;

export async function runPoissonAsync(job: PoissonJob, signal?: AbortSignal): Promise<Uint8ClampedArray> {
  const n = job.rect.w * job.rect.h;
  if (n <= POISSON_INLINE_PIXELS) return runPoissonJob(job);
  const pool = getPixelPool();
  if (pool.available()) {
    const buf = new ArrayBuffer(n * 9);
    new Uint8ClampedArray(buf, 0, n * 4).set(job.dest);
    new Uint8ClampedArray(buf, n * 4, n * 4).set(job.src);
    new Uint8Array(buf, n * 8, n).set(job.mask);
    try {
      const out = await pool.run({ op: 'poisson', buffer: buf, width: job.rect.w, height: job.rect.h }, { signal, priority: 0, label: 'Retoque' });
      return new Uint8ClampedArray(out);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError' || signal?.aborted) throw e;
      /* worker caído: se calcula aquí */
    }
  }
  if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
  return runPoissonJob(job);
}
