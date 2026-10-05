// Puente con los comandos Rust de src-tauri/src/native_media (V10). En web y en
// Android no hay ffmpeg nativo: todo devuelve «no disponible» y la app sigue
// como siempre. Ninguna función de aquí recibe ni envía rutas: los archivos se
// identifican con un token que Rust creó al elegirlos el usuario.
import { isTauri } from '../../io/nativeSave';
import { parseProgress } from './pure';
import type { FrameOptions, HwEncoder, HwExportOptions, JobEvent, NativeStatus, OutputRef, ProbeInfo, ProgressInfo, ProxyOptions, SourceRef } from './types';

const isMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);

/** Escritorio instalado (Tauri en Windows/macOS/Linux). */
export const isNativeDesktop = () => isTauri() && !isMobile();

async function core() {
  return import('@tauri-apps/api/core');
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await core();
  return invoke<T>(cmd, args);
}

let statusP: Promise<NativeStatus | null> | null = null;

/** Estado de ffmpeg nativo (se detecta una vez por sesión). null fuera del escritorio. */
export function nativeStatus(refresh = false): Promise<NativeStatus | null> {
  if (!isNativeDesktop()) return Promise.resolve(null);
  if (!statusP || refresh) {
    statusP = call<NativeStatus>('native_media_status', { refresh }).catch((e) => {
      console.warn('[native-media] estado no disponible', e);
      return null;
    });
  }
  return statusP;
}

export async function nativeAvailable(): Promise<boolean> {
  return !!(await nativeStatus())?.available;
}

/** Diálogo nativo «Abrir» (lo abre Rust). */
export const pickSources = () => call<SourceRef[]>('native_media_pick');
/** Registra lo último que se soltó sobre la ventana (rutas del sistema, no de la interfaz). */
export const takeDroppedSources = () => call<SourceRef[]>('native_media_take_dropped');
export const probeSource = (token: string) => call<ProbeInfo>('native_media_probe', { token });
export const workingHwEncoders = () => call<HwEncoder[]>('native_media_hw_encoders');
export const clearNativeCache = () => call<number>('native_media_cache_clear');
export const cancelJob = (jobId: number) => call<boolean>('native_media_cancel', { jobId });

export interface JobHooks {
  onProgress?: (p: ProgressInfo & { jobId: number }) => void;
  signal?: AbortSignal;
}

export class AbortError extends Error {
  constructor() {
    super('cancelado');
    this.name = 'AbortError';
  }
}

/** Lanza un trabajo con canal de progreso y cancelación por AbortSignal. */
async function runJob(cmd: string, args: Record<string, unknown>, hooks: JobHooks): Promise<OutputRef> {
  const { Channel } = await core();
  if (hooks.signal?.aborted) throw new AbortError();
  let jobId: number | null = null;
  let duration = 0;
  let last = 0;
  const ch = new Channel<JobEvent>();
  const onAbort = () => {
    if (jobId !== null) void cancelJob(jobId);
  };
  hooks.signal?.addEventListener('abort', onAbort);
  ch.onmessage = (ev) => {
    if (ev.event === 'started') {
      jobId = ev.jobId;
      duration = ev.duration;
      if (hooks.signal?.aborted) void cancelJob(ev.jobId);
      return;
    }
    const p = parseProgress(ev, duration, last);
    if (p.fraction !== null) last = p.fraction;
    hooks.onProgress?.({ ...p, jobId: ev.jobId });
  };
  try {
    return await call<OutputRef>(cmd, { ...args, onEvent: ch });
  } catch (e) {
    if (hooks.signal?.aborted || String(e) === 'cancelado') throw new AbortError();
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    hooks.signal?.removeEventListener('abort', onAbort);
  }
}

export const transcodeToProxy = (token: string, options: ProxyOptions, hooks: JobHooks = {}) => runJob('native_media_proxy', { token, options }, hooks);
export const extractAudio = (token: string, hooks: JobHooks = {}) => runJob('native_media_extract_audio', { token }, hooks);

const READ_CHUNK = 16 * 1024 * 1024;

/**
 * Trae un resultado de la caché como Blob, en trozos de 16 MiB. Cada trozo se
 * encadena al Blob anterior (Chromium no copia lo ya guardado y puede pasarlo
 * a disco), así que la memoria usada es la de un trozo, no la del archivo.
 */
export async function readOutput(out: Pick<OutputRef, 'key' | 'bytes' | 'mime'>, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Blob> {
  let blob = new Blob([], { type: out.mime });
  for (let offset = 0; offset < out.bytes; ) {
    if (signal?.aborted) throw new AbortError();
    const buf = await call<ArrayBuffer>('native_media_read', { key: out.key, offset, length: READ_CHUNK });
    if (!buf.byteLength) throw new Error('el resultado se ha truncado');
    blob = new Blob([blob, buf], { type: out.mime });
    offset += buf.byteLength;
    onProgress?.(Math.min(1, offset / out.bytes));
  }
  return blob;
}

/**
 * Lector de fotogramas RGBA crudos del ORIGINAL decodificado por ffmpeg (para
 * exportar con la calidad del original sin cargarlo entero): ffmpeg escribe en
 * un tubo y Rust los entrega en trozos de ≤ 64 MiB bajo demanda.
 */
export class NativeFrameReader {
  private constructor(
    readonly jobId: number,
    readonly frameBytes: number,
    readonly options: FrameOptions,
  ) {}
  private closed = false;

  static async open(token: string, options: FrameOptions): Promise<NativeFrameReader> {
    const r = await call<{ jobId: number; frameBytes: number }>('native_media_frames_open', { token, options });
    return new NativeFrameReader(r.jobId, r.frameBytes, options);
  }

  /** Hasta `max` fotogramas seguidos; [] = fin. */
  async read(max = 8): Promise<Uint8ClampedArray[]> {
    if (this.closed) return [];
    const buf = await call<ArrayBuffer>('native_media_frames_read', { jobId: this.jobId, maxFrames: max });
    const out: Uint8ClampedArray[] = [];
    for (let o = 0; o + this.frameBytes <= buf.byteLength; o += this.frameBytes) out.push(new Uint8ClampedArray(buf, o, this.frameBytes));
    if (!out.length) await this.close();
    return out;
  }

  async *frames(batch = 8): AsyncGenerator<Uint8ClampedArray> {
    try {
      for (;;) {
        const fs = await this.read(batch);
        if (!fs.length) return;
        yield* fs;
      }
    } finally {
      await this.close();
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await call<boolean>('native_media_frames_close', { jobId: this.jobId }).catch(() => false);
  }
}

// ------------------------------------------------ exportación por hardware

const HW_FLAG = 'chamva.experimental.hwExport';

/** Opción EXPERIMENTAL (apagada por defecto): exportar con el codificador H.264 del sistema/GPU. */
export function isHwExportEnabled(): boolean {
  try {
    return isNativeDesktop() && localStorage.getItem(HW_FLAG) === '1';
  } catch {
    return false;
  }
}
export function setHwExportEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(HW_FLAG, '1');
    else localStorage.removeItem(HW_FLAG);
  } catch {
    /* sin almacenamiento: queda apagada */
  }
}

export class HwExport {
  private constructor(readonly jobId: number, readonly frameBytes: number) {}

  static async open(options: HwExportOptions, hooks: JobHooks = {}): Promise<HwExport> {
    if (!isHwExportEnabled()) throw new Error('la exportación por hardware es experimental y está desactivada');
    const { Channel } = await core();
    const ch = new Channel<JobEvent>();
    ch.onmessage = (ev) => {
      if (ev.event === 'progress') hooks.onProgress?.({ ...parseProgress(ev, 0), jobId: ev.jobId });
    };
    const jobId = await call<number>('native_media_hw_export_open', { options, onEvent: ch });
    const h = new HwExport(jobId, options.width * options.height * 4);
    hooks.signal?.addEventListener('abort', () => void h.abort());
    return h;
  }

  /** Fotogramas RGBA (uno o varios seguidos, ≤ 64 MiB por llamada). */
  async writeFrames(rgba: Uint8Array | Uint8ClampedArray) {
    const { invoke } = await core();
    await invoke('native_media_hw_export_write', new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), { headers: { 'x-job': String(this.jobId) } });
  }

  /** Audio WAV en trozos (el primero con la cabecera RIFF/WAVE). */
  async writeAudio(wavChunk: Uint8Array) {
    const { invoke } = await core();
    await invoke('native_media_hw_export_write_audio', wavChunk, { headers: { 'x-job': String(this.jobId) } });
  }

  /** Termina y abre el diálogo «Guardar»; devuelve la ruta elegida (solo para mostrarla) o null. */
  finish(fileName: string) {
    return call<string | null>('native_media_hw_export_finish', { jobId: this.jobId, fileName });
  }

  abort() {
    return call<boolean>('native_media_hw_export_abort', { jobId: this.jobId }).catch(() => false);
  }
}
