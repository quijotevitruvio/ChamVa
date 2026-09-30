import type { TextLayer } from './types';
import { runFont, styledLines, type ResolvedStyle } from './richText';

export interface CurvedMetrics {
  width: number;
  height: number;
}

interface CurvedChar {
  c: string;
  st: ResolvedStyle;
}

// Primera línea del texto como caracteres con su estilo (el texto curvo usa
// una sola línea y sin prefijos de lista).
function curvedChars(layer: TextLayer): CurvedChar[] {
  const line = styledLines(layer, { list: false })[0] ?? [];
  const out: CurvedChar[] = [];
  for (const run of line) for (const c of [...run.text]) out.push({ c, st: run });
  return out;
}

function charWidths(ctx: CanvasRenderingContext2D, layer: TextLayer, chars: CurvedChar[]) {
  const ls = layer.letterSpacing || 0;
  return chars.map(({ c, st }) => {
    ctx.font = runFont(layer, st);
    return ctx.measureText(c).width + ls;
  });
}

// Mide el ancho/alto aproximado del texto curvo (para la caja del nodo).
export function measureCurved(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
): CurvedMetrics {
  const total = charWidths(ctx, layer, curvedChars(layer)).reduce((a, b) => a + b, 0);
  const arc = (Math.abs(layer.curve ?? 0) * Math.PI) / 180;
  const fs = layer.fontSize;
  if (arc < 0.01) return { width: Math.max(1, total), height: fs * 1.4 };
  const R = total / arc;
  // sagita del arco
  const sag = R - R * Math.cos(arc / 2);
  const chord = 2 * R * Math.sin(arc / 2);
  return {
    width: Math.max(1, chord + fs),
    height: Math.max(1, sag + fs * 1.4),
  };
}

// Dibuja el texto curvo dentro de la caja (0,0,width,height) sobre un contexto 2D.
export function drawCurvedText(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  width: number,
) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = curvedChars(layer);
  const widths = charWidths(ctx, layer, chars);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const fs = layer.fontSize;
  const curveDeg = layer.curve ?? 0;
  const drawChar = (ch: CurvedChar, x: number, y: number) => {
    ctx.font = runFont(layer, ch.st);
    ctx.fillStyle = ch.st.color;
    if (layer.strokeWidth > 0) {
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layer.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(ch.c, x, y);
    }
    ctx.fillText(ch.c, x, y);
  };

  const arc = (Math.abs(curveDeg) * Math.PI) / 180;
  if (arc < 0.01) {
    let x = (width - total) / 2;
    chars.forEach((ch, i) => {
      drawChar(ch, x + widths[i] / 2, fs * 0.7);
      x += widths[i];
    });
    return;
  }

  const s = curveDeg < 0 ? -1 : 1;
  const R = total / arc;
  const cx = width / 2;
  // Centro del círculo: debajo (curva hacia arriba) o encima (hacia abajo).
  const centerY = s > 0 ? fs * 0.7 + R : fs * 0.7 - R;
  let theta = -arc / 2;
  for (let i = 0; i < chars.length; i++) {
    theta += widths[i] / R / 2;
    ctx.save();
    ctx.translate(cx, centerY);
    ctx.rotate(s * theta);
    ctx.translate(0, -s * R);
    drawChar(chars[i], 0, 0);
    ctx.restore();
    theta += widths[i] / R / 2;
  }
}
