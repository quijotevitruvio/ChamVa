// Núcleo de "quitar fondo": BiRefNet-lite (licencia MIT) vía Transformers.js,
// más el refinado de bordes. Funciona igual dentro del Web Worker y en el hilo
// principal (usa OffscreenCanvas, disponible en ambos).
//
// Calidad = resolución de entrada del modelo (más grande = mejores bordes, más
// lento). Bordes = qué hacer con la máscara:
//   auto     → detecta si es foto (suaviza + descontamina) o gráfico (solo descontamina)
//   photo    → feather 1 px + descontaminación de color en el borde
//   graphic  → sin suavizado (logos/texto quedan nítidos), solo descontaminación
//   none     → máscara cruda del modelo

// Motores disponibles (todos locales, descargados una vez y cacheados):
//   modnet-fast  MODNet cuantizado  (Apache-2.0, 7 MB)   personas, muy rápido, WASM
//   modnet       MODNet fp32        (Apache-2.0, 26 MB)  personas, rápido, WASM
//   birefnet     BiRefNet-lite fp16 (MIT, 114 MB)        objetos, la mejor calidad,
//                SOLO WebGPU (en WASM no cabe en memoria) → si falla, cae a modnet
//   rmbg         RMBG-1.4 fp32      (BRIA, NO comercial, 176 MB) objetos, WASM
export type BgQuality = 'modnet-fast' | 'modnet' | 'birefnet' | 'rmbg';
export type EdgeMode = 'auto' | 'photo' | 'graphic' | 'none';
export type Progress = (ratio: number, stage: string) => void;

export const BG_ENGINES: {
  id: BgQuality;
  label: string;
  license: string;
  needsGpu?: boolean;
}[] = [
  { id: 'modnet', label: 'Personas — alta (MODNet)', license: 'Apache-2.0' },
  { id: 'modnet-fast', label: 'Personas — rápido (MODNet ligero)', license: 'Apache-2.0' },
  {
    id: 'birefnet',
    label: 'Objetos — máxima (BiRefNet, necesita GPU)',
    license: 'MIT',
    needsGpu: true,
  },
  { id: 'rmbg', label: 'Objetos — RMBG-1.4 (solo uso no comercial)', license: 'BRIA NC' },
];

interface Engine {
  modelId: string;
  device: 'webgpu' | 'wasm';
  dtype: string;
  processorConfig?: Record<string, unknown>; // config si el repo no trae preprocessor
  sigmoid: boolean; // la salida son logits → aplicar sigmoide
}

const ENGINES: Record<BgQuality, Engine> = {
  'modnet-fast': {
    modelId: 'Xenova/modnet',
    device: 'wasm',
    dtype: 'q8',
    sigmoid: false,
  },
  modnet: { modelId: 'Xenova/modnet', device: 'wasm', dtype: 'fp32', sigmoid: false },
  birefnet: {
    modelId: 'onnx-community/BiRefNet_lite-ONNX',
    device: 'webgpu',
    dtype: 'fp16',
    sigmoid: true,
  },
  rmbg: {
    modelId: 'briaai/RMBG-1.4',
    device: 'wasm',
    dtype: 'fp32',
    processorConfig: {
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
    sigmoid: false,
  },
};

const loaded = new Map<BgQuality, Promise<{ model: any; processor: any }>>();

export class GpuUnavailableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'GpuUnavailableError';
  }
}

export async function getBgModel(
  quality: BgQuality = 'modnet',
  onProgress?: Progress,
) {
  const eng = ENGINES[quality] ?? ENGINES.modnet;
  if (eng.device === 'webgpu' && !(typeof navigator !== 'undefined' && 'gpu' in navigator)) {
    throw new GpuUnavailableError('Este motor necesita WebGPU');
  }
  let p = loaded.get(quality);
  if (!p) {
    p = (async () => {
      const { AutoModel, AutoProcessor } = await import('@huggingface/transformers');
      const progress_callback = (x: any) => {
        if (x?.status === 'progress' && typeof x.progress === 'number')
          onProgress?.(x.progress / 100, 'fetch');
      };
      const modelOpts: Record<string, unknown> = {
        device: eng.device,
        dtype: eng.dtype,
        progress_callback,
      };
      if (quality === 'rmbg') modelOpts.config = { model_type: 'custom' };
      const model = await AutoModel.from_pretrained(eng.modelId, modelOpts as any);
      const processor = await AutoProcessor.from_pretrained(
        eng.modelId,
        (eng.processorConfig ? { config: eng.processorConfig } : {}) as any,
      );
      return { model, processor };
    })();
    p.catch(() => loaded.delete(quality)); // no cachear fallos
    loaded.set(quality, p);
  }
  return p;
}

async function loadBitmap(src: string): Promise<ImageBitmap> {
  const blob = await (await fetch(src)).blob();
  return createImageBitmap(blob);
}

// Devuelve el PNG (Blob) con el fondo quitado. Si el motor de GPU falla,
// lanza GpuUnavailableError para que el llamador cambie de motor.
export async function removeBackgroundCore(
  src: string,
  quality: BgQuality,
  edges: EdgeMode,
  onProgress?: Progress,
): Promise<Blob> {
  const { RawImage } = await import('@huggingface/transformers');
  const eng = ENGINES[quality] ?? ENGINES.modnet;
  const { model, processor } = await getBgModel(quality, onProgress);
  onProgress?.(0.4, 'process');

  const image = await RawImage.fromURL(src);
  const { pixel_values } = await processor(image);

  // Nombres de entrada/salida leídos de la sesión ONNX (robusto ante cambios).
  const session = model.sessions?.model;
  const inName: string = session?.inputNames?.[0] ?? 'input';
  const outName: string = session?.outputNames?.[0] ?? 'output';
  let out: any;
  try {
    out = await model({ [inName]: pixel_values });
  } catch (e) {
    if (eng.device === 'webgpu') {
      loaded.delete(quality);
      throw new GpuUnavailableError((e as Error).message);
    }
    throw e;
  }
  const raw = out[outName] ?? Object.values(out)[0];
  onProgress?.(0.8, 'process');

  const t = eng.sigmoid ? raw[0].sigmoid() : raw[0];
  const mask = await RawImage.fromTensor(t.mul(255).to('uint8')).resize(
    image.width,
    image.height,
  );

  const bmp = await loadBitmap(src);
  const w = image.width;
  const h = image.height;
  if (mask.data.length !== w * h) {
    // Máscara con más de un canal: quedarnos con el primero.
    const ch = mask.data.length / (w * h);
    const m1 = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) m1[i] = mask.data[i * ch];
    (mask as any).data = m1;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const px = ctx.getImageData(0, 0, w, h);
  const original = new Uint8ClampedArray(px.data); // copia RGB sin tocar
  for (let i = 0; i < w * h; i++) px.data[i * 4 + 3] = mask.data[i];

  refineCutout(px, original, w, h, edges);
  ctx.putImageData(px, 0, 0);
  onProgress?.(1, 'process');
  return canvas.convertToBlob({ type: 'image/png' });
}

// ---------- Refinado de bordes ----------

export function refineCutout(
  px: ImageData,
  original: Uint8ClampedArray,
  w: number,
  h: number,
  mode: EdgeMode,
) {
  if (mode === 'none') return;
  const d = px.data;
  const n = w * h;
  let m: EdgeMode = mode;
  if (m === 'auto') {
    // Gráfico = casi no hay alfa intermedio (bordes duros: logos, texto, iconos).
    let soft = 0;
    let on = 0;
    for (let i = 0; i < n; i++) {
      const a = d[i * 4 + 3];
      if (a > 0) on++;
      if (a > 16 && a < 240) soft++;
    }
    m = on > 0 && soft / on > 0.02 ? 'photo' : 'graphic';
  }
  if (m === 'photo') {
    let alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) alpha[i] = d[i * 4 + 3];
    alpha = boxBlur(alpha, w, h, 1);
    for (let i = 0; i < n; i++)
      d[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(alpha[i])));
  }
  decontaminate(d, original, w, h);
}

// Descontaminación de color: en los píxeles semitransparentes del borde, el
// color observado C = a·F + (1−a)·B (F = objeto, B = fondo). Estimamos B como el
// promedio de los píxeles de fondo cercanos y despejamos F, que es lo que debe
// quedar al componer sobre otro fondo. Esto elimina el "halo" sin erosionar.
function decontaminate(
  d: Uint8ClampedArray,
  original: Uint8ClampedArray,
  w: number,
  h: number,
) {
  // Estimación de fondo a resolución reducida (memoria/tiempo acotados).
  const step = Math.max(1, Math.ceil(Math.max(w, h) / 768));
  const sw = Math.ceil(w / step);
  const sh = Math.ceil(h / step);
  const sn = sw * sh;
  const sr = new Float32Array(sn);
  const sg = new Float32Array(sn);
  const sb = new Float32Array(sn);
  const swt = new Float32Array(sn);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / step);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const wt = (255 - d[i * 4 + 3]) / 255; // peso de fondo
      if (wt <= 0) continue;
      const si = sy * sw + Math.floor(x / step);
      sr[si] += original[i * 4] * wt;
      sg[si] += original[i * 4 + 1] * wt;
      sb[si] += original[i * 4 + 2] * wt;
      swt[si] += wt;
    }
  }
  const r = Math.max(2, Math.round(12 / step));
  const br = boxBlur(sr, sw, sh, r);
  const bg = boxBlur(sg, sw, sh, r);
  const bb = boxBlur(sb, sw, sh, r);
  const bw = boxBlur(swt, sw, sh, r);

  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / step);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = d[i * 4 + 3] / 255;
      if (a <= 0.02 || a >= 0.98) continue;
      const si = sy * sw + Math.floor(x / step);
      if (bw[si] < 1e-3) continue; // sin fondo cerca: dejar como está
      const Br = br[si] / bw[si];
      const Bg = bg[si] / bw[si];
      const Bb = bb[si] / bw[si];
      const k = 1 - a;
      d[i * 4] = clamp255((original[i * 4] - k * Br) / a);
      d[i * 4 + 1] = clamp255((original[i * 4 + 1] - k * Bg) / a);
      d[i * 4 + 2] = clamp255((original[i * 4 + 2] - k * Bb) / a);
    }
  }
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// Box blur separable (media móvil) sobre un plano float.
export function boxBlur(
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
    let sum = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const add = Math.min(w - 1, x + r + 1);
      const rem = Math.max(0, x - r);
      sum += src[row + add] - src[row + rem];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const add = Math.min(h - 1, y + r + 1);
      const rem = Math.max(0, y - r);
      sum += tmp[add * w + x] - tmp[rem * w + x];
    }
  }
  return out;
}
