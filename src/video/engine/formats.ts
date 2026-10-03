// Formatos de salida del video: proporción × calidad → tamaño en píxeles, nivel
// H.264 y tasa de bits. Lógica pura (sin WebCodecs) para poder probarla en Vitest.

export type Aspect = '16:9' | '9:16' | '1:1' | '4:5';
/** Lado corto del fotograma en píxeles (720p, 1080p, 4K). */
export type Quality = 720 | 1080 | 2160;
export type Container = 'mp4' | 'webm';

export const ASPECTS: { id: Aspect; label: string }[] = [
  { id: '16:9', label: '16:9 horizontal' },
  { id: '9:16', label: '9:16 vertical' },
  { id: '1:1', label: '1:1 cuadrado' },
  { id: '4:5', label: '4:5 retrato' },
];

export const QUALITIES: { id: Quality; label: string }[] = [
  { id: 720, label: '720p' },
  { id: 1080, label: '1080p' },
  { id: 2160, label: '4K' },
];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Tamaño de salida: el lado corto mide `q` px; ambos lados pares (H.264 4:2:0). */
export function outputSize(aspect: Aspect, q: Quality): { width: number; height: number } {
  switch (aspect) {
    case '16:9':
      return { width: even((q * 16) / 9), height: even(q) };
    case '9:16':
      return { width: even(q), height: even((q * 16) / 9) };
    case '1:1':
      return { width: even(q), height: even(q) };
    case '4:5':
      return { width: even(q), height: even((q * 5) / 4) };
  }
}

/** Calidad inmediatamente inferior (para degradar si el equipo no puede). */
export function lowerQuality(q: Quality): Quality | null {
  return q === 2160 ? 1080 : q === 1080 ? 720 : null;
}

// Tabla A-1 de H.264: [level_idc, máx. macrobloques/s, máx. macrobloques por fotograma, máx. kbit/s (Main)].
const AVC_LEVELS: [number, number, number, number][] = [
  [0x1e, 40500, 1620, 10000], // 3.0
  [0x1f, 108000, 3600, 14000], // 3.1
  [0x20, 216000, 5120, 20000], // 3.2
  [0x28, 245760, 8192, 20000], // 4.0
  [0x2a, 522240, 8704, 50000], // 4.2
  [0x32, 589824, 22080, 135000], // 5.0
  [0x33, 983040, 36864, 240000], // 5.1
  [0x34, 2073600, 36864, 240000], // 5.2
  [0x3c, 4177920, 139264, 240000], // 6.0
];

/** Nivel H.264 mínimo (level_idc) que admite ese tamaño, fps y tasa de bits; null si ninguno. */
export function avcLevel(width: number, height: number, fps: number, bitrate = 0): number | null {
  const mbW = Math.ceil(width / 16);
  const mbH = Math.ceil(height / 16);
  const fs = mbW * mbH;
  const mbps = fs * fps;
  for (const [idc, maxMbps, maxFs, maxKbps] of AVC_LEVELS) {
    // Además del área, cada lado debe caber en sqrt(8·MaxFS) macrobloques.
    const side = Math.sqrt(8 * maxFs);
    if (fs <= maxFs && mbps <= maxMbps && mbW <= side && mbH <= side && bitrate <= maxKbps * 1250)
      return idc;
  }
  return null;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Cadenas de códec H.264 a probar, de mejor a más compatible (High → Main → Baseline). */
export function avcCodecCandidates(width: number, height: number, fps: number, bitrate = 0): string[] {
  const lvl = avcLevel(width, height, fps, bitrate) ?? 0x34;
  const l = hex2(lvl);
  return [`avc1.6400${l}`, `avc1.4d00${l}`, `avc1.4200${l}`, `avc1.42e0${l}`];
}

/** Cadenas de códec para WebM: VP9 (nivel aproximado) y VP8 como último recurso. */
export function vpCodecCandidates(width: number, height: number, fps: number): string[] {
  const px = width * height;
  const lvl = px <= 1280 * 720 ? (fps > 30 ? 40 : 31) : px <= 2048 * 1152 ? (fps > 30 ? 41 : 40) : fps > 30 ? 51 : 50;
  return [`vp09.00.${lvl}.08`, 'vp09.00.10.08', 'vp8'];
}

/**
 * Tasa de bits de video. ~0,1 bit por píxel a 30 fps (1080p30 ≈ 6,2 Mb/s, como
 * recomiendan las plataformas); por encima de 30 fps cada fotograma cuesta menos.
 * (Antes: ~2 Mb/s a 1080p30, aunque el comentario decía 6.)
 */
export function videoBitrate(width: number, height: number, fps: number, container: Container = 'mp4'): number {
  const bpp = fps > 30 ? 0.075 : 0.1;
  const factor = container === 'webm' ? 0.8 : 1;
  return Math.round(Math.min(60_000_000, width * height * fps * bpp * factor));
}

export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_BITRATE = 160_000;
