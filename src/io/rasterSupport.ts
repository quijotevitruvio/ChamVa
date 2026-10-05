// ¿Puede este navegador codificar el formato pedido? canvas.toBlob() cae en
// silencio a PNG cuando no soporta el MIME (AVIF en Chromium/WebView2, WebP en
// Safari antiguo). Aquí se detecta una vez y se resuelve el formato REAL de un blob.
import { useEffect, useState } from 'react';

export type RasterFormat = 'png' | 'jpeg' | 'webp' | 'avif';

export const RASTER_MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};
export const RASTER_EXT: Record<RasterFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif' };
export const RASTER_LABEL: Record<RasterFormat, string> = { png: 'PNG', jpeg: 'JPG', webp: 'WebP', avif: 'AVIF' };

// Formato real según el tipo del blob; si no es uno conocido, se asume el pedido.
export function formatOfMime(mime: string, fallback: RasterFormat): RasterFormat {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpeg';
  for (const f of Object.keys(RASTER_MIME) as RasterFormat[]) if (RASTER_MIME[f] === m) return f;
  return fallback;
}

export interface FormatResolution {
  format: RasterFormat; // formato real del archivo
  degraded: boolean;
  message: string | null;
}

// Compara lo pedido con lo que el navegador entregó realmente.
export function resolveBlobFormat(blobType: string, requested: RasterFormat): FormatResolution {
  const real = formatOfMime(blobType, requested);
  if (real === requested) return { format: real, degraded: false, message: null };
  const msg = `Este equipo no puede exportar ${RASTER_LABEL[requested]}; se guardó como ${RASTER_LABEL[real]}.`;
  return { format: real, degraded: true, message: msg };
}

// ---- detección con una prueba de canvas pequeña, cacheada ----
const cache = new Map<RasterFormat, Promise<boolean>>();

export function supportsFormat(f: RasterFormat): Promise<boolean> {
  if (f === 'png') return Promise.resolve(true);
  let p = cache.get(f);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 2;
        c.getContext('2d')?.fillRect(0, 0, 2, 2);
        c.toBlob((b) => resolve(!!b && b.type === RASTER_MIME[f]), RASTER_MIME[f], 0.8);
      } catch {
        resolve(false);
      }
    });
    cache.set(f, p);
  }
  return p;
}

// Hook para la interfaz: formatos que este equipo no puede codificar.
export function useUnsupportedFormats(): Set<RasterFormat> {
  const [bad, setBad] = useState<Set<RasterFormat>>(new Set());
  useEffect(() => {
    let live = true;
    (['jpeg', 'webp', 'avif'] as RasterFormat[]).forEach((f) =>
      supportsFormat(f).then((ok) => {
        if (live && !ok) setBad((s) => new Set(s).add(f));
      }),
    );
    return () => {
      live = false;
    };
  }, []);
  return bad;
}
