// Subtítulos automáticos con IA local (V5a): motor, descarga con consentimiento y conversión a subtítulos.
// La interfaz se construye encima de esto (ver client.ts para el flujo).
export * from './models';
export * from './windows';
export * from './subtitles';
export {
  MODEL_CACHE,
  ConsentError,
  IntegrityError,
  DownloadError,
  browserStorageEnv,
  modelStatus,
  downloadPlan,
  downloadModel,
  deleteModel,
  installedModels,
  clearAllModels,
  type StorageEnv,
  type ModelStatus,
  type DownloadPlan,
  type DownloadProgress,
} from './store';
export * from './client';
export { extractProjectAudio, decodeFileTo16k, type ExtractedAudio, type AudioRange } from './audio';
