import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

// Núcleo de ffmpeg de un solo hilo (no requiere aislamiento cross-origin).
// Se descarga UNA vez y se guarda en Cache Storage (persistente si el
// navegador concede almacenamiento persistente), así que después funciona sin
// internet. "Preparar offline" llama a prefetchFFmpeg() para dejarlo listo.
const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
const CACHE_NAME = 'chamva-ffmpeg';

let ffmpeg: FFmpeg | null = null;

// Descarga con caché: devuelve una blob: URL del recurso.
async function cachedBlobURL(url: string, mime: string): Promise<string> {
  let res: Response | undefined;
  try {
    const cache = await caches.open(CACHE_NAME);
    res = await cache.match(url);
    if (!res) {
      const fresh = await fetch(url);
      if (!fresh.ok) throw new Error(`HTTP ${fresh.status}`);
      await cache.put(url, fresh.clone());
      res = fresh;
    }
  } catch {
    res = await fetch(url); // sin Cache API (entorno raro): descarga directa
  }
  const blob = await res.blob();
  return URL.createObjectURL(new Blob([blob], { type: mime }));
}

// Deja ffmpeg en caché para uso sin conexión (no lo inicializa).
export async function prefetchFFmpeg(): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
    const url = `${CORE_BASE}/${f}`;
    if (!(await cache.match(url))) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`No se pudo descargar ${f}`);
      await cache.put(url, res);
    }
  }
}

async function getFFmpeg(
  onProgress?: (ratio: number, stage: string) => void,
): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  const ff = new FFmpeg();
  if (onProgress) {
    ff.on('progress', ({ progress }) => onProgress(progress, 'convert'));
  }
  onProgress?.(0, 'fetch');
  await ff.load({
    coreURL: await cachedBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await cachedBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpeg = ff;
  return ff;
}

// Convierte un WebM a MP4 (H.264 + AAC) con ffmpeg.wasm.
export async function webmToMp4(
  webm: Blob,
  onProgress?: (ratio: number, stage: string) => void,
): Promise<Blob> {
  const ff = await getFFmpeg(onProgress);
  await ff.writeFile('in.webm', await fetchFile(webm));
  await ff.exec([
    '-i',
    'in.webm',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    'out.mp4',
  ]);
  const data = await ff.readFile('out.mp4');
  return new Blob([data as Uint8Array], { type: 'video/mp4' });
}

// Convierte un GIF (animación) a MP4 (H.264).
export async function gifToMp4(
  gif: Blob,
  onProgress?: (ratio: number, stage: string) => void,
): Promise<Blob> {
  const ff = await getFFmpeg(onProgress);
  await ff.writeFile('in.gif', await fetchFile(gif));
  await ff.exec([
    '-i',
    'in.gif',
    '-movflags',
    'faststart',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    'out.mp4',
  ]);
  const data = await ff.readFile('out.mp4');
  return new Blob([data as Uint8Array], { type: 'video/mp4' });
}
