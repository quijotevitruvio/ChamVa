// Composición del modelo v2: qué se dibuja (por capas) y qué suena (varias pistas)
// en cada instante. Con transformación neutra se usan EXACTAMENTE las mismas
// llamadas de dibujo que V1 (drawVideoFrame / texto / imagen), para que un
// proyecto migrado salga idéntico píxel a píxel.
import { clipAudioFx } from '../model/effects';
import { clipDuration, clipEnd, clipFadeAlpha, clipsAt, effectiveEnd, isIdentityTransform, videoTracksBottomUp } from '../model/query';
import type { BlendMode, Clip, Track, VideoProject } from '../model/types';
import { activeFx } from '../fx/effects';
import { applyFxStack, type Box } from '../fx/fxDraw';
import { fxAt, transformAt, volumeAt } from '../fx/keyframes';
import { getScratch, type Scratch } from '../fx/scratch';
import { drawTransition } from '../fx/transitionDraw';
import { resolveTransitions, transitionAt, type ResolvedTransition, type TransitionState } from '../fx/transitions';
import { ClipTimeSource, needsTimeSource, type OpenAt } from './timeAudio';
import { layersAt } from '../speed/clipTime';
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
  open: (clip: Clip, startAt?: number) => () => Promise<PcmSource | null>,
  playable: (clip: Clip) => boolean = (c) => !!c.mediaId && !!p.media[c.mediaId] && !p.media[c.mediaId].missing,
): MixEntry[] {
  const out: MixEntry[] = [];
  const add = (c: Clip) => {
    if (!playable(c) || c.start >= duration) return;
    const volKeys = !!c.keys?.volume?.length;
    // V8: curva de velocidad, invertido, bucle, congelado o tono conservado: el mezclador ve un clip normal en TIEMPO LOCAL
    // (inP 0, velocidad 1) y `ClipTimeSource` traduce con el mismo mapa de tiempo que la imagen.
    const special = needsTimeSource(c);
    const dur = special ? clipDuration(c) : 0;
    out.push({
      start: c.start,
      // Como V1: el sonido de un clip de video no se recorta a `duration` (que redondea a
      // fotogramas y puede quedar 1e-15 por debajo); el de las pistas de audio sí.
      end: c.kind === 'video' ? clipEnd(c) : Math.min(duration, clipEnd(c)),
      inP: special ? 0 : c.inP,
      outP: special ? dur + 1 : c.outP,
      speed: special ? 1 : c.speed || 1,
      // con fotogramas clave de volumen la ganancia va como envolvente (el volumen de la cadena queda en 1)
      fx: volKeys ? { ...clipAudioFx(c), volume: 1 } : clipAudioFx(c),
      ...(volKeys ? { gain: (tt: number) => volumeAt(c, tt) } : {}),
      ...(c.audioFadeIn > 0 ? { fadeIn: c.audioFadeIn } : {}),
      ...(c.audioFadeOut > 0 ? { fadeOut: c.audioFadeOut } : {}),
      open: special
        ? async () => {
            const at: OpenAt = (startAt) => open(c, startAt)();
            return new ClipTimeSource(c, at, { pitch: c.pitch });
          }
        : open(c),
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
  /** Fotograma del clip de video en el instante dado (null = todavía no hay: se salta la capa). `ext`: el clip se ve fuera de su rango por una transición de unión. */
  video(clip: Clip, ext?: boolean): ComposedFrame | null;
  /** Imagen de un clip de imagen (null = no cargada). */
  image(clip: Clip): StillImage | null;
}

const BLEND_OP: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  add: 'lighter',
  difference: 'difference',
  darken: 'darken',
  lighten: 'lighten',
  softlight: 'soft-light',
  hardlight: 'hard-light',
  dodge: 'color-dodge',
  burn: 'color-burn',
  exclusion: 'exclusion',
};

/** Semilla de ruido animado: cambia 24 veces por segundo (misma para vista previa y exportación). */
export const fxSeed = (t: number) => Math.floor(t * 24 + 1e-6);

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Rectángulo que ocupa el clip dibujado (con el giro incluido, como cuadro envolvente). */
export function clipBox(ac: Clip, w: number, h: number, fit: Fit, f: ComposedFrame | null, img: StillImage | null): Box {
  const full: Box = { cx: w / 2, cy: h / 2, w, h };
  const tr = ac.transform;
  let bw: number;
  let bh: number;
  if (ac.kind === 'video' && f) {
    const r = fitRect(f.width, f.height, w, h, fit, f.rotation);
    bw = r.w;
    bh = r.h;
  } else if (ac.kind === 'image' && img) {
    const dims = img as { width?: unknown; height?: unknown };
    const nw = img.naturalWidth ?? (typeof dims.width === 'number' ? dims.width : 0);
    const nh = img.naturalHeight ?? (typeof dims.height === 'number' ? dims.height : 0);
    if (!nw || !nh) return full;
    bw = (ac.size ?? 0.3) * w;
    bh = bw * (nh / nw);
  } else return full;
  bw *= tr.scale;
  bh *= tr.scale;
  if (tr.rotation) {
    const c = Math.abs(Math.cos(tr.rotation * DEG));
    const s = Math.abs(Math.sin(tr.rotation * DEG));
    [bw, bh] = [bw * c + bh * s, bw * s + bh * c];
  }
  return { cx: tr.x * w, cy: tr.y * h, w: bw, h: bh };
}

interface FrameCtx {
  main: CanvasRenderingContext2D;
  p: VideoProject;
  t: number;
  duration: number;
  w: number;
  h: number;
  fit: Fit;
  src: ComposeSources;
  seed: number;
}

type Item = { clip: Clip; track?: Track; ext?: boolean };

/** Instante con el que se evalúan fundidos, fotogramas clave y animaciones: dentro del clip aunque se vea por una transición. */
function localTime(c: Clip, t: number, duration: number, ext: boolean): number {
  if (!ext) return t;
  const end = effectiveEnd(c, duration);
  return Math.max(c.start, Math.min(end - 1e-6, t));
}

/** Pila de efectos del clip en t (con fotogramas clave) ya filtrada por activos. */
function fxOfClip(c: Clip, tt: number) {
  if (!c.fx || c.fx.length === 0) return [];
  return activeFx(c.fx.map((f) => fxAt(c, f, tt)));
}

/** Dibuja el contenido de un clip (sin efectos ni fusión) y devuelve su cuadro. */
function drawContent(g: FrameCtx, ctx: CanvasRenderingContext2D, clip: Clip, track: Track | undefined, ext: boolean): Box {
  const { w, h, fit, src } = g;
  const tt = localTime(clip, g.t, g.duration, ext);
  const tr = transformAt(clip, tt);
  const ac = tr === clip.transform ? clip : { ...clip, transform: tr };
  const alpha = clipFadeAlpha(clip, tt, g.duration);
  if (clip.kind === 'video') {
    const f = src.video(ac, ext);
    if (f) {
      // V8: bucle con fundido cruzado: la pasada saliente se dibuja entera y la entrante encima con su opacidad
      const ls = clip.loop?.xf ? layersAt(clip, tt - clip.start) : null;
      const f0 = ls && ls.length === 2 ? src.video({ ...ac, id: `${ac.id}~x`, xlayer: true }, ext) : null;
      if (f0 && ls) {
        drawVideoClip(ctx, f0.image, f0.width, f0.height, w, h, fit, f0.rotation, ac, alpha * ls[0].a);
        drawVideoClip(ctx, f.image, f.width, f.height, w, h, fit, f.rotation, ac, alpha * ls[1].a);
      } else drawVideoClip(ctx, f.image, f.width, f.height, w, h, fit, f.rotation, ac, alpha);
    }
    return clipBox(ac, w, h, fit, f, null);
  }
  const img = clip.kind === 'image' ? src.image(clip) : null;
  if (drawTitleClip(ctx, w, h, ac, tt, g.duration, alpha, track?.subStyle)) return clipBox(ac, w, h, fit, null, null);
  drawStillClip(ctx, w, h, ac, img, alpha);
  return clipBox(ac, w, h, fit, null, img);
}

/** Capa del clip en un lienzo de trabajo: contenido + efectos (sin fusión). */
function renderLayer(g: FrameCtx, slot: string, clip: Clip, track: Track | undefined, ext: boolean): Scratch {
  const s = getScratch(slot, g.w, g.h);
  const box = drawContent(g, s.ctx as CanvasRenderingContext2D, clip, track, ext);
  const tt = localTime(clip, g.t, g.duration, ext);
  const fx = fxOfClip(clip, tt);
  if (fx.length) applyFxStack(s, fx, { w: g.w, h: g.h, box, seed: g.seed });
  return s;
}

/** Capa de ajuste: aplica sus efectos a lo ya compuesto (lo de debajo), con su opacidad y fundido. */
function drawAdjust(g: FrameCtx, clip: Clip) {
  const tt = g.t;
  const fx = fxOfClip(clip, tt);
  if (!fx.length) return;
  const alpha = clipFadeAlpha(clip, tt, g.duration) * transformAt(clip, tt).opacity;
  if (alpha <= 0) return;
  const s = getScratch('adjust', g.w, g.h);
  s.ctx.drawImage(g.main.canvas as CanvasImageSource, 0, 0);
  applyFxStack(s, fx, { w: g.w, h: g.h, box: { cx: g.w / 2, cy: g.h / 2, w: g.w, h: g.h }, seed: g.seed });
  g.main.save();
  g.main.globalAlpha = alpha;
  g.main.drawImage(s.canvas as CanvasImageSource, 0, 0);
  g.main.restore();
}

/** Dibuja un clip suelto: directo si no tiene efectos ni fusión; por capa si los tiene. */
function drawSingle(g: FrameCtx, clip: Clip, track: Track | undefined) {
  if (clip.kind === 'adjust') return drawAdjust(g, clip);
  const fx = fxOfClip(clip, g.t);
  const blend = clip.blend && clip.blend !== 'normal' ? clip.blend : null;
  if (!fx.length && !blend) {
    drawContent(g, g.main, clip, track, false);
    return;
  }
  const layer = renderLayer(g, 'layer', clip, track, false);
  g.main.save();
  if (blend) g.main.globalCompositeOperation = BLEND_OP[blend];
  g.main.drawImage(layer.canvas as CanvasImageSource, 0, 0);
  g.main.restore();
}

/** Transición de unión, de entrada o de salida en este instante. */
function drawTransitionState(g: FrameCtx, st: TransitionState, byId: Map<string, Item>) {
  const { tr } = st;
  const find = (c: Clip | undefined) => (c ? byId.get(c.id) : undefined);
  const seed = hashStr((tr.b ?? tr.a)!.id);
  if (tr.kind === 'junction') {
    const ia = find(tr.a);
    const ib = find(tr.b);
    if (!ia || !ib) return;
    const A = renderLayer(g, 'tr-a', ia.clip, ia.track, !!ia.ext);
    const B = renderLayer(g, 'tr-b', ib.clip, ib.track, !!ib.ext);
    drawTransition(tr.spec.type, { ctx: g.main, A: A.canvas, B: B.canvas, w: g.w, h: g.h, p: st.eased, seed });
    return;
  }
  const it = find(tr.kind === 'in' ? tr.b : tr.a);
  if (!it) return;
  const base = getScratch('tr-base', g.w, g.h);
  base.ctx.drawImage(g.main.canvas as CanvasImageSource, 0, 0);
  const layer = renderLayer(g, 'tr-a', it.clip, it.track, false);
  const A = tr.kind === 'in' ? base : layer;
  const B = tr.kind === 'in' ? layer : base;
  drawTransition(tr.spec.type, { ctx: g.main, A: A.canvas, B: B.canvas, w: g.w, h: g.h, p: st.eased, seed });
}

/**
 * Composición de UN fotograma del proyecto en el instante t: fondo negro y, de abajo
 * arriba, cada capa visual con encaje, transformación (con fotogramas clave), efectos, fusión,
 * transiciones y fundido. Es la ÚNICA implementación: la usan la exportación (render.ts), la vista previa y las
 * miniaturas, así que lo que se ve es lo que sale. `visual` permite pasar la lista de capas ya calculada.
 * Un clip sin efectos, fusión ni transición se dibuja con las mismas llamadas que antes de V6 (mismos píxeles).
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
  visual: Item[] = clipsAt(p, t, duration).visual,
) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const g: FrameCtx = { main: ctx, p, t, duration, w, h, fit, src, seed: fxSeed(t) };
  const trCache = new Map<string, TransitionState | null>();
  const stateOf = (track: Track | undefined): TransitionState | null => {
    if (!track || track.kind !== 'video' || !track.clips.some((c) => c.tin || c.tout)) return null;
    if (trCache.has(track.id)) return trCache.get(track.id)!;
    const st = transitionAt(resolveTransitions(track, duration), t);
    trCache.set(track.id, st);
    return st;
  };
  const byId = new Map<string, Item>();
  for (const it of visual) byId.set(it.clip.id, it);
  const done = new Set<string>();
  for (const it of visual) {
    const { clip, track } = it;
    if (done.has(clip.id)) continue;
    const st = stateOf(track);
    const tr: ResolvedTransition | undefined = st?.tr;
    if (st && tr && (tr.a?.id === clip.id || tr.b?.id === clip.id)) {
      if (tr.a) done.add(tr.a.id);
      if (tr.b) done.add(tr.b.id);
      drawTransitionState(g, st, byId);
      continue;
    }
    if (it.ext) continue; // visible solo por una transición que ya no aplica
    drawSingle(g, clip, track);
  }
}
