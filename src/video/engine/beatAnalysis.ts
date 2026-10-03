// Análisis de ritmo de un archivo (V7): decodifica el audio por trozos (el mismo camino de la exportación), lo
// reduce a mono de 12 kHz sobre la marcha y le pasa la detección de ritmo (audio/beats.ts). Solo se queda la
// lista de pulsos (en segundos del ARCHIVO), no el audio.
import { detectBeats } from '../audio/beats';
import type { BeatInfo } from '../model/types';
import { BufferAudioSource, DecoderAudioSource, audioDecoderConfig } from './audioSource';
import { demux } from './demux';
import { AUDIO_SAMPLE_RATE } from './formats';
import type { PcmSource } from './mixer';

const TARGET = 12000;
const DECIM = AUDIO_SAMPLE_RATE / TARGET; // 4
/** Más allá de esto no se analiza (memoria y tiempo): 15 min. */
export const BEAT_MAX_SECONDS = 15 * 60;

const abortError = () => new DOMException('Análisis cancelado', 'AbortError');

async function openAudio(blob: Blob): Promise<PcmSource | null> {
  try {
    const file = await demux(blob);
    if (file.audio) {
      const cfg = await audioDecoderConfig(file.audio);
      if (cfg) return new DecoderAudioSource(file.audio, blob, cfg, 0);
    }
  } catch {
    /* se prueba el respaldo */
  }
  try {
    const ctx = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
    return new BufferAudioSource(await ctx.decodeAudioData(await blob.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Detecta los pulsos del audio de un archivo; null si no tiene audio legible o no se encuentra ritmo. */
export async function analyzeMediaBeats(blob: Blob, o: { duration: number; signal?: AbortSignal; onProgress?: (r: number) => void }): Promise<BeatInfo | null> {
  const src = await openAudio(blob);
  if (!src) return null;
  const secs = Math.min(BEAT_MAX_SECONDS, o.duration > 0 ? o.duration : BEAT_MAX_SECONDS);
  const total = Math.floor(secs * TARGET);
  const mono = new Float32Array(total);
  let w = 0;
  const BLOCK = AUDIO_SAMPLE_RATE; // 1 s
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  try {
    for (let t = 0; t < secs && w < total; t += 1) {
      if (o.signal?.aborted) throw abortError();
      const n = Math.min(BLOCK, Math.round((secs - t) * AUDIO_SAMPLE_RATE));
      await src.read(t, 1 / AUDIO_SAMPLE_RATE, n, L, R);
      for (let i = 0; i + DECIM <= n && w < total; i += DECIM) {
        let s = 0;
        for (let j = 0; j < DECIM; j++) s += L[i + j] + R[i + j];
        mono[w++] = s / (2 * DECIM);
      }
      o.onProgress?.(Math.min(0.9, t / secs));
    }
  } finally {
    src.close();
  }
  const res = detectBeats(mono.subarray(0, w), TARGET);
  o.onProgress?.(1);
  if (!res.beats.length || !(res.bpm > 0)) return null;
  return { bpm: Math.round(res.bpm * 10) / 10, beats: res.beats.map((b) => Math.round(b * 1000) / 1000), onsets: res.onsets.map((b) => Math.round(b * 1000) / 1000) };
}
