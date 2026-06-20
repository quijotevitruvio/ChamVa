// Dibujo de texto RECTO con efectos (eco / fondo), compartido por el editor
// (Konva, vía KonvaShape) y la exportación (Canvas 2D) para paridad pixel a pixel.
import { canvasFont, displayText, type TextLayer } from './types';

const BG_PAD = 0.3; // padding del fondo, relativo a fontSize
const BG_RADIUS = 0.2; // radio de esquina del fondo, relativo a fontSize
const ECHO_STEPS = 4;
const ECHO_STEP = 0.06; // desplazamiento por copia, relativo a fontSize

interface Metrics {
  lines: string[];
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
): Metrics {
  ctx.font = canvasFont(layer);
  (ctx as any).letterSpacing = `${layer.letterSpacing || 0}px`;
  const lines = displayText(layer).split('\n');
  const widths = lines.map((l) => ctx.measureText(l).width);
  const boxW = Math.max(0, ...widths);
  const lh = layer.lineHeight ?? 1;
  const textH = lines.length * layer.fontSize * lh;
  const pad = layer.textEffect === 'background' ? layer.fontSize * BG_PAD : 0;
  return {
    lines,
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
// contorno, sombra y efectos eco/fondo.
export function drawStyledText(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
) {
  const m = measureStyledText(ctx, layer);
  const fontSize = layer.fontSize;
  const lh = layer.lineHeight ?? 1;
  const effect = layer.textEffect ?? 'none';

  ctx.font = canvasFont(layer);
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

  m.lines.forEach((line, i) => {
    let lx = m.pad;
    if (layer.align === 'center') lx += (m.boxW - m.widths[i]) / 2;
    else if (layer.align === 'right') lx += m.boxW - m.widths[i];
    const y = m.pad + i * fontSize * lh;

    // Eco: copias desplazadas detrás del texto principal.
    if (effect === 'echo') {
      const ec = layer.effectColor ?? layer.fill;
      clearShadow();
      ctx.fillStyle = ec;
      for (let s = ECHO_STEPS; s >= 1; s--) {
        const off = s * fontSize * ECHO_STEP;
        ctx.save();
        ctx.globalAlpha = 0.45 * (1 - s / (ECHO_STEPS + 1));
        ctx.fillText(line, lx + off, y + off);
        ctx.restore();
      }
    }

    if (layer.strokeWidth > 0) {
      if (layer.shadow) setShadow();
      else clearShadow();
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layer.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, lx, y);
      clearShadow();
      ctx.fillStyle = layer.fill;
      ctx.fillText(line, lx, y);
    } else {
      if (layer.shadow) setShadow();
      else clearShadow();
      ctx.fillStyle = layer.fill;
      ctx.fillText(line, lx, y);
      clearShadow();
    }
  });
}
