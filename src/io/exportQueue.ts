// Cola de exportación: las exportaciones largas (lotes, ZIP de muchas páginas,
// animaciones) se ejecutan de una en una, con progreso y cancelación, sin
// bloquear la pantalla. Lógica pura (sin DOM); el panel es ui/ExportQueuePanel.tsx.
//
// Nota: JavaScript sigue siendo de un solo hilo; los trabajos deben ceder el
// control con `await` entre pasos para que la interfaz respire.

export type JobStatus = 'waiting' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobInfo {
  id: number;
  label: string;
  status: JobStatus;
  done: number; // pasos hechos
  total: number; // 0 = progreso desconocido
  detail?: string;
  error?: string;
}

export interface JobCtx {
  signal: AbortSignal;
  isCancelled: () => boolean;
  progress: (done: number, total: number, detail?: string) => void;
  // Para trabajos que no miran `signal` (p. ej. cancelExport de runExport.ts).
  onCancel: (fn: () => void) => void;
}

export type JobRun = (ctx: JobCtx) => Promise<void>;

interface Internal {
  info: JobInfo;
  run: JobRun;
  ctrl: AbortController;
  hooks: (() => void)[];
  resolve: (s: JobStatus) => void;
}

export class ExportQueue {
  private jobs: Internal[] = [];
  private listeners = new Set<() => void>();
  private snapshot: JobInfo[] = [];
  private seq = 0;
  private running = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = this.jobs.map((j) => ({ ...j.info }));
    this.listeners.forEach((f) => f());
  }

  // Añade un trabajo. La promesa se resuelve con el estado final (nunca rechaza).
  enqueue(label: string, run: JobRun): { id: number; done: Promise<JobStatus> } {
    const id = ++this.seq;
    let resolve!: (s: JobStatus) => void;
    const done = new Promise<JobStatus>((r) => (resolve = r));
    this.jobs.push({
      info: { id, label, status: 'waiting', done: 0, total: 0 },
      run,
      ctrl: new AbortController(),
      hooks: [],
      resolve,
    });
    this.emit();
    void this.pump();
    return { id, done };
  }

  cancel(id: number) {
    const j = this.jobs.find((x) => x.info.id === id);
    if (!j) return;
    if (j.info.status === 'waiting') {
      j.info.status = 'cancelled';
      j.resolve('cancelled');
      this.emit();
    } else if (j.info.status === 'running' && !j.ctrl.signal.aborted) {
      j.ctrl.abort();
      j.hooks.forEach((h) => h());
      this.emit();
    }
  }

  // Quita de la lista los terminados (hechos, con error o cancelados).
  clearFinished() {
    this.jobs = this.jobs.filter((j) => j.info.status === 'waiting' || j.info.status === 'running');
    this.emit();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const j = this.jobs.find((x) => x.info.status === 'waiting');
        if (!j) break;
        j.info.status = 'running';
        this.emit();
        const ctx: JobCtx = {
          signal: j.ctrl.signal,
          isCancelled: () => j.ctrl.signal.aborted,
          progress: (done, total, detail) => {
            j.info.done = done;
            j.info.total = total;
            j.info.detail = detail;
            this.emit();
          },
          onCancel: (fn) => {
            if (j.ctrl.signal.aborted) fn();
            else j.hooks.push(fn);
          },
        };
        try {
          await j.run(ctx);
          j.info.status = j.ctrl.signal.aborted ? 'cancelled' : 'done';
        } catch (e) {
          if (j.ctrl.signal.aborted) j.info.status = 'cancelled';
          else {
            j.info.status = 'error';
            j.info.error = e instanceof Error ? e.message : String(e);
          }
        }
        j.resolve(j.info.status);
        this.emit();
      }
    } finally {
      this.running = false;
    }
  }
}

export const exportQueue = new ExportQueue();

// Atajo: encola y devuelve el estado final.
export function runInQueue(label: string, run: JobRun): Promise<JobStatus> {
  return exportQueue.enqueue(label, run).done;
}
