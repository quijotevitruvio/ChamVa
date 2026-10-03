// API de transcripción para la interfaz (V5). Flujo:
//   1) `transcribeEnvironment()` → dispositivo (WebGPU/WASM + aviso), modelos permitidos y sugerido.
//   2) `downloadPlan(storage, size, device)` → tamaño real y espacio; la UI pide permiso mostrando el tamaño.
//   3) `downloadModel(storage, size, device, { consent: { ...plan.consent, accepted: true } })`.
//   4) `transcribeProject(project, …)` o `transcribePcm(pcm, …)` → segmentos con palabras.
//   5) `segmentsToSubtitles(segments, …)` → `Cue[]` → `replaceCues` en una pista `subtitle` (V4).
// Cancelar = AbortSignal (termina el worker al instante; el modelo sigue en la caché).
// Sin modelo descargado, `transcribe*` falla con `MissingModelError` (mensaje legible) y NO descarga nada.
import type { VideoProject } from '../../video/model/types';
import { extractProjectAudio, type ExtractOptions } from './audio';
import { chooseDevice, detectDevice, suggestModel, type AsrDevice, type DeviceChoice, type WhisperSize } from './models';
import { browserStorageEnv, modelStatus, type StorageEnv } from './store';
import type { TranscribeResult } from './transcribe.worker';
import type { AsrSegment } from './windows';

export type { TranscribeResult };

export class MissingModelError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'MissingModelError';
  }
}

export interface TranscribeProgress {
  stage: 'audio' | 'load' | 'language' | 'asr';
  /** 0..1 de la etapa */
  ratio: number;
  /** 0..1 global aproximado */
  overall: number;
}

export interface TranscribeOptions {
  size: WhisperSize;
  device: AsrDevice;
  /** código ISO 639-1; null/undefined = detectar */
  language?: string | null;
  /** traducir a inglés (tarea translate de Whisper) */
  translate?: boolean;
  /** afinar las marcas por palabra con la energía del audio (def. true) */
  refineTimes?: boolean;
  onProgress?: (p: TranscribeProgress) => void;
  signal?: AbortSignal;
  /** almacenamiento (pruebas); por defecto el del navegador */
  storage?: StorageEnv;
}

const WEIGHT = { audio: [0, 0.1], load: [0.1, 0.2], language: [0.2, 0.22], asr: [0.22, 1] } as const;

function abortError() {
  return Object.assign(new Error('cancelado'), { name: 'AbortError' });
}

/** Lanza un worker nuevo por trabajo (cancelar = terminarlo). */
function runWorker<T>(msg: Record<string, unknown>, transfer: Transferable[], onMsg: (d: any) => void, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const w = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    const end = () => {
      signal?.removeEventListener('abort', onAbort);
      w.terminate();
    };
    const onAbort = () => {
      end();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    w.onmessage = (e) => {
      const d = e.data ?? {};
      if (typeof d.progress === 'number') return onMsg(d);
      end();
      if (d.error) reject(d.code === 'missing-model' ? new MissingModelError(d.error) : Object.assign(new Error(d.error), { code: d.code }));
      else resolve(d as T);
    };
    w.onerror = (e) => {
      end();
      reject(new Error(e.message || 'El proceso de transcripción falló.'));
    };
    w.postMessage({ id: 1, ...msg }, transfer);
  });
}

export interface TranscribeEnvironment {
  device: DeviceChoice;
  suggested: WhisperSize;
  allowed: WhisperSize[];
  reason: string;
  webgpu: boolean;
  memoryGB?: number;
}

/** Equipo detectado (WebGPU se comprueba con un adaptador real) y modelo sugerido. */
export async function transcribeEnvironment(preferred?: AsrDevice): Promise<TranscribeEnvironment> {
  const info = await detectDevice();
  const s = suggestModel(info);
  return { device: chooseDevice(info, preferred), suggested: s.suggested, allowed: s.allowed, reason: s.reason, webgpu: info.webgpu, memoryGB: info.memoryGB };
}

/** Error legible (sin descargar nada) si el modelo no está completo en este equipo. */
export async function assertInstalled(storage: StorageEnv, size: WhisperSize, device: AsrDevice): Promise<void> {
  const st = await modelStatus(storage, size, device);
  if (!st.installed)
    throw new MissingModelError(
      `El modelo «${size}» no está descargado en este equipo${st.bytesHave ? ' (descarga a medias)' : ''}. Descárgalo primero; después la transcripción funciona sin conexión.`,
    );
}

/** Transcribe audio mono a 16 kHz. `offset` (s) se suma a todos los tiempos (posición en la línea de tiempo). */
export async function transcribePcm(pcm: Float32Array, o: TranscribeOptions & { offset?: number }): Promise<TranscribeResult> {
  const storage = o.storage ?? browserStorageEnv();
  await assertInstalled(storage, o.size, o.device);
  const prog = (stage: TranscribeProgress['stage'], ratio: number) => {
    const [a, b] = WEIGHT[stage];
    o.onProgress?.({ stage, ratio, overall: a + (b - a) * Math.min(1, Math.max(0, ratio)) });
  };
  const copy = pcm.slice(); // se transfiere la copia: el llamador conserva su búfer
  const out = await runWorker<{ result: TranscribeResult }>(
    { op: 'transcribe', pcm: copy, size: o.size, device: o.device, language: o.language ?? null, task: o.translate ? 'translate' : 'transcribe', refine: o.refineTimes !== false },
    [copy.buffer],
    (d) => prog(d.stage, d.progress),
    o.signal,
  );
  const r = out.result;
  const off = o.offset ?? 0;
  if (off) r.segments = shiftSegments(r.segments, off);
  return r;
}

/** Transcribe el audio del proyecto (todo, una pista o un rango): los tiempos salen en tiempo de línea de tiempo. */
export async function transcribeProject(project: VideoProject, o: TranscribeOptions & Pick<ExtractOptions, 'trackId' | 'range'>): Promise<TranscribeResult & { audioSeconds: number }> {
  const storage = o.storage ?? browserStorageEnv();
  // comprobar el modelo ANTES de decodificar minutos de audio
  await assertInstalled(storage, o.size, o.device);
  const a = await extractProjectAudio(project, {
    trackId: o.trackId,
    range: o.range,
    signal: o.signal,
    onProgress: (r) => o.onProgress?.({ stage: 'audio', ratio: r, overall: WEIGHT.audio[1] * r }),
  });
  if (o.signal?.aborted) throw abortError();
  const r = await transcribePcm(a.pcm, { ...o, storage, offset: a.offset });
  return { ...r, audioSeconds: a.duration };
}

export function shiftSegments(segs: AsrSegment[], off: number): AsrSegment[] {
  const r = (x: number) => Math.round((x + off) * 1000) / 1000;
  return segs.map((s) => ({ start: r(s.start), end: r(s.end), text: s.text, words: s.words.map((w) => ({ t0: r(w.t0), t1: r(w.t1), w: w.w })) }));
}

/** ¿Hay WebGPU utilizable DENTRO de un worker? (puede diferir del hilo principal). */
export async function probeWorkerGpu(): Promise<boolean> {
  try {
    return (await runWorker<{ webgpu: boolean }>({ op: 'probe' }, [], () => undefined)).webgpu;
  } catch {
    return false;
  }
}
