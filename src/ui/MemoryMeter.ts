// Medidor de memoria: lectura real (performance.memory, solo Chromium/WebView2) o,
// si no existe, estimación a partir de las imágenes del proyecto. Lógica pura.
import type { Doc } from '../editor/core/types';

export interface MemInfo {
  bytes: number;
  source: 'medida' | 'estimada';
}

// Lado máximo de la vista previa procesada de una imagen (ver ImageLayerNode).
const PREVIEW_MAX = 2048;

// Bytes de una imagen decodificada (RGBA).
export function imageBytes(w: number, h: number): number {
  return Math.max(0, Math.round(w)) * Math.max(0, Math.round(h)) * 4;
}

// Estimación: cada imagen decodificada + (si tiene ajustes/filtro) su copia procesada
// limitada a PREVIEW_MAX; más un pequeño coste fijo por capa.
export function estimateDocBytes(pages: Pick<Doc, 'layers'>[]): number {
  let total = 0;
  const seen = new Set<string>();
  for (const pg of pages) {
    for (const l of pg.layers) {
      total += 2048; // nodo + metadatos
      if (l.type !== 'image') continue;
      const w = l.naturalWidth;
      const h = l.naturalHeight;
      // La misma imagen repetida (mismo src) se decodifica una sola vez.
      if (!seen.has(l.src)) {
        seen.add(l.src);
        total += imageBytes(w, h);
      }
      const processed =
        (l.filter && l.filter !== 'none') ||
        l.flipX ||
        l.flipY ||
        Object.values(l.adjust ?? {}).some((v) => typeof v === 'number' && v !== 0);
      if (processed) {
        const k = Math.min(1, PREVIEW_MAX / Math.max(w, h, 1));
        total += imageBytes(w * k, h * k);
      }
    }
  }
  return total;
}

// Lectura de memoria: real si el navegador la expone; si no, la estimación.
export function readMemory(pages: Pick<Doc, 'layers'>[]): MemInfo {
  const pm = (typeof performance !== 'undefined' ? (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory : undefined);
  if (pm && typeof pm.usedJSHeapSize === 'number' && pm.usedJSHeapSize > 0) {
    return { bytes: pm.usedJSHeapSize, source: 'medida' };
  }
  return { bytes: estimateDocBytes(pages), source: 'estimada' };
}

export function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 * 1024 * 1024) return `${Math.round(b / (1024 * 1024))} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Umbral de aviso: 600 MB (medida) o 400 MB (estimación; la real suele ser mayor).
export function warnThreshold(source: MemInfo['source']): number {
  return (source === 'medida' ? 600 : 400) * 1024 * 1024;
}

export type MemLevel = 'ok' | 'alto';
export function memLevel(info: MemInfo): MemLevel {
  return info.bytes >= warnThreshold(info.source) ? 'alto' : 'ok';
}
