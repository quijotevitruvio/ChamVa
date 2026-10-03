// Aplicación de la pila de efectos a una capa (lienzo). Los efectos de píxel (color, desenfoques, croma…) se calculan
// en CPU sobre un único ImageData que se lee una vez y se escribe una vez por tramo; los de forma (máscara, borde,
// sombra) usan operaciones de lienzo. Es la ruta base: no depende de la GPU, así vista previa y exportación dan lo mismo.
import type { FxInstance } from '../model/types';
import { activeFx, effectiveParams } from './effects';
import { hexToRgb, PixelPipe, runPixelList, type Px } from './pixel';
import { getScratch, type Ctx2, type Scratch } from './scratch';

/** Rectángulo (px) que ocupa el clip dibujado: las máscaras y bordes se miden sobre él. */
export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface FxEnv {
  w: number;
  h: number;
  box: Box;
  /** semilla que cambia con el fotograma (grano, glitch, VHS animados) */
  seed: number;
}

export type MaskShape = 'rect' | 'rounded' | 'circle' | 'heart' | 'star';

/** Traza el contorno de una máscara sobre `box` (centrado). `size` 0,1–1,5 relativo; `round` radio de esquina relativo. */
export function traceMask(ctx: Pick<Ctx2, 'beginPath' | 'moveTo' | 'lineTo' | 'arc' | 'closePath' | 'bezierCurveTo' | 'arcTo' | 'ellipse'>, shape: MaskShape, box: Box, size: number, round: number) {
  const { cx, cy } = box;
  const side = Math.min(box.w, box.h) * size;
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(cx, cy, side / 2, 0, Math.PI * 2);
  } else if (shape === 'heart') {
    const r = side / 2;
    const P = (x: number, y: number): [number, number] => [cx + x * r, cy + y * r - 0.05 * r];
    ctx.moveTo(...P(0, 0.9));
    ctx.bezierCurveTo(...P(-0.2, 0.7), ...P(-1, 0.2), ...P(-1, -0.35));
    ctx.bezierCurveTo(...P(-1, -0.85), ...P(-0.2, -0.95), ...P(0, -0.35));
    ctx.bezierCurveTo(...P(0.2, -0.95), ...P(1, -0.85), ...P(1, -0.35));
    ctx.bezierCurveTo(...P(1, 0.2), ...P(0.2, 0.7), ...P(0, 0.9));
    ctx.closePath();
  } else if (shape === 'star') {
    const R = side / 2;
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? R : R * 0.42;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    const w = box.w * size;
    const h = box.h * size;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const r = shape === 'rounded' ? Math.min(w, h) * Math.max(0, Math.min(0.5, round)) : 0;
    if (r <= 0.01) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }
}

/** Efectos que se resuelven con operaciones de lienzo (no de píxel). */
export const CANVAS_FX = new Set(['mask', 'border', 'shadow']);

/**
 * Aplica en orden solo los efectos de PÍXEL de la pila sobre un ImageData (los de lienzo se saltan). Es lo mismo que
 * hace `applyFxStack` con ellos; se expone para probar el orden y los parámetros sin lienzo.
 */
export function runPixelStack(img: Px, list: readonly FxInstance[], seed: number, scale = 1): void {
  runPixelList(img, list, seed, scale, CANVAS_FX);
}

/** Aplica la pila de efectos al lienzo `layer` (modifica su contenido). `list` ya filtrada por activos y con los fotogramas aplicados. */
export function applyFxStack(layer: Scratch, list: readonly FxInstance[], env: FxEnv): void {
  const active = activeFx(list);
  if (!active.length) return;
  const { ctx } = layer;
  const { w, h } = env;
  const scale = Math.min(w, h) / 720;
  let img: ImageData | null = null;
  let pipe: PixelPipe | null = null;
  /** Escribe los píxeles pendientes (y la tabla fusionada) en el lienzo, antes de una operación de lienzo o al final. */
  const flush = () => {
    if (img) {
      pipe?.flush();
      ctx.putImageData(img, 0, 0);
      img = null;
      pipe = null;
    }
  };
  let shape: { shape: MaskShape; size: number; round: number } | null = null;
  for (const fx of active) {
    const q = effectiveParams(fx);
    switch (fx.type) {
      case 'mask': {
        flush();
        const s = String(q.shape) as MaskShape;
        shape = { shape: s, size: q.size as number, round: q.round as number };
        ctx.save();
        ctx.globalCompositeOperation = 'destination-in';
        traceMask(ctx, s, env.box, shape.size, shape.round);
        ctx.fillStyle = '#000';
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'border': {
        const bw = (q.w as number) * scale;
        if (bw < 0.4) break;
        flush();
        ctx.save();
        // el contorno va por dentro de la forma: se recorta a ella y se traza al doble
        if (shape) traceMask(ctx, shape.shape, env.box, shape.size, shape.round);
        else traceMask(ctx, 'rect', env.box, 1, 0);
        ctx.clip();
        ctx.lineWidth = bw * 2;
        ctx.strokeStyle = typeof q.color === 'string' ? q.color : '#ffffff';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'shadow': {
        flush();
        const tmp = getScratch('fx-shadow', w, h);
        tmp.ctx.drawImage(layer.canvas as CanvasImageSource, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const [r, g, b] = hexToRgb(q.color, [0, 0, 0]);
        ctx.save();
        ctx.shadowColor = `rgba(${r},${g},${b},0.65)`;
        ctx.shadowBlur = (q.blur as number) * scale;
        ctx.shadowOffsetX = (q.dx as number) * scale;
        ctx.shadowOffsetY = (q.dy as number) * scale;
        ctx.drawImage(tmp.canvas as CanvasImageSource, 0, 0);
        ctx.restore();
        break;
      }
      default: {
        img ??= ctx.getImageData(0, 0, w, h);
        pipe ??= new PixelPipe(img, { seed: env.seed, scale });
        pipe.apply(fx);
      }
    }
  }
  flush();
}
