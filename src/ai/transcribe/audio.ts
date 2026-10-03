// Audio del proyecto de video para Whisper: mono a 16 kHz, de todo el proyecto, de una pista o de un rango.
// Reutiliza el mezclador en streaming de V2/V3 (src/video/engine): mismas fuentes, mismos recortes, velocidad y
// volumen por clip que la exportación, pero sin la cadena maestra (ecualizador/normalización) que no ayuda al
// reconocimiento. El audio NUNCA sale del equipo: solo se le pasa al worker local.
import { buildProjectMixEntries } from '../../video/engine/compose';
import { BufferAudioSource, DecoderAudioSource, audioDecoderConfig } from '../../video/engine/audioSource';
import { demux, type DemuxedFile } from '../../video/engine/demux';
import { AUDIO_SAMPLE_RATE } from '../../video/engine/formats';
import { TimelineMixer, type MixEntry, type PcmSource } from '../../video/engine/mixer';
import { projectDuration } from '../../video/model/query';
import type { Clip, VideoProject } from '../../video/model/types';
import { ASR_RATE } from './windows';

/** Filtro paso bajo FIR (sinc con ventana de Blackman) para diezmar sin aliasing. */
export function lowpassKernel(cutoff: number, taps = 63): Float32Array {
  const k = new Float32Array(taps);
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - m;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    k[i] = sinc * w;
    sum += k[i];
  }
  for (let i = 0; i < taps; i++) k[i] /= sum;
  return k;
}

/**
 * Remuestreador por bloques (estéreo → mono, `inRate` → `outRate`, factor entero): conserva el estado entre
 * bloques para que el resultado sea idéntico a procesarlo todo de una vez.
 */
export class MonoDecimator {
  private readonly factor: number;
  private readonly kernel: Float32Array;
  private hist: Float32Array;
  private phase = 0;
  constructor(inRate = AUDIO_SAMPLE_RATE, outRate = ASR_RATE) {
    const f = inRate / outRate;
    if (!Number.isInteger(f) || f < 1) throw new Error('factor de diezmado no entero');
    this.factor = f;
    this.kernel = f === 1 ? new Float32Array([1]) : lowpassKernel(0.45 / f);
    this.hist = new Float32Array(this.kernel.length - 1);
  }
  /** Devuelve las muestras de salida de este bloque. */
  push(L: Float32Array, R: Float32Array | null, n = L.length): Float32Array {
    const K = this.kernel;
    const H = this.hist.length;
    const buf = new Float32Array(H + n);
    buf.set(this.hist);
    for (let i = 0; i < n; i++) buf[H + i] = R ? (L[i] + R[i]) * 0.5 : L[i];
    const out: number[] = [];
    let i = this.phase;
    for (; i < n; i += this.factor) {
      // salida centrada en la muestra i del bloque (retardo de grupo fijo = H/2, compensado al final)
      let acc = 0;
      for (let k = 0; k < K.length; k++) acc += K[k] * buf[i + k];
      out.push(acc);
    }
    this.phase = i - n;
    this.hist = buf.slice(buf.length - H);
    return Float32Array.from(out);
  }
  /** Retardo (muestras de salida) que introduce el filtro. */
  get delay(): number {
    return Math.round((this.kernel.length - 1) / 2 / this.factor);
  }
}

/** Todo de una vez (pruebas y audios cortos). */
export function toMono16k(L: Float32Array, R: Float32Array | null, inRate: number): Float32Array {
  const d = new MonoDecimator(inRate, ASR_RATE);
  const pad = new Float32Array((d.delay + 1) * (inRate / ASR_RATE));
  const a = d.push(L, R);
  const b = d.push(pad, null);
  const all = new Float32Array(a.length + b.length);
  all.set(a);
  all.set(b, a.length);
  const want = Math.floor((L.length * ASR_RATE) / inRate);
  return all.slice(d.delay, d.delay + want);
}

export interface AudioRange {
  start: number;
  end: number;
}

/**
 * Desplaza las entradas del mezclador para mezclar solo [range.start, range.end): las que caen fuera se quitan,
 * las que empiezan antes se recortan (su punto de entrada avanza según la velocidad). Puro.
 */
export function shiftEntries(entries: MixEntry[], range: AudioRange): MixEntry[] {
  const out: MixEntry[] = [];
  for (const e of entries) {
    if (e.end <= range.start || e.start >= range.end) continue;
    const cut = Math.max(0, range.start - e.start);
    const n: MixEntry = { ...e, start: e.start + cut - range.start, end: Math.min(e.end, range.end) - range.start, inP: e.inP + cut * e.speed };
    if (cut > 0) delete n.fadeIn;
    out.push(n);
  }
  return out;
}

export interface ExtractOptions {
  /** solo esta pista (aunque esté silenciada); por defecto, la mezcla de todo lo audible */
  trackId?: string;
  /** solo este rango de la línea de tiempo (s) */
  range?: AudioRange;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export interface ExtractedAudio {
  pcm: Float32Array;
  /** s de la línea de tiempo donde empieza `pcm` (para devolver los tiempos al proyecto) */
  offset: number;
  duration: number;
}

/** Proyecto reducido a lo que hay que escuchar. */
function projectFor(p: VideoProject, trackId?: string): VideoProject {
  if (!trackId) return p;
  return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, muted: false } : { ...t, muted: true })) };
}

/** Mezcla el audio del proyecto (o de una pista / rango) a mono 16 kHz. */
export async function extractProjectAudio(project: VideoProject, o: ExtractOptions = {}): Promise<ExtractedAudio> {
  const p = projectFor(project, o.trackId);
  const total = projectDuration(p);
  if (!(total > 0) || !Number.isFinite(total)) throw new Error('El proyecto no tiene clips con duración conocida.');
  const range = { start: Math.max(0, o.range?.start ?? 0), end: Math.min(total, o.range?.end ?? total) };
  if (!(range.end > range.start)) throw new Error('El rango elegido está vacío.');
  const probes = new Map<string, Promise<{ blob: Blob; file: DemuxedFile | null }>>();
  const probe = (mediaId: string) => {
    let pr = probes.get(mediaId);
    if (!pr) {
      const m = p.media[mediaId];
      pr = (async () => {
        const blob = m.blob ?? (await (await fetch(m.url!)).blob());
        try {
          return { blob, file: await demux(blob) };
        } catch {
          return { blob, file: null };
        }
      })();
      probes.set(mediaId, pr);
    }
    return pr;
  };
  const open = (clip: Clip) => async (): Promise<PcmSource | null> => {
    const pr = await probe(clip.mediaId!);
    const hint = clip.inP + Math.max(0, range.start - clip.start) * (clip.speed || 1);
    if (pr.file) {
      if (!pr.file.audio) return null;
      const cfg = await audioDecoderConfig(pr.file.audio);
      if (cfg) return new DecoderAudioSource(pr.file.audio, pr.blob, cfg, hint);
    }
    try {
      const ctx = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
      return new BufferAudioSource(await ctx.decodeAudioData(await pr.blob.arrayBuffer()));
    } catch {
      return null;
    }
  };
  const usable = (c: Clip) => !!c.mediaId && !!p.media[c.mediaId] && !p.media[c.mediaId].missing && !!(p.media[c.mediaId].blob || p.media[c.mediaId].url);
  const entries = shiftEntries(buildProjectMixEntries(p, total, open, usable), range);
  const dur = range.end - range.start;
  if (!entries.length) return { pcm: new Float32Array(Math.round(dur * ASR_RATE)), offset: range.start, duration: dur };
  const mixer = new TimelineMixer(entries, { eq: { low: 0, mid: 0, high: 0 }, normalize: false }, dur, AUDIO_SAMPLE_RATE);
  const dec = new MonoDecimator(AUDIO_SAMPLE_RATE, ASR_RATE);
  const outLen = Math.round(dur * ASR_RATE);
  const pcm = new Float32Array(outLen + dec.delay + 16);
  let w = 0;
  const BLOCK = AUDIO_SAMPLE_RATE; // 1 s
  try {
    while (!mixer.finished) {
      if (o.signal?.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
      const { L, R, frames } = await mixer.render(BLOCK);
      if (!frames) break;
      const y = dec.push(L, R, frames);
      pcm.set(y.subarray(0, Math.max(0, pcm.length - w)), w);
      w += y.length;
      o.onProgress?.(Math.min(1, mixer.position / mixer.totalSamples));
    }
    const tail = dec.push(new Float32Array((dec.delay + 1) * (AUDIO_SAMPLE_RATE / ASR_RATE)), null);
    pcm.set(tail.subarray(0, Math.max(0, pcm.length - w)), w);
  } finally {
    mixer.close();
  }
  return { pcm: pcm.slice(dec.delay, dec.delay + outLen), offset: range.start, duration: dur };
}

/** Decodifica un archivo de audio suelto (WAV/MP3/…) a mono 16 kHz (pruebas y «transcribir archivo»). */
export async function decodeFileTo16k(blob: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, ASR_RATE);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  if (buf.sampleRate === ASR_RATE) return R ? Float32Array.from(L, (v, i) => (v + R[i]) / 2) : L.slice();
  if (buf.sampleRate % ASR_RATE === 0) return toMono16k(L, R, buf.sampleRate);
  // frecuencia no múltiplo (44,1 kHz): remuestrear con OfflineAudioContext
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * ASR_RATE), ASR_RATE);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}
