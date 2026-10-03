/// <reference lib="webworker" />
// Worker de transcripción (Whisper vía Transformers.js): fuera del hilo de la interfaz.
//
// RED CORTADA PARA LOS MODELOS: este worker solo lee pesos de la caché «chamva-models-v1» que llena
// `store.ts` tras el consentimiento del usuario. Cualquier petición a Hugging Face desde aquí se responde
// localmente (404, o error «falta el modelo» si es un archivo del manifiesto): transcribir nunca descarga nada.
// El audio llega como Float32Array por postMessage y no sale de este proceso.
//
// Protocolo:
//   → { id, op: 'probe' }                                       ← { id, done, webgpu }
//   → { id, op: 'transcribe', pcm, size, device, language, task } ← { id, progress, stage } … { id, done, result }
//   ← { id, error, code? }   code: 'missing-model' | 'gpu'
import { DTYPES, MODEL_HOST, WHISPER_MODELS, fileUrl, modelFiles, type AsrDevice, type WhisperSize } from './models';
import { MODEL_CACHE } from './store';
import { ASR_RATE, buildSegments, mergeWindowWords, refineWordTimes, windowsForAudio, wordsFromChunks, type AsrSegment, type AsrWindow, type AsrWord } from './windows';

export interface TranscribeRequest {
  pcm: Float32Array;
  size: WhisperSize;
  device: AsrDevice;
  /** null = detectar */
  language: string | null;
  task: 'transcribe' | 'translate';
  /** afinar los tiempos con la energía del audio (def. true) */
  refine?: boolean;
}

export interface TranscribeResult {
  segments: AsrSegment[];
  language: string;
  languageDetected: boolean;
  windows: number;
  /** s de audio con voz que se transcribieron */
  speechSeconds: number;
  loadMs: number;
  asrMs: number;
}

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

class MissingModelError extends Error {
  code = 'missing-model';
  constructor(file: string) {
    super(`Falta el modelo de transcripción en este equipo (${file}). Descárgalo primero desde «Subtítulos automáticos»; después funciona sin conexión.`);
  }
}

/** Retraso medido de las marcas por palabra (tiny ≈ 0,38 s, base ≈ 0,21 s en Chromium, V5a); small: sin medir, como base. */
const REFINE: Record<WhisperSize, { lag: number; maxShift: number }> = { tiny: { lag: 0.35, maxShift: 0.7 }, base: { lag: 0.2, maxShift: 0.5 }, small: { lag: 0.2, maxShift: 0.5 } };

let configured: Promise<typeof import('@huggingface/transformers')> | null = null;

function setup() {
  return (configured ??= (async () => {
    const tf = await import('@huggingface/transformers');
    const { env } = tf;
    const known = new Set<string>();
    for (const s of Object.keys(WHISPER_MODELS) as WhisperSize[]) for (const d of ['wasm', 'webgpu'] as AsrDevice[]) for (const f of modelFiles(s, d)) known.add(fileUrl(s, f.path));
    const cache = caches.open(MODEL_CACHE);
    env.allowLocalModels = false;
    env.allowRemoteModels = true; // necesario para que consulte la caché; la red la corta `fetch` de abajo
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = {
      match: async (key: string) => (await cache).match(key),
      put: async () => undefined, // nunca se guarda nada desde aquí
    } as any;
    const realFetch = env.fetch;
    env.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(MODEL_HOST) || /^https?:\/\/([^/]+\.)?(huggingface\.co|hf\.co)\//.test(url)) {
        const base = url.split('?')[0];
        if (known.has(base)) throw new MissingModelError(base.split('/').pop() ?? base);
        return new Response(null, { status: 404, statusText: 'offline' });
      }
      return realFetch(input as any, init);
    }) as any;
    return tf;
  })());
}

const pipes = new Map<string, Promise<any>>();

async function getAsr(size: WhisperSize, device: AsrDevice, onProgress: (r: number) => void) {
  const key = `${size}:${device}`;
  let p = pipes.get(key);
  if (!p) {
    p = (async () => {
      const tf = await setup();
      const m = WHISPER_MODELS[size];
      // `pipeline()` no pasa `revision` a todas sus consultas (config, metadatos): se fija en la plantilla de
      // rutas, así TODAS las URL son las del commit del manifiesto (y coinciden con las claves de la caché).
      // Un worker carga un solo modelo por trabajo, así que cambiar la plantilla global es seguro.
      tf.env.remotePathTemplate = `{model}/resolve/${encodeURIComponent(m.revision)}/`;
      const loaded = new Map<string, number>();
      return tf.pipeline('automatic-speech-recognition', m.repo, {
        revision: m.revision,
        device,
        dtype: DTYPES[device] as any,
        // ORT 1.26-dev (el que trae Transformers.js 4.2) falla al crear la sesión del decodificador cuantizado
        // con la optimización completa (TransposeDQWeightsForMatMulNBits: «Missing required scale»): en WASM
        // se usa el nivel básico, comprobado en Chromium.
        session_options: device === 'wasm' ? { graphOptimizationLevel: 'basic' } : {},
        progress_callback: (x: any) => {
          if (x?.status === 'progress' && typeof x.progress === 'number') {
            loaded.set(x.file, x.progress / 100);
            const vals = [...loaded.values()];
            onProgress(vals.reduce((s, v) => s + v, 0) / Math.max(vals.length, 1));
          }
        },
      } as any);
    })();
    p.catch(() => pipes.delete(key));
    pipes.set(key, p);
  }
  return p;
}

/** Idioma más probable en los primeros 30 s de voz: un paso del decodificador tras <|startoftranscript|>. */
async function detectLanguage(asr: any, pcm: Float32Array, win: AsrWindow | undefined): Promise<string | null> {
  try {
    const tf = await setup();
    const slice = win ? pcm.subarray(Math.floor(win.start * ASR_RATE), Math.ceil(win.end * ASR_RATE)) : pcm.subarray(0, 30 * ASR_RATE);
    const { input_features } = await asr.processor(slice);
    const gc = asr.model.generation_config;
    const sot = gc.decoder_start_token_id as number;
    const decoder_input_ids = new tf.Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]);
    const out = await asr.model({ input_features, decoder_input_ids });
    const logits = out.logits.data as Float32Array;
    const dims = out.logits.dims as number[];
    const vocab = dims[dims.length - 1];
    const row = logits.subarray(logits.length - vocab);
    let best: string | null = null;
    let bestV = -Infinity;
    for (const [tok, id] of Object.entries(gc.lang_to_id as Record<string, number>)) {
      if (row[id] > bestV) {
        bestV = row[id];
        best = tok.replace(/[<|>]/g, '');
      }
    }
    return best;
  } catch (e) {
    console.warn('[transcribe] no se pudo detectar el idioma:', e);
    return null;
  }
}

async function transcribe(id: number, r: TranscribeRequest): Promise<TranscribeResult> {
  if (r.device === 'webgpu') {
    const gpu = (navigator as any).gpu;
    if (!gpu || !(await gpu.requestAdapter().catch(() => null))) throw Object.assign(new Error('WebGPU no está disponible en este equipo.'), { code: 'gpu' });
  }
  const t0 = performance.now();
  post({ id, progress: 0, stage: 'load' });
  const asr = await getAsr(r.size, r.device, (x) => post({ id, progress: x, stage: 'load' }));
  const t1 = performance.now();
  const wins = windowsForAudio(r.pcm, ASR_RATE);
  let language = r.language;
  let languageDetected = false;
  if (!language) {
    post({ id, progress: 0, stage: 'language' });
    language = (await detectLanguage(asr, r.pcm, wins[0])) ?? 'es';
    languageDetected = true;
  }
  const per: { win: AsrWindow; words: AsrWord[] }[] = [];
  const speech = wins.reduce((s, w) => s + (w.end - w.start), 0);
  let done = 0;
  post({ id, progress: 0, stage: 'asr', windows: wins.length });
  for (const win of wins) {
    const slice = r.pcm.subarray(Math.floor(win.start * ASR_RATE), Math.ceil(win.end * ASR_RATE));
    const out = await asr(slice, { return_timestamps: 'word', language, task: r.task });
    const chunks = (Array.isArray(out) ? out[0] : out)?.chunks ?? [];
    per.push({ win, words: wordsFromChunks(chunks, win) });
    done += win.end - win.start;
    post({ id, progress: speech ? done / speech : 1, stage: 'asr' });
  }
  const merged = mergeWindowWords(per);
  const words = r.refine === false ? merged : refineWordTimes(merged, r.pcm, ASR_RATE, REFINE[r.size]);
  return { segments: buildSegments(words), language: language!, languageDetected, windows: wins.length, speechSeconds: speech, loadMs: t1 - t0, asrMs: performance.now() - t1 };
}

self.onmessage = async (e: MessageEvent<{ id: number; op: string } & Partial<TranscribeRequest>>) => {
  const { id, op } = e.data;
  try {
    if (op === 'probe') {
      const gpu = (navigator as any).gpu;
      const webgpu = !!(gpu && (await gpu.requestAdapter().catch(() => null)));
      post({ id, done: true, webgpu });
    } else if (op === 'transcribe') {
      const result = await transcribe(id, e.data as TranscribeRequest);
      post({ id, done: true, result });
    }
  } catch (err) {
    const x = err as Error & { code?: string };
    let code = x?.code;
    let msg = x?.message ?? String(err);
    // Transformers.js envuelve algunos errores: reconocer el de modelo ausente por el texto
    if (!code && /Falta el modelo de transcripción/.test(msg)) code = 'missing-model';
    if (!code && /webgpu/i.test(msg) && e.data.device === 'webgpu') code = 'gpu';
    if (code === 'missing-model') msg = msg.slice(msg.indexOf('Falta el modelo'));
    post({ id, error: msg, code });
  }
};
