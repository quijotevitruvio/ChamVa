// Descarga y caché de los pesos de Whisper. Reglas (la app es offline por principio):
//  - Nada se descarga sin un consentimiento explícito que nombre el tamaño EXACTO (`downloadPlan` → la UI lo
//    enseña → `downloadModel(…, { consent })`). Sin consentimiento, error.
//  - Solo se piden archivos del manifiesto fijado (models.ts), por su URL de commit.
//  - Descarga por trozos de 8 MB guardados en IndexedDB: si se corta (red, cierre, cancelar) se reanuda con
//    `Range` desde el último trozo guardado.
//  - Integridad: tamaño exacto y huella (sha256 calculado mientras llega; sha1 de blob git para los JSON).
//    Si no coincide, se borra lo descargado y se avisa.
//  - Lo completo va a Cache Storage («chamva-models-v1»), con la URL como clave: es justo la que pide
//    Transformers.js, que en el worker de transcripción tiene la red CORTADA para los modelos (solo lee de aquí).
// La lógica recibe el almacenamiento inyectado (`StorageEnv`): las pruebas usan uno simulado.
import { fileUrl, modelBytes, modelFiles, type AsrDevice, type ModelFile, type WhisperSize, WHISPER_MODELS } from './models';
import { Sha256 } from './sha256';

export const MODEL_CACHE = 'chamva-models-v1';
const PART_SIZE = 8 * 1024 * 1024;

export interface BlobCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/** Trozos de descargas a medias, en orden. */
export interface PartStore {
  get(key: string): Promise<Blob[]>;
  append(key: string, index: number, blob: Blob): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface StorageEnv {
  cache: BlobCache;
  parts: PartStore;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  /** sha1 en hexadecimal (crypto.subtle) */
  sha1: (bytes: Uint8Array) => Promise<string>;
}

export class ConsentError extends Error {
  constructor() {
    super('La descarga necesita tu permiso: acepta el tamaño indicado antes de descargar.');
    this.name = 'ConsentError';
  }
}
export class IntegrityError extends Error {
  constructor(file: string, what: string) {
    super(`El archivo «${file}» llegó dañado (${what}). Se ha borrado; vuelve a intentarlo.`);
    this.name = 'IntegrityError';
  }
}
export class DownloadError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DownloadError';
  }
}

export type FileState = 'ok' | 'partial' | 'missing';

export interface ModelStatus {
  size: WhisperSize;
  device: AsrDevice;
  installed: boolean;
  files: { path: string; size: number; state: FileState; have: number }[];
  bytesTotal: number;
  bytesHave: number;
  bytesNeeded: number;
}

async function cachedSize(env: StorageEnv, url: string): Promise<number | null> {
  const r = await env.cache.match(url);
  if (!r) return null;
  const h = Number(r.headers.get('content-length'));
  return Number.isFinite(h) && h > 0 ? h : (await r.blob()).size;
}

const sumSizes = (bs: Blob[]) => bs.reduce((s, b) => s + b.size, 0);

export async function modelStatus(env: StorageEnv, size: WhisperSize, device: AsrDevice): Promise<ModelStatus> {
  const files: ModelStatus['files'] = [];
  for (const f of modelFiles(size, device)) {
    const url = fileUrl(size, f.path);
    const c = await cachedSize(env, url);
    if (c === f.size) {
      files.push({ path: f.path, size: f.size, state: 'ok', have: f.size });
      continue;
    }
    const have = Math.min(f.size, sumSizes(await env.parts.get(url)));
    files.push({ path: f.path, size: f.size, state: have > 0 ? 'partial' : 'missing', have });
  }
  const bytesTotal = modelBytes(size, device);
  const bytesHave = files.reduce((s, f) => s + f.have, 0);
  return { size, device, installed: files.length > 0 && files.every((f) => f.state === 'ok'), files, bytesTotal, bytesHave, bytesNeeded: bytesTotal - bytesHave };
}

export interface DownloadPlan extends ModelStatus {
  storage: { quota?: number; usage?: number; free?: number };
  /** false = el navegador dice que no cabe */
  fits: boolean;
  /** lo que la UI tiene que mostrar y devolver como consentimiento */
  consent: { size: WhisperSize; device: AsrDevice; bytes: number };
}

/** Lo que habría que descargar (para la pantalla de consentimiento): tamaño real pendiente y espacio libre. */
export async function downloadPlan(env: StorageEnv, size: WhisperSize, device: AsrDevice): Promise<DownloadPlan> {
  const st = await modelStatus(env, size, device);
  let storage: DownloadPlan['storage'] = {};
  try {
    const e = (await env.estimate?.()) ?? {};
    storage = { quota: e.quota, usage: e.usage, free: e.quota !== undefined && e.usage !== undefined ? e.quota - e.usage : undefined };
  } catch {
    /* sin estimación */
  }
  // margen: los trozos a medias y la copia final conviven un momento (se cuenta el archivo más grande dos veces)
  const biggest = Math.max(0, ...st.files.filter((f) => f.state !== 'ok').map((f) => f.size));
  const fits = storage.free === undefined ? true : storage.free >= st.bytesNeeded + biggest;
  return { ...st, storage, fits, consent: { size, device, bytes: st.bytesNeeded } };
}

export interface DownloadProgress {
  file: string;
  /** bytes ya presentes del modelo entero */
  loaded: number;
  total: number;
  ratio: number;
}

export interface DownloadOptions {
  /** el objeto `consent` del plan, devuelto tal cual tras aceptar */
  consent: { size: WhisperSize; device: AsrDevice; bytes: number; accepted: true } | null | undefined;
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
}

/**
 * Descarga lo que falte del modelo. Exige el consentimiento del plan (mismo modelo, dispositivo y bytes);
 * si lo pendiente creció desde que se aceptó, hay que volver a preguntar.
 */
export async function downloadModel(env: StorageEnv, size: WhisperSize, device: AsrDevice, o: DownloadOptions): Promise<ModelStatus> {
  const st = await modelStatus(env, size, device);
  if (st.installed) return st;
  const c = o.consent;
  if (!c || c.accepted !== true || c.size !== size || c.device !== device || c.bytes < st.bytesNeeded) throw new ConsentError();
  const total = st.bytesTotal;
  let base = st.files.filter((f) => f.state === 'ok').reduce((s, f) => s + f.size, 0);
  const all = modelFiles(size, device);
  for (const f of st.files) {
    if (f.state === 'ok') continue;
    const mf = all.find((x) => x.path === f.path)!;
    await downloadFile(env, size, mf, (have) => o.onProgress?.({ file: f.path, loaded: base + have, total, ratio: (base + have) / total }), o.signal);
    base += mf.size;
  }
  o.onProgress?.({ file: '', loaded: total, total, ratio: 1 });
  return modelStatus(env, size, device);
}

function abortError(): Error {
  const e = new Error('cancelado');
  e.name = 'AbortError';
  return e;
}

/** Descarga (o reanuda) un archivo, lo verifica y lo deja en la caché. */
export async function downloadFile(env: StorageEnv, size: WhisperSize, f: ModelFile, onBytes: (have: number) => void, signal?: AbortSignal): Promise<void> {
  const url = fileUrl(size, f.path);
  let parts = await env.parts.get(url);
  let have = sumSizes(parts);
  if (have > f.size) {
    await env.parts.clear(url);
    parts = [];
    have = 0;
  }
  let hasher = f.sha256 ? new Sha256() : null;
  if (hasher) for (const p of parts) hasher.update(new Uint8Array(await p.arrayBuffer()));
  let index = parts.length;
  onBytes(have);

  if (have < f.size) {
    if (signal?.aborted) throw abortError();
    let res: Response;
    try {
      res = await env.fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal, cache: 'no-store' });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError' || signal?.aborted) throw abortError();
      throw new DownloadError('Sin conexión: no se pudo descargar el modelo. Conéctate a internet y reanuda la descarga (lo ya descargado se conserva).');
    }
    if (res.status === 200 && have > 0) {
      // el servidor no admite reanudar: se empieza de cero
      await env.parts.clear(url);
      have = 0;
      index = 0;
      hasher = f.sha256 ? new Sha256() : null;
      onBytes(0);
    } else if (res.status === 416) {
      await env.parts.clear(url);
      throw new DownloadError(`No se pudo reanudar «${f.path}»; vuelve a intentarlo para empezar de cero.`);
    } else if (res.status !== 200 && res.status !== 206) {
      throw new DownloadError(`El servidor de modelos respondió ${res.status} al pedir «${f.path}».`);
    }
    if (!res.body) throw new DownloadError('Respuesta vacía del servidor de modelos.');
    const reader = res.body.getReader();
    let pending: Uint8Array[] = [];
    let pendingLen = 0;
    const flush = async () => {
      if (!pendingLen) return;
      await env.parts.append(url, index++, new Blob(pending as BlobPart[]));
      pending = [];
      pendingLen = 0;
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (have + value.length > f.size) throw new IntegrityError(f.path, 'más grande de lo esperado');
        hasher?.update(value);
        pending.push(value);
        pendingLen += value.length;
        have += value.length;
        if (pendingLen >= PART_SIZE) await flush();
        onBytes(have);
      }
      await flush();
    } catch (e) {
      if (e instanceof IntegrityError) {
        await env.parts.clear(url);
        throw e;
      }
      // guardar lo que ya llegó para poder reanudar
      try {
        await flush();
      } catch {
        /* nada */
      }
      if ((e as Error)?.name === 'AbortError' || signal?.aborted) throw abortError();
      throw new DownloadError('La descarga se cortó. Puedes reanudarla: lo ya descargado se conserva.');
    }
    parts = await env.parts.get(url);
  }

  // --- verificación ---
  const blob = new Blob(parts as BlobPart[]);
  if (blob.size !== f.size) {
    await env.parts.clear(url);
    throw new IntegrityError(f.path, `tamaño ${blob.size} en vez de ${f.size}`);
  }
  if (f.sha256) {
    const got = hasher!.hex();
    if (got !== f.sha256) {
      await env.parts.clear(url);
      throw new IntegrityError(f.path, 'la huella sha256 no coincide');
    }
  } else if (f.gitSha1) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(head.length + bytes.length);
    all.set(head);
    all.set(bytes, head.length);
    if ((await env.sha1(all)) !== f.gitSha1) {
      await env.parts.clear(url);
      throw new IntegrityError(f.path, 'la huella sha1 no coincide');
    }
  }
  await env.cache.put(url, new Response(blob, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(f.size) } }));
  await env.parts.clear(url);
}

/** Borra un modelo (las dos variantes, y lo que hubiera a medias). Devuelve los bytes liberados. */
export async function deleteModel(env: StorageEnv, size: WhisperSize): Promise<number> {
  const m = WHISPER_MODELS[size];
  let freed = 0;
  for (const f of [...m.common, ...m.wasm, ...m.webgpu]) {
    const url = fileUrl(size, f.path);
    const c = await cachedSize(env, url);
    if (c) freed += c;
    await env.cache.delete(url);
    freed += sumSizes(await env.parts.get(url));
    await env.parts.clear(url);
  }
  return freed;
}

/** Qué modelos están completos (por dispositivo). */
export async function installedModels(env: StorageEnv): Promise<{ size: WhisperSize; device: AsrDevice }[]> {
  const out: { size: WhisperSize; device: AsrDevice }[] = [];
  for (const size of Object.keys(WHISPER_MODELS) as WhisperSize[])
    for (const device of ['wasm', 'webgpu'] as AsrDevice[]) if ((await modelStatus(env, size, device)).installed) out.push({ size, device });
  return out;
}

// ---------------- almacenamiento real del navegador ----------------

const IDB_NAME = 'chamva-model-parts';
const IDB_STORE = 'parts';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const partKey = (url: string, i: number) => `${url}#${String(i).padStart(6, '0')}`;
const range = (url: string) => IDBKeyRange.bound(`${url}#`, `${url}#￿`);

function idbParts(): PartStore {
  let db: Promise<IDBDatabase> | null = null;
  const tx = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await (db ??= openIdb());
    return new Promise<T>((resolve, reject) => {
      const t = d.transaction(IDB_STORE, mode);
      const req = run(t.objectStore(IDB_STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    get: async (url) => ((await tx('readonly', (s) => s.getAll(range(url)))) as Blob[]) ?? [],
    append: async (url, i, blob) => void (await tx('readwrite', (s) => s.put(blob, partKey(url, i)))),
    clear: async (url) => void (await tx('readwrite', (s) => s.delete(range(url)))),
  };
}

/** Borra TODOS los modelos de transcripción (también restos de revisiones antiguas y descargas a medias). */
export async function clearAllModels(): Promise<void> {
  await caches.delete(MODEL_CACHE);
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(IDB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

/** Almacenamiento del navegador: Cache Storage + IndexedDB + fetch + navigator.storage.estimate. */
export function browserStorageEnv(): StorageEnv {
  let cache: Promise<Cache> | null = null;
  const c = () => (cache ??= caches.open(MODEL_CACHE));
  return {
    cache: {
      match: async (k) => (await c()).match(k),
      put: async (k, r) => (await c()).put(k, r),
      delete: async (k) => (await c()).delete(k),
    },
    parts: idbParts(),
    fetch: (u, i) => fetch(u, i),
    estimate: async () => (navigator.storage?.estimate ? navigator.storage.estimate() : {}),
    sha1: async (bytes) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes as BufferSource)), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}
