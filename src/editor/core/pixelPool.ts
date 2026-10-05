// Pool de workers de píxeles con cola de trabajos, progreso, cancelación y caída segura.
// - Hasta `max` workers (≤ hardwareConcurrency-1, tope 3), creados bajo demanda y reutilizados.
// - Cola por prioridad (0 vista previa antes que 1 exportación), FIFO dentro de cada una.
// - Cancelar un trabajo EN CURSO termina su worker (el siguiente trabajo crea otro); uno en
//   cola simplemente se descarta. El rechazo es un `AbortError`.
// - Si no hay `Worker` o falla, `available()` es false / `run` rechaza y el llamador procesa
//   en el hilo principal con la misma función (resultado idéntico).
import type { PixelJobMsg, PixelReply } from './pixelWorkerCore';
import { trackEnd, trackProgress, trackStart } from './processingStore';

/** Bajo este nº de píxeles no compensa el viaje al worker. */
export const MIN_WORKER_PIXELS = 40_000;

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: PixelReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export type PixelJobInput = Omit<PixelJobMsg, 'id'>;

export interface PixelRunOpts {
  signal?: AbortSignal;
  onProgress?: (fraction: number, label: string) => void;
  priority?: number;
  label?: string;
}

interface Job {
  id: number;
  input: PixelJobInput;
  opts: PixelRunOpts;
  resolve: (b: ArrayBuffer) => void;
  reject: (e: Error) => void;
  worker: WorkerLike | null;
  onAbort: (() => void) | null;
}

const abortError = () => new DOMException('cancelado', 'AbortError');

export class PixelPool {
  private idle: WorkerLike[] = [];
  private busy = new Map<WorkerLike, Job>();
  private queue: Job[] = [];
  private nextId = 1;
  private failures = 0;
  private broken = false;
  /** Cuántos workers se han creado en total (para pruebas / diagnóstico). */
  created = 0;

  constructor(
    private factory: () => WorkerLike | null,
    private max: number,
  ) {}

  available(): boolean {
    return !this.broken;
  }

  get pending(): number {
    return this.queue.length + this.busy.size;
  }

  run(input: PixelJobInput, opts: PixelRunOpts = {}): Promise<ArrayBuffer> {
    if (this.broken) return Promise.reject(new Error('sin worker'));
    if (opts.signal?.aborted) return Promise.reject(abortError());
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const job: Job = { id: this.nextId++, input, opts, resolve, reject, worker: null, onAbort: null };
      if (opts.signal) {
        job.onAbort = () => this.cancel(job);
        opts.signal.addEventListener('abort', job.onAbort, { once: true });
      }
      if (opts.label) trackStart({ id: job.id, label: opts.label, priority: opts.priority ?? 0 });
      // Inserción estable por prioridad.
      const pr = opts.priority ?? 0;
      let i = this.queue.length;
      while (i > 0 && (this.queue[i - 1].opts.priority ?? 0) > pr) i--;
      this.queue.splice(i, 0, job);
      this.pump();
    });
  }

  /** Cancela todo (cola y en curso). */
  cancelAll() {
    for (const j of [...this.queue]) this.cancel(j);
    for (const j of [...this.busy.values()]) this.cancel(j);
  }

  private finish(job: Job) {
    if (job.onAbort) job.opts.signal?.removeEventListener('abort', job.onAbort);
    if (job.opts.label) trackEnd(job.id);
  }

  private cancel(job: Job) {
    const qi = this.queue.indexOf(job);
    if (qi >= 0) this.queue.splice(qi, 1);
    else if (job.worker) {
      // En curso: no se puede interrumpir un bucle síncrono, se termina el worker.
      this.busy.delete(job.worker);
      job.worker.terminate();
      job.worker = null;
    } else return; // ya terminado
    this.finish(job);
    job.reject(abortError());
    this.pump();
  }

  private spawn(): WorkerLike | null {
    let w: WorkerLike | null = null;
    try {
      w = this.factory();
    } catch {
      w = null;
    }
    if (!w) {
      this.broken = true;
      return null;
    }
    this.created++;
    w.onmessage = (e) => this.onMessage(w!, e.data);
    w.onerror = () => this.onError(w!);
    return w;
  }

  private pump() {
    while (this.queue.length) {
      let w = this.idle.pop() ?? null;
      if (!w && this.busy.size < this.max) w = this.spawn();
      if (!w) {
        if (this.broken) {
          const q = this.queue.splice(0);
          for (const j of q) {
            this.finish(j);
            j.reject(new Error('sin worker'));
          }
        }
        return;
      }
      const job = this.queue.shift()!;
      job.worker = w;
      this.busy.set(w, job);
      const msg: PixelJobMsg = { id: job.id, ...job.input };
      try {
        w.postMessage(msg, [msg.buffer]);
      } catch (e) {
        this.busy.delete(w);
        w.terminate();
        job.worker = null;
        this.finish(job);
        job.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  private onMessage(w: WorkerLike, r: PixelReply) {
    const job = this.busy.get(w);
    if (!job || r.id !== job.id) return;
    if ('progress' in r) {
      if (job.opts.label) trackProgress(job.id, r.progress, r.label);
      job.opts.onProgress?.(r.progress, r.label);
      return;
    }
    this.busy.delete(w);
    job.worker = null;
    this.idle.push(w);
    this.finish(job);
    this.failures = 0;
    if ('error' in r) job.reject(new Error(r.error));
    else job.resolve(r.buffer);
    this.pump();
  }

  private onError(w: WorkerLike) {
    const job = this.busy.get(w);
    this.busy.delete(w);
    this.idle = this.idle.filter((x) => x !== w);
    w.terminate();
    if (++this.failures >= 2) this.broken = true; // dos fallos seguidos: se deja de intentar
    if (job) {
      job.worker = null;
      this.finish(job);
      job.reject(new Error('worker-error'));
    }
    this.pump();
  }
}

function defaultFactory(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./pixel.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

let pool: PixelPool | null = null;
export function getPixelPool(): PixelPool {
  if (!pool) {
    const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    pool = new PixelPool(defaultFactory, Math.max(1, Math.min(3, hc - 1)));
  }
  return pool;
}

/** Para pruebas: sustituye el pool global. */
export function setPixelPool(p: PixelPool | null) {
  pool = p;
}

export function cancelAllProcessing() {
  pool?.cancelAll();
}
