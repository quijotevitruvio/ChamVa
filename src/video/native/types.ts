// Tipos del puente con el ffmpeg nativo (V10, solo escritorio). Reflejan las
// estructuras de src-tauri/src/native_media/*.rs (serde camelCase).

export type HwEncoder = 'h264_mf' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'h264_videotoolbox';
export type ProxyEncoder = 'h264_mf' | 'h264_video_toolbox' | 'libvpx';

export interface NativeStatus {
  available: boolean;
  reason: string | null;
  origin: 'bundled' | 'user' | 'dev' | null;
  version: string | null;
  license: string | null;
  listedHwEncoders: HwEncoder[];
  hasLibvpx: boolean;
  hasZscale: boolean;
  userDir: string | null;
  pinnedSourceUrl: string | null;
  pinnedSha256: string | null;
  pinnedVersion: string;
  releaseUrl: string;
  ffmpegSourceUrl: string;
  buildScriptsUrl: string;
  userInstallSupported: boolean;
  /** Release propio con el zip exacto y la fuente correspondiente (vacío si no hay build incluido) */
  sourceReleaseUrl: string;
  /** false si esta versión de ChamVa no incluye un FFmpeg utilizable en esta plataforma (solo lo trae Windows x64) */
  included: boolean;
  /** «verificar y omitir / reparar» de la copia propia de FFmpeg */
  install: InstallReport | null;
  /** texto de la licencia que acompaña al binario en uso */
  licenseText: string | null;
}

export interface InstallReport {
  action: 'skipped' | 'installed' | 'repaired' | 'unavailable' | 'failed';
  detail: string | null;
}

/** Archivo registrado en Rust (elegido en el diálogo nativo o soltado). La interfaz nunca ve la ruta. */
export interface SourceRef {
  token: string | null;
  name: string;
  size: number;
  error: string | null;
}

export interface VideoInfo {
  codec: string;
  profile: string | null;
  pixFmt: string | null;
  width: number;
  height: number;
  fps: number;
  variableFps: boolean;
  rotation: 0 | 90 | 180 | 270;
  bitDepth: number;
  colorTransfer: string | null;
  hdr: 'pq' | 'hlg' | null;
}

export interface AudioInfo {
  codec: string;
  channels: number;
  sampleRate: number;
}

export interface ProbeInfo {
  container: string;
  duration: number;
  size: number;
  video: VideoInfo | null;
  audio: AudioInfo | null;
  audioStreams: number;
}

export type ProxyHeight = '360' | '540' | '720' | '1080';

export interface ProxyOptions {
  height: ProxyHeight;
  video: 'auto' | 'h264' | 'vp8';
  tonemap: boolean;
}

export type JobEvent =
  | { event: 'started'; jobId: number; duration: number }
  | { event: 'progress'; jobId: number; outTimeUs: number | null; fields: Record<string, string>; end: boolean };

export interface OutputRef {
  key: string;
  mime: string;
  bytes: number;
  cached: boolean;
  encoder: ProxyEncoder | null;
  probe: ProbeInfo | null;
}

export interface FrameOptions {
  start: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
}

export interface HwExportOptions {
  encoder: HwEncoder;
  width: number;
  height: number;
  fps: number;
  kbps: number;
}

export interface ProgressInfo {
  /** 0..1, o null si FFmpeg aún no sabe cuánto lleva */
  fraction: number | null;
  /** segundos de salida ya escritos */
  outSeconds: number | null;
  /** «2.5x» → 2.5 */
  speed: number | null;
  frame: number | null;
  end: boolean;
}
