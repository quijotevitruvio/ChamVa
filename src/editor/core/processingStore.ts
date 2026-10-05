// Estado de los trabajos de procesado largos: alimenta el indicador «Procesando…» con barra
// de progreso y botón Cancelar. Solo informa; no decide nada del resultado.
import { create } from 'zustand';

export interface ProcJob {
  id: number;
  label: string;
  progress: number; // 0..1
  stage: string;
  startedAt: number;
  priority: number; // 0 vista previa · 1 exportación
}

export const useProcessing = create<{ jobs: ProcJob[] }>(() => ({ jobs: [] }));

export function trackStart(job: Omit<ProcJob, 'progress' | 'stage' | 'startedAt'>) {
  useProcessing.setState((s) => ({
    jobs: [...s.jobs.filter((j) => j.id !== job.id), { ...job, progress: 0, stage: '', startedAt: Date.now() }],
  }));
}

export function trackProgress(id: number, progress: number, stage: string) {
  useProcessing.setState((s) => ({
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, progress: Math.max(0, Math.min(1, progress)), stage } : j)),
  }));
}

export function trackEnd(id: number) {
  useProcessing.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
}
