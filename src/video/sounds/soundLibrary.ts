// Carga PEREZOSA de la biblioteca de sonidos: nada de esto entra en el arranque ni en el bundle principal. El índice y cada
// archivo se piden solo cuando se abre la pestaña «Sonidos» o se usa un sonido. El service worker (public/sw.js) los guarda en
// su propia caché al verlos por primera vez; en Tauri son recursos locales de la app.
import { soundPath, type SoundEntry, type SoundIndex } from './soundIndex';

export const SOUND_MIME = 'application/x-chamva-sound';

const base = () => (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';
const urlOf = (rel: string) => new URL(base() + rel, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;

let indexP: Promise<SoundIndex> | null = null;
/** Descarga el índice (una sola vez). Si falla, el siguiente intento vuelve a pedirlo. */
export function loadSoundIndex(): Promise<SoundIndex> {
  if (!indexP) {
    indexP = fetch(urlOf('sounds/index.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`No se pudo leer el índice de sonidos (${r.status}).`);
        return r.json() as Promise<SoundIndex>;
      })
      .catch((e) => {
        indexP = null;
        throw e;
      });
  }
  return indexP;
}

const blobs = new Map<string, Blob>();
const sha256Hex = async (buf: ArrayBuffer): Promise<string | null> => {
  const c = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!c) return null;
  const h = new Uint8Array(await c.digest('SHA-256', buf));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Descarga el archivo del sonido y comprueba su hash contra el índice (si el equipo puede calcularlo). */
export async function fetchSoundBlob(s: SoundEntry): Promise<Blob> {
  const hit = blobs.get(s.id);
  if (hit) return hit;
  const r = await fetch(urlOf(soundPath(s)));
  if (!r.ok) throw new Error(`No se pudo cargar «${s.nombre}» (${r.status}). Si no hay conexión, ábrelo una vez con internet para que quede guardado.`);
  const buf = await r.arrayBuffer();
  const got = await sha256Hex(buf);
  if (got && got !== s.sha256) throw new Error(`«${s.nombre}» no coincide con su huella: el archivo está dañado.`);
  const blob = new Blob([buf], { type: 'audio/ogg' });
  blobs.set(s.id, blob);
  return blob;
}

/** El sonido como `File` para importarlo al proyecto como cualquier otro medio. */
export async function soundFile(s: SoundEntry): Promise<File> {
  return new File([await fetchSoundBlob(s)], `${s.nombre}.ogg`, { type: 'audio/ogg' });
}

// ---------- vista previa: un solo sonido a la vez ----------
let audio: HTMLAudioElement | null = null;
let url = '';
let playingId: string | null = null;
let loadingId: string | null = null;
let error = '';
const subs = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  subs.forEach((f) => f());
};
export const previewStore = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
  getVersion: () => version,
  state: () => ({ playingId, loadingId, error }),
};

export function stopPreview(): void {
  if (audio) {
    audio.onended = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (url) URL.revokeObjectURL(url);
  url = '';
  playingId = null;
  loadingId = null;
  bump();
}

/** Suena `s` (y corta el que sonara). Pulsar el que ya suena lo detiene. */
export async function togglePreview(s: SoundEntry): Promise<void> {
  if (playingId === s.id || loadingId === s.id) {
    stopPreview();
    return;
  }
  stopPreview();
  error = '';
  loadingId = s.id;
  bump();
  try {
    const blob = await fetchSoundBlob(s);
    if (loadingId !== s.id) return; // se pidió otro mientras tanto
    audio ??= new Audio();
    url = URL.createObjectURL(blob);
    audio.src = url;
    audio.onended = () => stopPreview();
    await audio.play();
    if (loadingId !== s.id) return; // se detuvo mientras arrancaba
    loadingId = null;
    playingId = s.id;
  } catch (e) {
    if (loadingId === s.id) {
      stopPreview();
      error = e instanceof Error ? e.message : String(e);
    }
  }
  bump();
}
