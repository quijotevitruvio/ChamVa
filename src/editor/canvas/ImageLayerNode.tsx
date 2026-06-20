import { useMemo } from 'react';
import { Image as KonvaImage, Shape as KonvaShape } from 'react-konva';
import type Konva from 'konva';
import type { ImageLayer } from '../core/types';
import { useImage } from './useImage';
import { useEditor } from '../state/store';
import { needsProcessing, processImage } from '../core/imageProcessing';
import { shapePath } from '../core/shapes';

// Resolución máxima de la vista previa del editor (la exportación usa resolución completa).
const PREVIEW_MAX = 2048;

interface Props {
  layer: ImageLayer;
  registerRef: (id: string, node: Konva.Node | null) => void;
}

export function ImageLayerNode({ layer, registerRef }: Props) {
  const image = useImage(layer.src);
  const clickSelect = useEditor((s) => s.clickSelect);
  const updateLayer = useEditor((s) => s.updateLayer);

  // Imagen con filtros/volteo aplicados (se recalcula solo si cambian esos campos).
  const rendered = useMemo<CanvasImageSource | null>(() => {
    if (!image) return null;
    if (!needsProcessing(layer)) return image;
    return processImage(image, layer, PREVIEW_MAX);
  }, [
    image,
    layer.adjust,
    layer.filter,
    layer.flipX,
    layer.flipY,
    layer.naturalWidth,
    layer.naturalHeight,
  ]);

  if (!rendered || !layer.visible) return null;

  const w = layer.naturalWidth;
  const h = layer.naturalHeight;
  const common = {
    ref: (node: Konva.Node | null) => registerRef(layer.id, node),
    x: layer.x,
    y: layer.y,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    rotation: layer.rotation,
    opacity: layer.opacity,
    shadowEnabled: layer.shadow,
    shadowColor: layer.shadowColor,
    shadowBlur: layer.shadowBlur,
    shadowOffsetX: layer.shadowX,
    shadowOffsetY: layer.shadowY,
    draggable: !layer.locked,
    globalCompositeOperation:
      layer.blendMode === 'normal' ? undefined : (layer.blendMode as any),
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) =>
      clickSelect(layer.id, e.evt.shiftKey),
    onTap: () => clickSelect(layer.id, false),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
      updateLayer(layer.id, { x: e.target.x(), y: e.target.y() }),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      updateLayer(layer.id, {
        x: node.x(),
        y: node.y(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation(),
      });
    },
  };

  // Con máscara: recorta la imagen a una forma (marco).
  if (layer.maskShape) {
    return (
      <KonvaShape
        {...common}
        width={w}
        height={h}
        sceneFunc={(ctx) => {
          const c = (ctx as any)._context as CanvasRenderingContext2D;
          c.save();
          shapePath(c, layer.maskShape!, w, h, 0);
          c.clip();
          c.drawImage(rendered, 0, 0, w, h);
          c.restore();
        }}
        hitFunc={(ctx, node) => {
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.closePath();
          ctx.fillStrokeShape(node);
        }}
      />
    );
  }

  return (
    <KonvaImage {...common} image={rendered} width={w} height={h} />
  );
}
