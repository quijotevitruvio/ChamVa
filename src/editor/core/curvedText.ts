import { canvasFont, transformText, type TextLayer } from './types';

export interface CurvedMetrics {
  width: number;
  height: number;
}

// Mide el ancho/alto aproximado del texto curvo (para la caja del nodo).
export function measureCurved(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
): CurvedMetrics {
  ctx.font = canvasFont(layer);
  const line = transformText(layer.text, layer.textTransform).split('\n')[0] || '';
  const ls = layer.letterSpacing || 0;
  let total = 0;
  for (const c of [...line]) total += ctx.measureText(c).width + ls;
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
  ctx.font = canvasFont(layer);
  ctx.fillStyle = layer.fill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const line = transformText(layer.text, layer.textTransform).split('\n')[0] || '';
  const chars = [...line];
  const ls = layer.letterSpacing || 0;
  const widths = chars.map((c) => ctx.measureText(c).width + ls);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const fs = layer.fontSize;
  const curveDeg = layer.curve ?? 0;
  const drawChar = (c: string, x: number, y: number) => {
    if (layer.strokeWidth > 0) {
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layer.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(c, x, y);
    }
    ctx.fillText(c, x, y);
  };

  const arc = (Math.abs(curveDeg) * Math.PI) / 180;
  if (arc < 0.01) {
    let x = (width - total) / 2;
    chars.forEach((c, i) => {
      drawChar(c, x + widths[i] / 2, fs * 0.7);
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
