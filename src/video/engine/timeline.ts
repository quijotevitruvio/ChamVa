// Modelo puro «línea de tiempo → qué se ve en el instante t». Lo comparten la
// exportación (MP4/WebM) y la ruta antigua de grabación, para que lo que sale
// por una ruta y por la otra sea idéntico (tamaño de texto, fundidos, encaje).

export interface TimelineClip {
  inP: number; // s del archivo donde empieza
  outP: number; // s del archivo donde termina
  speed: number;
  fadeIn: number;
  fadeOut: number;
}

export interface Segment<C extends TimelineClip = TimelineClip> {
  clip: C;
  index: number;
  start: number; // s de la línea de tiempo
  end: number;
  dur: number;
}

/** Clips en secuencia desde 0 (sin huecos), con la duración real según recorte y velocidad. */
export function buildSegments<C extends TimelineClip>(clips: C[]): Segment<C>[] {
  const out: Segment<C>[] = [];
  clips.forEach((clip, index) => {
    const start = out.length ? out[out.length - 1].end : 0;
    const dur = Math.max(0.01, (clip.outP - clip.inP) / (clip.speed || 1));
    out.push({ clip, index, start, end: start + dur, dur });
  });
  return out;
}

export function totalDuration(segs: Segment[]): number {
  return segs.length ? segs[segs.length - 1].end : 0;
}

/** Índice del tramo visible en t (el último si t cae al final). */
export function segmentIndexAt(segs: Segment[], t: number): number {
  for (let i = 0; i < segs.length; i++) if (t >= segs[i].start && t < segs[i].end) return i;
  return segs.length - 1;
}

/** Instante del archivo de origen que corresponde al instante t de la línea de tiempo. */
export function sourceTimeAt(seg: Segment, t: number): number {
  const c = seg.clip;
  const s = c.inP + (t - seg.start) * (c.speed || 1);
  return Math.max(c.inP, Math.min(c.outP - 0.001, s));
}

/** Opacidad del fundido de entrada/salida (a negro) en t. */
export function fadeAlpha(seg: Segment, t: number): number {
  const local = t - seg.start;
  let a = 1;
  if (seg.clip.fadeIn > 0 && local < seg.clip.fadeIn) a = local / seg.clip.fadeIn;
  if (seg.clip.fadeOut > 0 && seg.dur - local < seg.clip.fadeOut)
    a = Math.min(a, (seg.dur - local) / seg.clip.fadeOut);
  return Math.max(0, Math.min(1, a));
}

/** Número de fotogramas de una duración (tolerante al error de coma flotante: 5,9 s × 30 = 177). */
export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

// ---------- Capas (texto / imagen) ----------

export interface RenderOverlay {
  kind: 'text' | 'image';
  text: string;
  color: string;
  /** texto: px con referencia a 720 px de lado corto · imagen: fracción del ancho */
  size: number;
  img?: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number } | null;
  xf: number;
  yf: number;
  start: number;
  end: number;
}

/**
 * Tamaño de la letra en el fotograma de salida. Antes la ruta WebM usaba `size`
 * tal cual y la MP4 lo escalaba por alto/720: a 1080p el texto salía de distinto
 * tamaño según el formato. Ahora ambas usan esto. Referencia: el lado corto, para
 * que en 9:16 el texto no se salga por los lados (en 16:9 equivale a alto/720).
 */
export function overlayFontPx(size: number, width: number, height: number): number {
  return size * (Math.min(width, height) / 720);
}

export const OVERLAY_FONT = 'Arial, Helvetica, sans-serif';

export function overlayVisible(o: { start: number; end: number }, t: number): boolean {
  return !(t < o.start || t > o.end);
}

export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  overlays: RenderOverlay[],
  t: number,
) {
  for (const o of overlays) {
    if (!overlayVisible(o, t)) continue;
    const cx = o.xf * w;
    const cy = o.yf * h;
    if (o.kind === 'text') {
      ctx.fillStyle = o.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${overlayFontPx(o.size, w, h)}px ${OVERLAY_FONT}`;
      ctx.fillText(o.text, cx, cy);
    } else if (o.img && o.img.naturalWidth && o.img.naturalHeight) {
      const iw = o.size * w;
      const ih = iw * (o.img.naturalHeight / o.img.naturalWidth);
      ctx.drawImage(o.img, cx - iw / 2, cy - ih / 2, iw, ih);
    }
  }
}

// ---------- Encaje del video en el fotograma ----------

export type Fit = 'contain' | 'cover';

/**
 * Rectángulo (centrado) donde se dibuja una imagen de srcW×srcH dentro de dstW×dstH.
 * `rotation` (0/90/180/270, la del metadato del MP4 de un móvil) intercambia los lados.
 */
export function fitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: Fit = 'contain',
  rotation = 0,
): { x: number; y: number; w: number; h: number } {
  const turned = rotation % 180 !== 0;
  const vw = turned ? srcH : srcW;
  const vh = turned ? srcW : srcH;
  const s = fit === 'cover' ? Math.max(dstW / vw, dstH / vh) : Math.min(dstW / vw, dstH / vh);
  const w = vw * s;
  const h = vh * s;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** Dibuja un fotograma con encaje, rotación y opacidad sobre negro. */
export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: Fit,
  rotation: number,
  alpha: number,
) {
  if (!srcW || !srcH || alpha <= 0) return;
  const r = fitRect(srcW, srcH, dstW, dstH, fit, rotation);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (rotation % 360 === 0) {
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  } else {
    ctx.translate(dstW / 2, dstH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const turned = rotation % 180 !== 0;
    const dw = turned ? r.h : r.w;
    const dh = turned ? r.w : r.h;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  }
  ctx.restore();
}
