// Lógica pura del ffmpeg nativo (V10): progreso, elección de ruta de
// importación, opciones por defecto y textos. Sin Tauri ni DOM: se prueba con Vitest.
import type { NativeStatus, ProbeInfo, ProgressInfo, ProxyHeight, ProxyOptions } from './types';

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

/**
 * Bloque de `-progress` (ya filtrado en Rust) → progreso. `out_time_us` manda;
 * «N/A», negativos y valores absurdos se ignoran. La fracción nunca baja de lo
 * que ya se mostró (`prev`) ni pasa de 1.
 */
export function parseProgress(
  ev: { outTimeUs: number | null; fields: Record<string, string>; end: boolean },
  duration: number,
  prev = 0,
): ProgressInfo {
  let outUs = ev.outTimeUs;
  if (outUs === null || !Number.isFinite(outUs) || outUs < 0) {
    const raw = num(ev.fields.out_time_us ?? ev.fields.out_time_ms);
    outUs = raw !== null && raw >= 0 ? raw : null;
  }
  const outSeconds = outUs === null ? null : outUs / 1e6;
  const speedRaw = ev.fields.speed?.replace(/x$/i, '');
  const speed = num(speedRaw);
  const frame = num(ev.fields.frame);
  let fraction: number | null = null;
  if (ev.end) fraction = 1;
  else if (outSeconds !== null && duration > 0 && Number.isFinite(duration)) fraction = Math.min(0.999, Math.max(prev, outSeconds / duration));
  return { fraction, outSeconds, speed: speed !== null && speed >= 0 ? speed : null, frame: frame !== null && frame >= 0 ? Math.round(frame) : null, end: ev.end };
}

/** Segundos que quedan, con lo que se lleva y el tiempo transcurrido (null si aún no se puede estimar). */
export function etaSeconds(fraction: number | null, elapsedS: number): number | null {
  if (fraction === null || fraction < 0.02 || elapsedS < 1) return null;
  if (fraction >= 1) return 0;
  return Math.max(0, (elapsedS / fraction) * (1 - fraction));
}

export type ImportRoute =
  /** el motor propio abre y decodifica TODO el archivo */
  | 'direct'
  /** el motor propio no, pero <video> sí: ruta lenta de siempre (sin FFmpeg) */
  | 'slow'
  /** hay FFmpeg nativo: ofrecer «Convertir para editar (proxy)» (y, si <video> lo
   * reproduce, también «importar sin convertir») */
  | 'proxy'
  /** escritorio sin FFmpeg utilizable y nada lo abre: explicar la causa y cómo obtenerlo */
  | 'missing-native'
  /** web/Android: no se puede */
  | 'unsupported';

/**
 * Sin FFmpeg nativo el comportamiento es el de siempre (directo, lento o error).
 * Con él, todo lo que el motor propio no abre entero (HEVC sin decodificador,
 * ProRes, MP4 fragmentado, audio AC-3/PCM raro…) pasa por el diálogo del proxy:
 * `<video>` a veces «abre» un archivo que luego no decodifica (ProRes da la
 * duración pero no la imagen) o lo reproduce sin sonido.
 */
export function chooseImportRoute(o: { demuxOk: boolean; decodable: boolean; htmlPlayable: boolean; desktop: boolean; nativeAvailable: boolean }): ImportRoute {
  if (o.demuxOk && o.decodable) return 'direct';
  if (o.desktop && o.nativeAvailable) return 'proxy';
  if (o.htmlPlayable) return 'slow';
  return o.desktop ? 'missing-native' : 'unsupported';
}

const HEIGHTS: ProxyHeight[] = ['360', '540', '720', '1080'];

/** Por defecto 720p (o menos si el original es más pequeño); HDR → SDR si el build sabe hacerlo. */
export function defaultProxyOptions(probe: ProbeInfo | null, status: Pick<NativeStatus, 'hasZscale'> | null): ProxyOptions {
  const v = probe?.video;
  // la altura que se verá tras rotar (un vertical 1080×1920 de móvil cuenta su lado corto)
  const shown = v ? (v.rotation === 90 || v.rotation === 270 ? v.width : v.height) : 720;
  const fit = HEIGHTS.filter((h) => Number(h) <= 720 && Number(h) <= Math.max(360, shown));
  return { height: fit[fit.length - 1] ?? '360', video: 'auto', tonemap: !!(v?.hdr && status?.hasZscale) };
}

export function isProxyHeight(s: string): s is ProxyHeight {
  return (HEIGHTS as string[]).includes(s);
}

const CODEC_NAMES: Record<string, string> = {
  hevc: 'HEVC (H.265)',
  h264: 'H.264',
  prores: 'Apple ProRes',
  dnxhd: 'Avid DNxHD/HR',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4 parte 2',
  cfhd: 'GoPro CineForm',
  ac3: 'Dolby Digital (AC-3)',
  eac3: 'Dolby Digital Plus (E-AC-3)',
  dts: 'DTS',
  aac: 'AAC',
  opus: 'Opus',
  mp3: 'MP3',
  flac: 'FLAC',
};
export const codecLabel = (c: string) => CODEC_NAMES[c] ?? (c.startsWith('pcm_') ? `PCM (${c.slice(4)})` : c.toUpperCase());

/** Lo que el usuario debe saber del original y de lo que hará la conversión. */
export function describeProbe(p: ProbeInfo, opts?: ProxyOptions): string[] {
  const out: string[] = [];
  const v = p.video;
  if (v) {
    out.push(`Video ${codecLabel(v.codec)}${v.profile ? ` ${v.profile}` : ''} · ${v.width}×${v.height}${v.bitDepth > 8 ? ` · ${v.bitDepth} bits` : ''} · ${v.fps ? v.fps.toFixed(2).replace(/\.00$/, '') : '?'} fps`);
    if (v.hdr) out.push(opts?.tonemap === false ? `HDR (${v.hdr.toUpperCase()}): se dejará sin convertir a SDR (los colores pueden verse lavados).` : `HDR (${v.hdr.toUpperCase()}): el proxy se convierte a SDR (BT.709).`);
    if (v.rotation) out.push(`Girado ${v.rotation}° (móvil): el proxy sale ya derecho.`);
    if (v.variableFps) out.push('Fotogramas por segundo variables: el proxy usa una cadencia constante (sin saltos al editar).');
  } else out.push('Sin pista de video.');
  if (p.audio) out.push(`Audio ${codecLabel(p.audio.codec)} · ${p.audio.channels} canal${p.audio.channels === 1 ? '' : 'es'}${p.audio.channels > 2 ? ' → estéreo en el proxy' : ''}${p.audioStreams > 1 ? ` (se usa la 1.ª de ${p.audioStreams} pistas)` : ''}`);
  else out.push('Sin audio.');
  return out;
}

/** Aviso de calidad: lo que se exporta sale del proxy. */
export function qualityNotice(height: ProxyHeight, sourceHeight?: number): string {
  const h = Number(height);
  const lower = sourceHeight && sourceHeight > h;
  return lower
    ? `La exportación usará el proxy (${h}p): saldrá con menos resolución que el original (${sourceHeight}p). Si vas a exportar en alta calidad, elige 1080p.`
    : `La exportación usará el proxy (${h}p).`;
}

export const isCacheKey = (s: string) => /^[0-9a-f]{64}$/.test(s);

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')} ${u[i]}`;
}

export function formatEta(s: number | null): string {
  if (s === null) return 'calculando…';
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Nombre del medio convertido: «clip.mov» → «clip (proxy 720p).mp4». */
export function proxyFileName(original: string, height: ProxyHeight, mime: string): string {
  const base = original.replace(/\.[^./\\]+$/, '') || 'video';
  const ext = mime === 'video/webm' ? 'webm' : 'mp4';
  return `${base} (proxy ${height}p).${ext}`;
}

/** Texto para el caso «escritorio sin FFmpeg». */
export function missingNativeMessage(fileName: string, s: Pick<NativeStatus, 'reason'> | null): string {
  const why = s?.reason ? ` (${s.reason})` : '';
  return `No se pudo leer «${fileName}»: este códec o contenedor (HEVC, ProRes, MKV raro…) necesita FFmpeg, que no está disponible${why}.`;
}
