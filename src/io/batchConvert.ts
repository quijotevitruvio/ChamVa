// Convertir imágenes por lote: varias imágenes → un formato, calidad y tamaño
// máximo, y todo en un ZIP. Procesado secuencial en el hilo principal con un
// `await` entre archivos para que la interfaz no se congele.
import { uniqueName } from './fileNameTemplate';
import { blobToBytes, zipToBlob, type ZipEntry } from './zip';

export type BatchFormat = 'png' | 'jpeg' | 'webp' | 'avif';

export interface BatchOptions {
  format: BatchFormat;
  quality: number; // 0.1..1 (ignorada en PNG)
  maxW: number; // 0 = sin límite
  maxH: number; // 0 = sin límite
}

const MIME: Record<BatchFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};
const EXT: Record<BatchFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif' };

// Tamaño de salida: cabe en maxW×maxH conservando proporción y NUNCA agranda.
export function fitSize(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 1, h: 1 };
  let k = 1;
  if (maxW > 0) k = Math.min(k, maxW / w);
  if (maxH > 0) k = Math.min(k, maxH / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// «foto.final.jpeg» → «foto.final.webp» (sin duplicar nombres).
export function outputName(original: string, format: BatchFormat, used: Set<string>): string {
  const base = original.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || 'imagen';
  return uniqueName(`${base}.${EXT[format]}`, used);
}

export function isImageFile(f: { name: string; type: string }): boolean {
  return f.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(f.name);
}

function toBlob(c: HTMLCanvasElement, mime: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob falló'))), mime, q));
}

export async function convertImage(file: File, o: BatchOptions): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  try {
    const { w, h } = fitSize(bmp.width, bmp.height, o.maxW, o.maxH);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    if (o.format === 'jpeg') {
      ctx.fillStyle = '#ffffff'; // JPG no tiene transparencia
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const mime = MIME[o.format];
    const blob = await toBlob(c, mime, o.format === 'png' ? undefined : o.quality);
    if (blob.type !== mime) throw new Error(`Este navegador no puede crear ${o.format.toUpperCase()}`);
    return { blob, w, h };
  } finally {
    bmp.close();
  }
}

export interface BatchResult {
  zip: Blob | null; // null si se canceló o no salió ninguno
  ok: number;
  failed: { name: string; error: string }[];
  bytesIn: number;
  bytesOut: number;
}

export async function runBatchConvert(
  files: File[],
  o: BatchOptions,
  hooks: { onProgress?: (done: number, total: number, name: string) => void; isCancelled?: () => boolean } = {},
): Promise<BatchResult> {
  const used = new Set<string>();
  const entries: ZipEntry[] = [];
  const failed: BatchResult['failed'] = [];
  let bytesIn = 0;
  let bytesOut = 0;
  for (let i = 0; i < files.length; i++) {
    if (hooks.isCancelled?.()) return { zip: null, ok: entries.length, failed, bytesIn, bytesOut };
    const f = files[i];
    hooks.onProgress?.(i, files.length, f.name);
    try {
      const r = await convertImage(f, o);
      const data = await blobToBytes(r.blob);
      entries.push({ name: outputName(f.name, o.format, used), data });
      bytesIn += f.size;
      bytesOut += data.length;
    } catch (e) {
      failed.push({ name: f.name, error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((r) => setTimeout(r, 0)); // deja respirar a la interfaz
  }
  hooks.onProgress?.(files.length, files.length, '');
  return {
    zip: entries.length ? zipToBlob(entries) : null,
    ok: entries.length,
    failed,
    bytesIn,
    bytesOut,
  };
}
