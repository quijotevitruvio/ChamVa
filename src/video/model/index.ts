// API pública del modelo de proyecto de video v2 (ver README.md).
export * from './types';
export * from './effects';
export * from './query';
export * from './ops';
export * from './history';
export { detectVersion, migrateVideoProject, normalizeV2, serializeProject, sequenceToProject, type MigrationReport, type StoredVersion } from './migrate';
export { PERSIST_UNDO_STEPS, VIDEO_BACKUP_KEY, VIDEO_KEY, VIDEO_UNDO_KEY, VideoProjectStore, loadUndo, projectFingerprint, saveUndo, type KvIo, type LoadResult } from './storage';
