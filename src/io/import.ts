import { isHeicLike } from './heic/detect';
import type { HeicOpts } from './heic';

export interface LoadedImage {
  src: string; // dataURL
  naturalWidth: number;
  naturalHeight: number;
  name: string;
}

// Lee un File (de un <input> o drag&drop) y devuelve dataURL + dimensiones.
// HEIC/HEIF va por su propio decodificador, cargado bajo demanda (chunk aparte).
export function loadImageFile(file: File, opts?: HeicOpts): Promise<LoadedImage> {
  if (isHeicLike(file)) return import('./heic').then((m) => m.decodeHeicFile(file, opts));
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('El archivo no es una imagen'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const src = reader.result as string;
      const img = new window.Image();
      img.onload = () =>
        resolve({
          src,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          name: file.name,
        });
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
