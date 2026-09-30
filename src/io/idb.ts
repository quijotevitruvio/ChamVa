// Wrapper mínimo de IndexedDB (clave→valor) para datos grandes.
// Los errores NO se silencian: se reportan al manejador registrado por la UI
// (toast) además de la consola, para que el usuario sepa si algo no se guardó.
const DB = 'chamva';
const STORE = 'kv';

let onError: ((e: unknown) => void) | null = null;
let lastReport = 0;

// La UI registra aquí cómo avisar (p. ej. un toast). Se limita a 1 aviso/minuto.
export function setStorageErrorHandler(fn: (e: unknown) => void) {
  onError = fn;
}

function report(e: unknown) {
  console.error('[IndexedDB]', e);
  const now = Date.now();
  if (now - lastReport > 60_000) {
    lastReport = now;
    onError?.(e);
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => resolve((rq.result as T) ?? null);
      rq.onerror = () => reject(rq.error);
    });
  } catch (e) {
    report(e);
    return null;
  }
}

// Devuelve true si se guardó; false (y avisa) si falló — nunca lanza.
export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transacción abortada'));
    });
    return true;
  } catch (e) {
    report(e);
    return false;
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    report(e);
  }
}

// Claves que empiezan por `prefix` (todas si se omite).
export async function idbKeys(prefix = ''): Promise<string[]> {
  try {
    const db = await open();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).getAllKeys();
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    return keys
      .map(String)
      .filter((k) => k.startsWith(prefix));
  } catch (e) {
    report(e);
    return [];
  }
}

// Pide al navegador que NO borre nuestro almacenamiento bajo presión de espacio.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}
