// V9b: el orquestador de IA de la sesión con sus dependencias reales (navegador): decodificador del motor, MODNet en un worker,
// caché en memoria y persistencia opcional en IndexedDB. Solo lo importa la interfaz (el worker no existe en las pruebas de Node).
import type { VideoProject } from '../model/types';
import { findClip } from '../model/query';
import { browserStorageEnv } from '../../ai/transcribe/store';
import { matteCache, matteKey, motionCache, stabKey } from './cache';
import { aiParamsOf, clearAiMemo, hasAiFx } from './aiFrame';
import { computeMatte, computeStabilization, createModnetEngine, type MatteEngine } from './analyze';
import { JobController, type JobDeps, type JobItem } from './jobs';
import { downloadMatteModel, matteDownloadPlan, matteModelStatus } from './models';
import { AiPersist, MemoryAiStore, idbAiStore, matteStoreKey, mediaFingerprint, stabStoreKey, type AiStore } from './persist';

const storage = browserStorageEnv();
let getProjectFn: () => VideoProject = () => {
  throw new Error('El editor de video aún no registró su proyecto');
};
/** El editor registra cómo leer el proyecto actual (el cálculo siempre lee el último estado). */
export const setAiProjectGetter = (fn: () => VideoProject) => void (getProjectFn = fn);

function makeStore(): AiStore {
  try {
    if (typeof indexedDB !== 'undefined') return idbAiStore();
  } catch {
    /* sin IndexedDB */
  }
  return new MemoryAiStore();
}
export const aiPersist = new AiPersist(makeStore());

/** Puntos de enganche (solo cambian en las pruebas del navegador): el motor de máscaras y el estado del modelo. */
export const aiHooks: { createEngine: () => Promise<MatteEngine>; matteStatus: JobDeps['matteStatus'] } = {
  createEngine: () => createModnetEngine(storage),
  matteStatus: () => matteModelStatus(storage),
};

const modeOf = (p: VideoProject, clipId: string) => {
  const c = findClip(p, clipId)?.clip;
  return (c && aiParamsOf(c, c.start).matte?.mode) || 'quality';
};

/** Claves de almacenamiento persistente de un trabajo (huella del medio + parámetros de cálculo). */
async function keysOf(p: VideoProject, item: JobItem) {
  const c = findClip(p, item.clipId)?.clip;
  const m = c?.mediaId ? p.media[c.mediaId] : undefined;
  if (!c || !m) return null;
  const fp = await mediaFingerprint(m);
  if (!fp) return null;
  return { c, m, fp, mode: modeOf(p, item.clipId) };
}

async function persist(item: JobItem) {
  const k = await keysOf(getProjectFn(), item);
  if (!k) return;
  if (item.kind === 'bgremove') await aiPersist.saveMatte(matteStoreKey(k.fp, k.mode), k.m.name, matteKey(k.m.id, k.mode), matteCache);
  else await aiPersist.saveStab(stabStoreKey(k.fp), k.m.name, stabKey(k.m.id), motionCache);
}

let tick: () => void = () => {};
/** La interfaz pide repintar la vista previa a medida que se calcula. */
export const setAiTick = (fn: () => void) => void (tick = fn);

export const aiJobs = new JobController({
  getProject: () => getProjectFn(),
  matteStatus: () => aiHooks.matteStatus(),
  matteDownloadPlan: () => matteDownloadPlan(storage),
  downloadMatteModel: (o) => downloadMatteModel(storage, o),
  createEngine: () => aiHooks.createEngine(),
  computeMatte,
  computeStabilization,
  modeOf,
  persist,
  onTick: () => tick(),
});

// la interfaz se entera de que las cachés cambiaron (recuperadas de IndexedDB, borradas…) sin esperar a un cálculo
const cacheListeners = new Set<() => void>();
export const subscribeAiCache = (fn: () => void) => (cacheListeners.add(fn), () => void cacheListeners.delete(fn));
export const aiCacheVersion = () => matteCache.version * 1_000_003 + motionCache.version;
const notifyAiCache = () => cacheListeners.forEach((f) => f());

const restored = new Set<string>();
/**
 * Recupera de IndexedDB lo ya calculado de los clips con efectos de origen (al abrir el proyecto o al cambiar de modo), para
 * no recalcular. Devuelve los fotogramas recuperados. Solo lee de este equipo; sin red.
 */
export async function restoreAiCaches(p: VideoProject): Promise<number> {
  if (!aiPersist.enabled) return 0;
  let n = 0;
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (!hasAiFx(c) || !c.mediaId) continue;
      const m = p.media[c.mediaId];
      const prm = aiParamsOf(c, c.start);
      const jobs: { id: string; run: (fp: string) => Promise<number> }[] = [];
      if (prm.matte) {
        const mode = prm.matte.mode;
        jobs.push({ id: `m|${mode}|${c.mediaId}`, run: (fp) => aiPersist.restoreMatte(matteStoreKey(fp, mode), matteKey(c.mediaId!, mode), matteCache) });
      }
      if (prm.stab) jobs.push({ id: `s|${c.mediaId}`, run: (fp) => aiPersist.restoreStab(stabStoreKey(fp), stabKey(c.mediaId!), motionCache) });
      for (const j of jobs) {
        if (restored.has(j.id) || !m) continue;
        restored.add(j.id);
        const fp = await mediaFingerprint(m);
        if (fp) n += await j.run(fp);
      }
    }
  if (n) {
    notifyAiCache();
    tick();
  }
  return n;
}

/** «Borrar cachés de IA»: la memoria de la sesión y lo guardado en este equipo. */
export async function clearAllAiCaches(): Promise<void> {
  matteCache.clear();
  motionCache.clear();
  clearAiMemo();
  restored.clear();
  await aiPersist.deleteAll();
  notifyAiCache();
  tick();
}

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  // solo en desarrollo: acceso desde la consola para las pruebas del navegador
  (window as unknown as Record<string, unknown>).__chamvaAi = { jobs: aiJobs, hooks: aiHooks, persist: aiPersist, matteCache, motionCache, restoreAiCaches, clearAllAiCaches };
}
