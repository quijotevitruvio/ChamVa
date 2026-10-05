// Núcleo de la decodificación (se ejecuta en el worker): teselas → lienzo de la imagen →
// alfa → recorte/orientación → JPEG/PNG. El decodificador y el lienzo se inyectan, así que
// en pruebas se usa uno simulado y en el worker el de WebCodecs (decodificador del SO/GPU).
import { HeicError } from './errors';
import type { DecodePlan, ImagePlan } from './plan';
import { tileBytes } from './plan';

/** Lo mínimo que se usa de un VideoFrame. */
export interface FrameLike {
  displayWidth: number;
  displayHeight: number;
  close(): void;
}

export interface Ctx2D {
  drawImage(src: unknown, dx: number, dy: number): void;
  drawImage(src: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, sw2: number, sh2: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  putImageData(img: { data: Uint8ClampedArray }, x: number, y: number): void;
}

export interface SurfaceLike {
  width: number;
  height: number;
  ctx: Ctx2D;
  /** Lo que se pasa a drawImage (el OffscreenCanvas real). */
  source: unknown;
  toBlob(type: string, quality?: number): Promise<Blob>;
  release(): void;
}

export interface TileDecoder {
  /** Decodifica UNA tesela (fotograma clave) y devuelve su fotograma. */
  decode(data: Uint8Array, index: number): Promise<FrameLike>;
  close(): void;
}

export interface DecodeDeps {
  /** null si este equipo no puede decodificar ese códec/perfil. */
  openDecoder(p: ImagePlan, role: 'color' | 'alpha'): Promise<TileDecoder | null>;
  surface(w: number, h: number): SurfaceLike;
}

export interface DecodeResult {
  blob: Blob;
  width: number;
  height: number;
  warnings: string[];
}

export interface CoreOpts {
  onProgress?: (fraction: number, stage: string) => void;
  isCancelled?: () => boolean;
  jpegQuality?: number;
}

const checkCancel = (o: CoreOpts) => {
  if (o.isCancelled?.()) throw new HeicError('aborted');
};

/** Dibuja todas las teselas de `p` en una superficie de p.outW×p.outH (memoria: 1 tesela a la vez). */
export async function drawImagePlan(
  plan: DecodePlan,
  p: ImagePlan,
  buf: Uint8Array,
  dec: TileDecoder,
  deps: DecodeDeps,
  opts: CoreOpts,
  progress: (done: number) => void,
): Promise<SurfaceLike> {
  const s = deps.surface(p.outW, p.outH);
  try {
    for (let i = 0; i < p.tiles.length; i++) {
      checkCancel(opts);
      const data = tileBytes(plan, buf, p.tiles[i]);
      let frame: FrameLike;
      try {
        frame = await dec.decode(data, i);
      } catch (e) {
        if (e instanceof HeicError) throw e;
        // configure() rechazado tras un isConfigSupported optimista (tamaño/perfil que la GPU no admite)
        if ((e as { name?: string })?.name === 'NotSupportedError') throw new HeicError('no-decoder', 'el decodificador del equipo no admite esta imagen');
        throw new HeicError('decode-failed', e instanceof Error ? e.message : String(e));
      }
      try {
        const col = i % p.cols;
        const row = Math.floor(i / p.cols);
        s.ctx.drawImage(frame, col * p.tileW, row * p.tileH); // lo que sobra de la rejilla se recorta solo
      } finally {
        frame.close();
      }
      progress(i + 1);
    }
    return s;
  } catch (e) {
    s.release();
    throw e;
  }
}

export async function decodeWithPlan(plan: DecodePlan, buf: Uint8Array, deps: DecodeDeps, opts: CoreOpts = {}): Promise<DecodeResult> {
  const warnings = plan.ignored.length ? [`Se usó la imagen principal; se ignoró: ${plan.ignored.join(', ')}`] : [];
  const colorDec = await deps.openDecoder(plan.color, 'color');
  if (!colorDec) throw new HeicError('no-decoder', plan.color.codecString);
  let alphaDec: TileDecoder | null = null;
  if (plan.alpha) {
    try {
      alphaDec = await deps.openDecoder(plan.alpha, 'alpha');
    } catch {
      alphaDec = null;
    }
    if (!alphaDec) warnings.push('Este equipo no puede leer la transparencia de la foto: se abrió opaca');
  }
  const total = plan.color.tiles.length + (alphaDec ? plan.alpha!.tiles.length : 0);
  const report = (done: number, stage: string) => opts.onProgress?.(Math.min(0.9, (done / Math.max(1, total)) * 0.9), stage);
  let base: SurfaceLike | null = null;
  try {
    base = await drawImagePlan(plan, plan.color, buf, colorDec, deps, opts, (d) => report(d, 'Decodificando'));
    colorDec.close();
    if (alphaDec && plan.alpha) {
      let a: SurfaceLike | null = null;
      try {
        a = await drawImagePlan(plan, plan.alpha, buf, alphaDec, deps, opts, (d) => report(plan.color.tiles.length + d, 'Transparencia'));
        const w = plan.color.outW;
        const h = plan.color.outH;
        const ci = base.ctx.getImageData(0, 0, w, h);
        const ai = a.ctx.getImageData(0, 0, w, h).data;
        const cd = ci.data;
        for (let k = 3; k < cd.length; k += 4) cd[k] = ai[k - 3]; // luma del plano alfa → canal A
        base.ctx.putImageData(ci, 0, 0);
      } catch (e) {
        if (e instanceof HeicError && e.code === 'aborted') throw e;
        warnings.push('No se pudo leer la transparencia de la foto: se abrió opaca');
        plan = { ...plan, alpha: null };
      } finally {
        a?.release();
        alphaDec.close();
      }
    }
    checkCancel(opts);
    opts.onProgress?.(0.92, 'Orientando');
    const o = plan.orient;
    const identity = o.ops.length === 0 && o.crop.x === 0 && o.crop.y === 0 && o.crop.w === base.width && o.crop.h === base.height;
    let out = base;
    if (!identity) {
      out = deps.surface(o.outW, o.outH);
      out.ctx.setTransform(...o.matrix);
      out.ctx.drawImage(base.source, o.crop.x, o.crop.y, o.crop.w, o.crop.h, 0, 0, o.crop.w, o.crop.h);
      base.release();
      base = out;
    }
    checkCancel(opts);
    opts.onProgress?.(0.95, 'Guardando');
    const blob = plan.alpha && alphaDec ? await out.toBlob('image/png') : await out.toBlob('image/jpeg', opts.jpegQuality ?? 0.95);
    opts.onProgress?.(1, '');
    return { blob, width: o.outW, height: o.outH, warnings };
  } finally {
    base?.release();
    try {
      colorDec.close();
    } catch {
      /* ya cerrado */
    }
  }
}
