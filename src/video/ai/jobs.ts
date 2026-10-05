// V9b: orquestador de los cálculos de IA del editor de video (quitar fondo y estabilizar). Una cola de trabajos de UNO en UNO
// con estado observable (progreso por fotograma, tiempo restante, cancelación) y el consentimiento de descarga del modelo.
//
// Reglas:
//  - Nada se descarga sin consentimiento: si falta el modelo, la fase pasa a `consent` con el tamaño EXACTO y espera a
//    `acceptConsent()`; sin él no se pide ni un byte (`downloadMatteModel` además lo exige por su cuenta).
//  - Reanudar = volver a calcular: el motor solo calcula lo que falta (por clave y fotograma), así que tras cancelar o fallar
//    basta repetir el trabajo.
//  - Todo es inyectable (`JobDeps`): las pruebas usan motores y relojes simulados; el navegador, `jobsDefault.ts`.
import type { VideoProject } from '../model/types';
import type { MatteDownloadPlan, MatteModelStatus } from './models';
import type { MatteEngine, MatteJob, MatteResult, AiProgress, StabJob } from './analyze';
import type { AiKind } from './aiPlan';
import type { MatteMode } from './matteMath';

export type JobPhase = 'idle' | 'consent' | 'download' | 'running' | 'done' | 'cancelled' | 'error';

export interface JobItem {
  clipId: string;
  kind: AiKind;
  /** tramo del archivo (s); sin él, el del clip */
  range?: [number, number];
}

export interface JobState {
  phase: JobPhase;
  items: JobItem[];
  /** posición del trabajo en curso dentro de `items` */
  index: number;
  clipId?: string;
  kind?: AiKind;
  stage: string;
  done: number;
  total: number;
  ratio: number;
  /** s restantes del trabajo en curso */
  eta?: number;
  /** fotogramas calculados de verdad en esta cola (sin contar los que ya estaban) */
  computed: number;
  /** se pidió cancelar y se espera a que termine el fotograma en curso (el modelo no se puede interrumpir a medias) */
  cancelling: boolean;
  consent: { bytes: number; free?: number; fits: boolean; have: number } | null;
  dl: { ratio: number; bytes: number } | null;
  error?: string;
  /** mensaje legible del final (para el aviso accesible) */
  message: string;
}

export interface JobDeps {
  getProject(): VideoProject;
  matteStatus(): Promise<MatteModelStatus>;
  matteDownloadPlan(): Promise<MatteDownloadPlan>;
  downloadMatteModel(o: { consent: { model: 'modnet'; bytes: number; accepted: true }; onProgress: (r: number) => void; signal: AbortSignal }): Promise<MatteModelStatus>;
  createEngine(): Promise<MatteEngine>;
  computeMatte(p: VideoProject, clipId: string, job: MatteJob): Promise<MatteResult>;
  computeStabilization(p: VideoProject, clipId: string, job: StabJob): Promise<{ computed: number; total: number; ms: number }>;
  /** modo de «quitar fondo» que usa el clip ahora */
  modeOf(p: VideoProject, clipId: string): MatteMode;
  /** guarda lo calculado (persistencia opcional); nunca debe lanzar */
  persist?(item: JobItem): Promise<void>;
  /** tras cada fotograma calculado (p. ej. repintar la vista previa); ya limitado por `JobController` */
  onTick?(): void;
}

const IDLE: JobState = { phase: 'idle', items: [], index: 0, stage: '', done: 0, total: 0, ratio: 0, computed: 0, cancelling: false, consent: null, dl: null, message: '' };

export const isBusy = (s: Pick<JobState, 'phase'>) => s.phase === 'consent' || s.phase === 'download' || s.phase === 'running';

export class JobController {
  private state: JobState = IDLE;
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private consentResolve: ((ok: boolean) => void) | null = null;
  /** ms por fotograma medidos en esta sesión, por modo (mejoran la estimación) */
  readonly measured: Partial<Record<MatteMode, number>> = {};
  private lastTick = 0;
  private lastNotify = 0;
  private pending: Partial<JobState> | null = null;

  constructor(private deps: JobDeps) {}

  setDeps(d: JobDeps) {
    this.deps = d;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<JobState>) {
    this.state = { ...this.state, ...this.pending, ...patch };
    this.pending = null;
    this.lastNotify = Date.now();
    for (const l of [...this.listeners]) l();
  }
  /** Avance de un fotograma: se avisa a la interfaz como mucho cada 120 ms (la estabilización va a decenas de fotogramas por segundo). */
  private progress(patch: Partial<JobState>, last: boolean) {
    if (last || Date.now() - this.lastNotify >= 120) return this.set(patch);
    this.pending = { ...this.pending, ...patch };
  }

  /** ¿Este clip está en la cola (en curso o esperando)? */
  involves(clipId: string): boolean {
    return isBusy(this.state) && this.state.items.some((i) => i.clipId === clipId);
  }

  /** Empieza la cola. Devuelve false si ya hay un cálculo en marcha o no hay nada que hacer. */
  async start(items: JobItem[]): Promise<boolean> {
    if (isBusy(this.state) || !items.length) return false;
    const ac = new AbortController();
    this.abort = ac;
    this.set({ ...IDLE, phase: 'running', items, stage: 'Preparando…', message: '' });
    try {
      if (items.some((i) => i.kind === 'bgremove')) {
        const st = await this.deps.matteStatus();
        if (!st.installed) {
          const plan = await this.deps.matteDownloadPlan();
          this.set({ phase: 'consent', stage: 'Falta el modelo', consent: { bytes: plan.bytesNeeded, free: plan.free, fits: plan.fits, have: plan.bytesHave } });
          const ok = await new Promise<boolean>((res) => (this.consentResolve = res));
          this.consentResolve = null;
          if (!ok || ac.signal.aborted) return this.finish('cancelled', 'No se descargó nada: sin el modelo, «Quitar fondo» no se puede calcular.');
          this.set({ phase: 'download', consent: null, dl: { ratio: 0, bytes: 0 }, stage: 'Descargando el modelo' });
          await this.deps.downloadMatteModel({
            consent: { model: 'modnet', bytes: plan.bytesNeeded, accepted: true },
            signal: ac.signal,
            onProgress: (r) => this.set({ dl: { ratio: r, bytes: Math.round(r * plan.bytesNeeded) } }),
          });
          if (ac.signal.aborted) return this.finish('cancelled', 'Descarga cancelada: lo ya descargado se conserva y continúa donde iba.');
          this.set({ dl: null, phase: 'running' });
        }
      }
      let engine: MatteEngine | null = null;
      try {
        for (let n = 0; n < items.length; n++) {
          const it = items[n];
          if (ac.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
          this.set({ index: n, clipId: it.clipId, kind: it.kind, done: 0, total: 0, ratio: 0, eta: undefined, stage: it.kind === 'bgremove' ? 'Quitando el fondo' : 'Analizando el movimiento' });
          const p = this.deps.getProject();
          const onProgress = (pr: AiProgress) => {
            this.progress({ stage: pr.stage, done: pr.done, total: pr.total, ratio: pr.ratio, eta: pr.eta }, pr.done >= pr.total);
            const now = Date.now();
            if (now - this.lastTick > 250) {
              this.lastTick = now;
              this.deps.onTick?.();
            }
          };
          try {
            if (it.kind === 'bgremove') {
              const mode = this.deps.modeOf(p, it.clipId);
              engine ??= await this.deps.createEngine();
              const r = await this.deps.computeMatte(p, it.clipId, { range: it.range, mode, engine, signal: ac.signal, onProgress });
              if (r.computed > 2 && r.msPerFrame > 0) this.measured[mode] = r.msPerFrame;
              this.set({ computed: this.state.computed + r.computed });
            } else {
              const r = await this.deps.computeStabilization(p, it.clipId, { range: it.range, signal: ac.signal, onProgress });
              this.set({ computed: this.state.computed + r.computed });
            }
          } finally {
            // lo calculado hasta aquí se guarda aunque se cancele o falle: reanudar no lo repite
            await this.deps.persist?.(it).catch(() => undefined);
            this.deps.onTick?.();
          }
        }
      } finally {
        engine?.close();
      }
      const c = this.state.computed;
      return this.finish('done', c === 0 ? 'Todo estaba ya calculado.' : `Calculado: ${c} fotogramas nuevos.`);
    } catch (e) {
      const err = e as Error;
      if (err?.name === 'AbortError' || ac.signal.aborted) return this.finish('cancelled', 'Cancelado. Se conserva lo ya calculado; al volver a pulsar «Calcular» continúa solo con lo que falta.');
      return this.finish('error', err?.message || 'El cálculo falló.', err?.message || 'El cálculo falló.');
    } finally {
      this.abort = null;
    }
  }

  private finish(phase: 'done' | 'cancelled' | 'error', message: string, error?: string): boolean {
    this.set({ phase, message, error, consent: null, dl: null, eta: undefined, stage: '', cancelling: false });
    return phase === 'done';
  }

  /** El usuario acepta la descarga del tamaño indicado. */
  acceptConsent() {
    this.consentResolve?.(true);
  }
  declineConsent() {
    this.consentResolve?.(false);
  }
  /** Cancela lo que esté en marcha (consentimiento, descarga o cálculo). */
  cancel() {
    if (isBusy(this.state) && this.state.phase === 'running' && !this.abort?.signal.aborted) this.set({ cancelling: true });
    this.abort?.abort();
    this.consentResolve?.(false);
  }
  /** Vuelve a «sin actividad» (cierra el resultado anterior). */
  dismiss() {
    if (!isBusy(this.state)) this.set({ ...IDLE });
  }
}
