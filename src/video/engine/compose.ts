// Composición del modelo v2: qué se dibuja (por capas) y qué suena (varias pistas)
// en cada instante. Con transformación neutra se usan EXACTAMENTE las mismas
// llamadas de dibujo que V1 (drawVideoFrame / texto / imagen), para que un
// proyecto migrado salga idéntico píxel a píxel.
import { clipAudioFx } from '../model/effects';
import { clipEnd, clipFadeAlpha, clipsAt, isIdentityTransform, videoTracksBottomUp } from '../model/query';
import type { Clip, Track, VideoProject } from '../model/types';
import type { MixEntry, PcmSource } from './mixer';
import { OVERLAY_FONT, type Fit, drawVideoFrame, fitRect, overlayFontPx } from './timeline';
import { drawTitleClip } from './titleDraw';

export type StillImage = CanvasImageSource & { naturalWidth?: number; naturalHeight?: number };

const DEG = Math.PI / 180;

/**
 * Entradas de mezcla: el sonido de los clips de video (pistas de video de abajo
 * arriba) y luego el de las pistas de audio, en orden. Sin pistas silenciadas ni
 * medios que falten; lo que empieza después del final no suena y lo que se pasa se corta.
 */
export function buildProjectMixEntries(
  p: VideoProject,
  duration: number,
  open: (clip: Clip) => () => Promise<PcmSource | null>,
  playable: (clip: Clip) => boolean = (c) => !!c.mediaId && !!p.media[c.mediaId] && !p.media[c.mediaId].missing,
): MixEntry[] {
  const out: MixEntry[] = [];
  const add = (c: Clip) => {
    if (!playable(c) || c.start >= duration) return;
    out.push({
      start: c.start,
      // Como V1: el sonido de un clip de video no se recorta a `duration` (que redondea a
      // fotogramas y puede quedar 1e-15 por debajo); el de las pistas de audio sí.
      end: c.kind === 'video' ? clipEnd(c) : Math.min(duration, clipEnd(c)),
      inP: c.inP,
      outP: c.outP,
      speed: c.speed || 1,
      fx: clipAudioFx(c),
      ...(c.audioFadeIn > 0 ? { fadeIn: c.audioFadeIn } : {}),
      ...(c.audioFadeOut > 0 ? { fadeOut: c.audioFadeOut } : {}),
      open: open(c),
    });
  };
  for (const { track } of videoTracksBottomUp(p)) if (!track.muted) for (const c of track.clips) if (c.kind === 'video') add(c);
  for (const track of p.tracks) if (track.kind === 'audio' && !track.muted) for (const c of track.clips) add(c);
  return out;
}

/** Dibuja un fotograma de video con encaje, rotación del archivo, transformación del clip y opacidad. */
export function drawVideoClip(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  w: number,
  h: number,
  fit: Fit,
  fileRotation: number,
  clip: Pick<Clip, 'transform'>,
  alpha: number,
) {
  const tr = clip.transform;
  if (isIdentityTransform(tr)) return drawVideoFrame(ctx, img, srcW, srcH, w, h, fit, fileRotation, alpha);
  const a = alpha * tr.opacity;
  if (!srcW || !srcH || a <= 0 || tr.scale <= 0) return;
  const r = fitRect(srcW, srcH, w, h, fit, fileRotation);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(tr.x * w, tr.y * h);
  if (tr.rotation) ctx.rotate(tr.rotation * DEG);
  if (tr.scale !== 1) ctx.scale(tr.scale, tr.scale);
  const turned = fileRotation % 180 !== 0;
  if (fileRotation % 360 !== 0) ctx.rotate(fileRotation * DEG);
  const dw = turned ? r.h : r.w;
  const dh = turned ? r.w : r.h;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/** Dibuja un clip de texto o imagen (como las capas de V1, más transformación y opacidad). */
export function drawStillClip(ctx: CanvasRenderingContext2D, w: number, h: number, clip: Clip, img: StillImage | null, alpha: number) {
  const tr = clip.transform;
  // La posición no cuenta: V1 ya dibujaba las capas en (xf, yf).
  const plain = tr.scale === 1 && tr.rotation === 0 && tr.opacity === 1 && alpha >= 1;
  const cx = tr.x * w;
  const cy = tr.y * h;
  if (clip.kind === 'text') {
    const size = clip.size ?? 60;
    ctx.fillStyle = clip.color ?? '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${overlayFontPx(size, w, h)}px ${OVERLAY_FONT}`;
    if (plain) return ctx.fillText(clip.text ?? '', cx, cy);
    const a = alpha * tr.opacity;
    if (a <= 0 || tr.scale <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(cx, cy);
    if (tr.rotation) ctx.rotate(tr.rotation * DEG);
    if (tr.scale !== 1) ctx.scale(tr.scale, tr.scale);
    ctx.fillText(clip.text ?? '', 0, 0);
    ctx.restore();
    return;
  }
  if (!img) return;
  const dims = img as { width?: unknown; height?: unknown };
  const nw = img.naturalWidth ?? (typeof dims.width === 'number' ? dims.width : 0);
  const nh = img.naturalHeight ?? (typeof dims.height === 'number' ? dims.height : 0);
  if (!nw || !nh) return;
  const iw = (clip.size ?? 0.3) * w;
  const ih = iw * (nh / nw);
  if (plain) return ctx.drawImage(img, cx - iw / 2, cy - ih / 2, iw, ih);
  const a = alpha * tr.opacity;
  if (a <= 0 || tr.scale <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(cx, cy);
  if (tr.rotation) ctx.rotate(tr.rotation * DEG);
  if (tr.scale !== 1) ctx.scale(tr.scale, tr.scale);
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();
}

/** Fotograma de video listo para dibujar (con la rotación del archivo). */
export interface ComposedFrame {
  image: CanvasImageSource;
  width: number;
  height: number;
  rotation: number;
}

/** De dónde saca `composeFrame` las imágenes: la exportación decodifica, la vista previa usa elementos/caché. */
export interface ComposeSources {
  /** Fotograma del clip de video en el instante dado (null = todavía no hay: se salta la capa). */
  video(clip: Clip): ComposedFrame | null;
  /** Imagen de un clip de imagen (null = no cargada). */
  image(clip: Clip): StillImage | null;
}

/**
 * Composición de UN fotograma del proyecto en el instante t: fondo negro y, de abajo
 * arriba, cada capa visual con encaje, transformación, opacidad y fundido. Es la ÚNICA
 * implementación: la usan la exportación (render.ts) y la vista previa, así que lo que
 * se ve es lo que sale. `visual` permite pasar la lista de capas ya calculada.
 */
export function composeFrame(
  ctx: CanvasRenderingContext2D,
  p: VideoProject,
  t: number,
  duration: number,
  w: number,
  h: number,
  fit: Fit,
  src: ComposeSources,
  visual: { clip: Clip; track?: Track }[] = clipsAt(p, t, duration).visual,
) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  for (const { clip, track } of visual) {
    const alpha = clipFadeAlpha(clip, t, duration);
    if (clip.kind === 'video') {
      const f = src.video(clip);
      if (f) drawVideoClip(ctx, f.image, f.width, f.height, w, h, fit, f.rotation, clip, alpha);
    } else if (drawTitleClip(ctx, w, h, clip, t, duration, alpha, track?.subStyle)) {
      // título con estilo o subtítulo (V4)
    } else drawStillClip(ctx, w, h, clip, clip.kind === 'image' ? src.image(clip) : null, alpha);
  }
}
