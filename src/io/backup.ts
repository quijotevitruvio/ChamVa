// Copia de seguridad completa (`.chamva-backup`): TODA la biblioteca en un solo
// archivo JSON: diseños (con carpetas y etiquetas), plantillas, subidos, kit de
// marca (colores/fuentes/logos), fuentes propias, versiones con nombre y las
// preferencias de usuario (localStorage con prefijo `chamva.`).
//
// Las imágenes viajan UNA vez por contenido en `assets` (mismo hash que el
// almacén de assets.ts) y los documentos solo llevan la referencia `asset:<hash>`,
// igual que en IndexedDB. Importar nunca ejecuta nada del archivo: todo se valida
// como datos y se escribe tal cual en IndexedDB / localStorage.
//
// Parte pura (validar, resumir, combinar) arriba, con pruebas; la parte con
// IndexedDB/localStorage abajo.
import type { SavedTemplate, UploadedImage } from '../editor/core/types';
import type { SavedDesign } from './designs';
import { MAX_DESIGNS } from './designs';
import type { Snapshot } from './snapshots';
import { MAX_SNAPSHOTS } from './snapshots';
import { collectRefs, isAssetRef } from './assets';
import { idbDelete, idbGet, idbKeys, idbSet } from './idb';
import { APP_VERSION } from '../branding';

export const BACKUP_KIND = 'chamva-backup';
/** Versión del esquema. Un archivo con versión mayor se rechaza (viene de una app más nueva). */
export const BACKUP_VERSION = 1;
export const BACKUP_EXT = '.chamva-backup';

export interface FontEntry {
  family: string;
  dataUrl: string;
}

/** Contenido de IndexedDB que viaja en la copia (todo opcional). */
export interface BackupDb {
  designs?: SavedDesign[];
  designFolders?: string[];
  templates?: SavedTemplate[];
  uploads?: UploadedImage[];
  brandKitLogos?: Record<string, UploadedImage[]>;
  snapshots?: Record<string, Snapshot[]>;
}

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: number;
  createdAt: number;
  appVersion?: string;
  data: BackupDb;
  fonts: FontEntry[];
  assets: Record<string, string>; // asset:<hash> → dataURL
  prefs: Record<string, string>; // chamva.* → texto
}

export const DB_KEYS = ['designs', 'designFolders', 'templates', 'uploads', 'brandKitLogos', 'snapshots'] as const;

/** Preferencias que NUNCA viajan (licencia, estado propio de las copias). */
export const PREF_EXCLUDED = ['chamva.license'];
export const PREF_EXCLUDED_PREFIX = 'chamva.backup';
export const isBackupPref = (k: string) =>
  k.startsWith('chamva.') && !PREF_EXCLUDED.includes(k) && !k.startsWith(PREF_EXCLUDED_PREFIX);

// ---- validación ----

const MAX_PREF_LEN = 2_000_000;
const MAX_ITEMS = 20_000;
const ASSET_RE = /^asset:[0-9a-f]{8,64}$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isDocLike(v: unknown): boolean {
  return isObj(v) && isStr(v.id) && Array.isArray(v.layers) && isNum(v.width) && isNum(v.height);
}
function isDesign(v: unknown): v is SavedDesign {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.name) &&
    isNum(v.updatedAt) &&
    Array.isArray(v.pages) &&
    v.pages.length > 0 &&
    v.pages.every(isDocLike) &&
    (v.thumb === undefined || isStr(v.thumb)) &&
    (v.folder === undefined || isStr(v.folder)) &&
    (v.tags === undefined || (Array.isArray(v.tags) && v.tags.every(isStr))) &&
    (v.deletedAt === undefined || isNum(v.deletedAt))
  );
}
const isImage = (v: unknown): v is UploadedImage => isObj(v) && isStr(v.id) && isStr(v.src);
const isTemplate = (v: unknown): v is SavedTemplate => isObj(v) && isStr(v.id) && isDocLike(v.doc);
const isSnap = (v: unknown): v is Snapshot =>
  isObj(v) && isStr(v.id) && isNum(v.ts) && Array.isArray(v.pages) && v.pages.every(isDocLike);

function recordOf<T>(v: unknown, ok: (x: unknown) => x is T): v is Record<string, T[]> {
  if (!isObj(v)) return false;
  for (const [k, list] of Object.entries(v)) {
    if (BAD_KEYS.has(k) || !Array.isArray(list) || list.length > MAX_ITEMS || !list.every(ok)) return false;
  }
  return true;
}

export type Validation = { ok: true; file: BackupFile } | { ok: false; error: string };

/** Comprueba que `raw` (JSON ya parseado) es una copia válida y de versión admitida. */
export function validateBackup(raw: unknown): Validation {
  if (!isObj(raw) || raw.kind !== BACKUP_KIND) return { ok: false, error: 'No es una copia de seguridad de ChamVa.' };
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1)
    return { ok: false, error: 'La copia no indica una versión válida.' };
  if ((raw.version as number) > BACKUP_VERSION)
    return {
      ok: false,
      error: `La copia es de una versión más nueva (${raw.version}). Actualiza ChamVa para poder importarla.`,
    };
  if (!isNum(raw.createdAt)) return { ok: false, error: 'La copia no tiene fecha válida.' };
  const data = raw.data;
  if (!isObj(data)) return { ok: false, error: 'Faltan los datos de la copia.' };

  const bad = (what: string): Validation => ({ ok: false, error: `Archivo dañado o manipulado: ${what}.` });
  const lists: [string, (x: unknown) => boolean][] = [
    ['designs', isDesign],
    ['templates', isTemplate],
    ['uploads', isImage],
    ['designFolders', isStr],
  ];
  for (const [key, ok] of lists) {
    const v = data[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length > MAX_ITEMS || !v.every(ok)) return bad(key);
  }
  if (data.brandKitLogos !== undefined && !recordOf(data.brandKitLogos, isImage)) return bad('logos del kit');
  if (data.snapshots !== undefined && !recordOf(data.snapshots, isSnap)) return bad('versiones');
  for (const k of Object.keys(data)) if (!(DB_KEYS as readonly string[]).includes(k)) return bad(`clave desconocida «${k}»`);

  const fonts = raw.fonts ?? [];
  if (!Array.isArray(fonts) || fonts.length > 500) return bad('fuentes');
  for (const f of fonts) {
    if (!isObj(f) || !isStr(f.family) || !f.family.trim() || !isStr(f.dataUrl) || !/^data:[^,]*;base64,/.test(f.dataUrl))
      return bad('fuentes');
  }
  const assets = raw.assets ?? {};
  if (!isObj(assets)) return bad('imágenes');
  for (const [k, v] of Object.entries(assets)) {
    if (!ASSET_RE.test(k) || !isStr(v) || !v.startsWith('data:')) return bad('imágenes');
  }
  const prefs = raw.prefs ?? {};
  if (!isObj(prefs)) return bad('preferencias');
  for (const [k, v] of Object.entries(prefs)) {
    if (!isBackupPref(k) || BAD_KEYS.has(k) || !isStr(v) || v.length > MAX_PREF_LEN) return bad('preferencias');
  }

  return {
    ok: true,
    file: {
      kind: BACKUP_KIND,
      version: raw.version as number,
      createdAt: raw.createdAt as number,
      appVersion: isStr(raw.appVersion) ? raw.appVersion : undefined,
      data: data as BackupDb,
      fonts: fonts as FontEntry[],
      assets: assets as Record<string, string>,
      prefs: prefs as Record<string, string>,
    },
  };
}

/** Texto → copia validada (nunca lanza). */
export function parseBackupText(text: string): Validation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' };
  }
  return validateBackup(raw);
}

// ---- resumen ----

export interface BackupSummary {
  createdAt: number;
  designs: number;
  trashed: number;
  folders: number;
  templates: number;
  uploads: number;
  brandKits: number;
  logos: number;
  fonts: number;
  snapshots: number;
  images: number;
  prefs: number;
}

export function kitsOfPrefs(prefs: Record<string, string>): { id: string }[] {
  try {
    const v = JSON.parse(prefs['chamva.brandKits'] ?? 'null');
    return Array.isArray(v) ? v.filter((k) => isObj(k) && isStr(k.id)) : [];
  } catch {
    return [];
  }
}

export function summarize(file: BackupFile): BackupSummary {
  const d = file.data;
  const designs = d.designs ?? [];
  const logos = Object.values(d.brandKitLogos ?? {}).reduce((n, l) => n + l.length, 0);
  const snaps = Object.values(d.snapshots ?? {}).reduce((n, l) => n + l.length, 0);
  return {
    createdAt: file.createdAt,
    designs: designs.filter((x) => !x.deletedAt).length,
    trashed: designs.filter((x) => !!x.deletedAt).length,
    folders: (d.designFolders ?? []).length,
    templates: (d.templates ?? []).length,
    uploads: (d.uploads ?? []).length,
    brandKits: kitsOfPrefs(file.prefs).length,
    logos,
    fonts: file.fonts.length,
    snapshots: snaps,
    images: Object.keys(file.assets).length,
    prefs: Object.keys(file.prefs).length,
  };
}

// ---- combinar (no pisa nada de lo que ya hay) ----

export interface MergeState<F extends { family: string } = FontEntry> {
  data: BackupDb;
  fonts: F[];
  prefs: Record<string, string>;
}

export interface MergeStats {
  designsAdded: number;
  designsSkippedLimit: number;
  templatesAdded: number;
  uploadsAdded: number;
  fontsAdded: number;
  snapshotsAdded: number;
  prefsAdded: number;
}

function addMissingById<T extends { id: string }>(cur: T[], inc: T[]): { list: T[]; added: T[] } {
  const have = new Set(cur.map((x) => x.id));
  const added: T[] = [];
  for (const x of inc) {
    if (!have.has(x.id)) {
      have.add(x.id);
      added.push(x);
    }
  }
  return { list: [...cur, ...added], added };
}

function mergeKits(cur: string | undefined, inc: string): string {
  try {
    const a = JSON.parse(cur ?? '[]');
    const b = JSON.parse(inc);
    if (!Array.isArray(a) || !Array.isArray(b)) return cur ?? inc;
    const have = new Set(a.map((k) => (isObj(k) ? k.id : undefined)));
    const extra = b.filter((k) => isObj(k) && isStr(k.id) && !have.has(k.id));
    return JSON.stringify([...a, ...extra]);
  } catch {
    return cur ?? inc;
  }
}

/**
 * «Combinar»: añade lo que falta y deja intacto lo que ya existe.
 * Diseños, plantillas y subidos se comparan por id; carpetas sin distinguir
 * mayúsculas; fuentes por familia; preferencias solo si no existían (los kits de
 * marca se combinan por id). El tope de diseños (MAX_DESIGNS) se respeta.
 */
export function mergeBackup<F extends { family: string }>(
  cur: MergeState<F>,
  inc: MergeState<F>,
): { next: MergeState<F>; stats: MergeStats } {
  const stats: MergeStats = {
    designsAdded: 0,
    designsSkippedLimit: 0,
    templatesAdded: 0,
    uploadsAdded: 0,
    fontsAdded: 0,
    snapshotsAdded: 0,
    prefsAdded: 0,
  };
  const data: BackupDb = { ...cur.data };

  // Diseños
  const curDesigns = cur.data.designs ?? [];
  const { added } = addMissingById(curDesigns, inc.data.designs ?? []);
  let live = curDesigns.filter((d) => !d.deletedAt).length;
  const take: SavedDesign[] = [];
  for (const d of added) {
    if (!d.deletedAt) {
      if (live >= MAX_DESIGNS) {
        stats.designsSkippedLimit++;
        continue;
      }
      live++;
    }
    take.push(d);
  }
  stats.designsAdded = take.length;
  if (curDesigns.length || take.length) data.designs = [...curDesigns, ...take];

  // Carpetas
  const folders = [...(cur.data.designFolders ?? [])];
  const lower = new Set(folders.map((f) => f.toLowerCase()));
  for (const f of inc.data.designFolders ?? []) {
    if (!lower.has(f.toLowerCase())) {
      lower.add(f.toLowerCase());
      folders.push(f);
    }
  }
  // Una carpeta usada por un diseño añadido tiene que existir.
  for (const d of take) {
    if (d.folder && !lower.has(d.folder.toLowerCase())) {
      lower.add(d.folder.toLowerCase());
      folders.push(d.folder);
    }
  }
  if (folders.length) data.designFolders = folders;

  // Plantillas y subidos
  const tpl = addMissingById(cur.data.templates ?? [], inc.data.templates ?? []);
  stats.templatesAdded = tpl.added.length;
  if (tpl.list.length) data.templates = tpl.list;
  const up = addMissingById(cur.data.uploads ?? [], inc.data.uploads ?? []);
  stats.uploadsAdded = up.added.length;
  if (up.list.length) data.uploads = up.list;

  // Logos por kit: por kit, los que falten
  const logos: Record<string, UploadedImage[]> = { ...(cur.data.brandKitLogos ?? {}) };
  for (const [kit, list] of Object.entries(inc.data.brandKitLogos ?? {})) {
    logos[kit] = addMissingById(logos[kit] ?? [], list).list;
  }
  if (Object.keys(logos).length) data.brandKitLogos = logos;

  // Versiones con nombre: por diseño, las que falten (tope MAX_SNAPSHOTS, más nuevas primero)
  const snaps: Record<string, Snapshot[]> = { ...(cur.data.snapshots ?? {}) };
  for (const [id, list] of Object.entries(inc.data.snapshots ?? {})) {
    const m = addMissingById(snaps[id] ?? [], list);
    const room = Math.max(0, MAX_SNAPSHOTS - (snaps[id]?.length ?? 0));
    const addedS = m.added.slice(0, room);
    stats.snapshotsAdded += addedS.length;
    snaps[id] = [...(snaps[id] ?? []), ...addedS].sort((a, b) => b.ts - a.ts);
  }
  if (Object.keys(snaps).length) data.snapshots = snaps;

  // Fuentes
  const have = new Set(cur.fonts.map((f) => f.family));
  const fonts = [...cur.fonts];
  for (const f of inc.fonts) {
    if (!have.has(f.family)) {
      have.add(f.family);
      fonts.push(f);
      stats.fontsAdded++;
    }
  }

  // Preferencias
  const prefs: Record<string, string> = { ...cur.prefs };
  for (const [k, v] of Object.entries(inc.prefs)) {
    if (k === 'chamva.brandKits') {
      const merged = mergeKits(prefs[k], v);
      if (merged !== prefs[k]) stats.prefsAdded++;
      prefs[k] = merged;
    } else if (!(k in prefs) && k !== 'chamva.brandKitActive') {
      prefs[k] = v;
      stats.prefsAdded++;
    } else if (k === 'chamva.brandKitActive' && !(k in prefs)) {
      prefs[k] = v;
    }
  }

  return { next: { data, fonts, prefs }, stats };
}

// ---- recordatorio cada 30 días ----

export const REMIND_DAYS = 30;
const DAY = 86_400_000;

export function isReminderDue(o: {
  now: number;
  lastBackup: number; // 0 = nunca
  firstUse: number; // 0 = desconocido
  hasData: boolean;
  enabled: boolean;
  snoozeUntil: number;
}): boolean {
  if (!o.enabled || !o.hasData || o.now < o.snoozeUntil) return false;
  const base = o.lastBackup || o.firstUse;
  if (!base) return false;
  return o.now - base >= REMIND_DAYS * DAY;
}

// =====================================================================
// Parte con IndexedDB / localStorage / DOM
// =====================================================================
const FONTS_KEY = 'fonts';
const LS_LAST = 'chamva.backupLast';
const LS_REMIND = 'chamva.backupRemind'; // '0' = desactivado
const LS_SNOOZE = 'chamva.backupSnooze';

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento */
  }
};

export const getLastBackup = () => Number(lsGet(LS_LAST) ?? 0) || 0;
export const isReminderEnabled = () => lsGet(LS_REMIND) !== '0';
export const setReminderEnabled = (on: boolean) => lsSet(LS_REMIND, on ? '1' : '0');

function readPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isBackupPref(k)) {
        const v = localStorage.getItem(k);
        if (v !== null && v.length <= MAX_PREF_LEN) out[k] = v;
      }
    }
  } catch {
    /* sin localStorage */
  }
  return out;
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

function dataUrlToBlob(url: string): Blob {
  const m = /^data:([^,;]*)[^,]*;base64,(.*)$/s.exec(url);
  if (!m) throw new Error('Fuente inválida');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || 'font/ttf' });
}

interface StoredFont {
  family: string;
  blob: Blob;
}

async function readDb(): Promise<BackupDb> {
  const data: Record<string, unknown> = {};
  for (const k of DB_KEYS) {
    const v = await idbGet<unknown>(k);
    if (v != null) data[k] = v;
  }
  return data as BackupDb;
}

/** ¿Hay algo que guardar? (para el recordatorio) */
export async function hasLibraryData(): Promise<boolean> {
  const d = await idbGet<SavedDesign[]>('designs');
  return !!d && d.length > 0;
}

/** Genera la copia completa. Devuelve el Blob (JSON) y su resumen. */
export async function buildBackup(): Promise<{ blob: Blob; summary: BackupSummary }> {
  const data = await readDb();
  const stored = (await idbGet<StoredFont[]>(FONTS_KEY)) ?? [];
  const fonts: FontEntry[] = [];
  for (const f of stored) {
    try {
      fonts.push({ family: f.family, dataUrl: await blobToDataUrl(f.blob) });
    } catch {
      /* fuente ilegible: se omite */
    }
  }
  const refs = new Set<string>();
  collectRefs(data, refs);
  const prefs = readPrefs();
  const head: Omit<BackupFile, 'assets'> = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    appVersion: APP_VERSION,
    data,
    fonts,
    prefs,
  };
  const parts: string[] = [JSON.stringify(head).slice(0, -1), ',"assets":{'];
  let first = true;
  let images = 0;
  for (const ref of refs) {
    if (!ASSET_RE.test(ref)) continue;
    const v = await idbGet<string>(ref);
    if (typeof v !== 'string' || !v.startsWith('data:')) continue;
    parts.push((first ? '' : ',') + JSON.stringify(ref) + ':' + JSON.stringify(v));
    first = false;
    images++;
  }
  parts.push('}}');
  const summary = summarize({ ...head, assets: {} });
  summary.images = images;
  return { blob: new Blob(parts, { type: 'application/json' }), summary };
}

export function markBackupDone() {
  lsSet(LS_LAST, String(Date.now()));
}

export function backupFileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `chamva-copia-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${BACKUP_EXT}`;
}

async function readCurrent(): Promise<MergeState<StoredFont>> {
  return {
    data: await readDb(),
    fonts: ((await idbGet<StoredFont[]>(FONTS_KEY)) ?? []).map((f) => ({ family: f.family, blob: f.blob })),
    prefs: readPrefs(),
  };
}

export interface ApplyResult {
  mode: 'merge' | 'replace';
  stats?: MergeStats;
}

/**
 * Escribe la copia en IndexedDB/localStorage. 'merge' no pisa nada; 'replace'
 * sustituye por completo biblioteca, fuentes y preferencias (la sesión en curso,
 * 'autosave', no se toca). Después hay que recargar la aplicación.
 */
export async function applyBackup(file: BackupFile, mode: 'merge' | 'replace'): Promise<ApplyResult> {
  // Imágenes: por contenido, nunca pisan (mismo hash = mismos datos).
  for (const [ref, v] of Object.entries(file.assets)) {
    if (!isAssetRef(ref)) continue;
    if ((await idbGet<string>(ref)) == null) await idbSet(ref, v);
  }
  const incFonts: StoredFont[] = [];
  for (const f of file.fonts) {
    try {
      incFonts.push({ family: f.family, blob: dataUrlToBlob(f.dataUrl) });
    } catch {
      /* fuente ilegible */
    }
  }
  const inc: MergeState<StoredFont> = { data: file.data, fonts: incFonts, prefs: file.prefs };

  let next: MergeState<StoredFont>;
  let stats: MergeStats | undefined;
  if (mode === 'merge') {
    const r = mergeBackup(await readCurrent(), inc);
    next = r.next;
    stats = r.stats;
  } else {
    next = inc;
  }

  for (const k of DB_KEYS) {
    const v = next.data[k];
    if (v !== undefined) await idbSet(k, v);
    else if (mode === 'replace') await idbDelete(k);
  }
  if (next.fonts.length) await idbSet(FONTS_KEY, next.fonts);
  else if (mode === 'replace') await idbDelete(FONTS_KEY);

  if (mode === 'replace') {
    for (const k of Object.keys(readPrefs())) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* noop */
      }
    }
  }
  for (const [k, v] of Object.entries(next.prefs)) if (isBackupPref(k)) lsSet(k, v);
  return { mode, stats };
}

/** Aviso discreto (toast) si hace 30+ días que no se exporta una copia. */
export async function checkBackupReminder(show: (msg: string) => void): Promise<void> {
  try {
    const now = Date.now();
    if (
      !isReminderDue({
        now,
        lastBackup: getLastBackup(),
        firstUse: Number(lsGet('chamva.firstUse') ?? 0) || 0,
        hasData: await hasLibraryData(),
        enabled: isReminderEnabled(),
        snoozeUntil: Number(lsGet(LS_SNOOZE) ?? 0) || 0,
      })
    )
      return;
    lsSet(LS_SNOOZE, String(now + 7 * DAY));
    show('Hace más de 30 días de tu última copia de seguridad. Ajustes → Copia de seguridad → Exportar todo.');
  } catch {
    /* sin aviso */
  }
}

/** Claves `asset:` presentes (para mostrar el tamaño del almacén). */
export async function countStoredImages(): Promise<number> {
  return (await idbKeys('asset:')).length;
}
