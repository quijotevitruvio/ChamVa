import { removeBackground } from '@imgly/background-removal';

// 'maxima' = RMBG-1.4 (Transformers.js, calidad tipo Canva) · 'alta'/'rapido' = imgly (isnet).
export type BgQuality = 'maxima' | 'alta' | 'rapido';

const IMGLY_MODEL: Record<'alta' | 'rapido', 'isnet' | 'isnet_quint8'> = {
  alta: 'isnet',
  rapido: 'isnet_quint8',
};

// Quita el fondo de una imagen (src dataURL) con un modelo de segmentación local,
// y refina los bordes para eliminar el halo. Devuelve un PNG (dataURL) transparente.
export async function removeImageBackground(
  src: string,
  options: {
    quality?: BgQuality;
    refine?: boolean;
    onProgress?: (ratio: number, stage: string) => void;
  } = {},
): Promise<string> {
  const { quality = 'maxima', refine = true, onProgress } = options;

  let dataUrl: string;
  if (quality === 'maxima') {
    dataUrl = await removeBackgroundRMBG(src, onProgress);
  } else {
    const blob = await removeBackground(src, {
      model: IMGLY_MODEL[quality],
      output: { format: 'image/png', quality: 1 },
      progress: (key: string, current: number, total: number) => {
        onProgress?.(total ? current / total : 0, key);
      },
    });
    dataUrl = await blobToDataURL(blob);
  }

  return refine ? refineEdges(dataUrl, 1, 1) : dataUrl;
}

// ---- Motor de máxima calidad: RMBG-1.4 (BRIA) vía Transformers.js, local ----
const RMBG_ID = 'briaai/RMBG-1.4';
let rmbgModel: Promise<any> | null = null;
let rmbgProcessor: Promise<any> | null = null;

async function getRMBG(onProgress?: (ratio: number, stage: string) => void) {
  // Carga perezosa: Transformers.js solo se descarga al usar "Máxima".
  const { AutoModel, AutoProcessor } = await import('@huggingface/transformers');
  if (!rmbgModel) {
    rmbgModel = AutoModel.from_pretrained(RMBG_ID, {
      config: { model_type: 'custom' },
      progress_callback: (p: any) =>
        onProgress?.((p?.progress ?? 0) / 100, 'fetch'),
    } as any);
  }
  if (!rmbgProcessor) {
    rmbgProcessor = AutoProcessor.from_pretrained(RMBG_ID, {
      config: {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: [0.5, 0.5, 0.5],
        image_std: [1, 1, 1],
        resample: 2,
        rescale_factor: 0.00392156862745098,
        size: { width: 1024, height: 1024 },
      },
    } as any);
  }
  return { model: await rmbgModel, processor: await rmbgProcessor };
}

// Precarga el modelo de quitafondos (para dejarlo cacheado y usar offline después).
export async function prefetchBgModel(
  onProgress?: (ratio: number, stage: string) => void,
): Promise<void> {
  await getRMBG(onProgress);
}

async function removeBackgroundRMBG(
  src: string,
  onProgress?: (ratio: number, stage: string) => void,
): Promise<string> {
  const { RawImage } = await import('@huggingface/transformers');
  const { model, processor } = await getRMBG(onProgress);
  onProgress?.(0.5, 'process');

  const image = await RawImage.fromURL(src);
  const { pixel_values } = await processor(image);
  const { output } = await model({ input: pixel_values });

  // Máscara (0..1) → 0..255, redimensionada al tamaño original.
  const maskTensor = (output as any)[0].mul(255).to('uint8');
  const mask = await RawImage.fromTensor(maskTensor).resize(
    image.width,
    image.height,
  );

  // Componer: original + alfa de la máscara.
  const original = await loadImg(src);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(original, 0, 0);
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < mask.data.length; i++) {
    px.data[i * 4 + 3] = mask.data[i];
  }
  ctx.putImageData(px, 0, 0);
  onProgress?.(1, 'process');
  return canvas.toDataURL('image/png');
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar el recorte'));
    img.src = src;
  });
}

// Refina el canal alfa: contrae el borde (erosión) y lo suaviza (feather),
// lo que elimina el típico halo claro alrededor del sujeto.
async function refineEdges(
  dataUrl: string,
  erode: number,
  feather: number,
): Promise<string> {
  const img = await loadImg(dataUrl);
  const w = img.width;
  const h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const n = w * h;

  // Extraer alfa.
  let alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3];

  alpha = minFilter(alpha, w, h, erode); // erosión (contrae)
  alpha = boxBlur(alpha, w, h, feather); // suavizado (feather)

  for (let i = 0; i < n; i++) {
    data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(alpha[i])));
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

// Filtro de mínimo (erosión) separable.
function minFilter(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx));
        m = Math.min(m, src[y * w + xx]);
      }
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        m = Math.min(m, tmp[yy * w + x]);
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

// Box blur separable (feather del alfa).
function boxBlur(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx));
        sum += src[y * w + xx];
      }
      tmp[y * w + x] = sum / win;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        sum += tmp[yy * w + x];
      }
      out[y * w + x] = sum / win;
    }
  }
  return out;
}
