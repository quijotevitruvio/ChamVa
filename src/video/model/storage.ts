// Guardado del proyecto de video en IndexedDB (clave `videoProject`) con migración
// segura desde V1:
//
//  1. load(): lee la clave; si es v1 (o algo irreconocible) lo migra EN MEMORIA, sin escribir.
//  2. save() la primera vez: copia el valor original tal cual a `videoProject.v1-backup`
//     (si falla, NO se pisa el original y save devuelve false), escribe el v2, lo relee y
//     lo comprueba; solo entonces borra la copia (y solo si la migración fue completa).
//  3. Un proyecto de una versión FUTURA nunca se pisa (save devuelve false).
import { detectVersion, migrateVideoProject, normalizeV2, serializeProject, type MigrationReport, type StoredVersion } from './migrate';
import { createProject } from './ops';
import { projectCounts } from './query';
import type { MediaAsset, VideoProject } from './types';

export const VIDEO_KEY = 'videoProject';
export const VIDEO_BACKUP_KEY = 'videoProject.v1-backup';

/** Almacén clave→valor (IndexedDB en la app; un Map en las pruebas). */
export interface KvIo {
  get<T>(key: string): Promise<T | null>;
  /** true si se guardó */
  set(key: string, value: unknown): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export interface LoadResult {
  project: VideoProject;
  /** qué había guardado */
  from: StoredVersion;
  /** se recuperó de la copia de seguridad porque la clave principal estaba vacía */
  fromBackup: boolean;
  report: MigrationReport;
}

type MainState = 'unknown' | 'empty' | 'v2' | 'legacy' | 'future';

export class VideoProjectStore {
  private main: MainState = 'unknown';
  /** valor original (no v2) que hay que respaldar antes de pisarlo */
  private legacyRaw: unknown = null;
  private retireBackup = false;
  /** el último save comprobó la relectura */
  lastVerified = false;

  constructor(private io: KvIo) {}

  async load(): Promise<LoadResult> {
    let raw = await this.io.get<unknown>(VIDEO_KEY);
    let fromBackup = false;
    if (raw === null || raw === undefined) {
      // La principal vacía y la copia presente: algo cortó el guardado → se recupera la copia.
      const bak = await this.io.get<unknown>(VIDEO_BACKUP_KEY);
      if (bak !== null && bak !== undefined) {
        raw = bak;
        fromBackup = true;
      }
    }
    const from = detectVersion(raw);
    const { project, report } = migrateVideoProject(raw);
    if (from === 'future') this.main = 'future';
    else if (from === 2 && !fromBackup) this.main = 'v2';
    else if (from === 'empty') this.main = 'empty';
    else {
      this.main = 'legacy';
      this.legacyRaw = raw;
      this.retireBackup = report.complete && !fromBackup;
    }
    return { project, from, fromBackup, report };
  }

  /** ¿Se puede guardar? (false si hay un proyecto de una versión más nueva) */
  get writable(): boolean {
    return this.main !== 'future';
  }

  async save(p: VideoProject): Promise<boolean> {
    if (this.main === 'unknown') await this.load();
    if (this.main === 'future') return false;
    const firstAfterLegacy = this.main === 'legacy';
    if (firstAfterLegacy) {
      // Copia de seguridad del original ANTES de pisarlo (si ya hay una, se conserva: es la más antigua).
      const existing = await this.io.get<unknown>(VIDEO_BACKUP_KEY);
      if (existing === null || existing === undefined) {
        if (!(await this.io.set(VIDEO_BACKUP_KEY, this.legacyRaw))) return false;
      }
    }
    const value = serializeProject(p);
    if (!(await this.io.set(VIDEO_KEY, value))) return false;
    this.lastVerified = false;
    if (firstAfterLegacy || this.main === 'empty') {
      const back = await this.io.get<unknown>(VIDEO_KEY);
      const ok = detectVersion(back) === 2 && sameCounts(back as VideoProject, value);
      this.lastVerified = ok;
      if (!ok) return true; // escrito pero sin confirmar: la copia se queda
      if (firstAfterLegacy && this.retireBackup) await this.io.delete(VIDEO_BACKUP_KEY);
      this.main = 'v2';
      this.legacyRaw = null;
    }
    return true;
  }

  /**
   * «Nuevo proyecto»: deja guardado un proyecto v2 vacío (no se borra la clave, para
   * que load() no «recupere» la copia de seguridad). La copia, si existe, se conserva.
   */
  async clear(): Promise<boolean> {
    if (this.main === 'future') return false;
    if (this.main === 'legacy') {
      const existing = await this.io.get<unknown>(VIDEO_BACKUP_KEY);
      if ((existing === null || existing === undefined) && !(await this.io.set(VIDEO_BACKUP_KEY, this.legacyRaw))) return false;
    }
    if (!(await this.io.set(VIDEO_KEY, serializeProject(createProject())))) return false;
    await this.io.delete(VIDEO_UNDO_KEY);
    this.main = 'v2';
    this.legacyRaw = null;
    return true;
  }
}

// ---------------- historial de deshacer (persistente, como el del diseño) ----------------

export const VIDEO_UNDO_KEY = 'videoProject.undo';
/** Pasos de deshacer que se guardan (los medios de clips borrados viven en disco mientras estén aquí). */
export const PERSIST_UNDO_STEPS = 30;

interface UndoRecord {
  v: 2;
  /** huella del presente: el historial solo vale si el proyecto cargado es este */
  fp: string;
  media: Record<string, MediaAsset>;
  past: (Omit<VideoProject, 'media'> & { mediaIds: string[] })[];
}

/** Huella del contenido (sin Blobs ni URLs): igual antes de guardar y después de cargar. */
export function projectFingerprint(p: VideoProject): string {
  return JSON.stringify(normalizeV2(serializeProject(p) as unknown as Record<string, unknown>), (_k, v) =>
    v instanceof Blob ? `blob:${v.size}:${v.type}` : typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
  );
}

export async function saveUndo(io: KvIo, past: VideoProject[], present: VideoProject): Promise<boolean> {
  const keep = past.slice(-PERSIST_UNDO_STEPS);
  const media: Record<string, MediaAsset> = {};
  const snaps = keep.map((p) => {
    const s = serializeProject(p);
    for (const [id, m] of Object.entries(s.media)) media[id] ??= m;
    const { media: m, ...rest } = s;
    return { ...rest, mediaIds: Object.keys(m) };
  });
  const rec: UndoRecord = { v: 2, fp: projectFingerprint(present), media, past: snaps };
  return io.set(VIDEO_UNDO_KEY, rec);
}

/** Pasos de deshacer guardados para `present` ([] si no hay o son de otro estado). */
export async function loadUndo(io: KvIo, present: VideoProject): Promise<VideoProject[]> {
  const rec = await io.get<UndoRecord>(VIDEO_UNDO_KEY);
  if (!rec || rec.v !== 2 || !Array.isArray(rec.past) || typeof rec.fp !== 'string') return [];
  if (rec.fp !== projectFingerprint(present)) return [];
  try {
    return rec.past.map(({ mediaIds, ...rest }) => {
      const media: Record<string, MediaAsset> = {};
      for (const id of Array.isArray(mediaIds) ? mediaIds : []) if (rec.media?.[id]) media[id] = rec.media[id];
      return normalizeV2({ ...rest, media } as unknown as Record<string, unknown>);
    });
  } catch {
    return [];
  }
}

function sameCounts(a: VideoProject, b: VideoProject): boolean {
  try {
    const x = projectCounts(a);
    const y = projectCounts(b);
    return x.tracks === y.tracks && x.clips === y.clips && x.media === y.media && x.mediaWithBlob === y.mediaWithBlob;
  } catch {
    return false;
  }
}
