// Compartir con el sistema (Web Share nivel 2, con archivos). Si el navegador o
// el WebView no lo admite, se descarga el archivo.
import { downloadBlob } from './export';

export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'a.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

export type ShareResult = 'shared' | 'cancelled' | 'downloaded';

export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: blob.type });
  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // Cualquier otro fallo: se cae a la descarga.
    }
  }
  await downloadBlob(blob, filename);
  return 'downloaded';
}
