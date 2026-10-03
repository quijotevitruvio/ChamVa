// COPIA de src/io/videoRender.ts en 6180a97 (motor anterior), solo para medir «antes» en el banco de pruebas.
// No se usa en la app.
// Render de video fotograma a fotograma con WebCodecs → MP4 (H.264 + AAC).
//
// Antes la exportación GRABABA la reproducción en tiempo real (captureStream):
// un video de 3 min tardaba 3 min y perdía fotogramas si la máquina se
// distraía. Aquí cada fotograma se busca (seek) y se codifica de forma
// determinista, y el audio se mezcla offline con OfflineAudioContext.
// Si el navegador no tiene WebCodecs, el llamador usa la ruta antigua.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

export interface RenderClip {
  url: string;
  inP: number;
  outP: number;
  speed: number;
  fadeIn: number;
  fadeOut: number;
  volume: number;
  hp: number; // filtro paso-alto (Hz)
  lp: number; // filtro paso-bajo (Hz)
  echo: number; // 0..1
}

export interface RenderOverlay {
  kind: 'text' | 'image';
  text: string;
  color: string;
  size: number; // texto: px (ref. 720 px de alto) · imagen: fracción del ancho
  img?: HTMLImageElement | null;
  xf: number;
  yf: number;
  start: number;
  end: number;
}

export interface RenderOptions {
  width: number;
  height: number;
  fps: number;
  videoClips: RenderClip[];
  audioClips: RenderClip[];
  overlays: RenderOverlay[];
  eq: { low: number; mid: number; high: number };
  normalize: boolean;
  onProgress?: (ratio: number, stage: string) => void;
}

export function canRenderMp4(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined'
  );
}

const SAMPLE_RATE = 48000;

async function pickVideoCodec(
  width: number,
  height: number,
  fps: number,
): Promise<VideoEncoderConfig> {
  const bitrate = Math.round((width * height * fps) / 30 * 0.12) * 8; // ~6 Mb/s a 1080p30
  const candidates = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f', 'avc1.42E01E'];
  for (const codec of candidates) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return config;
    } catch {
      /* siguiente */
    }
  }
  throw new Error('El navegador no puede codificar H.264 (WebCodecs)');
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.0005) return resolve();
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

function loadVideo(v: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (v.src === url && v.readyState >= 2) return resolve();
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error('No se pudo cargar el video'));
    };
    const cleanup = () => {
      v.removeEventListener('loadeddata', ok);
      v.removeEventListener('error', bad);
    };
    v.addEventListener('loadeddata', ok);
    v.addEventListener('error', bad);
    v.src = url;
    v.load();
  });
}

interface Segment {
  clip: RenderClip;
  start: number;
  end: number;
  dur: number;
}

function segmentsOf(clips: RenderClip[]): Segment[] {
  const out: Segment[] = [];
  for (const c of clips) {
    const start = out.length ? out[out.length - 1].end : 0;
    const dur = Math.max(0.01, (c.outP - c.inP) / (c.speed || 1));
    out.push({ clip: c, start, end: start + dur, dur });
  }
  return out;
}

function drawOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  overlays: RenderOverlay[],
  t: number,
) {
  for (const o of overlays) {
    if (t < o.start || t > o.end) continue;
    const cx = o.xf * w;
    const cy = o.yf * h;
    if (o.kind === 'text') {
      ctx.fillStyle = o.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${o.size * (h / 720)}px Arial`;
      ctx.fillText(o.text, cx, cy);
    } else if (o.img && o.img.naturalWidth) {
      const iw = o.size * w;
      const ih = iw * (o.img.naturalHeight / o.img.naturalWidth);
      ctx.drawImage(o.img, cx - iw / 2, cy - ih / 2, iw, ih);
    }
  }
}

// ---------- Audio offline ----------

async function decode(ac: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    return await ac.decodeAudioData(buf);
  } catch {
    return null; // video sin pista de audio, o formato no decodificable
  }
}

function chain(ac: BaseAudioContext, clip: RenderClip, mix: AudioNode): AudioNode {
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = clip.hp;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = clip.lp;
  const vol = ac.createGain();
  vol.gain.value = clip.volume;
  hp.connect(lp);
  lp.connect(vol);
  vol.connect(mix);
  if (clip.echo > 0) {
    const echo = ac.createGain();
    echo.gain.value = clip.echo;
    const delay = ac.createDelay(1);
    delay.delayTime.value = 0.28;
    const fb = ac.createGain();
    fb.gain.value = 0.35;
    vol.connect(echo);
    echo.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(mix);
  }
  return hp;
}

async function renderAudio(opts: RenderOptions, duration: number): Promise<AudioBuffer> {
  const ac = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const mix = ac.createGain();
  const eqLow = ac.createBiquadFilter();
  eqLow.type = 'peaking';
  eqLow.frequency.value = 120;
  eqLow.Q.value = 1;
  eqLow.gain.value = opts.eq.low;
  const eqMid = ac.createBiquadFilter();
  eqMid.type = 'peaking';
  eqMid.frequency.value = 1000;
  eqMid.Q.value = 1;
  eqMid.gain.value = opts.eq.mid;
  const eqHigh = ac.createBiquadFilter();
  eqHigh.type = 'peaking';
  eqHigh.frequency.value = 6000;
  eqHigh.Q.value = 1;
  eqHigh.gain.value = opts.eq.high;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = opts.normalize ? -24 : 0;
  comp.ratio.value = opts.normalize ? 4 : 1;
  comp.knee.value = opts.normalize ? 30 : 0;
  mix.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(comp);
  comp.connect(ac.destination);

  // Pista de video: cada clip en su tramo de la línea de tiempo.
  for (const seg of segmentsOf(opts.videoClips)) {
    const buffer = await decode(ac, seg.clip.url);
    if (!buffer) continue;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = seg.clip.speed || 1;
    src.connect(chain(ac, seg.clip, mix));
    src.start(seg.start, seg.clip.inP, Math.max(0.01, seg.clip.outP - seg.clip.inP));
  }
  // Pista de audio (música/voz): en secuencia desde 0.
  let at = 0;
  for (const c of opts.audioClips) {
    if (at >= duration) break;
    const buffer = await decode(ac, c.url);
    if (!buffer) continue;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = c.speed || 1;
    src.connect(chain(ac, c, mix));
    src.start(at, c.inP, Math.max(0.01, c.outP - c.inP));
    at += (c.outP - c.inP) / (c.speed || 1);
  }
  return ac.startRendering();
}

// ---------- Render principal ----------

export async function renderMp4(opts: RenderOptions): Promise<Blob> {
  const { width, height, fps, onProgress } = opts;
  const w = width - (width % 2);
  const h = height - (height % 2);
  const segs = segmentsOf(opts.videoClips);
  const duration = segs.length ? segs[segs.length - 1].end : 0;
  if (duration <= 0) throw new Error('No hay clips de video');

  const videoConfig = await pickVideoCodec(w, h, fps);
  let audioConfig: AudioEncoderConfig | null = {
    codec: 'mp4a.40.2',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 2,
    bitrate: 128_000,
  };
  try {
    if (
      typeof AudioEncoder === 'undefined' ||
      !(await AudioEncoder.isConfigSupported(audioConfig)).supported
    )
      audioConfig = null;
  } catch {
    audioConfig = null;
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: w, height: h },
    audio: audioConfig
      ? { codec: 'aac', sampleRate: SAMPLE_RATE, numberOfChannels: 2 }
      : undefined,
    fastStart: 'in-memory',
  });

  let encodeError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  videoEncoder.configure(videoConfig);

  // --- fotogramas ---
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;

  const totalFrames = Math.ceil(duration * fps);
  const keyEvery = fps * 2;
  for (let i = 0; i < totalFrames; i++) {
    if (encodeError) throw encodeError;
    const t = i / fps;
    const seg = segs.find((s) => t >= s.start && t < s.end) ?? segs[segs.length - 1];
    const clip = seg.clip;
    const local = t - seg.start;
    const srcTime = Math.min(clip.outP - 0.001, clip.inP + local * (clip.speed || 1));
    await loadVideo(v, clip.url);
    await seekTo(v, srcTime);

    let alpha = 1;
    if (clip.fadeIn > 0 && local < clip.fadeIn) alpha = local / clip.fadeIn;
    if (clip.fadeOut > 0 && seg.dur - local < clip.fadeOut)
      alpha = Math.min(alpha, (seg.dur - local) / clip.fadeOut);
    alpha = Math.max(0, Math.min(1, alpha));

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (v.videoWidth) {
      const s = Math.min(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * s;
      const dh = v.videoHeight * s;
      ctx.globalAlpha = alpha;
      ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    }
    drawOverlays(ctx, w, h, opts.overlays, t);

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(t * 1_000_000),
      duration: Math.round(1_000_000 / fps),
    });
    videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    // Contrapresión: no dejar que la cola del codificador crezca sin límite.
    while (videoEncoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (i % 5 === 0) onProgress?.(0.05 + (i / totalFrames) * 0.75, 'video');
  }
  await videoEncoder.flush();
  videoEncoder.close();
  v.removeAttribute('src');
  v.load();

  // --- audio ---
  if (audioConfig) {
    onProgress?.(0.82, 'audio');
    const buffer = await renderAudio(opts, duration);
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => (encodeError = e),
    });
    audioEncoder.configure(audioConfig);
    const frames = buffer.length;
    const step = SAMPLE_RATE; // 1 s por bloque
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
    for (let off = 0; off < frames; off += step) {
      const n = Math.min(step, frames - off);
      const planar = new Float32Array(n * 2);
      planar.set(ch0.subarray(off, off + n), 0);
      planar.set(ch1.subarray(off, off + n), n);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((off / SAMPLE_RATE) * 1_000_000),
        data: planar,
      });
      audioEncoder.encode(data);
      data.close();
      while (audioEncoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    }
    await audioEncoder.flush();
    audioEncoder.close();
  }
  if (encodeError) throw encodeError;

  muxer.finalize();
  onProgress?.(1, 'done');
  return new Blob([target.buffer], { type: 'video/mp4' });
}
