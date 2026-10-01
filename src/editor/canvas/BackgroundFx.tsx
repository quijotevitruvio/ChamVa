import { useMemo } from 'react';
import { Rect, Shape } from 'react-konva';
import { useEditor } from '../state/store';
import { canvasGradient, konvaGradientProps } from '../core/gradients';
import { fillCurrentPathConic, isConic } from '../core/conic';
import { fillDither, renderGrainTile } from '../core/grain';
import type { BgGrain, Gradient } from '../core/types';

// Fondos que Konva no sabe dibujar solo: degradado cónico, degradado con tramado
// (dither) y capa de grano. Misma lógica que la exportación (grain.ts / conic.ts).

const useK = () => {
  const viewScale = useEditor((s) => s.viewScale);
  return Math.min(4, Math.max(1, Math.ceil(viewScale * (window.devicePixelRatio || 1))));
};

export function GradientBg({ g, w, h }: { g: Gradient; w: number; h: number }) {
  const k = useK();
  if (!isConic(g) && !g.dither) return <Rect width={w} height={h} {...konvaGradientProps(g, w, h)} />;
  return (
    <Shape
      width={w}
      height={h}
      sceneFunc={(ctx) => {
        const c = (ctx as any)._context as CanvasRenderingContext2D;
        c.beginPath();
        c.rect(0, 0, w, h);
        c.save();
        if (isConic(g)) fillCurrentPathConic(c, g, w, h);
        else {
          c.fillStyle = canvasGradient(c, g, w, h);
          c.fill();
        }
        c.restore();
        if (g.dither) fillDither(c, w, h, k);
      }}
    />
  );
}

export function GrainBg({ grain, w, h }: { grain: BgGrain; w: number; h: number }) {
  const k = useK();
  const tile = useMemo(
    () => renderGrainTile(grain, k),
    [grain.amount, grain.size, k], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (grain.amount <= 0) return null;
  return (
    <Rect
      width={w}
      height={h}
      fillPatternImage={tile.canvas as unknown as HTMLImageElement}
      fillPatternRepeat="repeat"
      fillPatternScale={{ x: tile.ps, y: tile.ps }}
    />
  );
}
