export interface LoadedImage {
  src: string; // dataURL
  naturalWidth: number;
  naturalHeight: number;
  name: string;
}

// Lee un File (de un <input> o drag&drop) y devuelve dataURL + dimensiones.
export function loadImageFile(file: File): Promise<LoadedImage> {
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
