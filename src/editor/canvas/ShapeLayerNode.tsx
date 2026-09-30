import { Shape as KonvaShape } from 'react-konva';
import type Konva from 'konva';
import type { ShapeLayer } from '../core/types';
import { isStrokeOnly, shapePath } from '../core/shapes';
import { useEditor } from '../state/store';

interface Props {
  layer: ShapeLayer;
  registerRef: (id: string, node: Konva.Node | null) => void;
}

export function ShapeLayerNode({ layer, registerRef }: Props) {
  const clickSelect = useEditor((s) => s.clickSelect);
  const selectLayer = useEditor((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const viewScale = useEditor((s) => s.viewScale);

  if (!layer.visible) return null;

  const strokeOnly = isStrokeOnly(layer.shape);
  const frame = !!layer.frame && !strokeOnly;

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
      fill={strokeOnly ? undefined : layer.fill}
      stroke={layer.strokeWidth > 0 || strokeOnly ? layer.stroke : undefined}
      strokeWidth={strokeOnly ? Math.max(2, layer.strokeWidth) : layer.strokeWidth}
      shadowEnabled={layer.shadow}
      shadowColor={layer.shadowColor}
      shadowBlur={layer.shadowBlur}
      shadowOffsetX={layer.shadowX}
      shadowOffsetY={layer.shadowY}
      draggable={!layer.locked}
      globalCompositeOperation={
        layer.blendMode === 'normal' ? undefined : (layer.blendMode as any)
      }
      sceneFunc={(ctx, node) => {
        shapePath(ctx, layer.shape, layer.width, layer.height, layer.cornerRadius);
        ctx.fillStrokeShape(node);
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
