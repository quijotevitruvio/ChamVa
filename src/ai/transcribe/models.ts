// Modelos de transcripción (Whisper de OpenAI convertido a ONNX por Xenova para Transformers.js).
//
// Licencias VERIFICADAS el 2026-10-03 leyendo el origen (ver AUDITORIA.md §6):
//  - Código y pesos de Whisper: MIT (github.com/openai/whisper, LICENSE + README «code and model weights … MIT»).
//  - Repos de pesos ONNX Xenova/whisper-{tiny,base,small}: «license: apache-2.0» en su ficha de Hugging Face.
//
// Cada modelo está FIJADO a un commit (revision): el contenido no puede cambiar a escondidas, y cada archivo
// lleva su tamaño y su huella publicados por Hugging Face (sha256 de LFS, o sha1 de blob git para los JSON).
// Este manifiesto es la única lista de lo que se puede descargar: nada fuera de él sale a la red.
// Se regenera con el script descrito en docs/plan-video.md (V5) si se cambia de revisión.

export type WhisperSize = 'tiny' | 'base' | 'small';
export type AsrDevice = 'webgpu' | 'wasm';

export interface ModelFile {
  path: string;
  size: number;
  /** sha256 del contenido (archivos LFS) */
  sha256?: string;
  /** sha1 del blob git («blob <tamaño>\0<contenido>», archivos pequeños) */
  gitSha1?: string;
}

export interface ModelEntry {
  repo: string;
  revision: string;
  common: ModelFile[];
  /** pesos cuantizados a 8 bits para WASM (CPU) */
  wasm: ModelFile[];
  /** codificador fp32 + decodificador q4 para WebGPU */
  webgpu: ModelFile[];
}

export const MODEL_HOST = 'https://huggingface.co/';

export const WHISPER_MODELS: Record<WhisperSize, ModelEntry> = {
  tiny: {
    repo: "Xenova/whisper-tiny",
    revision: "5332fcc35e32a33b86612b9a57a89be7906102b1",
    common: [
      { path: "config.json", size: 2248, gitSha1: "dea913aa8ec7d53db029e97c97a766d534c8da04" },
      { path: "generation_config.json", size: 3716, gitSha1: "72e54ad7340e05287aa731f9d8556b5368be3fe0" },
      { path: "preprocessor_config.json", size: 339, gitSha1: "91876762a536a746d268353c5cba57286e76b058" },
      { path: "tokenizer.json", size: 2480466, gitSha1: "1e95340ff836fad1b5932e800fb7b8c5e6d78a74" },
      { path: "tokenizer_config.json", size: 282683, gitSha1: "d13b786c04765fb1a06492b53587752cd67665ea" },
    ],
    wasm: [
      { path: "onnx/encoder_model_quantized.onnx", size: 10124910, sha256: "fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e" },
      { path: "onnx/decoder_model_merged_quantized.onnx", size: 30727765, sha256: "6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0" },
    ],
    webgpu: [
      { path: "onnx/encoder_model.onnx", size: 32909539, sha256: "39e81b6c86a5b2b4beda1bb3145486a769d594801f780a66cad1ae72c7ad2c5e" },
      { path: "onnx/decoder_model_merged_q4.onnx", size: 86739474, sha256: "462a65ea8459402cded5e6f22a378ac410ec7e0aad9367ebb08431906c237660" },
    ],
  },
  base: {
    repo: "Xenova/whisper-base",
    revision: "64da57285918e20ea79ea5c88eed7197933abaa8",
    common: [
      { path: "config.json", size: 2248, gitSha1: "1b9048005c9f52ee7aa93c2e57bc99cf92b014b4" },
      { path: "generation_config.json", size: 3776, gitSha1: "70fc9361d8f658414e36505ebeb58a95cd11e73c" },
      { path: "preprocessor_config.json", size: 339, gitSha1: "91876762a536a746d268353c5cba57286e76b058" },
      { path: "tokenizer.json", size: 2480466, gitSha1: "1e95340ff836fad1b5932e800fb7b8c5e6d78a74" },
      { path: "tokenizer_config.json", size: 282683, gitSha1: "d13b786c04765fb1a06492b53587752cd67665ea" },
    ],
    wasm: [
      { path: "onnx/encoder_model_quantized.onnx", size: 23200850, sha256: "3e345e977b55620a37c0c2b2af0644e019afdfad562dcf71eb929bb7274285f9" },
      { path: "onnx/decoder_model_merged_quantized.onnx", size: 53707539, sha256: "a6beb6baabb66f00b6a686d828c95ffca6146d51900cbad0266cad38f64cf861" },
    ],
    webgpu: [
      { path: "onnx/encoder_model.onnx", size: 82474863, sha256: "f0bd7927234639c6e1f293cef18a210cee4e4aea93e200ebbe48e1d7acf6fdb1" },
      { path: "onnx/decoder_model_merged_q4.onnx", size: 123641874, sha256: "a68dcdbb6551967030dcbdcef400d6e62b1624234c2e606f75d1d2878aef5def" },
    ],
  },
  small: {
    repo: "Xenova/whisper-small",
    revision: "2d67713f236afa48a18992566e7647f6ca848e13",
    common: [
      { path: "config.json", size: 2232, gitSha1: "a239fdd538b77d3c496d13d085848eca67fe993a" },
      { path: "generation_config.json", size: 3837, gitSha1: "66f96818620f7b67c276aed4a35bedc4f6986dc3" },
      { path: "preprocessor_config.json", size: 339, gitSha1: "91876762a536a746d268353c5cba57286e76b058" },
      { path: "tokenizer.json", size: 2480466, gitSha1: "1e95340ff836fad1b5932e800fb7b8c5e6d78a74" },
      { path: "tokenizer_config.json", size: 282683, gitSha1: "d13b786c04765fb1a06492b53587752cd67665ea" },
    ],
    wasm: [
      { path: "onnx/encoder_model_quantized.onnx", size: 92324809, sha256: "969f5ac12974340386bf7a02ea6626003e5e2dee396ffc6ab0eec282bf55ba06" },
      { path: "onnx/decoder_model_merged_quantized.onnx", size: 156780950, sha256: "fcfc6100dc7339e7507e10f8b274350be7c4f8d8b575f0293f94cc0e156d6d24" },
    ],
    webgpu: [
      { path: "onnx/encoder_model.onnx", size: 352839389, sha256: "31a05a14d514440e43746fdaaa8d4e8102c9543e53c5ae1111910af142041406" },
      { path: "onnx/decoder_model_merged_q4.onnx", size: 233230238, sha256: "7de7841243c9f128780dbd18949bca0c7291866f1435b8dafb577bbf445e973b" },
    ],
  },
};

/** dtype de Transformers.js para cada dispositivo (determina el sufijo del archivo ONNX). */
export const DTYPES: Record<AsrDevice, Record<string, string>> = {
  wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
};

export const MODEL_LABELS: Record<WhisperSize, { label: string; note: string }> = {
  tiny: { label: 'Rápido (tiny)', note: 'el más ligero; comete más errores' },
  base: { label: 'Equilibrado (base)', note: 'buena relación calidad/velocidad' },
  small: { label: 'Preciso (small)', note: 'mejor en español; lento sin GPU' },
};

/** Archivos que necesita un modelo en un dispositivo. */
export function modelFiles(size: WhisperSize, device: AsrDevice): ModelFile[] {
  const m = WHISPER_MODELS[size];
  return [...m.common, ...m[device]];
}

export function modelBytes(size: WhisperSize, device: AsrDevice): number {
  return modelFiles(size, device).reduce((s, f) => s + f.size, 0);
}

/** URL exacta que pide Transformers.js (remoteHost + «{model}/resolve/{revision}/» + archivo): también es la clave de caché. */
export function fileUrl(size: WhisperSize, file: string): string {
  const m = WHISPER_MODELS[size];
  return `${MODEL_HOST}${m.repo}/resolve/${encodeURIComponent(m.revision)}/${file}`;
}

/** Idiomas ofrecidos (código ISO 639-1 que entiende Whisper), español primero. */
export const ASR_LANGUAGES: { code: string; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'Inglés' },
  { code: 'pt', label: 'Portugués' },
  { code: 'fr', label: 'Francés' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Alemán' },
  { code: 'ca', label: 'Catalán' },
  { code: 'gl', label: 'Gallego' },
  { code: 'eu', label: 'Euskera' },
  { code: 'nl', label: 'Neerlandés' },
  { code: 'ja', label: 'Japonés' },
  { code: 'zh', label: 'Chino' },
];

export interface DeviceInfo {
  /** WebGPU con adaptador real (no solo `navigator.gpu`) */
  webgpu: boolean;
  /** GB (navigator.deviceMemory; los navegadores lo topan en 8). undefined = desconocido */
  memoryGB?: number;
  cores?: number;
  mobile?: boolean;
}

export interface DeviceChoice {
  device: AsrDevice;
  /** aviso legible si se va a ir lento */
  warning?: string;
}

/** WebGPU si existe (salvo que se pida WASM); si no, WASM con aviso de velocidad. */
export function chooseDevice(info: DeviceInfo, preferred?: AsrDevice): DeviceChoice {
  if (preferred === 'wasm') return { device: 'wasm', warning: 'Sin GPU la transcripción va por CPU: puede tardar más que la duración del audio.' };
  if (info.webgpu) return { device: 'webgpu' };
  return {
    device: 'wasm',
    warning: preferred === 'webgpu' ? 'Este equipo no tiene WebGPU: se usa la CPU, más lenta.' : 'Sin WebGPU la transcripción va por CPU: puede tardar más que la duración del audio.',
  };
}

/** Modelos que se pueden elegir en este equipo y el sugerido. small sin GPU o con poca memoria no se ofrece en móvil. */
export function suggestModel(info: DeviceInfo): { suggested: WhisperSize; allowed: WhisperSize[]; reason: string } {
  const mem = info.memoryGB;
  const low = info.mobile || (mem !== undefined && mem <= 4);
  if (low) {
    const allowed: WhisperSize[] = mem !== undefined && mem < 3 ? ['tiny'] : ['tiny', 'base'];
    return { suggested: 'tiny', allowed, reason: info.mobile ? 'móvil: el modelo ligero cabe en memoria' : 'poca memoria' };
  }
  if (info.webgpu && (mem === undefined || mem >= 8)) return { suggested: 'small', allowed: ['tiny', 'base', 'small'], reason: 'GPU disponible: el más preciso va rápido' };
  return { suggested: 'base', allowed: ['tiny', 'base', 'small'], reason: info.webgpu ? 'GPU con memoria moderada' : 'sin GPU: equilibrio entre calidad y tiempo' };
}

/** Detecta el equipo (navegador o worker). */
export async function detectDevice(): Promise<DeviceInfo> {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(): Promise<unknown> }; userAgentData?: { mobile?: boolean } };
  let webgpu = false;
  try {
    webgpu = !!(nav.gpu && (await nav.gpu.requestAdapter()));
  } catch {
    webgpu = false;
  }
  const ua = nav.userAgent ?? '';
  return {
    webgpu,
    memoryGB: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    mobile: nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(ua),
  };
}
