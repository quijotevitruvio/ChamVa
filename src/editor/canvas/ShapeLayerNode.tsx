import { Shape as KonvaShape } from 'react-konva';
import { canvasGradient, konvaGradientProps } from '../core/gradients';
import { fillCurrentPathConic, isConic } from '../core/conic';
import { fillDither } from '../core/grain';
import type Konva from 'konva';
import type { ShapeLayer } from '../core/types';
import { isStrokeOnly, shapePath } from '../core/shapes';
import { useEffectiveTool } from '../state/toolStore';
import { useEditor } from '../state/store';
import { isLayerLocked } from '../core/pageOps';

interface Props {
  layer: ShapeLayer;
  registerRef: (id: string, node: Konva.Node | null) => void;
}

export function ShapeLayerNode({ layer, registerRef }: Props) {
  const selecting = useEffectiveTool() === 'select'; // con la mano u otra herramienta, las capas no se arrastran
  const clickSelect = useEditor((s) => s.clickSelect);
  const selectLayer = useEditor((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const viewScale = useEditor((s) => s.viewScale);
  const pageLocked = useEditor((s) => !!s.doc.locked);

  if (!layer.visible) return null;

  const strokeOnly = isStrokeOnly(layer.shape);
  const frame = !!layer.frame && !strokeOnly;
  // Relleno cónico, contorno con degradado y tramado: Konva no los tiene, se dibujan sobre el canvas nativo.
  const conicFill = !strokeOnly && isConic(layer.fillGradient);
  const strokeGrad = layer.strokeGradient && (layer.strokeWidth > 0 || strokeOnly) ? layer.strokeGradient : undefined;
  const dither = !strokeOnly && !!layer.fillGradient?.dither;
  const custom = conicFill || !!strokeGrad || dither;

  return (
    <KonvaShape
      ref={(node) => registerRef(layer.id, node)}
      x={layer.x}
      y={layer.y}
      width={layer.width}
      height={layer.height}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      rotation={layer.rotation}
      opacity={layer.opacity}
      fill={strokeOnly ? undefined : conicFill ? layer.fillGradient!.stops[0]?.color ?? layer.fill : layer.fill}
      {...(layer.fillGradient && !strokeOnly && !conicFill ? konvaGradientProps(layer.fillGradient, layer.width, layer.height) : {})}
      stroke={(layer.strokeWidth > 0 || strokeOnly) && !strokeGrad ? layer.stroke : undefined}
      strokeWidth={strokeOnly ? Math.max(2, layer.strokeWidth) : layer.strokeWidth}
      shadowEnabled={layer.shadow}
      shadowColor={layer.shadowColor}
      shadowBlur={layer.shadowBlur}
      shadowOffsetX={layer.shadowX}
      shadowOffsetY={layer.shadowY}
      draggable={selecting && !isLayerLocked({ locked: pageLocked }, layer)}
      globalCompositeOperation={
        layer.blendMode === 'normal' ? undefined : (layer.blendMode as any)
      }
      sceneFunc={(ctx, node) => {
        shapePath(ctx, layer.shape, layer.width, layer.height, layer.cornerRadius);
        if (!custom) ctx.fillStrokeShape(node);
        else {
          const c = (ctx as any)._context as CanvasRenderingContext2D;
          if (conicFill) {
            c.save();
            if (layer.shadow) (ctx as any)._applyShadow(node);
            fillCurrentPathConic(c, layer.fillGradient!, layer.width, layer.height);
            c.restore();
          } else if (!strokeOnly) ctx.fillShape(node);
          if (dither) {
            const k = Math.max(1, viewScale * (window.devicePixelRatio || 1) * Math.max(layer.scaleX, layer.scaleY));
            shapePath(c, layer.shape, layer.width, layer.height, layer.cornerRadius);
            c.save();
            c.clip();
            fillDither(c, layer.width, layer.height, k);
            c.restore();
          }
          if (strokeGrad) {
            shapePath(c, layer.shape, layer.width, layer.height, layer.cornerRadius);
            c.save();
            c.lineWidth = strokeOnly ? Math.max(2, layer.strokeWidth) : layer.strokeWidth;
            c.strokeStyle = canvasGradient(c, strokeGrad, layer.width, layer.height);
            c.stroke();
            c.restore();
          } else ctx.strokeShape(node);
        }
        if (frame) {
          // Solo en el editor: borde discontinuo e indicación de "suelta una foto".
          const c = (ctx as any)._context as CanvasRenderingContext2D;
          const px = 1 / Math.max(0.01, viewScale * Math.max(layer.scaleX, layer.scaleY));
          c.save();
          shapePath(c, layer.shape, layer.width, layer.height, layer.cornerRadius);
          c.setLineDash([8 * px, 6 * px]);
          c.lineWidth = 2 * px;
          c.strokeStyle = '#7b8494';
          c.stroke();
          c.setLineDash([]);
          const fs = Math.min(layer.width, layer.height) * 0.12;
          c.fillStyle = '#6b7280';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.font = `${fs * 1.6}px Arial`;
          c.fillText('🖼', layer.width / 2, layer.height / 2 - fs * 0.6);
          c.font = `${fs * 0.55}px Arial`;
          c.fillText('Suelta una foto aquí', layer.width / 2, layer.height / 2 + fs * 0.9);
          c.restore();
        }
      }}
      hitFunc={(ctx, node) => {
        ctx.beginPath();
        ctx.rect(0, 0, layer.width, layer.height);
        ctx.closePath();
        ctx.fillStrokeShape(node);
      }}
      onMouseDown={(e) => clickSelect(layer.id, e.evt.shiftKey)}
      onTap={() => clickSelect(layer.id, false)}
      onDblClick={() => selectLayer(layer.id)}
      onDblTap={() => selectLayer(layer.id)}
      onDragEnd={(e) =>
        updateLayer(layer.id, { x: e.target.x(), y: e.target.y() })
      }
      onTransformEnd={(e) => {
        const node = e.target;
        updateLayer(layer.id, {
          x: node.x(),
          y: node.y(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY(),
          rotation: node.rotation(),
        });
      }}
    />
  );
}
