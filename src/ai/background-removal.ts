// Quitar fondo en el hilo principal (respaldo cuando el worker no está
// disponible). La lógica real vive en bgcore.ts (BiRefNet-lite, MIT).
import {
  getBgModel,
  removeBackgroundCore,
  type BgQuality,
  type EdgeMode,
  type Progress,
} from './bgcore';

export type { BgQuality, EdgeMode };

export interface BgOptions {
  quality?: BgQuality;
  edges?: EdgeMode;
  onProgress?: Progress;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

// Quita el fondo de una imagen (dataURL) y devuelve un PNG transparente (dataURL).
export async function removeImageBackground(
  src: string,
  options: BgOptions = {},
): Promise<string> {
  const { quality = 'modnet', edges = 'auto', onProgress } = options;
  const blob = await removeBackgroundCore(src, quality, edges, onProgress);
  return blobToDataURL(blob);
}

// Precarga el modelo (queda en la caché del navegador para uso offline).
export async function prefetchBgModel(
  onProgress?: Progress,
  quality: BgQuality = 'modnet',
): Promise<void> {
  await getBgModel(quality, onProgress);
}
