import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Núcleo de ffmpeg de un solo hilo (no requiere aislamiento cross-origin).
const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';

let ffmpeg: FFmpeg | null = null;

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
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
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
