import { demuxMp4 } from './mp4';
import { demuxWebm } from './webm';
import { type DemuxedFile, UnsupportedMediaError } from './types';

export * from './types';

/** Detecta el contenedor por sus primeros bytes y lo desmultiplexa (sin leer el archivo entero). */
export async function demux(blob: Blob): Promise<DemuxedFile> {
  const h = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (h.length >= 4 && h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return demuxWebm(blob);
  const t = String.fromCharCode(h[4], h[5], h[6], h[7]);
  if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'pnot'].includes(t)) return demuxMp4(blob);
  throw new UnsupportedMediaError('Formato de archivo no reconocido');
}
