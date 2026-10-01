// Dibujo de texto RECTO con efectos (eco / fondo) y estilo por palabra,
// compartido por el editor (Konva, vía KonvaShape) y la exportación (Canvas 2D)
// para paridad pixel a pixel.
import type { TextLayer } from './types';
import { runFont, styledLines, type StyledRun } from './richText';
import { runUsesGradient, textCanvasGradient } from './textGradient';
import { layoutText, usesTypography, type DropCapInfo } from './typography';
import { drawDropCaps, drawLeader, runDy, runUnderlineY } from './typographyDraw';
import type { FieldValues } from './textMacros';
import { drawTextWithFx, hasTextFx, type FxPass, type LineRect } from './textFx';

const BG_PAD = 0.3; // padding del fondo, relativo a fontSize
const BG_RADIUS = 0.2; // radio de esquina del fondo, relativo a fontSize
const ECHO_STEPS = 4;
const ECHO_STEP = 0.06; // desplazamiento por copia, relativo a fontSize

interface Metrics {
  layer: TextLayer; // capa con el tamaño efectivo (autoajuste); igual a la original si no hay
  xs: number[]; // desplazamiento horizontal de cada línea (columna, sangría)
  ys: number[]; // posición vertical de cada línea
  aw: number[]; // ancho disponible para alinear cada línea
  drops: DropCapInfo[]; // capitulares
  lines: StyledRun[][];
  runWidths: number[][];
  widths: number[];
  boxW: number;
  textH: number;
  pad: number; // desplazamiento del texto (fondo) — 0 si no hay fondo
  width: number; // ancho total de la caja (incl. fondo)
  height: number; // alto total de la caja (incl. fondo)
}

export function measureStyledText(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  fields?: Partial<FieldValues>,
): Metrics {
  (ctx as any).letterSpacing = `${layer.letterSpacing || 0}px`;
  if (usesTypography(layer)) {
    // Maquetación avanzada (caja, columnas, capitular…): ver typography.ts.
    const lay = layoutText(
      layer,
      (l, run) => {
        ctx.font = runFont(l, run);
        return ctx.measureText(run.text).width;
      },
      fields,
    );
    const eff = lay.layer;
    const pad = eff.textEffect === 'background' ? eff.fontSize * BG_PAD : 0;
    return {
      layer: eff,
      xs: lay.xs,
      ys: lay.ys,
      aw: lay.aw,
      drops: lay.drops,
      lines: lay.lines,
      runWidths: lay.runWidths,
      widths: lay.widths,
      boxW: lay.boxW,
      textH: lay.textH,
      pad,
      width: lay.boxW + pad * 2,
      height: lay.textH + pad * 2,
    };
  }
  const lines = styledLines(layer);
  const runWidths = lines.map((line) =>
    line.map((run) => {
      ctx.font = runFont(layer, run);
      return ctx.measureText(run.text).width;
    }),
  );
  const widths = runWidths.map((ws) => ws.reduce((a, b) => a + b, 0));
  const boxW = Math.max(0, ...widths);
  const lh = layer.lineHeight ?? 1;
  const textH = lines.length * layer.fontSize * lh;
  const pad = layer.textEffect === 'background' ? layer.fontSize * BG_PAD : 0;
  return {
    layer,
    xs: lines.map(() => 0),
    ys: lines.map((_, i) => i * layer.fontSize * lh),
    aw: lines.map(() => boxW),
    drops: [],
    lines,
    runWidths,
    widths,
    boxW,
    textH,
    pad,
    width: boxW + pad * 2,
    height: textH + pad * 2,
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Dibuja el texto en el origen actual del ctx (el llamador ya aplicó
// translate/rotate/scale/alpha). Soporta multilínea, alineación, espaciado,
// contorno, sombra, subrayado, estilo por palabra y efectos eco/fondo.
export function drawStyledText(
  ctx: CanvasRenderingContext2D,
  layerIn: TextLayer,
  fields?: Partial<FieldValues>,
) {
  if (!hasTextFx(layerIn)) {
    drawStyledBase(ctx, layerIn, fields);
    return;
  }
  // Efectos avanzados (textFx.ts): el dibujo normal se envuelve en varias pasadas.
  const m = measureStyledText(ctx, layerIn, fields);
  const lines: LineRect[] = m.lines.map((_, i) => {
    let lx = m.pad + m.xs[i];
    if (m.layer.align === 'center') lx += (m.aw[i] - m.widths[i]) / 2;
    else if (m.layer.align === 'right') lx += m.aw[i] - m.widths[i];
    return { x: lx, y: m.pad + m.ys[i], w: m.widths[i] };
  });
  drawTextWithFx(ctx, m.layer, { width: m.width, height: m.height, lines }, (c, pass) =>
    drawStyledBase(c, layerIn, fields, pass),
  );
}

// `pass` (textFx.ts): pasada plana de un efecto — un solo color y contorno dado,
// sin fondo, eco ni sombra. Sin `pass` es el dibujo de siempre.
function drawStyledBase(
  ctx: CanvasRenderingContext2D,
  layerIn: TextLayer,
  fields?: Partial<FieldValues>,
  pass?: FxPass,
) {
  const m = measureStyledText(ctx, layerIn, fields);
  const layer = m.layer;
  const fontSize = layer.fontSize;
  const effect = pass ? 'none' : (layer.textEffect ?? 'none');
  const useShadow = layer.shadow && !pass;
  const strokeW = pass ? pass.strokeWidth : layer.strokeWidth;
  const strokeC = pass ? pass.color : layer.strokeColor;

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  (ctx as any).letterSpacing = `${layer.letterSpacing || 0}px`;

  // Fondo detrás del texto.
  if (effect === 'background') {
    ctx.save();
    ctx.fillStyle = layer.effectColor ?? '#000000';
    roundRect(ctx, 0, 0, m.width, m.height, fontSize * BG_RADIUS);
    ctx.fill();
    ctx.restore();
  }

  const setShadow = () => {
    ctx.shadowColor = layer.shadowColor;
    ctx.shadowBlur = layer.shadowBlur;
    ctx.shadowOffsetX = layer.shadowX;
    ctx.shadowOffsetY = layer.shadowY;
  };
  const clearShadow = () => {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };
  const underlineThickness = Math.max(1, fontSize / 15);
  // Degradado del color de texto: un solo CanvasGradient sobre todo el cuadro.
  const grad = layer.fillGradient ? textCanvasGradient(ctx, layer.fillGradient, m.width, m.height) : null;
  const paintFor = (color: string): string | CanvasGradient =>
    pass ? pass.color : grad && runUsesGradient(layer, color) ? grad : color;

  m.lines.forEach((line, i) => {
    let lx = m.pad + m.xs[i];
    if (layer.align === 'center') lx += (m.aw[i] - m.widths[i]) / 2;
    else if (layer.align === 'right') lx += m.aw[i] - m.widths[i];
    const y = m.pad + m.ys[i];

    // Eco: copias desplazadas detrás del texto principal.
    if (effect === 'echo') {
      const ec = layer.effectColor ?? layer.fill;
      clearShadow();
      ctx.fillStyle = ec;
      for (let s = ECHO_STEPS; s >= 1; s--) {
        const off = s * fontSize * ECHO_STEP;
        ctx.save();
        ctx.globalAlpha = 0.45 * (1 - s / (ECHO_STEPS + 1));
        let x = lx;
        line.forEach((run, r) => {
          ctx.font = runFont(layer, run);
          if (!run.tab) ctx.fillText(run.text, x + (run.dx ?? 0) + off, y + runDy(layer, run) + off);
          x += m.runWidths[i][r];
        });
        ctx.restore();
      }
    }

    let x = lx;
    line.forEach((run, r) => {
      const w = m.runWidths[i][r];
      ctx.font = runFont(layer, run);
      if (run.tab) {
        if (run.leader) drawLeader(ctx, layer, run, x, y, w, paintFor(run.color));
        x += w;
        return;
      }
      const rx = x + (run.dx ?? 0);
      const ry = y + runDy(layer, run);
      if (strokeW > 0) {
        if (useShadow) setShadow();
        else clearShadow();
        ctx.strokeStyle = strokeC;
        ctx.lineWidth = strokeW;
        ctx.lineJoin = 'round';
        ctx.strokeText(run.text, rx, ry);
        clearShadow();
        ctx.fillStyle = paintFor(run.color);
        ctx.fillText(run.text, rx, ry);
      } else {
        if (useShadow) setShadow();
        else clearShadow();
        ctx.fillStyle = paintFor(run.color);
        ctx.fillText(run.text, rx, ry);
        clearShadow();
      }
      if (run.underline && run.text.trim()) {
        ctx.fillStyle = paintFor(run.color);
        ctx.fillRect(rx, y + runUnderlineY(layer, run), w - (run.dx ?? 0), underlineThickness);
      }
      x += w;
    });
  });

  // Capitulares (typography.ts): letra grande a la izquierda del párrafo.
  if (m.drops.length) drawDropCaps(ctx, pass ? { ...layer, strokeWidth: strokeW, strokeColor: strokeC, shadow: false } : layer, m.drops, m.pad, paintFor, pass ? clearShadow : setShadow, clearShadow);
}
