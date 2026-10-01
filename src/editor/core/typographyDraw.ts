// Piezas de dibujo (Canvas 2D) de la tipografía avanzada: desplazamiento de
// superíndices/subíndices, puntos guía de las tabulaciones y capitulares.
// styledText.ts las llama desde pequeños ganchos.
import type { TextLayer } from './types';
import { SCRIPT_DY, SCRIPT_SCALE, runFont, type StyledRun } from './richText';
import type { DropCapInfo } from './typography';

type Paint = string | CanvasGradient;

// Desplazamiento vertical del tramo (sup/sub); 0 si no tiene.
export function runDy(layer: TextLayer, run: StyledRun): number {
  return run.script ? layer.fontSize * SCRIPT_DY[run.script] : 0;
}

// Posición del subrayado respecto al origen de la línea (0,95 del tamaño del tramo).
export function runUnderlineY(layer: TextLayer, run: StyledRun): number {
  const size = run.script ? layer.fontSize * SCRIPT_SCALE : layer.fontSize;
  return runDy(layer, run) + size * 0.95;
}

// Relleno de una tabulación con puntos o guiones, alineado al final de la parada.
export function drawLeader(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  run: StyledRun,
  x: number,
  y: number,
  w: number,
  paint: Paint,
) {
  const ch = run.leader;
  if (!ch || w <= 0) return;
  const unit = ctx.measureText(ch + ' ').width;
  if (unit <= 0) return;
  const n = Math.floor((w - unit * 0.5) / unit);
  if (n <= 0) return;
  ctx.fillStyle = paint;
  const start = x + w - n * unit;
  for (let k = 0; k < n; k++) ctx.fillText(ch, start + k * unit, y + runDy(layer, run));
}

// Capitulares: la primera letra grande a la izquierda del párrafo.
export function drawDropCaps(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  drops: DropCapInfo[],
  pad: number,
  paintFor: (color: string) => Paint,
  setShadow: () => void,
  clearShadow: () => void,
) {
  for (const d of drops) {
    ctx.font = runFont({ ...layer, fontSize: d.fontSize }, d.run);
    const x = pad + d.x;
    const y = pad + d.y;
    if (layer.strokeWidth > 0) {
      if (layer.shadow) setShadow();
      else clearShadow();
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layer.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(d.run.text, x, y);
      clearShadow();
      ctx.fillStyle = paintFor(d.run.color);
      ctx.fillText(d.run.text, x, y);
    } else {
      if (layer.shadow) setShadow();
      else clearShadow();
      ctx.fillStyle = paintFor(d.run.color);
      ctx.fillText(d.run.text, x, y);
      clearShadow();
    }
  }
}
