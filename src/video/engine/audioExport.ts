// Exportar solo el audio del proyecto (V7): la misma mezcla que la exportación de video (mezclador con pistas,
// ducking, ecualizadores, normalización a LUFS en dos pasadas y limitador de pico real), sin imagen.
//   WAV 16/24 bits  → escritura directa (sin pérdida)
//   OGG/Opus        → AudioEncoder (WebCodecs) + contenedor Ogg propio (ogg.ts)
//   M4A/AAC         → AudioEncoder (WebCodecs) + mp4-muxer
// MP3 no se ofrece: los codificadores de MP3 en JavaScript (p. ej. lamejs, LGPL) no tienen licencia permisiva.
// Si el equipo no codifica Opus/AAC se degrada a otro formato con aviso (resolveAudioFormat).
import { Muxer as Mp4Muxer, StreamTarget as Mp4StreamTarget } from 'mp4-muxer';
import { LoudnessMeter } from '../audio/loudness';
import { clipEnd } from '../model/query';
import type { Clip, VideoProject } from '../model/types';
import { BufferAudioSource, DecoderAudioSource, audioDecoderConfig } from './audioSource';
import { planProjectMix, resolveTrackPlan } from './audioPlan';
import { TRUE_PEAK_LOSSY_CEILING_DB } from './dsp';
import { type DemuxedFile, demux } from './demux';
import { AUDIO_SAMPLE_RATE } from './formats';
import { codecCorrection, measureViaCodec } from './codecProbe';
import { solveLoudnessGain, type LoudnessSolve } from './loudnessPass';
import { TimelineMixer, type PcmSource } from './mixer';
import { OggOpusWriter, OPUS_PRESKIP } from './ogg';
import type { ByteSink } from './sink';
import { WAV_MAX_DATA, WavWriter } from './wav';

export type AudioFormat = 'wav16' | 'wav24' | 'opus' | 'aac';

export interface AudioFormatInfo {
  id: AudioFormat;
  label: string;
  ext: string;
  mime: string;
  lossy: boolean;
}

export const AUDIO_FORMATS: AudioFormatInfo[] = [
  { id: 'wav16', label: 'WAV 16 bits', ext: 'wav', mime: 'audio/wav', lossy: false },
  { id: 'wav24', label: 'WAV 24 bits', ext: 'wav', mime: 'audio/wav', lossy: false },
  { id: 'opus', label: 'OGG / Opus', ext: 'ogg', mime: 'audio/ogg', lossy: true },
  { id: 'aac', label: 'M4A / AAC', ext: 'm4a', mime: 'audio/mp4', lossy: true },
];

export const audioFormatInfo = (id: AudioFormat): AudioFormatInfo => AUDIO_FORMATS.find((f) => f.id === id)!;

const OPUS_CFG = (bitrate: number): AudioEncoderConfig => ({ codec: 'opus', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate });
const AAC_CFG = (bitrate: number): AudioEncoderConfig => ({ codec: 'mp4a.40.2', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate });
export const AUDIO_BITRATE_DEFAULT = 160_000;

async function supports(cfg: AudioEncoderConfig): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try {
    return !!(await AudioEncoder.isConfigSupported(cfg)).supported;
  } catch {
    return false;
  }
}

/** Qué formatos puede producir este equipo (WAV siempre). */
export async function probeAudioFormats(): Promise<Record<AudioFormat, boolean>> {
  const [opus, aac] = await Promise.all([supports(OPUS_CFG(AUDIO_BITRATE_DEFAULT)), supports(AAC_CFG(AUDIO_BITRATE_DEFAULT))]);
  return { wav16: true, wav24: true, opus, aac };
}

/** El formato pedido o, si no se puede, el siguiente mejor con un aviso en español. */
export async function resolveAudioFormat(want: AudioFormat): Promise<{ format: AudioFormat; notice?: string }> {
  const ok = await probeAudioFormats();
  if (ok[want]) return { format: want };
  const name = audioFormatInfo(want).label;
  if (want === 'aac' && ok.opus) return { format: 'opus', notice: `Este equipo no codifica AAC: el audio se guarda en ${audioFormatInfo('opus').label}.` };
  return { format: 'wav16', notice: `Este equipo no puede codificar ${name} (falta WebCodecs de audio): se guarda en WAV 16 bits, sin pérdida.` };
}

export interface AudioRenderOptions {
  format: AudioFormat;
  sink: ByteSink;
  signal?: AbortSignal;
  onProgress?: (ratio: number, stage: string) => void;
  onNotice?: (msg: string) => void;
  /** bits por segundo de Opus / AAC */
  bitrate?: number;
  /** Anula la ganancia de sonoridad (para pruebas): no mide ni normaliza aunque el proyecto lo pida */
  skipLoudness?: boolean;
}

export interface AudioRenderResult {
  blob: Blob | null;
  format: AudioFormat;
  duration: number;
  bytes: number;
  notices: string[];
  elapsedMs: number;
  stats: { integrated: number; truePeak: number; samplePeak: number; gainDb: number; /** compensación del códec con pérdida (dB), ya incluida en gainDb */ codecDb: number; measuredBefore: number | null; passes: number };
  trackStats: Record<string, { peak: number; minDuckDb: number }>;
}

const abortError = () => new DOMException('Exportación cancelada', 'AbortError');

/** Espera a que el codificador saque algo de su cola (evento `dequeue`); con un respaldo por si no llega. No depende de temporizadores rápidos (una pestaña oculta los frena a 1 s). */
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

/** Medio utilizable (tiene archivo o URL). */
const usable = (m: VideoProject['media'][string] | undefined) => !!m && !m.missing && (!!m.blob || !!m.url);

/** Clips que pueden sonar: audio de las pistas activas (con silencio y solo aplicados). */
export function audibleClips(p: VideoProject): Clip[] {
  const plan = resolveTrackPlan(p);
  const out: Clip[] = [];
  for (const t of p.tracks) {
    if (!plan.get(t.id)?.active) continue;
    for (const c of t.clips) if ((t.kind === 'video' && c.kind === 'video') || (t.kind === 'audio' && c.kind === 'audio')) out.push(c);
  }
  return out;
}

/** Duración del audio a exportar: hasta donde llega el último clip que suena. */
export function audioDuration(p: VideoProject): number {
  let d = 0;
  for (const c of audibleClips(p)) {
    if (!c.mediaId || !usable(p.media[c.mediaId])) continue;
    const e = clipEnd(c);
    if (Number.isFinite(e)) d = Math.max(d, e);
  }
  return d;
}

interface Probe {
  blob: Blob;
  file: DemuxedFile | null;
}

/** Abre las fuentes de audio de los clips de un proyecto (desmultiplexa cada archivo una vez). */
export async function probeProjectAudio(p: VideoProject, signal?: AbortSignal) {
  const probes = new Map<string, Probe>();
  const byKey = new Map<Blob | string, Promise<Probe>>();
  for (const c of audibleClips(p)) {
    const m = c.mediaId ? p.media[c.mediaId] : undefined;
    if (!m || !usable(m) || probes.has(m.id)) continue;
    const key = m.blob ?? m.url!;
    if (!byKey.has(key))
      byKey.set(
        key,
        (async () => {
          const blob = m.blob ?? (await (await fetch(m.url!)).blob());
          try {
            return { blob, file: await demux(blob) };
          } catch {
            return { blob, file: null };
          }
        })(),
      );
    probes.set(m.id, await byKey.get(key)!);
    if (signal?.aborted) throw abortError();
  }
  const playable = (c: Clip) => !!c.mediaId && probes.has(c.mediaId);
  const openPcm = (clip: Clip, startAt?: number) => async (): Promise<PcmSource | null> => {
    const pr = probes.get(clip.mediaId!)!;
    if (pr.file) {
      if (!pr.file.audio) return null;
      const cfg = await audioDecoderConfig(pr.file.audio);
      if (cfg) return new DecoderAudioSource(pr.file.audio, pr.blob, cfg, startAt ?? clip.inP);
    }
    try {
      const ctx = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
      return new BufferAudioSource(await ctx.decodeAudioData(await pr.blob.arrayBuffer()));
    } catch {
      return null;
    }
  };
  return { probes, playable, openPcm };
}

/** Plan de mezcla y mezclador de un proyecto para un audio de `duration` s. */
export function mixerFactory(p: VideoProject, duration: number, openPcm: (c: Clip, startAt?: number) => () => Promise<PcmSource | null>, playable: (c: Clip) => boolean, ceilingDb?: number) {
  const plan = planProjectMix(p, duration, openPcm, playable);
  if (ceilingDb !== undefined) plan.master.ceilingDb = ceilingDb;
  const make = (gainDb: number) => new TimelineMixer(plan.entries, { ...plan.master, gainDb }, duration, AUDIO_SAMPLE_RATE, plan.tracks);
  return { plan, make };
}

/** Mide la sonoridad integrada del proyecto tal como saldría (sin exportar): para el medidor «Analizar» de la interfaz. */
export async function analyzeProjectLoudness(p: VideoProject, o: { signal?: AbortSignal; onProgress?: (r: number) => void; gainDb?: number } = {}): Promise<{ integrated: number; truePeak: number; ungated: number; duration: number } | null> {
  const duration = audioDuration(p);
  if (!(duration > 0)) return null;
  const { openPcm, playable } = await probeProjectAudio(p, o.signal);
  const { make } = mixerFactory(p, duration, openPcm, playable);
  const meter = new LoudnessMeter(AUDIO_SAMPLE_RATE);
  const m = make(o.gainDb ?? 0);
  try {
    while (!m.finished) {
      if (o.signal?.aborted) throw abortError();
      const b = await m.render(AUDIO_SAMPLE_RATE);
      if (!b.frames) break;
      meter.process(b.L, b.R, b.frames);
      o.onProgress?.(m.position / Math.max(1, m.totalSamples));
    }
  } finally {
    m.close();
  }
  return { integrated: meter.integrated(), truePeak: meter.truePeakDb(), ungated: meter.ungated(), duration };
}

export async function renderAudioOnly(p: VideoProject, opts: AudioRenderOptions): Promise<AudioRenderResult> {
  const t0 = performance.now();
  const { sink, signal } = opts;
  const info = audioFormatInfo(opts.format);
  const notices: string[] = [];
  const notice = (m: string) => {
    notices.push(m);
    opts.onNotice?.(m);
  };
  const duration = audioDuration(p);
  if (!(duration > 0)) throw new Error('No hay audio que exportar: añade clips de video o de audio con sonido.');
  opts.onProgress?.(0, 'preparando');
  const { openPcm, playable } = await probeProjectAudio(p, signal);
  const lossy = opts.format === 'opus' || opts.format === 'aac';
  const { plan, make } = mixerFactory(p, duration, openPcm, playable, lossy ? TRUE_PEAK_LOSSY_CEILING_DB : undefined);
  if (!plan.entries.length) throw new Error('No hay audio que exportar (todas las pistas están en silencio o sin archivos).');
  if (signal?.aborted) throw abortError();
  if (Object.values(p.tracks).some((t) => t.solo)) notice('Hay una pista en solo: la exportación solo incluye las pistas en solo.');

  // normalización de sonoridad (dos pasadas): mismo mezclador que la salida
  let solve: LoudnessSolve | null = null;
  const loud = p.audio?.loud;
  if (loud?.on && !opts.skipLoudness) {
    solve = await solveLoudnessGain(make, loud.target, { signal, ceilingDb: plan.master.ceilingDb ?? -1.3, onProgress: (r) => opts.onProgress?.(r * 0.3, 'midiendo sonoridad') });
    if (solve.silent) notice('El audio no tiene sonoridad medible: no se aplica la normalización a LUFS.');
  }
  let gainDb = solve && !solve.silent ? solve.gainDb : 0;
  const bitrate = opts.bitrate ?? AUDIO_BITRATE_DEFAULT;
  // Códec con pérdida: se codifica y decodifica la mezcla con ese mismo códec, se mide y se compensa lo que cambie el nivel
  let codecDb = 0;
  if (solve && !solve.silent && loud && (opts.format === 'opus' || opts.format === 'aac') && (await supports(opts.format === 'opus' ? OPUS_CFG(bitrate) : AAC_CFG(bitrate)))) {
    opts.onProgress?.(0.3, 'midiendo el códec');
    const mc = await measureViaCodec(make, gainDb, opts.format === 'opus' ? OPUS_CFG(bitrate) : AAC_CFG(bitrate), { signal, onProgress: (r) => opts.onProgress?.(0.3 + r * 0.1, 'midiendo el códec') });
    codecDb = codecCorrection(loud.target, mc);
    gainDb += codecDb;
  }
  const mixer = make(gainDb);
  const total = mixer.totalSamples;
  const meter = new LoudnessMeter(AUDIO_SAMPLE_RATE);
  const base = solve ? 0.4 : 0;
  const BLOCK = 24000; // 0,5 s

  let pos = 0; // posición de escritura en el destino
  const put = (bytes: Uint8Array) => {
    sink.write(bytes, pos);
    pos += bytes.byteLength;
  };
  let wav: WavWriter | null = null;
  let encoder: AudioEncoder | null = null;
  let encodeError: Error | null = null;
  let ogg: OggOpusWriter | null = null;
  let mp4: Mp4Muxer<Mp4StreamTarget> | null = null;
  const fail = (e: unknown) => (encodeError ??= e instanceof Error ? e : new Error(String(e)));
  try {
    if (opts.format === 'wav16' || opts.format === 'wav24') {
      const bits = opts.format === 'wav16' ? 16 : 24;
      if (total * 2 * (bits / 8) > WAV_MAX_DATA) throw new Error('El audio es demasiado largo para un WAV (más de 4 GB): usa Opus o AAC.');
      wav = new WavWriter(sink, total, bits, AUDIO_SAMPLE_RATE);
    } else if (opts.format === 'opus') {
      if (!(await supports(OPUS_CFG(bitrate)))) throw new Error('Este equipo no puede codificar Opus.');
      ogg = new OggOpusWriter(put, 2, AUDIO_SAMPLE_RATE, OPUS_PRESKIP);
      encoder = new AudioEncoder({
        output: (c) => {
          const data = new Uint8Array(c.byteLength);
          c.copyTo(data);
          ogg!.addPacket(data, c.duration ? Math.round((c.duration * AUDIO_SAMPLE_RATE) / 1e6) : 960);
        },
        error: fail,
      });
      encoder.configure(OPUS_CFG(bitrate));
    } else {
      if (!(await supports(AAC_CFG(bitrate)))) throw new Error('Este equipo no puede codificar AAC.');
      mp4 = new Mp4Muxer({
        target: new Mp4StreamTarget({ onData: (d, position) => sink.write(d, position) }),
        audio: { codec: 'aac', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2 },
        fastStart: false,
        firstTimestampBehavior: 'offset',
      });
      encoder = new AudioEncoder({ output: (c, m) => mp4!.addAudioChunk(c, m), error: fail });
      encoder.configure(AAC_CFG(bitrate));
    }

    while (!mixer.finished) {
      if (signal?.aborted) throw abortError();
      if (encodeError) throw encodeError;
      const blk = await mixer.render(BLOCK);
      if (!blk.frames) break;
      meter.process(blk.L, blk.R, blk.frames);
      if (wav) wav.write(blk.L, blk.R, blk.frames);
      else if (encoder) {
        const planar = new Float32Array(blk.frames * 2);
        planar.set(blk.L, 0);
        planar.set(blk.R, blk.frames);
        const data = new AudioData({ format: 'f32-planar', sampleRate: AUDIO_SAMPLE_RATE, numberOfFrames: blk.frames, numberOfChannels: 2, timestamp: Math.round((blk.startSample / AUDIO_SAMPLE_RATE) * 1e6), data: planar });
        encoder.encode(data);
        data.close();
        while (encoder.encodeQueueSize > 8) {
          if (encodeError) throw encodeError;
          await waitDequeue(encoder);
        }
      }
      if (sink.pending > 32 << 20) await sink.drain();
      opts.onProgress?.(base + (1 - base) * Math.min(0.98, mixer.position / Math.max(1, total)), 'codificando');
    }
    if (encoder) await encoder.flush();
    if (encodeError) throw encodeError;
    ogg?.finish(total);
    mp4?.finalize();
    const stats = { integrated: meter.integrated(), truePeak: meter.truePeakDb(), samplePeak: meter.samplePeakDb(), gainDb, codecDb, measuredBefore: solve?.measured ?? null, passes: solve?.passes ?? 0 };
    const trackStats = mixer.trackStats();
    mixer.close();
    try {
      if (encoder && encoder.state !== 'closed') encoder.close();
    } catch {
      /* noop */
    }
    const bytes = sink.bytesWritten;
    const blob = await sink.close();
    opts.onProgress?.(1, 'listo');
    return { blob, format: opts.format, duration: total / AUDIO_SAMPLE_RATE, bytes, notices, elapsedMs: performance.now() - t0, stats, trackStats };
  } catch (e) {
    mixer.close();
    try {
      if (encoder && encoder.state !== 'closed') encoder.close();
    } catch {
      /* noop */
    }
    await sink.abort();
    void info;
    throw e;
  }
}

/** Ganancia de sonoridad del proyecto entero (lo que hace la exportación antes de codificar), para que la vista previa use la misma. */
export async function solveProjectLoudness(p: VideoProject, o: { signal?: AbortSignal; onProgress?: (r: number) => void } = {}): Promise<LoudnessSolve | null> {
  const loud = p.audio?.loud;
  if (!loud?.on) return null;
  const duration = audioDuration(p);
  if (!(duration > 0)) return null;
  const { openPcm, playable } = await probeProjectAudio(p, o.signal);
  const { plan, make } = mixerFactory(p, duration, openPcm, playable);
  if (!plan.entries.length) return null;
  return solveLoudnessGain(make, loud.target, { signal: o.signal, ceilingDb: plan.master.ceilingDb ?? -1.3, onProgress: o.onProgress });
}

/**
 * Sonoridad integrada de UN clip tal como suena su cadena (filtros, reducción de ruido y ecualizador del clip), sin su
 * volumen, ganancia ni panorámica y sin la cadena de pista ni maestra. Sirve para «Normalizar clip a LUFS».
 */
export async function measureClipLoudness(p: VideoProject, clipId: string, o: { signal?: AbortSignal; onProgress?: (r: number) => void } = {}): Promise<{ integrated: number; truePeak: number } | null> {
  for (const t of p.tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (!c || (c.kind !== 'video' && c.kind !== 'audio') || !c.mediaId) continue;
    const bare: Clip = { ...c, start: 0, volume: 1, audioFadeIn: 0, audioFadeOut: 0 };
    delete bare.gainDb;
    delete bare.pan;
    delete bare.keys;
    const dur = clipEnd(bare);
    if (!(dur > 0)) return null;
    const track = { ...t, muted: false, solo: undefined, clips: [bare] } as typeof t;
    delete track.gainDb;
    delete track.pan;
    delete track.eq;
    delete track.duck;
    const sub: VideoProject = { v: p.v, media: p.media, tracks: [track], eq: { low: 0, mid: 0, high: 0 }, normalize: false };
    const { openPcm, playable } = await probeProjectAudio(sub, o.signal);
    const plan = planProjectMix(sub, dur, openPcm, playable);
    if (!plan.entries.length) return null;
    const m = new TimelineMixer(plan.entries, { ...plan.master, ceilingDb: 40 }, dur, AUDIO_SAMPLE_RATE, plan.tracks);
    const meter = new LoudnessMeter(AUDIO_SAMPLE_RATE);
    try {
      while (!m.finished) {
        if (o.signal?.aborted) throw abortError();
        const b = await m.render(AUDIO_SAMPLE_RATE);
        if (!b.frames) break;
        meter.process(b.L, b.R, b.frames);
        o.onProgress?.(m.position / Math.max(1, m.totalSamples));
      }
    } finally {
      m.close();
    }
    const i = meter.integrated();
    return { integrated: Number.isFinite(i) ? i : meter.ungated(), truePeak: meter.truePeakDb() };
  }
  return null;
}
