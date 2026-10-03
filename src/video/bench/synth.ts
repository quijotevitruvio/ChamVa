// Clips sintéticos para el banco de pruebas, generados con WebCodecs (nunca descargados):
// - fondo de color que cambia cada segundo + barras fijas a la derecha;
// - número de fotograma en binario (12 casillas blancas/negras abajo);
// - cuadrado verde arriba a la izquierda (para comprobar la rotación);
// - tono de 440 Hz continuo y «bip» de 1 kHz con destello blanco en los instantes dados.
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';

export const PALETTE: [number, number, number][] = [
  [224, 32, 32],
  [32, 64, 224],
  [224, 192, 32],
  [192, 32, 192],
  [32, 192, 192],
  [224, 112, 32],
];
export const CODE_BITS = 12;
export const SAMPLE_PT = { x: 0.35, y: 0.4 };

export interface SynthOptions {
  container: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number;
  seconds: number;
  audio?: boolean;
  /** Fotogramas variables: duraciones alternas 1/24 y 1/40 s. */
  vfr?: boolean;
  rotation?: 0 | 90 | 180 | 270;
  toneAmp?: number;
  beepsAt?: number[];
  /** Amplitud del tono durante los primeros `quietUntil` s (para la compuerta). */
  quietAmp?: number;
  quietUntil?: number;
  /** Desplaza el color: el segundo s usa PALETTE[(s + colorOffset) % n]. */
  colorOffset?: number;
}

export interface SynthClip {
  blob: Blob;
  url: string;
  /** Instante de presentación de cada fotograma (s). */
  frameTimes: number[];
  opts: SynthOptions;
  encodeMs: number;
}

export function colorAt(t: number, offset = 0): [number, number, number] {
  return PALETTE[(Math.floor(t + 1e-6) + offset) % PALETTE.length];
}

export function drawSynthFrame(ctx: CanvasRenderingContext2D, w: number, h: number, index: number, t: number, flash: boolean, colorOffset = 0) {
  if (flash) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const [r, g, b] = colorAt(t, colorOffset);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, w, h);
  const bars = ['#ffffff', '#000000', '#808080', '#00ff00'];
  bars.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(w * (0.7 + i * 0.075), 0, w * 0.075 + 1, h);
  });
  ctx.fillStyle = '#00c000';
  ctx.fillRect(0, 0, w * 0.12, h * 0.12);
  for (let bit = 0; bit < CODE_BITS; bit++) {
    ctx.fillStyle = (index >> bit) & 1 ? '#fff' : '#000';
    ctx.fillRect(w * (0.02 + bit * 0.055), h * 0.8, w * 0.05, h * 0.14);
  }
}

export async function makeSynthClip(o: SynthOptions): Promise<SynthClip> {
  const t0 = performance.now();
  const { width: w, height: h, fps } = o;
  const frameTimes: number[] = [];
  for (let t = 0, i = 0; t < o.seconds - 1e-9; i++) {
    frameTimes.push(t);
    t += o.vfr ? (i % 2 ? 1 / 24 : 1 / 40) : 1 / fps;
  }
  const beeps = o.beepsAt ?? [];
  const isFlash = (i: number) => {
    const t = frameTimes[i];
    const next = frameTimes[i + 1] ?? t + 1 / fps;
    return beeps.some((b) => b >= t - 1e-9 && b < next - 1e-9);
  };
  const withAudio = o.audio !== false;
  let addV: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void;
  let addA: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void;
  let fin: () => ArrayBuffer;
  if (o.container === 'mp4') {
    const target = new Mp4Target();
    const mux = new Mp4Muxer({
      target,
      video: { codec: 'avc', width: w, height: h, rotation: o.rotation ?? 0 },
      audio: withAudio ? { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 } : undefined,
      fastStart: 'in-memory',
    });
    addV = (c, m) => mux.addVideoChunk(c, m);
    addA = (c, m) => mux.addAudioChunk(c, m);
    fin = () => (mux.finalize(), target.buffer);
  } else {
    const target = new WebmTarget();
    const mux = new WebmMuxer({
      target,
      video: { codec: 'V_VP8', width: w, height: h },
      audio: withAudio ? { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 2 } : undefined,
    });
    addV = (c, m) => mux.addVideoChunk(c, m);
    addA = (c, m) => mux.addAudioChunk(c, m);
    fin = () => (mux.finalize(), target.buffer);
  }
  let err: unknown = null;
  const ve = new VideoEncoder({ output: (c, m) => addV(c, m), error: (e) => (err = e) });
  const lvl = w * h > 1920 * 1088 ? '33' : w * h > 1280 * 720 ? '2a' : '1f';
  ve.configure(
    o.container === 'mp4'
      ? { codec: `avc1.4200${lvl}`, width: w, height: h, bitrate: w * h * 3, framerate: fps, avc: { format: 'avc' } }
      : { codec: 'vp8', width: w, height: h, bitrate: w * h * 3, framerate: fps },
  );
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < frameTimes.length; i++) {
    if (err) throw err;
    drawSynthFrame(ctx, w, h, i, frameTimes[i], isFlash(i), o.colorOffset ?? 0);
    const next = frameTimes[i + 1] ?? o.seconds;
    const f = new VideoFrame(canvas, { timestamp: Math.round(frameTimes[i] * 1e6), duration: Math.round((next - frameTimes[i]) * 1e6) });
    ve.encode(f, { keyFrame: i % 60 === 0 });
    f.close();
    while (ve.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
  }
  await ve.flush();
  ve.close();
  if (withAudio) {
    const ae = new AudioEncoder({ output: (c, m) => addA(c, m), error: (e) => (err = e) });
    ae.configure({ codec: o.container === 'mp4' ? 'mp4a.40.2' : 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
    const total = Math.round(o.seconds * 48000);
    const amp = o.toneAmp ?? 0.3;
    for (let off = 0; off < total; off += 4800) {
      const n = Math.min(4800, total - off);
      const planar = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) {
        const t = (off + k) / 48000;
        const a = o.quietUntil && t < o.quietUntil ? (o.quietAmp ?? 0.01) : amp;
        let v = a * Math.sin(2 * Math.PI * 440 * t);
        if (beeps.some((b) => t >= b && t < b + 0.1)) v += 0.6 * Math.sin(2 * Math.PI * 1000 * t);
        planar[k] = v;
        planar[n + k] = v;
      }
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfChannels: 2, numberOfFrames: n, timestamp: Math.round((off / 48000) * 1e6), data: planar });
      ae.encode(ad);
      ad.close();
    }
    await ae.flush();
    ae.close();
  }
  if (err) throw err;
  const blob = new Blob([fin()], { type: o.container === 'mp4' ? 'video/mp4' : 'video/webm' });
  return { blob, url: URL.createObjectURL(blob), frameTimes, opts: o, encodeMs: performance.now() - t0 };
}
