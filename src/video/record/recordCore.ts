// Grabación de pantalla, cámara y micrófono (parte pura, sin DOM): elección del formato, calidad, geometría de la
// burbuja de cámara, límites de duración/espacio y mensajes de error legibles. La parte con DOM está en `session.ts`.

export type RecordMode = 'screen' | 'camera' | 'screen-cam' | 'mic';

/** Burbuja de la cámara sobre la pantalla: diámetro (fracción del lado corto) y posición (0 = pegada a la izquierda/arriba, 1 = derecha/abajo). */
export interface BubbleCfg {
  size: number;
  px: number;
  py: number;
}
export const DEFAULT_BUBBLE: Readonly<BubbleCfg> = Object.freeze({ size: 0.24, px: 1, py: 1 });
export const BUBBLE_MIN = 0.1;
export const BUBBLE_MAX = 0.5;

export type RecordHeight = 720 | 1080;
export type RecordFps = 30 | 60;

// ---------------- formato ----------------

export const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=av1,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
] as const;
export const AUDIO_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'] as const;

/** El mejor `mimeType` que el navegador sabe grabar (el primero de la lista de preferencia), o null si no hay `MediaRecorder` o ninguno vale. */
export function pickMimeType(isSupported: ((m: string) => boolean) | null | undefined, kind: 'video' | 'audio'): string | null {
  if (!isSupported) return null;
  for (const m of kind === 'video' ? VIDEO_MIME_CANDIDATES : AUDIO_MIME_CANDIDATES) {
    try {
      if (isSupported(m)) return m;
    } catch {
      /* un navegador que lanza ante un tipo raro: se prueba el siguiente */
    }
  }
  return null;
}

export function extensionFor(mime: string): 'webm' | 'mp4' | 'ogg' | 'm4a' {
  const m = mime.toLowerCase();
  if (m.startsWith('audio/mp4')) return 'm4a';
  if (m.startsWith('video/mp4')) return 'mp4';
  if (m.includes('ogg')) return 'ogg';
  return 'webm';
}

/** Tipo base (sin `;codecs=`), el que lleva el Blob. */
export const baseMime = (mime: string): string => mime.split(';')[0].trim() || 'video/webm';

// ---------------- calidad ----------------

export interface QualityPreset {
  height: RecordHeight;
  fps: RecordFps;
  /** ideal para `getDisplayMedia` / `getUserMedia` (16:9) */
  width: number;
  /** bits por segundo de video del grabador */
  videoBps: number;
  audioBps: number;
}

export function qualityPreset(height: RecordHeight, fps: RecordFps): QualityPreset {
  const h = height === 1080 ? 1080 : 720;
  const f = fps === 60 ? 60 : 30;
  const base = h === 1080 ? 8_000_000 : 4_000_000;
  return { height: h, fps: f, width: Math.round((h * 16) / 9), videoBps: f === 60 ? Math.round(base * 1.5) : base, audioBps: 128_000 };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Tamaño del lienzo de la composición: el de la pantalla, reducido (nunca ampliado) para que su alto no pase de `height`. */
export function composeCanvasSize(srcW: number, srcH: number, height: RecordHeight): { w: number; h: number } {
  if (!(srcW > 0) || !(srcH > 0)) return { w: even((height * 16) / 9), h: even(height) };
  const k = Math.min(1, height / srcH);
  return { w: even(srcW * k), h: even(srcH * k) };
}

// ---------------- burbuja de cámara ----------------

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);

/** Centro y radio de la burbuja en un lienzo W×H. Siempre cabe entera dentro del lienzo, con un margen del 3 % del lado corto. */
export function bubbleLayout(W: number, H: number, cfg: BubbleCfg): { cx: number; cy: number; r: number; d: number } {
  const short = Math.min(W, H);
  const d = clamp(cfg.size, BUBBLE_MIN, BUBBLE_MAX) * short;
  const m = 0.03 * short;
  const px = clamp(cfg.px, 0, 1);
  const py = clamp(cfg.py, 0, 1);
  const r = d / 2;
  return { cx: m + r + px * Math.max(0, W - 2 * m - d), cy: m + r + py * Math.max(0, H - 2 * m - d), r, d };
}

/** Recorte cuadrado centrado de una cámara (cubre el círculo sin deformarla). */
export function coverCrop(sw: number, sh: number): { sx: number; sy: number; s: number } {
  const s = Math.min(sw, sh);
  return { sx: (sw - s) / 2, sy: (sh - s) / 2, s };
}

/** Lo mínimo del contexto 2D que usa la composición (así se prueba sin canvas). */
export interface Ctx2DLike {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  clip(): void;
  stroke(): void;
  drawImage(...args: any[]): void;
}
export interface FrameSrc {
  el: unknown;
  w: number;
  h: number;
}

/** Un fotograma de la grabación «pantalla + cámara»: la pantalla encajada sobre negro y la cámara en una burbuja redonda con borde blanco. */
export function drawBubbleComposite(ctx: Ctx2DLike, W: number, H: number, screen: FrameSrc | null, cam: FrameSrc | null, cfg: BubbleCfg): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (screen && screen.w > 0 && screen.h > 0) {
    const k = Math.min(W / screen.w, H / screen.h);
    const w = screen.w * k;
    const h = screen.h * k;
    ctx.drawImage(screen.el, (W - w) / 2, (H - h) / 2, w, h);
  }
  if (cam && cam.w > 0 && cam.h > 0) {
    const { cx, cy, r } = bubbleLayout(W, H, cfg);
    const c = coverCrop(cam.w, cam.h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(cam.el, c.sx, c.sy, c.s, c.s, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.lineWidth = Math.max(2, r * 0.05);
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ---------------- límites ----------------

export interface Limits {
  maxSeconds: number;
  maxBytes: number;
}
export type LimitCheck = { ok: true; limits: Limits } | { ok: false; reason: string };

export const MAX_RECORD_MINUTES = 60;
const MAX_BYTES_CAP = 2 * 1024 ** 3;
const RESERVE_BYTES = 300 * 1024 ** 2;
const MIN_FREE_BYTES = 80 * 1024 ** 2;

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`;
}

/** Límites de la grabación según el espacio libre que declara el navegador (`navigator.storage.estimate()`) y la tasa de bits. */
export function computeLimits(est: { quota?: number; usage?: number } | null | undefined, bitsPerSecond: number, maxMinutes = MAX_RECORD_MINUTES): LimitCheck {
  const bytesPerSec = Math.max(1, bitsPerSecond / 8);
  let maxBytes = MAX_BYTES_CAP;
  if (est && typeof est.quota === 'number' && est.quota > 0) {
    const free = est.quota - (est.usage ?? 0);
    if (free < MIN_FREE_BYTES) return { ok: false, reason: `No hay espacio suficiente para grabar: el navegador solo deja ${fmtBytes(Math.max(0, free))} libres. Libera espacio (borra medios que no uses o proyectos viejos) e inténtalo de nuevo.` };
    maxBytes = Math.min(MAX_BYTES_CAP, Math.max(MIN_FREE_BYTES, (free - RESERVE_BYTES) * 0.8, free * 0.5));
  }
  return { ok: true, limits: { maxBytes, maxSeconds: Math.min(maxMinutes * 60, Math.floor(maxBytes / bytesPerSec)) } };
}

export type LimitState = 'ok' | 'warn' | 'stop';
export function limitState(elapsedSec: number, bytes: number, l: Limits): LimitState {
  if (elapsedSec >= l.maxSeconds || bytes >= l.maxBytes) return 'stop';
  if (elapsedSec >= l.maxSeconds * 0.9 || bytes >= l.maxBytes * 0.9) return 'warn';
  return 'ok';
}

// ---------------- reloj y nivel ----------------

/** 0:07 · 12:05 · 1:02:03 */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** Nivel de un bloque de muestras: RMS → 0..1 con −60 dB = 0 y 0 dB = 1 (para la barra del micrófono). */
export function levelFromSamples(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / n);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return clamp((db + 60) / 60, 0, 1);
}

// ---------------- errores ----------------

export type ErrorSource = 'screen' | 'camera' | 'mic' | 'recorder';

export interface ReadableError {
  code: 'denied' | 'cancelled-or-denied' | 'no-device' | 'busy' | 'unsupported' | 'insecure' | 'quota' | 'unknown';
  message: string;
}

const SRC_NAME: Record<ErrorSource, string> = { screen: 'la pantalla', camera: 'la cámara', mic: 'el micrófono', recorder: 'la grabación' };

/** Traduce el error del navegador a un mensaje que explica qué pasó y qué hacer. */
export function recordErrorMessage(err: unknown, src: ErrorSource): ReadableError {
  const name = (err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '') || '';
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err ?? '');
  const what = SRC_NAME[src];
  if (src === 'screen' && name === 'NotAllowedError')
    return { code: 'cancelled-or-denied', message: 'No se compartió la pantalla: cancelaste el selector o el permiso fue denegado. Pulsa «Activar vista previa» otra vez y elige qué quieres compartir.' };
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
    return {
      code: 'denied',
      message: `El permiso para usar ${what} está denegado. Actívalo en el candado de la barra de direcciones (o en Configuración de Windows › Privacidad y seguridad › ${src === 'camera' ? 'Cámara' : 'Micrófono'}) y vuelve a intentarlo.`,
    };
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || name === 'NotFoundError')
    return { code: 'no-device', message: src === 'screen' ? 'No hay nada que compartir.' : `No se encontró ${src === 'camera' ? 'ninguna cámara' : 'ningún micrófono'} (o el elegido ya no está conectado). Conéctalo o elige otro en la lista.` };
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return { code: 'busy', message: `No se pudo abrir ${what}: otra aplicación la está usando o el dispositivo no responde. Ciérrala e inténtalo de nuevo.` };
  if (name === 'SecurityError')
    return { code: 'insecure', message: 'El navegador bloquea la captura en esta página (hace falta una conexión segura, https o localhost).' };
  if (name === 'QuotaExceededError' || /quota|space|espacio/i.test(msg))
    return { code: 'quota', message: 'No hay espacio suficiente para guardar la grabación. Libera espacio (borra medios que no uses) e inténtalo de nuevo.' };
  if (name === 'NotSupportedError' || name === 'TypeError')
    return { code: 'unsupported', message: src === 'recorder' ? 'Este navegador no puede grabar en este formato.' : `Este equipo no permite capturar ${what} desde ChamVa.` };
  return { code: 'unknown', message: `No se pudo usar ${what}${msg ? ': ' + msg : '.'}` };
}

// ---------------- nombres ----------------

export const MODE_LABEL: Record<RecordMode, string> = {
  screen: 'Grabación de pantalla',
  camera: 'Grabación de cámara',
  'screen-cam': 'Grabación de pantalla con cámara',
  mic: 'Grabación de voz',
};

/** «Grabación de pantalla 2.webm» (n = número de grabaciones del mismo modo en el proyecto + 1). */
export function recordingName(mode: RecordMode, n: number, mime: string, role: 'main' | 'camera' = 'main'): string {
  const base = role === 'camera' ? 'Cámara' : MODE_LABEL[mode];
  return `${base} ${n}.${extensionFor(mime)}`;
}
