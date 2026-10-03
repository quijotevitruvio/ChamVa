// Análisis del archivo exportado. Dos caminos independientes para no validar el
// motor solo consigo mismo:
//  1) <video> del navegador + decodeAudioData (duración, tamaño, color, audio);
//  2) el desmultiplexor + VideoDecoder del motor (fotograma exacto en t, código binario).
import { demux } from '../engine/demux';
import { DecoderFrameSource, videoDecoderConfig } from '../engine/videoSource';
import { CODE_BITS, SAMPLE_PT } from './synth';

export interface Pixel {
  r: number;
  g: number;
  b: number;
}

export function lum(p: Pixel) {
  return 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
}

export function colorClose(p: Pixel, c: [number, number, number], tol = 48) {
  return Math.abs(p.r - c[0]) < tol && Math.abs(p.g - c[1]) < tol && Math.abs(p.b - c[2]) < tol;
}

export interface FrameProbe {
  t: number;
  sample: Pixel;
  meanLum: number;
  code: number;
  topLeft: Pixel;
  topRight: Pixel;
  /** Alto (px) de la caja de píxeles casi blancos en la franja superior (texto). */
  textHeight: number;
}

function probeCanvas(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): FrameProbe {
  const img = ctx.getImageData(0, 0, w, h).data;
  const at = (x: number, y: number): Pixel => {
    const i = (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4;
    return { r: img[i], g: img[i + 1], b: img[i + 2] };
  };
  let sum = 0;
  let cnt = 0;
  for (let y = 0; y < h; y += 8)
    for (let x = 0; x < w; x += 8) {
      sum += lum(at(x, y));
      cnt++;
    }
  let code = 0;
  for (let bit = 0; bit < CODE_BITS; bit++) {
    const p = at(w * (0.02 + bit * 0.055 + 0.025), h * 0.87);
    if (lum(p) > 128) code |= 1 << bit;
  }
  // texto blanco en la franja 0,05–0,3 del alto, zona central 0,15–0,6 del ancho
  let top = -1;
  let bottom = -1;
  for (let y = Math.round(h * 0.03); y < Math.round(h * 0.32); y++) {
    for (let x = Math.round(w * 0.15); x < Math.round(w * 0.6); x += 2) {
      const p = at(x, y);
      if (p.r > 235 && p.g > 235 && p.b > 235) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  return {
    t,
    sample: at(w * SAMPLE_PT.x, h * SAMPLE_PT.y),
    meanLum: sum / cnt,
    code,
    topLeft: at(w * 0.04, h * 0.04),
    topRight: at(w * 0.96, h * 0.04),
    textHeight: top >= 0 ? bottom - top + 1 : 0,
  };
}

/** Fotogramas en los instantes dados, con el decodificador del motor (exacto). */
export async function probeFramesDecoder(blob: Blob, times: number[]): Promise<{ width: number; height: number; frames: FrameProbe[]; count: number; duration: number; hasAudio: boolean; videoCodec: string; audioCodec?: string }> {
  const d = await demux(blob);
  if (!d.video) throw new Error('sin pista de video');
  const cfg = await videoDecoderConfig(d.video);
  if (!cfg) throw new Error('no decodificable: ' + d.video.codec);
  const src = new DecoderFrameSource(d.video, blob, cfg, Math.min(...times));
  const w = d.video.codedWidth;
  const h = d.video.codedHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames: FrameProbe[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    const f = await src.frameAt(t);
    ctx.clearRect(0, 0, w, h);
    if (f) ctx.drawImage(f.image, 0, 0, w, h);
    frames.push(probeCanvas(ctx, w, h, t));
  }
  src.close();
  return { width: w, height: h, frames, count: d.video.samples.count, duration: d.duration, hasAudio: !!d.audio, videoCodec: d.video.codec, audioCodec: d.audio?.codec };
}

/** Camino independiente: el <video> del navegador. */
export async function probeWithElement(blob: Blob, times: number[]): Promise<{ duration: number; width: number; height: number; frames: FrameProbe[] }> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error('el navegador no pudo abrir el archivo exportado'));
  });
  let duration = v.duration;
  if (!isFinite(duration)) {
    // WebM sin duración en cabecera: forzar el cálculo
    v.currentTime = 1e7;
    await new Promise((r) => (v.onseeked = r));
    duration = v.duration;
  }
  const w = v.videoWidth;
  const h = v.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames: FrameProbe[] = [];
  for (const t of times) {
    v.currentTime = t;
    await new Promise<void>((r) => {
      const done = () => {
        v.removeEventListener('seeked', done);
        r();
      };
      v.addEventListener('seeked', done);
    });
    await new Promise<void>((r) => {
      const vv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void };
      const timer = setTimeout(r, 400);
      vv.requestVideoFrameCallback?.(() => (clearTimeout(timer), r()));
    });
    ctx.drawImage(v, 0, 0, w, h);
    frames.push(probeCanvas(ctx, w, h, t));
  }
  v.removeAttribute('src');
  v.load();
  URL.revokeObjectURL(url);
  return { duration, width: w, height: h, frames };
}

export interface AudioProbe {
  duration: number;
  peak: number;
  /** Instantes (s) donde empieza cada «bip» (salto de envolvente). */
  onsets: number[];
  rms: (from: number, to: number) => number;
}

export async function probeAudio(blob: Blob): Promise<AudioProbe | null> {
  try {
    const ac = new OfflineAudioContext(2, 1, 48000);
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    let peak = 0;
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    // envolvente en ventanas de 1 ms
    const win = Math.round(buf.sampleRate / 1000);
    const env: number[] = [];
    for (let i = 0; i < L.length; i += win) {
      let m = 0;
      for (let k = i; k < Math.min(L.length, i + win); k++) m = Math.max(m, Math.abs(L[k]));
      env.push(m);
    }
    const onsets: number[] = [];
    for (let i = 5; i < env.length; i++) {
      const before = Math.max(...env.slice(Math.max(0, i - 30), i - 5));
      if (env[i] > 0.6 && before < 0.5 && (!onsets.length || i / 1000 - onsets[onsets.length - 1] > 0.3)) onsets.push(i / 1000);
    }
    return {
      duration: buf.duration,
      peak,
      onsets,
      rms: (from, to) => {
        const a = Math.floor(from * buf.sampleRate);
        const b = Math.min(L.length, Math.floor(to * buf.sampleRate));
        let s = 0;
        for (let i = a; i < b; i++) s += L[i] * L[i];
        return Math.sqrt(s / Math.max(1, b - a));
      },
    };
  } catch {
    return null;
  }
}
