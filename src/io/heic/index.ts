// Importar fotos HEIC/HEIF sin incluir ningún decodificador HEVC en ChamVa (patentes y LGPL;
// ver AUDITORIA.md §8). Orden:
//  1. Nativo: si el navegador/SO ya abre HEIC en <img> (Safari, WKWebView de macOS/iOS), se usa.
//  2. WebCodecs: contenedor leído por ChamVa (MIT) y teselas HEVC/AV1 decodificadas por el
//     decodificador del sistema o de la GPU, en un worker, con progreso y cancelación.
//  3. Si ninguno puede: error legible con la guía para convertir la foto a JPG.
// El archivo nunca sale del equipo.
import { trackEnd, trackProgress, trackStart } from '../../editor/core/processingStore';
import type { LoadedImage } from '../import';
import { isHeifBrand } from './detect';
import { registerHeicCancel } from './cancel';
import { HeicError } from './errors';
import { buildPlan, MAX_PIXELS } from './plan';
import type { HeicWorkerIn, HeicWorkerOut } from './heic.worker';

export { HeicError, isHeicError, heicErrorReason } from './errors';
export { isHeicLike } from './detect';
export { cancelHeicImports } from './cancel';

export interface HeicOpts {
  signal?: AbortSignal;
  onProgress?: (fraction: number, stage: string) => void;
  /** Avisos no fatales (se ignoró la miniatura, la transparencia no se pudo leer…). */
  onWarning?: (msg: string) => void;
}

let nextJob = 1;
const JOB_BASE = 1_500_000_000; // no choca con los ids del pool de píxeles

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(r.error);
    r.onload = () => res(r.result as string);
    r.readAsDataURL(b);
  });

const isJpeg = (h: Uint8Array) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
const isPng = (h: Uint8Array) => h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;

/** ¿Lo abre el navegador tal cual? Devuelve la imagen ya pasada a JPEG/PNG, o null. */
async function tryNative(buf: ArrayBuffer, hasAlpha: boolean): Promise<{ blob: Blob; w: number; h: number } | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
  const url = URL.createObjectURL(new Blob([buf], { type: 'image/heic' }));
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return null;
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0); // el navegador ya aplicó orientación y perfil de color
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, hasAlpha ? 'image/png' : 'image/jpeg', 0.95));
    c.width = c.height = 0;
    return blob ? { blob, w, h } : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function runWorker(buf: ArrayBuffer, opts: HeicOpts, signal: AbortSignal): Promise<Extract<HeicWorkerOut, { type: 'done' }>> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      reject(new HeicError('no-decoder', 'sin workers'));
      return;
    }
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      w.terminate(); // libera de golpe la memoria del decodificador y los lienzos
    };
    const onAbort = () => {
      finish();
      reject(new HeicError('aborted'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort);
    w.onmessage = (e: MessageEvent<HeicWorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') opts.onProgress?.(m.p, m.stage);
      else if (m.type === 'done') {
        finish();
        resolve(m);
      } else {
        finish();
        reject(new HeicError(m.code, m.detail));
      }
    };
    w.onerror = (ev) => {
      finish();
      reject(new HeicError('decode-failed', (ev as ErrorEvent).message || 'el worker falló'));
    };
    const msg: HeicWorkerIn = { buf, maxPixels: MAX_PIXELS };
    w.postMessage(msg, [buf]); // se transfiere: no se duplica en memoria
  });
}

/** Decodifica un HEIC/HEIF a una imagen que el editor entiende (dataURL JPEG o PNG). */
export async function decodeHeicFile(file: File, opts: HeicOpts = {}): Promise<LoadedImage> {
  const ctl = new AbortController();
  const cancel = () => ctl.abort();
  opts.signal?.addEventListener('abort', cancel);
  if (opts.signal?.aborted) ctl.abort();
  const unregister = registerHeicCancel(cancel);
  const job = JOB_BASE + nextJob++;
  trackStart({ id: job, label: file.name || 'foto HEIC', priority: 0 });
  const progress = (p: number, stage: string) => {
    trackProgress(job, p, stage);
    opts.onProgress?.(p, stage);
  };
  try {
    let buf: ArrayBuffer;
    try {
      buf = await file.arrayBuffer();
    } catch {
      throw new HeicError('corrupt', 'no se pudo leer el archivo');
    }
    if (ctl.signal.aborted) throw new HeicError('aborted');
    const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 64));
    // Algunos móviles guardan JPEG/PNG con extensión .heic: se abren por la vía normal.
    if (isJpeg(head) || isPng(head)) {
      const type = isJpeg(head) ? 'image/jpeg' : 'image/png';
      const { loadImageFile } = await import('../import');
      return await loadImageFile(new File([buf], file.name, { type }));
    }
    if (!isHeifBrand(head)) throw new HeicError('corrupt', 'no es un archivo HEIF');

    // Estructura (rápido: solo la caja meta). Si ChamVa no la entiende, el navegador quizá sí.
    let plan: ReturnType<typeof buildPlan> | null = null;
    let planErr: unknown = null;
    try {
      plan = buildPlan(buf);
    } catch (e) {
      planErr = e;
    }
    if (planErr instanceof HeicError && planErr.code === 'too-large') throw planErr;
    // Miniatura, profundidad y mapas HDR se ignoran en silencio; solo se avisa si hay más fotos.
    if (plan?.ignored.includes('otras imágenes del archivo')) opts.onWarning?.(`${file.name}: tiene varias imágenes; se abrió la principal`);

    progress(0.02, 'Comprobando el sistema');
    const native = await tryNative(buf, !!plan?.alpha);
    if (ctl.signal.aborted) throw new HeicError('aborted');
    let blob: Blob;
    let width: number;
    let height: number;
    if (native) {
      ({ blob, w: width, h: height } = native);
    } else {
      if (planErr) throw planErr;
      const r = await runWorker(buf, { ...opts, onProgress: progress }, ctl.signal);
      for (const w of r.warnings.filter((x) => !x.startsWith('Se usó la imagen principal'))) opts.onWarning?.(`${file.name}: ${w}`);
      ({ blob, width, height } = r);
    }
    const src = await blobToDataUrl(blob);
    return { src, naturalWidth: width, naturalHeight: height, name: file.name };
  } finally {
    unregister();
    opts.signal?.removeEventListener('abort', cancel);
    trackEnd(job);
  }
}
