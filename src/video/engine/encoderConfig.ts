// Negociación de códecs con el equipo (VideoEncoder/AudioEncoder.isConfigSupported)
// y degradación clara: si el tamaño o los fps pedidos no se pueden, se baja un
// escalón y se avisa en español en vez de fallar o salir sin audio en silencio.
import {
  AUDIO_BITRATE,
  AUDIO_SAMPLE_RATE,
  type Container,
  avcCodecCandidates,
  videoBitrate,
  vpCodecCandidates,
} from './formats';

export interface VideoChoice {
  config: VideoEncoderConfig;
  /** Códec para el multiplexor ('avc' en MP4; 'V_VP9'/'V_VP8' en WebM). */
  muxCodec: string;
  width: number;
  height: number;
  fps: number;
}

export interface AudioChoice {
  config: AudioEncoderConfig;
  muxCodec: string; // 'aac' | 'opus' (MP4) · 'A_OPUS' (WebM)
}

export function canUseWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
}

async function supported(cfg: VideoEncoderConfig): Promise<boolean> {
  try {
    return !!(await VideoEncoder.isConfigSupported(cfg)).supported;
  } catch {
    return false;
  }
}

/** Primera configuración de video admitida para ese tamaño y fps (o null). */
export async function findVideoConfig(container: Container, width: number, height: number, fps: number): Promise<VideoChoice | null> {
  if (!canUseWebCodecs()) return null;
  const bitrate = videoBitrate(width, height, fps, container);
  const codecs = container === 'mp4' ? avcCodecCandidates(width, height, fps, bitrate) : vpCodecCandidates(width, height, fps);
  for (const codec of codecs) {
    for (const hw of ['no-preference', 'prefer-software'] as const) {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        latencyMode: 'quality',
        hardwareAcceleration: hw,
        ...(container === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
      };
      if (await supported(config))
        return { config, muxCodec: container === 'mp4' ? 'avc' : codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9', width, height, fps };
    }
  }
  return null;
}

export interface Negotiated {
  video: VideoChoice;
  notices: string[];
}

/**
 * Busca la mejor configuración posible empezando por la pedida. `sizes` va de la
 * pedida a las de respaldo (p. ej. 4K → 1080p → 720p en la misma proporción).
 */
export async function negotiateVideo(
  container: Container,
  sizes: { width: number; height: number; label: string }[],
  fps: number,
): Promise<Negotiated | null> {
  const notices: string[] = [];
  const fpsList = fps > 30 ? [fps, 30] : [fps];
  for (const f of fpsList) {
    for (let i = 0; i < sizes.length; i++) {
      const s = sizes[i];
      const v = await findVideoConfig(container, s.width, s.height, f);
      if (!v) continue;
      if (i > 0 || f !== fps)
        notices.push(
          `Este equipo no puede codificar ${sizes[0].label} a ${fps} fps en ${container.toUpperCase()}; se exporta a ${s.label} y ${f} fps.`,
        );
      return { video: v, notices };
    }
  }
  return null;
}

/** Audio: AAC en MP4 (o Opus si el equipo no tiene AAC); Opus en WebM. */
export async function findAudioConfig(container: Container): Promise<{ audio: AudioChoice | null; notice?: string }> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined')
    return { audio: null, notice: 'Este equipo no puede codificar audio con WebCodecs: el video saldrá sin sonido.' };
  const base = { sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE };
  const tries: [string, string][] = container === 'mp4' ? [['mp4a.40.2', 'aac'], ['opus', 'opus']] : [['opus', 'A_OPUS']];
  for (const [codec, muxCodec] of tries) {
    const config: AudioEncoderConfig = { ...base, codec };
    try {
      if ((await AudioEncoder.isConfigSupported(config)).supported) {
        const notice =
          container === 'mp4' && muxCodec === 'opus'
            ? 'Este equipo no codifica AAC: el audio del MP4 va en Opus (algunos reproductores antiguos no lo leen; si pasa, exporta en WebM).'
            : undefined;
        return { audio: { config, muxCodec }, notice };
      }
    } catch {
      /* siguiente */
    }
  }
  return { audio: null, notice: 'Este equipo no puede codificar el audio: el video saldrá sin sonido.' };
}

export interface ExportSupport {
  webcodecs: boolean;
  mp4: boolean;
  webm: boolean;
  /** 4K a 30 fps admitido en MP4 / WebM. */
  mp4_4k: boolean;
  webm_4k: boolean;
}

/** Sondeo rápido para la interfaz (qué opciones habilitar). */
export async function probeExportSupport(): Promise<ExportSupport> {
  if (!canUseWebCodecs()) return { webcodecs: false, mp4: false, webm: false, mp4_4k: false, webm_4k: false };
  const [mp4, webm, mp4_4k, webm_4k] = await Promise.all([
    findVideoConfig('mp4', 1280, 720, 30),
    findVideoConfig('webm', 1280, 720, 30),
    findVideoConfig('mp4', 3840, 2160, 30),
    findVideoConfig('webm', 3840, 2160, 30),
  ]);
  return { webcodecs: true, mp4: !!mp4, webm: !!webm, mp4_4k: !!mp4_4k, webm_4k: !!webm_4k };
}
