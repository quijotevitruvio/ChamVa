// Dibujo de títulos y subtítulos (V4) sobre el lienzo del video. Reutiliza el motor de texto del editor de
// diseño (`drawStyledText`: fuentes, contorno, sombra, caja, eco…) y es la ÚNICA implementación: la usan
// `composeFrame` (y con él la exportación y la vista previa), el selector de estilos y las pruebas.
//
// Dos caminos con el mismo resultado visual en reposo:
//  - texto entero (sin animación por unidades ni karaoke): una sola llamada a `drawStyledText`;
//  - por unidades (palabra / letra / karaoke / máquina de escribir): cada unidad se coloca según la
//    maquetación del texto entero y se dibuja con `drawStyledText`, con su propia transformación y color.
import { drawStyledText, measureStyledText } from '../../editor/core/styledText';
import { transformText, type TextLayer } from '../../editor/core/types';
import { clipDuration } from '../model/query';
import type { Clip, Karaoke, SubtitleStyle, TitleAnim, TitleStyle, Transform } from '../model/types';
import { NEUTRAL, animDurations, effectiveUnit, emphasisState, needsUnits, unitState, type AnimState } from '../title/anim';
import { splitWords, wordKaraoke, wordTimings } from '../title/karaoke';
import { REF_SIZE } from '../title/style';
import { fitLines, wrapLines } from '../title/wrap';

/** Familia lista para `ctx.font`: entre comillas y con respaldo si es un nombre suelto. */
export function cssFamily(family: string): string {
  if (/[",]/.test(family)) return family;
  return `"${family}", Arial, Helvetica, sans-serif`;
}

export function fontShorthand(style: Pick<TitleStyle, 'bold' | 'italic' | 'fontFamily'>, px: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${px}px ${cssFamily(style.fontFamily)}`;
}

export interface TitleLayout {
  layer: TextLayer;
  /** líneas ya partidas por ancho (con las mayúsculas aplicadas) */
  lines: string[];
  /** caja del texto en px del fotograma (incluye el margen de la caja de fondo) */
  width: number;
  height: number;
  /** tamaño de letra en px del fotograma (tras reducir para que quepa) */
  fontPx: number;
  overflow: boolean;
}

const pxScale = (w: number, h: number) => Math.min(w, h) / REF_SIZE;

function buildLayer(style: TitleStyle, text: string, k: number): TextLayer {
  return {
    id: 'title',
    type: 'text',
    name: 'título',
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    text,
    fontFamily: cssFamily(style.fontFamily),
    fontSize: style.fontSize * k,
    fill: style.fill,
    align: style.align,
    bold: style.bold,
    italic: style.italic,
    textTransform: 'none',
    letterSpacing: style.letterSpacing * k,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth * k,
    shadow: style.shadow,
    shadowColor: style.shadowColor,
    shadowBlur: style.shadowBlur * k,
    shadowX: style.shadowX * k,
    shadowY: style.shadowY * k,
    lineHeight: style.lineHeight,
    textEffect: style.textEffect ?? 'none',
    effectColor: style.effectColor,
    underline: style.underline,
  } as TextLayer;
}

/** Maqueta un texto con su estilo en un fotograma de w×h: parte en líneas por ancho y mide la caja. */
export function layoutTitle(ctx: CanvasRenderingContext2D, text: string, style: TitleStyle, w: number, h: number, o: { maxLines?: number } = {}): TitleLayout {
  const k = pxScale(w, h);
  const shown = transformText(text, style.textTransform);
  let layer = buildLayer(style, shown, k);
  const padOf = (l: TextLayer) => (l.textEffect === 'background' ? l.fontSize * 0.3 : 0);
  const apply = (l: TextLayer) => {
    ctx.font = fontShorthand(style, l.fontSize);
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${l.letterSpacing}px`;
  };
  apply(layer);
  const maxW = Math.max(10, (style.maxWidth ?? 0.9) * w - 2 * padOf(layer));
  const measure = (s: string) => ctx.measureText(s).width;
  let lines: string[];
  let overflow = false;
  if (o.maxLines) {
    const fit = fitLines(shown, maxW, measure, o.maxLines);
    lines = fit.lines;
    overflow = fit.overflow;
    if (fit.scale < 1) {
      layer = buildLayer(style, shown, k * fit.scale);
      apply(layer);
      lines = wrapLines(shown, Math.max(10, (style.maxWidth ?? 0.9) * w - 2 * padOf(layer)), measure);
    }
  } else lines = wrapLines(shown, maxW, measure);
  layer.text = lines.join('\n');
  const m = measureStyledText(ctx, layer);
  return { layer, lines, width: m.width, height: m.height, fontPx: layer.fontSize, overflow };
}

export interface TitleDrawOpts {
  text: string;
  style: TitleStyle;
  anim?: TitleAnim;
  transform: Pick<Transform, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'>;
  /** s desde el inicio del clip y duración del clip */
  lt: number;
  dur: number;
  /** opacidad externa (fundidos del clip) */
  alpha: number;
  words?: Clip['words'];
  maxLines?: number;
  /** subtítulos: pegado a un borde en vez de centrado en `transform` */
  anchor?: { position: SubtitleStyle['position']; margin: number };
}

const compose = (a: AnimState, b: AnimState): AnimState => ({
  dx: a.dx + b.dx,
  dy: a.dy + b.dy,
  scale: a.scale * b.scale,
  opacity: a.opacity * b.opacity,
  rotation: a.rotation + b.rotation,
});

/** Opacidad global de la entrada y la salida (para la caja de fondo cuando se anima por unidades). */
function envelope(anim: TitleAnim | undefined, lt: number, dur: number): number {
  const { inD, outD } = animDurations(anim, dur);
  let e = 1;
  if (inD > 0 && lt < inD) e *= Math.max(0, lt / inD);
  if (outD > 0 && dur - lt < outD) e *= Math.max(0, (dur - lt) / outD);
  return e;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Centro y caja del texto en el fotograma. */
function placement(o: TitleDrawOpts, lay: TitleLayout, w: number, h: number): { cx: number; cy: number } {
  const tr = o.transform;
  if (o.anchor) {
    const m = o.anchor.margin * h;
    const cy = o.anchor.position === 'top' ? m + lay.height / 2 : o.anchor.position === 'middle' ? h / 2 : h - m - lay.height / 2;
    return { cx: tr.x * w, cy };
  }
  return { cx: tr.x * w, cy: tr.y * h };
}

/**
 * Dibuja un título o subtítulo en el instante `lt` de su clip. Devuelve la caja (para las manijas) o null si
 * no se dibujó nada.
 */
export function drawTitle(ctx: CanvasRenderingContext2D, w: number, h: number, o: TitleDrawOpts): { cx: number; cy: number; width: number; height: number } | null {
  if (!o.text.trim() || o.alpha <= 0) return null;
  const tr = o.transform;
  if (tr.scale <= 0) return null;
  ctx.save();
  try {
    const lay = layoutTitle(ctx, o.text, o.style, w, h, { maxLines: o.maxLines });
    const { cx, cy } = placement(o, lay, w, h);
    const unitsMode = needsUnits(o.anim);
    const emph = emphasisState(o.anim, o.lt);
    // Nivel de caja: con unidad «todo» la entrada y la salida actúan sobre la caja entera.
    const unit = effectiveUnit(o.anim);
    const boxLevel = unit === 'all' ? unitState(o.anim, o.lt, o.dur, 0, 1) : { state: NEUTRAL, visible: true };
    const st = compose(boxLevel.state, emph);
    const a = o.alpha * tr.opacity * st.opacity;
    if (a <= 0.001 || !boxLevel.visible) return { cx, cy, width: lay.width, height: lay.height };
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.translate(cx + st.dx * w, cy + st.dy * h);
    const rot = tr.rotation + st.rotation;
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    const sc = tr.scale * st.scale;
    if (sc !== 1) ctx.scale(sc, sc);
    ctx.translate(-lay.width / 2, -lay.height / 2);
    if (!unitsMode) drawStyledText(ctx, lay.layer);
    else drawUnits(ctx, o, lay, w, h, unit, a);
    return { cx, cy, width: lay.width, height: lay.height };
  } finally {
    ctx.restore();
  }
}

interface Piece {
  text: string;
  /** línea y posición (px) dentro de la caja */
  x: number;
  y: number;
  /** número de línea */
  line: number;
  width: number;
  wordIdx: number;
  /** índice entre las unidades de animación */
  unitIdx: number;
}

function drawUnits(ctx: CanvasRenderingContext2D, o: TitleDrawOpts, lay: TitleLayout, w: number, h: number, unit: 'all' | 'word' | 'letter', boxAlpha: number) {
  const layer = lay.layer;
  const m = measureStyledText(ctx, layer);
  const anim = o.anim;
  const fs = layer.fontSize;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${layer.letterSpacing}px`;
  ctx.font = fontShorthand(o.style, fs);
  // Caja de fondo: una vez, con la envolvente de la entrada/salida
  if (layer.textEffect === 'background') {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, boxAlpha * (unit === 'all' ? 1 : envelope(anim, o.lt, o.dur))));
    ctx.fillStyle = layer.effectColor ?? '#000000';
    roundRectPath(ctx, 0, 0, m.width, m.height, fs * 0.2);
    ctx.fill();
    ctx.restore();
  }
  // Piezas (palabras o letras) con su posición según la maquetación del texto entero
  const pieces: Piece[] = [];
  let wordIdx = 0;
  let unitIdx = 0;
  const letterMode = unit === 'letter';
  m.lines.forEach((runs, i) => {
    const line = runs.map((r) => r.text).join('');
    let x0 = m.pad + m.xs[i];
    if (layer.align === 'center') x0 += (m.aw[i] - m.widths[i]) / 2;
    else if (layer.align === 'right') x0 += m.aw[i] - m.widths[i];
    const y0 = m.pad + m.ys[i];
    for (const wd of splitWords(line)) {
      const before = ctx.measureText(line.slice(0, wd.from)).width;
      if (letterMode) {
        let off = 0;
        for (const ch of Array.from(wd.text)) {
          const pre = ctx.measureText(line.slice(0, wd.from) + wd.text.slice(0, off)).width;
          const cw = ctx.measureText(ch).width;
          pieces.push({ text: ch, x: x0 + pre, y: y0, line: i, width: cw, wordIdx, unitIdx: unitIdx++ });
          off += ch.length;
        }
      } else {
        pieces.push({ text: wd.text, x: x0 + before, y: y0, line: i, width: ctx.measureText(wd.text).width, wordIdx, unitIdx: unit === 'word' ? unitIdx : 0 });
        if (unit === 'word') unitIdx++;
      }
      wordIdx++;
    }
  });
  const nUnits = unit === 'all' ? 1 : Math.max(1, unitIdx);
  const k: Karaoke | undefined = anim?.karaoke;
  const times = k ? wordTimings(o.text, o.dur, o.words) : [];
  const total = ctx.globalAlpha;
  // Karaoke: la palabra activa crece y empuja a las vecinas para no pisarlas (la línea se mantiene alineada)
  const kws = pieces.map((p) => (k ? wordKaraoke(k, times, p.wordIdx, o.lt) : null));
  const shift = new Array<number>(pieces.length).fill(0);
  if (k) {
    const byLine = new Map<number, number[]>();
    pieces.forEach((p, idx) => byLine.set(p.line, [...(byLine.get(p.line) ?? []), idx]));
    for (const idxs of byLine.values()) {
      const extra = idxs.map((ix) => ((kws[ix]?.scale ?? 1) - 1) * pieces[ix].width);
      const sum = extra.reduce((a, b) => a + b, 0);
      const anchor = layer.align === 'center' ? sum / 2 : layer.align === 'right' ? sum : 0;
      let before = 0;
      idxs.forEach((ix, j) => {
        shift[ix] = before + extra[j] / 2 - anchor;
        before += extra[j];
      });
    }
  }
  for (const [pi, p] of pieces.entries()) {
    const us = unit === 'all' ? { state: NEUTRAL, visible: true } : unitState(anim, o.lt, o.dur, p.unitIdx, nUnits);
    if (!us.visible) continue;
    const kw = kws[pi];
    const pieceAlpha = us.state.opacity;
    if (pieceAlpha <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha = total * pieceAlpha;
    const cxp = p.x + p.width / 2;
    const cyp = p.y + fs * 0.5;
    ctx.translate(cxp + shift[pi] + us.state.dx * w, cyp + us.state.dy * h);
    if (us.state.rotation) ctx.rotate((us.state.rotation * Math.PI) / 180);
    const s = us.state.scale * (kw?.scale ?? 1);
    if (s !== 1) ctx.scale(s, s);
    ctx.translate(-p.width / 2, -fs * 0.5);
    const pl: TextLayer = { ...layer, text: p.text, align: 'left', textEffect: layer.textEffect === 'echo' ? 'echo' : 'none', fill: kw?.colored && k ? k.color : layer.fill };
    drawStyledText(ctx, pl);
    ctx.restore();
  }
}

/** ¿Dónde está el título de este clip (fotograma w×h)? Para las manijas de la vista previa. */
export function measureTitleClip(ctx: CanvasRenderingContext2D, clip: Clip, w: number, h: number, sub?: SubtitleStyle): { width: number; height: number; fontPx: number } | null {
  const style = clip.kind === 'subtitle' ? sub?.style : clip.tstyle;
  if (!style) return null;
  const lay = layoutTitle(ctx, clip.text ?? '', style, w, h, clip.kind === 'subtitle' ? { maxLines: sub?.maxLines ?? 2 } : {});
  return { width: lay.width, height: lay.height, fontPx: lay.fontPx };
}

/**
 * Dibuja un clip de texto con estilo propio o un subtítulo (`sub`: estilo de su pista) en el instante t.
 * Devuelve false si el clip no usa este camino (texto de V1 sin estilo): quien llama lo dibuja como siempre.
 */
export function drawTitleClip(ctx: CanvasRenderingContext2D, w: number, h: number, clip: Clip, t: number, projectDur: number, alpha: number, sub?: SubtitleStyle): boolean {
  const isSub = clip.kind === 'subtitle';
  if (isSub) {
    if (!sub) return true; // pista sin estilo: nada que dibujar
  } else if (clip.kind !== 'text' || !clip.tstyle) return false;
  const dur = clip.toEnd ? Math.max(0, projectDur - clip.start) : clipDuration(clip);
  const lt = t - clip.start;
  if (isSub) {
    const fade = sub!.fade ?? 0;
    const anim: TitleAnim | undefined = fade > 0 || sub!.karaoke ? { ...(fade > 0 ? { in: 'fade', out: 'fade', inDur: fade, outDur: fade } : {}), ...(sub!.karaoke ? { karaoke: sub!.karaoke } : {}) } : undefined;
    drawTitle(ctx, w, h, {
      text: clip.text ?? '',
      style: sub!.style,
      anim,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
      lt,
      dur,
      alpha,
      words: clip.words,
      maxLines: sub!.maxLines,
      anchor: { position: sub!.position, margin: sub!.margin },
    });
    return true;
  }
  drawTitle(ctx, w, h, { text: clip.text ?? '', style: clip.tstyle!, anim: clip.anim, transform: clip.transform, lt, dur, alpha, words: clip.words });
  return true;
}
