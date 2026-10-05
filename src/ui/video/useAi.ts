// V9b: enganche de React con el orquestador de IA y las cachés (estado de los trabajos, versión de las cachés y estado del
// modelo de «quitar fondo»). La lógica está en `video/ai/*`; aquí solo se suscribe.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { VideoProject } from '../../video/model';
import { aiCoverage } from '../../video/ai/aiFrame';
import { aiStatusByClip } from '../../video/ai/aiPlan';
import { aiCacheVersion, aiHooks, aiJobs, subscribeAiCache } from '../../video/ai/jobsDefault';
import type { MatteModelStatus } from '../../video/ai/models';

export const useAiJob = () => useSyncExternalStore(aiJobs.subscribe, aiJobs.getState);

/** Cambia cuando se escribe o se borra algo de las cachés (cálculo, recuperación, borrado). */
const subscribeCaches = (fn: () => void) => {
  const a = subscribeAiCache(fn);
  const b = aiJobs.subscribe(fn);
  return () => (a(), b());
};
export const useAiCacheVersion = () => useSyncExternalStore(subscribeCaches, aiCacheVersion);

/** Cobertura por clip (banda de la línea de tiempo). */
export function useAiStatus(project: VideoProject) {
  const v = useAiCacheVersion();
  return useMemo(() => aiStatusByClip(aiCoverage(project)), [project, v]);
}

/** Estado del modelo de «quitar fondo» (se vuelve a mirar al terminar un trabajo y con `bump`). */
export function useMatteModel() {
  const job = useAiJob();
  const [st, setSt] = useState<MatteModelStatus | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    void aiHooks.matteStatus().then((s) => live && setSt(s)).catch(() => live && setSt(null));
    return () => {
      live = false;
    };
  }, [job.phase, n]);
  return { status: st, refresh: () => setN((x) => x + 1) };
}
