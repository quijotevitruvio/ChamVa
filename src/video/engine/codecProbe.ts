// Medida de la sonoridad DESPUÉS del códec con pérdida (V7): los codificadores de AAC y Opus cambian el nivel
// del programa (en pruebas, −0,1 LU en Opus y −0,55 LU en AAC con un programa de voz y música). La normalización
// mide la mezcla con la ganancia puesta, la codifica con el MISMO AudioEncoder que usará la exportación, la
// decodifica otra vez y mide ese resultado: la diferencia con el objetivo es lo que hay que corregir.
import { LoudnessMeter } from '../audio/loudness';
import { audioDataToStereo } from './audioSource';
import { AUDIO_SAMPLE_RATE } from './formats';
import type { TimelineMixer } from './mixer';

const abortError = () => new DOMException('Cancelado', 'AbortError');

function waitDequeue(enc: AudioEncoder): Promise<void> {
  return new Promise((res) => {
    const done = () => {
      enc.removeEventListener('dequeue', done);
      clearTimeout(t);
      res();
    };
    const t = setTimeout(done, 250);
    enc.addEventListener('dequeue', done);
  });
}

export interface CodecMeasure {
  /** sonoridad integrada tras codificar y decodificar (LUFS) */
  integrated: number;
  /** pico real tras el códec (dBTP) */
  truePeak: number;
}

/** Mezcla con `gainDb`, codifica con `cfg`, decodifica y mide. null si el equipo no puede decodificar lo que codifica. */
export async function measureViaCodec(make: (gainDb: number) => TimelineMixer, gainDb: number, cfg: AudioEncoderConfig, o: { signal?: AbortSignal; onProgress?: (r: number) => void } = {}): Promise<CodecMeasure | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined' || typeof AudioData === 'undefined') return null;
  const chunks: EncodedAudioChunk[] = [];
  let decCfg: AudioDecoderConfig | null = null;
  let encErr: Error | null = null;
  const enc = new AudioEncoder({
    output: (c, m) => {
      chunks.push(c);
      if (!decCfg && m?.decoderConfig) decCfg = m.decoderConfig;
    },
    error: (e) => (encErr ??= e),
  });
  enc.configure(cfg);
  const m = make(gainDb);
  try {
    while (!m.finished) {
      if (o.signal?.aborted) throw abortError();
      if (encErr) throw encErr;
      const b = await m.render(24000);
      if (!b.frames) break;
      const planar = new Float32Array(b.frames * 2);
      planar.set(b.L, 0);
      planar.set(b.R, b.frames);
      const data = new AudioData({ format: 'f32-planar', sampleRate: AUDIO_SAMPLE_RATE, numberOfFrames: b.frames, numberOfChannels: 2, timestamp: Math.round((b.startSample / AUDIO_SAMPLE_RATE) * 1e6), data: planar });
      enc.encode(data);
      data.close();
      while (enc.encodeQueueSize > 8) {
        if (encErr) throw encErr;
        await waitDequeue(enc);
      }
      o.onProgress?.(0.7 * Math.min(1, m.position / Math.max(1, m.totalSamples)));
    }
    await enc.flush();
    if (encErr) throw encErr;
  } finally {
    m.close();
    try {
      if (enc.state !== 'closed') enc.close();
    } catch {
      /* noop */
    }
  }
  if (!chunks.length) return null;
  const config: AudioDecoderConfig = decCfg ?? { codec: cfg.codec, sampleRate: cfg.sampleRate, numberOfChannels: cfg.numberOfChannels };
  try {
    if (!(await AudioDecoder.isConfigSupported(config)).supported) return null;
  } catch {
    return null;
  }
  const meter = new LoudnessMeter(AUDIO_SAMPLE_RATE);
  let decErr: Error | null = null;
  const dec = new AudioDecoder({
    output: (ad) => {
      try {
        const [l, r] = audioDataToStereo(ad);
        meter.process(l, r, l.length);
      } finally {
        ad.close();
      }
    },
    error: (e) => (decErr ??= e),
  });
  dec.configure(config);
  try {
    for (let i = 0; i < chunks.length; i++) {
      if (o.signal?.aborted) throw abortError();
      dec.decode(chunks[i]);
      if (dec.decodeQueueSize > 64) await new Promise<void>((res) => dec.addEventListener('dequeue', () => res(), { once: true }));
      if (decErr) return null;
      if ((i & 63) === 0) o.onProgress?.(0.7 + 0.3 * (i / chunks.length));
    }
    await dec.flush();
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') throw e;
    return null;
  } finally {
    try {
      if (dec.state !== 'closed') dec.close();
    } catch {
      /* noop */
    }
  }
  if (decErr) return null;
  const i = meter.integrated();
  return { integrated: Number.isFinite(i) ? i : meter.ungated(), truePeak: meter.truePeakDb() };
}

/** Corrección (dB) que deja el archivo codificado en el objetivo: `objetivo − medida`; 0 si es despreciable o no se pudo medir. Acotada a ±2 dB. */
export const codecCorrection = (target: number, m: CodecMeasure | null): number => {
  if (!m || !Number.isFinite(m.integrated)) return 0;
  const c = Math.max(-2, Math.min(2, target - m.integrated));
  return Math.abs(c) < 0.06 ? 0 : c;
};
