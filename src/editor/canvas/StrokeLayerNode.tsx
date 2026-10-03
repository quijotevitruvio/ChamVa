import { useMemo } from 'react';
import { Shape as KonvaShape } from 'react-konva';
import type Konva from 'konva';
import type { StrokeLayer } from '../core/types';
import { drawStroke, strokePrims } from '../core/brush';
import { useEditor } from '../state/store';
import { isLayerLocked } from '../core/pageOps';
import { useBrush } from '../state/brushStore';

interface Props {
  layer: StrokeLayer;
  registerRef: (id: string, node: Konva.Node | null) => void;
}

// Trazo a mano alzada: se dibuja con la MISMA función que la exportación (brush.ts).
export function StrokeLayerNode({ layer, registerRef }: Props) {
  const clickSelect = useEditor((s) => s.clickSelect);
  const selectLayer = useEditor((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const pageLocked = useEditor((s) => !!s.doc.locked);
  const drawing = useBrush((s) => s.active); // con el pincel activo, las capas no se agarran
  // La geometría solo se recalcula si cambian los puntos o el estilo (no al mover/escalar).
  const prims = useMemo(
    () => strokePrims(layer),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer.pts, layer.brush, layer.size, layer.seed],
  );

  if (!layer.visible) return null;

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
      fill="#000" // solo para que Konva dibuje la zona de clic; el trazo se pinta en sceneFunc
      listening={!drawing}
      draggable={!drawing && !isLayerLocked({ locked: pageLocked }, layer)}
      globalCompositeOperation={layer.blendMode === 'normal' ? undefined : (layer.blendMode as any)}
      sceneFunc={(ctx) => {
        const c = (ctx as any)._context as CanvasRenderingContext2D;
        drawStroke(c, layer, prims);
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
      onDragEnd={(e) => updateLayer(layer.id, { x: e.target.x(), y: e.target.y() })}
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
