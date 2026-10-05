// V9b: persistencia OPCIONAL de las cachés de «quitar fondo» y «estabilizar» en IndexedDB, para que reabrir el proyecto no
// obligue a recalcular. Clave = huella del MEDIO (no su id de sesión) + parámetros de cálculo (modelo y modo; la
// estabilización no depende de parámetros: el suavizado se calcula al vuelo). Con límite de espacio (se sueltan primero
// las pistas menos usadas) y un botón «Borrar cachés de IA». Los datos son DERIVADOS del archivo del usuario y solo viven
// en este equipo; nada sale de él.
//
// La lógica recibe el almacén inyectado (`AiStore`): las pruebas usan `MemoryAiStore`; el navegador, `idbAiStore()`.
import type { MediaAsset } from '../model/types';
import type { MaskCache, MotionCache } from './cache';
import type { MatteMode } from './matteMath';

export const AI_DB = 'chamva-ai-cache';
export const MIN_BUDGET_MB = 64;
export const MAX_BUDGET_MB = 8192;
export const DEFAULT_BUDGET_MB = 512;

export interface PersistSettings {
  enabled: boolean;
  budgetMB: number;
}
export const DEFAULT_SETTINGS: PersistSettings = { enabled: true, budgetMB: DEFAULT_BUDGET_MB };
const SETTINGS_KEY = 'chamva.ai.persist';

export const clampBudgetMB = (v: number) => (Number.isFinite(v) ? Math.max(MIN_BUDGET_MB, Math.min(MAX_BUDGET_MB, Math.round(v))) : DEFAULT_BUDGET_MB);

export function parseSettings(raw: string | null | undefined): PersistSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const v = JSON.parse(raw) as Partial<PersistSettings>;
    return { enabled: v.enabled !== false, budgetMB: clampBudgetMB(Number(v.budgetMB ?? DEFAULT_BUDGET_MB)) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function loadSettings(): PersistSettings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(s: PersistSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: s.enabled, budgetMB: clampBudgetMB(s.budgetMB) }));
  } catch {
    /* sin almacenamiento: se queda en memoria */
  }
}

// ---------- claves ----------

/** Huella del medio a partir de lo que se lee de él (tamaño, duración y el hash de tres trozos): igual en cada sesión. */
export const fingerprintKey = (size: number, duration: number, hex: string) => `${size}-${Math.round(duration * 1000)}-${hex}`;

/** Clave persistente de las máscaras: modelo + modo + huella (el id de medio cambia de sesión en sesión; la huella no). */
export const matteStoreKey = (fp: string, mode: MatteMode, model = 'modnet') => `matte|${model}|${mode}|${fp}`;
export const stabStoreKey = (fp: string) => `stab|${fp}`;

export type TrackKind = 'matte' | 'stab';
export const kindOfKey = (k: string): TrackKind => (k.startsWith('stab|') ? 'stab' : 'matte');

// ---------- límite de espacio ----------

export interface TrackMeta {
  key: string;
  kind: TrackKind;
  w: number;
  h: number;
  fps: number;
  /** nombre del medio (solo para mostrarlo) */
  name: string;
  /** nº de fotogramas guardados y bytes que ocupan */
  count: number;
  bytes: number;
  /** último uso (ms desde 1970) */
  used: number;
  /** estabilización: el movimiento va aquí (es pequeño) */
  motion?: [number, { dx: number; dy: number; da: number; ds: number; ok: boolean }][];
}

/**
 * Qué pistas hay que soltar (las menos usadas primero) para que `incoming` bytes quepan en `budget`. Nunca suelta `keep`.
 * `fits` = false si ni vaciando todo lo demás cabe (no se guarda).
 */
export function planEviction(metas: Pick<TrackMeta, 'key' | 'bytes' | 'used'>[], incoming: number, budget: number, keep: string): { drop: string[]; fits: boolean } {
  const others = metas.filter((m) => m.key !== keep);
  const own = metas.find((m) => m.key === keep)?.bytes ?? 0;
  let total = others.reduce((s, m) => s + m.bytes, 0) + own + incoming;
  if (own + incoming > budget) return { drop: [], fits: false };
  const drop: string[] = [];
  for (const m of [...others].sort((a, b) => a.used - b.used)) {
    if (total <= budget) break;
    drop.push(m.key);
    total -= m.bytes;
  }
  return { drop, fits: total <= budget };
}

// ---------- almacén ----------

export interface AiStore {
  listMeta(): Promise<TrackMeta[]>;
  getMeta(key: string): Promise<TrackMeta | undefined>;
  putMeta(meta: TrackMeta): Promise<void>;
  putFrames(key: string, frames: [number, Uint8Array][]): Promise<void>;
  getFrames(key: string): Promise<[number, Uint8Array][]>;
  deleteTrack(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** Almacén en memoria (pruebas, y respaldo si IndexedDB no está disponible). */
export class MemoryAiStore implements AiStore {
  meta = new Map<string, TrackMeta>();
  frames = new Map<string, Map<number, Uint8Array>>();
  async listMeta() {
    return [...this.meta.values()].map((m) => ({ ...m }));
  }
  async getMeta(key: string) {
    const m = this.meta.get(key);
    return m ? { ...m } : undefined;
  }
  async putMeta(meta: TrackMeta) {
    this.meta.set(meta.key, { ...meta });
  }
  async putFrames(key: string, frames: [number, Uint8Array][]) {
    const m = this.frames.get(key) ?? new Map();
    for (const [i, b] of frames) m.set(i, b.slice());
    this.frames.set(key, m);
  }
  async getFrames(key: string) {
    return [...(this.frames.get(key) ?? [])].map(([i, b]) => [i, b.slice()] as [number, Uint8Array]);
  }
  async deleteTrack(key: string) {
    this.meta.delete(key);
    this.frames.delete(key);
  }
  async clear() {
    this.meta.clear();
    this.frames.clear();
  }
}

const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => ((tx.oncomplete = () => res()), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error))));

/** IndexedDB: `meta` (una fila por pista) y `frames` (una fila por fotograma, clave «pista#n»: lo nuevo se añade sin reescribir lo viejo). */
export function idbAiStore(factory: IDBFactory = indexedDB): AiStore {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () =>
    (dbp ??= new Promise<IDBDatabase>((res, rej) => {
      const o = factory.open(AI_DB, 1);
      o.onupgradeneeded = () => {
        o.result.createObjectStore('meta', { keyPath: 'key' });
        o.result.createObjectStore('frames');
      };
      o.onsuccess = () => res(o.result);
      o.onerror = () => rej(o.error);
    }));
  const range = (key: string) => IDBKeyRange.bound(`${key}#`, `${key}#￿`);
  return {
    async listMeta() {
      const d = await db();
      return req(d.transaction('meta').objectStore('meta').getAll() as IDBRequest<TrackMeta[]>);
    },
    async getMeta(key) {
      const d = await db();
      return (await req(d.transaction('meta').objectStore('meta').get(key))) as TrackMeta | undefined;
    },
    async putMeta(meta) {
      const d = await db();
      const tx = d.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(meta);
      await done(tx);
    },
    async putFrames(key, frames) {
      const d = await db();
      const tx = d.transaction('frames', 'readwrite');
      const st = tx.objectStore('frames');
      for (const [i, b] of frames) st.put(b.slice().buffer, `${key}#${i}`);
      await done(tx);
    },
    async getFrames(key) {
      const d = await db();
      const st = d.transaction('frames').objectStore('frames');
      const [keys, vals] = await Promise.all([req(st.getAllKeys(range(key))), req(st.getAll(range(key)))]);
      return keys.map((k, n) => [Number(String(k).slice(key.length + 1)), new Uint8Array(vals[n] as ArrayBuffer)] as [number, Uint8Array]);
    },
    async deleteTrack(key) {
      const d = await db();
      const tx = d.transaction(['meta', 'frames'], 'readwrite');
      tx.objectStore('meta').delete(key);
      tx.objectStore('frames').delete(range(key));
      await done(tx);
    },
    async clear() {
      const d = await db();
      const tx = d.transaction(['meta', 'frames'], 'readwrite');
      tx.objectStore('meta').clear();
      tx.objectStore('frames').clear();
      await done(tx);
    },
  };
}

// ---------- huella del medio ----------

const SAMPLE = 256 * 1024;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const fpMemo = new WeakMap<object, Promise<string>>();

/** Huella estable de un medio: tamaño + duración + SHA-256 de tres trozos (inicio, mitad y final) del archivo. Sin leer el archivo entero. */
export function mediaFingerprint(m: Pick<MediaAsset, 'blob' | 'duration'>): Promise<string | null> {
  const blob = m.blob;
  if (!blob) return Promise.resolve(null);
  let p = fpMemo.get(blob);
  if (!p) {
    p = (async () => {
      const size = blob.size;
      const parts = [blob.slice(0, SAMPLE), blob.slice(Math.max(0, Math.floor(size / 2) - SAMPLE / 2), Math.floor(size / 2) + SAMPLE / 2), blob.slice(Math.max(0, size - SAMPLE))];
      const buf = new Uint8Array(parts.length * SAMPLE);
      let off = 0;
      for (const part of parts) {
        const a = new Uint8Array(await part.arrayBuffer());
        buf.set(a, off);
        off += SAMPLE;
      }
      return fingerprintKey(size, m.duration, hex(await crypto.subtle.digest('SHA-256', buf.subarray(0, off))).slice(0, 32));
    })();
    fpMemo.set(blob, p);
  }
  return p.then((s) => s).catch(() => null);
}

// ---------- el servicio ----------

export interface PersistStats {
  bytes: number;
  tracks: number;
  list: TrackMeta[];
}

/** Guarda y recupera pistas de las cachés en memoria. Un fallo de almacenamiento nunca rompe el cálculo (devuelve false). */
export class AiPersist {
  /** qué fotogramas de cada pista ya están guardados (para escribir solo lo nuevo) */
  private saved = new Map<string, Set<number>>();
  constructor(
    private store: AiStore,
    public settings: () => PersistSettings = loadSettings,
    private now: () => number = () => Date.now(),
  ) {}

  get enabled() {
    return this.settings().enabled;
  }
  get budget() {
    return clampBudgetMB(this.settings().budgetMB) * 1048576;
  }

  async stats(): Promise<PersistStats> {
    const list = await this.store.listMeta();
    return { bytes: list.reduce((s, m) => s + m.bytes, 0), tracks: list.length, list: list.sort((a, b) => b.used - a.used) };
  }

  /** Guarda lo calculado de una pista de máscaras (solo los fotogramas que faltan). */
  async saveMatte(storeKey: string, name: string, memKey: string, cache: MaskCache): Promise<boolean> {
    if (!this.enabled) return false;
    const tr = cache.peek(memKey);
    if (!tr || !tr.frames.size) return false;
    try {
      const have = this.saved.get(storeKey) ?? new Set<number>();
      const fresh: [number, Uint8Array][] = [];
      for (const [i, m] of tr.frames) if (!have.has(i)) fresh.push([i, m]);
      const prev = await this.store.getMeta(storeKey);
      const sameShape = !!prev && prev.w === tr.w && prev.h === tr.h && prev.fps === tr.fps;
      if (prev && !sameShape) {
        await this.store.deleteTrack(storeKey);
        have.clear();
        fresh.length = 0;
        for (const [i, m] of tr.frames) fresh.push([i, m]);
      }
      if (!fresh.length && sameShape) {
        await this.store.putMeta({ ...prev!, used: this.now() });
        return true;
      }
      const baseBytes = sameShape ? prev!.bytes : 0;
      const add = fresh.length * tr.w * tr.h;
      const plan = planEviction(await this.store.listMeta(), add, this.budget, storeKey);
      if (!plan.fits) return false;
      for (const k of plan.drop) {
        await this.store.deleteTrack(k);
        this.saved.delete(k);
      }
      await this.store.putFrames(storeKey, fresh);
      for (const [i] of fresh) have.add(i);
      this.saved.set(storeKey, have);
      await this.store.putMeta({ key: storeKey, kind: 'matte', w: tr.w, h: tr.h, fps: tr.fps, name, count: have.size, bytes: baseBytes + add, used: this.now() });
      return true;
    } catch {
      return false;
    }
  }

  /** Guarda el movimiento medido (pequeño: va dentro de la fila `meta`). */
  async saveStab(storeKey: string, name: string, memKey: string, cache: MotionCache): Promise<boolean> {
    if (!this.enabled) return false;
    const tr = cache.peek(memKey);
    if (!tr || !tr.motion.size) return false;
    try {
      const bytes = tr.motion.size * 64;
      const plan = planEviction(await this.store.listMeta(), bytes, this.budget, storeKey);
      if (!plan.fits) return false;
      for (const k of plan.drop) {
        await this.store.deleteTrack(k);
        this.saved.delete(k);
      }
      await this.store.putMeta({ key: storeKey, kind: 'stab', w: tr.w, h: tr.h, fps: tr.fps, name, count: tr.motion.size, bytes, used: this.now(), motion: [...tr.motion] });
      return true;
    } catch {
      return false;
    }
  }

  /** Vuelve a poner en la caché en memoria lo guardado. Devuelve cuántos fotogramas recuperó (0 = nada guardado / apagado). */
  async restoreMatte(storeKey: string, memKey: string, cache: MaskCache): Promise<number> {
    if (!this.enabled) return 0;
    try {
      const meta = await this.store.getMeta(storeKey);
      if (!meta || meta.kind !== 'matte') return 0;
      const have = cache.peek(memKey);
      if (have && have.w === meta.w && have.h === meta.h && have.frames.size >= meta.count) return 0;
      const frames = await this.store.getFrames(storeKey);
      if (!frames.length) return 0;
      cache.track(memKey, meta.w, meta.h, meta.fps);
      const set = new Set<number>();
      let n = 0;
      for (const [i, m] of frames) {
        if (m.length !== meta.w * meta.h) continue;
        if (cache.has(memKey, i)) {
          set.add(i);
          continue;
        }
        cache.put(memKey, i, m);
        set.add(i);
        n++;
      }
      this.saved.set(storeKey, set);
      await this.store.putMeta({ ...meta, used: this.now() });
      return n;
    } catch {
      return 0;
    }
  }

  async restoreStab(storeKey: string, memKey: string, cache: MotionCache): Promise<number> {
    if (!this.enabled) return 0;
    try {
      const meta = await this.store.getMeta(storeKey);
      if (!meta || meta.kind !== 'stab' || !meta.motion?.length) return 0;
      const cur = cache.peek(memKey);
      if (cur && cur.w === meta.w && cur.h === meta.h && cur.motion.size >= meta.count) return 0;
      cache.track(memKey, meta.w, meta.h, meta.fps);
      let n = 0;
      for (const [i, m] of meta.motion) {
        if (!cache.peek(memKey)!.motion.has(i)) {
          cache.put(memKey, i, m);
          n++;
        }
      }
      await this.store.putMeta({ ...meta, used: this.now() });
      return n;
    } catch {
      return 0;
    }
  }

  async deleteAll(): Promise<void> {
    this.saved.clear();
    await this.store.clear();
  }

  /** Se suelta lo que ya no cabe tras bajar el límite. Devuelve cuántas pistas borró. */
  async enforceBudget(): Promise<number> {
    try {
      const metas = await this.store.listMeta();
      const plan = planEviction(metas, 0, this.budget, '\u0000');
      for (const k of plan.drop) {
        await this.store.deleteTrack(k);
        this.saved.delete(k);
      }
      return plan.drop.length;
    } catch {
      return 0;
    }
  }
}
