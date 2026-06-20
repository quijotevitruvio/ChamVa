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
  const updateLayer = useEditor((s) => s.updateLayer);

  if (!layer.visible) return null;

  const strokeOnly = isStrokeOnly(layer.shape);

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
      }}
      hitFunc={(ctx, node) => {
        ctx.beginPath();
        ctx.rect(0, 0, layer.width, layer.height);
        ctx.closePath();
        ctx.fillStrokeShape(node);
      }}
      onMouseDown={(e) => clickSelect(layer.id, e.evt.shiftKey)}
      onTap={() => clickSelect(layer.id, false)}
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
