/// <reference lib="webworker" />
// Worker de «quitar fondo» de video (V9): MODNet (Apache-2.0) vía Transformers.js, fuera del hilo de la interfaz.
//
// RED CORTADA PARA LOS MODELOS (como el de transcripción): solo lee los pesos de la caché «chamva-models-v1» que llena
// `models.ts` tras el consentimiento con el tamaño exacto. Cualquier petición a Hugging Face se responde aquí mismo; el
// video llega como píxeles por postMessage y nunca sale de este proceso.
//
// Protocolo:
//   → { id, op: 'load' }                                   ← { id, done, loadMs }
//   → { id, op: 'infer', w, h, rgba (ArrayBuffer) }         ← { id, done, mask (ArrayBuffer w·h, 0..255), ms }
//   ← { id, error, code? }   code: 'missing-model'
import { MATTE_HOST, MATTE_MODEL, MODEL_CACHE, matteFileUrl } from './models';

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

class MissingModelError extends Error {
  code = 'missing-model';
  constructor(file: string) {
    super(`Falta el modelo de «quitar fondo» en este equipo (${file}). Descárgalo primero; después funciona sin conexión.`);
  }
}

let modelP: Promise<{ tf: typeof import('@huggingface/transformers'); model: any; inName: string; outName: string }> | null = null;

function load() {
  return (modelP ??= (async () => {
    const tf = await import('@huggingface/transformers');
    const { env } = tf;
    const known = new Set(MATTE_MODEL.files.map((f) => matteFileUrl(f.path)));
    const cache = caches.open(MODEL_CACHE);
    env.allowLocalModels = false;
    env.allowRemoteModels = true; // para que consulte la caché; la red la corta `fetch`
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = { match: async (key: string) => (await cache).match(key), put: async () => undefined } as any;
    const realFetch = env.fetch;
    env.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(MATTE_HOST) || /^https?:\/\/([^/]+\.)?(huggingface\.co|hf\.co)\//.test(url)) {
        const base = url.split('?')[0];
        if (known.has(base)) throw new MissingModelError(base.split('/').pop() ?? base);
        return new Response(null, { status: 404, statusText: 'offline' });
      }
      return realFetch(input as any, init);
    }) as any;
    tf.env.remotePathTemplate = `{model}/resolve/${encodeURIComponent(MATTE_MODEL.revision)}/`;
    const model = await tf.AutoModel.from_pretrained(MATTE_MODEL.repo, { revision: MATTE_MODEL.revision, device: 'wasm', dtype: 'fp32' } as any);
    const session = (model as any).sessions?.model;
    return { tf, model, inName: session?.inputNames?.[0] ?? 'input', outName: session?.outputNames?.[0] ?? 'output' };
  })().catch((e) => {
    modelP = null;
    throw e;
  }));
}

/** RGBA → tensor [1,3,h,w] normalizado como el preprocesador de MODNet: (x/255 − 0,5) / 0,5. */
function toTensor(tf: typeof import('@huggingface/transformers'), rgba: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  const data = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    data[i] = rgba[j] / 127.5 - 1;
    data[n + i] = rgba[j + 1] / 127.5 - 1;
    data[2 * n + i] = rgba[j + 2] / 127.5 - 1;
  }
  return new tf.Tensor('float32', data, [1, 3, h, w]);
}

self.onmessage = async (e: MessageEvent<{ id: number; op: 'load' | 'infer'; w?: number; h?: number; rgba?: ArrayBuffer }>) => {
  const { id, op } = e.data;
  try {
    const t0 = performance.now();
    const m = await load();
    if (op === 'load') return post({ id, done: true, loadMs: performance.now() - t0 });
    const w = e.data.w!;
    const h = e.data.h!;
    const t1 = performance.now();
    const out = await m.model({ [m.inName]: toTensor(m.tf, new Uint8ClampedArray(e.data.rgba!), w, h) });
    const raw = out[m.outName] ?? Object.values(out)[0];
    const src = raw.data as Float32Array;
    const [, , oh, ow] = raw.dims as number[];
    const mask = new Uint8Array(w * h);
    if (ow === w && oh === h) for (let i = 0; i < mask.length; i++) mask[i] = Math.max(0, Math.min(255, Math.round(src[i] * 255)));
    else
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) mask[y * w + x] = Math.max(0, Math.min(255, Math.round(src[Math.min(oh - 1, Math.floor((y * oh) / h)) * ow + Math.min(ow - 1, Math.floor((x * ow) / w))] * 255)));
    post({ id, done: true, mask: mask.buffer, ms: performance.now() - t1 }, [mask.buffer]);
  } catch (err) {
    const x = err as Error & { code?: string };
    post({ id, error: x?.message ?? String(err), code: x?.code });
  }
};
