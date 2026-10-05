// Muestreo de fotogramas y audio para «Bucle perfecto» (con DOM): miniaturas en gris de los instantes pedidos y el audio
// decodificado en mono. La elección del punto de unión es lógica pura en `video/speed/perfectLoop.ts`.
import type { LumaSample } from '../../video/speed/perfectLoop';

export const LUMA_W = 32;
export const LUMA_H = 18;

export interface ScanSample extends LumaSample {
  /** miniatura para la vista previa de la unión (dataURL) */
  thumb: string;
}

const seekTo = (v: HTMLVideoElement, t: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('El video tardó demasiado en buscar un fotograma.')), 8000);
    v.onseeked = () => {
      clearTimeout(to);
      resolve();
    };
    v.onerror = () => {
      clearTimeout(to);
      reject(new Error('No se pudo leer el video.'));
    };
    v.currentTime = t;
  });

/** Miniaturas en gris (y para ver) de los instantes `times` (s del archivo), en orden. Se puede cancelar con `signal`. */
export async function scanFrames(blob: Blob, times: number[], o: { signal?: AbortSignal; onProgress?: (ratio: number) => void } = {}): Promise<ScanSample[]> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  const small = document.createElement('canvas');
  small.width = LUMA_W;
  small.height = LUMA_H;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  const big = document.createElement('canvas');
  big.width = 160;
  big.height = 90;
  const bctx = big.getContext('2d')!;
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('No se pudo abrir el video.'));
      v.src = url;
    });
    const out: ScanSample[] = [];
    for (let i = 0; i < times.length; i++) {
      if (o.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      await seekTo(v, times[i]);
      sctx.drawImage(v, 0, 0, LUMA_W, LUMA_H);
      const d = sctx.getImageData(0, 0, LUMA_W, LUMA_H).data;
      const px = new Uint8Array(LUMA_W * LUMA_H);
      for (let k = 0; k < px.length; k++) px[k] = Math.round(0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2]);
      bctx.drawImage(v, 0, 0, 160, 90);
      out.push({ t: times[i], px, thumb: big.toDataURL('image/jpeg', 0.6) });
      o.onProgress?.((i + 1) / times.length);
    }
    return out;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

export interface DecodedAudio {
  buffer: AudioBuffer;
  /** canal mezclado a mono */
  mono: Float32Array;
}

const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/** Audio de un archivo decodificado (null si no tiene audio, no se puede decodificar o es demasiado grande). */
export async function decodeAudio(blob: Blob): Promise<DecodedAudio | null> {
  if (blob.size > MAX_AUDIO_BYTES) return null;
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buffer.numberOfChannels;
    }
    return { buffer, mono };
  } catch {
    return null;
  }
}
