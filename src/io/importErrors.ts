// Mensajes legibles cuando una imagen no se puede importar (lógica pura).
import { HEIC_CONVERT_TIP, isHeicError } from './heic/errors';

export interface ImportFailure {
  name: string;
  reason: string;
}

const ext = (name: string) => (/\.([^.\\/]+)$/.exec(name)?.[1] ?? '').toLowerCase();

// Causa legible de un fallo de importación, según el tipo/extensión y el error.
export function classifyImportError(file: { name: string; type: string }, err?: unknown): string {
  const e = ext(file.name);
  const t = (file.type || '').toLowerCase();
  if (isHeicError(err)) return err.message; // causa concreta + guía, de io/heic
  if (['heic', 'heif', 'hif'].includes(e) || t === 'image/heic' || t === 'image/heif') return `No se pudo abrir la foto HEIC. ${HEIC_CONVERT_TIP}`;
  if (e === 'tif' || e === 'tiff' || t === 'image/tiff') return 'Formato TIFF no soportado todavía';
  if (['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2'].includes(e)) return 'Formato RAW no soportado todavía';
  if (e === 'psd' || t === 'image/vnd.adobe.photoshop') return 'Formato PSD no soportado todavía';
  const msg = err instanceof Error ? err.message : '';
  if (msg === 'El archivo no es una imagen' || (!t.startsWith('image/') && t !== '')) return 'El archivo no es una imagen';
  if (!t) return 'Formato no reconocido como imagen';
  return 'No se pudo leer la imagen: archivo dañado';
}

// «3 importadas, 1 falló» (null si todo fue bien y no hace falta resumen).
export function summarizeImport(ok: number, failed: number): string | null {
  if (failed === 0) return null;
  const imp = ok === 1 ? '1 importada' : `${ok} importadas`;
  const fal = failed === 1 ? '1 falló' : `${failed} fallaron`;
  return `${imp}, ${fal}`;
}

// Texto completo del aviso: resumen + detalle de cada archivo (máx. 3 nombres).
export function importFailureMessage(ok: number, failures: ImportFailure[]): string | null {
  if (!failures.length) return null;
  const lines = failures.slice(0, 3).map((f) => `${f.name}: ${f.reason}`);
  if (failures.length > 3) lines.push(`…y ${failures.length - 3} más`);
  const head = failures.length === 1 && ok === 0 ? '' : `${summarizeImport(ok, failures.length)}. `;
  return `${head}${lines.join(' · ')}`;
}
