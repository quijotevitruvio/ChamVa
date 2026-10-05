/// <reference lib="webworker" />
// Worker de importación HEIC/HEIF. Decodifica con WebCodecs, es decir, con el decodificador
// HEVC/AV1 que YA trae el sistema o la GPU (ChamVa no incluye ningún decodificador HEVC).
// Mensajes: entrada {buf, maxPixels}; salida progress | done | error.
import { colorOverride, type ColorInfo } from './color';
import { decodeWithPlan, type DecodeDeps, type FrameLike, type SurfaceLike, type TileDecoder } from './decodeCore';
import { HeicError, isHeicError } from './errors';
import { buildPlan, type ImagePlan } from './plan';

export interface HeicWorkerIn {
  buf: ArrayBuffer;
  maxPixels?: number;
}
export type HeicWorkerOut =
  | { type: 'progress'; p: number; stage: string }
  | { type: 'done'; blob: Blob; width: number; height: number; warnings: string[] }
  | { type: 'error'; code: HeicError['code']; detail: string };

const TILE_TIMEOUT_MS = 20_000;

function configsFor(p: ImagePlan): VideoDecoderConfig[] {
  const base: VideoDecoderConfig = {
    codec: p.codecString,
    description: p.description,
    codedWidth: p.tileW,
    codedHeight: p.tileH,
    optimizeForLatency: true,
  };
  const out = [base];
  // «Main Still Picture» (perfil 3) es un subconjunto de Main: algunos decodificadores solo
  // anuncian Main. Se pide Main con el mismo flujo; si no lo aceptan, falla y se informa.
  if (p.codec === 'hevc' && /^hvc1\.3\./.test(p.codecString)) out.push({ ...base, codec: p.codecString.replace(/^hvc1\.3\.[0-9A-F]+\./, 'hvc1.1.6.') });
  return out;
}

async function fixColor(frame: VideoFrame, info: ColorInfo): Promise<VideoFrame> {
  const cs = frame.colorSpace;
  const o = colorOverride(info, { primaries: cs.primaries ?? null, transfer: cs.transfer ?? null, matrix: cs.matrix ?? null, fullRange: cs.fullRange ?? null });
  if (!o || !frame.format) return frame;
  try {
    // Se copia el área CODIFICADA entera (copyTo por defecto copia solo la visible).
    const rect = { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight };
    const data = new Uint8Array(frame.allocationSize({ rect }));
    await frame.copyTo(data, { rect });
    const vr = frame.visibleRect;
    const nf = new VideoFrame(data, {
      format: frame.format,
      codedWidth: frame.codedWidth,
      codedHeight: frame.codedHeight,
      visibleRect: vr ? { x: vr.x, y: vr.y, width: vr.width, height: vr.height } : undefined,
      displayWidth: frame.displayWidth,
      displayHeight: frame.displayHeight,
      timestamp: frame.timestamp,
      colorSpace: o as VideoColorSpaceInit,
    });
    frame.close();
    return nf;
  } catch {
    return frame; // sin corrección de color antes que sin foto
  }
}

async function openDecoder(p: ImagePlan, role: 'color' | 'alpha', info: ColorInfo): Promise<TileDecoder | null> {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return null;
  const cands: VideoDecoderConfig[] = [];
  for (const c of configsFor(p)) {
    try {
      if ((await VideoDecoder.isConfigSupported(c)).supported) cands.push(c);
    } catch {
      /* configuración inválida para este navegador */
    }
  }
  if (!cands.length) return null;
  let waiter: { res: (f: VideoFrame) => void; rej: (e: unknown) => void } | null = null;
  let dead: unknown = null;
  let dec: VideoDecoder | null = null;
  let ci = -1;
  let anyOk = false;
  let closed = false;
  const shut = () => {
    try {
      if (dec && dec.state !== 'closed') dec.close();
    } catch {
      /* nada */
    }
  };
  // isConfigSupported puede decir que sí y configure() fallar después (p. ej. tamaños muy
  // pequeños en decodificadores de GPU): entonces se prueba la siguiente configuración.
  const next = () => {
    shut();
    ci++;
    dead = null;
    dec = new VideoDecoder({
      output: (f) => {
        if (waiter) {
          const w = waiter;
          waiter = null;
          w.res(f);
        } else f.close();
      },
      error: (e) => {
        dead = e;
        const w = waiter;
        waiter = null;
        w?.rej(e);
      },
    });
    dec.configure(cands[ci]);
  };
  next();
  const once = (data: Uint8Array, index: number) =>
    new Promise<VideoFrame>((res, rej) => {
      if (dead) return rej(dead);
      const t = setTimeout(() => {
        waiter = null;
        rej(new HeicError('decode-failed', 'el decodificador no respondió'));
      }, TILE_TIMEOUT_MS);
      waiter = {
        res: (f) => {
          clearTimeout(t);
          res(f);
        },
        rej: (e) => {
          clearTimeout(t);
          rej(e);
        },
      };
      try {
        dec!.decode(new EncodedVideoChunk({ type: 'key', timestamp: index, data }));
        dec!.flush().catch((e) => waiter?.rej(e));
      } catch (e) {
        waiter?.rej(e);
      }
    });
  return {
    async decode(data, index) {
      for (;;) {
        try {
          const f = await once(data, index);
          anyOk = true;
          return (role === 'color' ? await fixColor(f, info) : f) as FrameLike;
        } catch (e) {
          if (anyOk || ci + 1 >= cands.length || e instanceof HeicError) throw e;
          next();
        }
      }
    },
    close() {
      if (closed) return;
      closed = true;
      shut();
    },
  };
}

function surface(w: number, h: number): SurfaceLike {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new HeicError('too-large', `${w}×${h} px`);
  return {
    get width() {
      return c.width;
    },
    get height() {
      return c.height;
    },
    ctx: ctx as unknown as SurfaceLike['ctx'],
    source: c,
    toBlob: (type, quality) => c.convertToBlob({ type, quality }),
    release() {
      c.width = 0;
      c.height = 0;
    },
  };
}

self.onmessage = async (e: MessageEvent<HeicWorkerIn>) => {
  const post = (m: HeicWorkerOut) => (self as unknown as Worker).postMessage(m);
  try {
    const buf = new Uint8Array(e.data.buf);
    const plan = buildPlan(buf, e.data.maxPixels);
    if (typeof OffscreenCanvas === 'undefined') throw new HeicError('no-decoder', 'sin OffscreenCanvas');
    const deps: DecodeDeps = { openDecoder: (p, role) => openDecoder(p, role, plan.colorInfo), surface };
    let last = 0;
    const r = await decodeWithPlan(plan, buf, deps, {
      onProgress: (p, stage) => {
        const now = Date.now();
        if (now - last > 100 || p >= 1) {
          last = now;
          post({ type: 'progress', p, stage });
        }
      },
    });
    post({ type: 'done', ...r });
  } catch (err) {
    if (isHeicError(err)) post({ type: 'error', code: err.code, detail: err.detail });
    else post({ type: 'error', code: 'decode-failed', detail: err instanceof Error ? err.message : String(err) });
  }
};
