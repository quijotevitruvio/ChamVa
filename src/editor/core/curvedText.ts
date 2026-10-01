import type { TextLayer } from './types';
import { runFont, styledLines, type ResolvedStyle } from './richText';
import { runUsesGradient, textCanvasGradient, type PointMap } from './textGradient';
import { buildArcTable, drawTextWithFx, hasPathText, hasTextFx, pathBox, pointAtLength, type FxPass } from './textFx';

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
  if (hasPathText(layer)) return pathBox(layer.pathText!.points, layer.fontSize); // texto sobre trazado
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
  height: number = measureCurved(ctx, layer).height,
) {
  if (!hasTextFx(layer)) {
    drawCurvedBase(ctx, layer, width, height);
    return;
  }
  // Efectos avanzados (textFx.ts): el dibujo normal se envuelve en varias pasadas.
  drawTextWithFx(ctx, layer, { width, height }, (c, pass) => drawCurvedBase(c, layer, width, height, pass));
}

// `pass` (textFx.ts): pasada plana de un efecto (un color, contorno dado).
function drawCurvedBase(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  width: number,
  height: number,
  pass?: FxPass,
) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = curvedChars(layer);
  const widths = charWidths(ctx, layer, chars);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const fs = layer.fontSize;
  const curveDeg = layer.curve ?? 0;
  // `toLocal`: del cuadro del texto al espacio local de la letra que se dibuja
  // (cada letra va rotada); así el degradado cubre todo el cuadro.
  let toLocal: PointMap = (px, py) => ({ x: px, y: py });
  const grad = layer.fillGradient
    ? (map: PointMap) => textCanvasGradient(ctx, layer.fillGradient!, width, height, map)
    : null;
  const drawChar = (ch: CurvedChar, x: number, y: number) => {
    ctx.font = runFont(layer, ch.st);
    ctx.fillStyle = pass ? pass.color : grad && runUsesGradient(layer, ch.st.color) ? grad(toLocal) : ch.st.color;
    const sw = pass ? pass.strokeWidth : layer.strokeWidth;
    if (sw > 0) {
      ctx.strokeStyle = pass ? pass.color : layer.strokeColor;
      ctx.lineWidth = sw;
      ctx.lineJoin = 'round';
      ctx.strokeText(ch.c, x, y);
    }
    ctx.fillText(ch.c, x, y);
  };

  // Texto sobre trazado libre (Bézier de 4 puntos): cada letra va sobre la curva,
  // apoyada en la línea base y girada con la tangente.
  if (hasPathText(layer)) {
    const pt = layer.pathText!;
    const table = buildArcTable(pt.points);
    ctx.textBaseline = 'alphabetic';
    let start = pt.offset ?? 0;
    if (layer.align === 'center') start += (table.length - total) / 2;
    else if (layer.align === 'right') start += table.length - total;
    let s = start;
    for (let i = 0; i < chars.length; i++) {
      const p = pointAtLength(table, s + widths[i] / 2);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      {
        // Inversa de translate(p)·rotate(ángulo): del cuadro al espacio local de la letra.
        const cos = Math.cos(-p.angle);
        const sin = Math.sin(-p.angle);
        toLocal = (px, py) => {
          const dx = px - p.x;
          const dy = py - p.y;
          return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
        };
      }
      drawChar(chars[i], 0, 0);
      ctx.restore();
      s += widths[i];
    }
    return;
  }

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
    {
      // Inversa de translate(cx,centerY)·rotate(sθ)·translate(0,-sR).
      const a = -s * theta;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      toLocal = (px, py) => {
        const dx = px - cx;
        const dy = py - centerY;
        return { x: dx * cos - dy * sin, y: dx * sin + dy * cos + s * R };
      };
    }
    drawChar(chars[i], 0, 0);
    ctx.restore();
    theta += widths[i] / R / 2;
  }
}
