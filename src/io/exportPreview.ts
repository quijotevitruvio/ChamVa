// Utilidades puras para la vista previa de exportación.

export const MAX_PREVIEW_PIXELS = 16_000_000;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
}

// Dimensiones finales en píxeles (mismo redondeo que renderDocToCanvas).
export function finalSize(
  doc: { width: number; height: number },
  scale: number,
): { width: number; height: number; pixels: number } {
  const width = Math.max(1, Math.round(doc.width * scale));
  const height = Math.max(1, Math.round(doc.height * scale));
  return { width, height, pixels: width * height };
}

export function isTooLargeToPreview(pixels: number): boolean {
  return pixels > MAX_PREVIEW_PIXELS;
}
