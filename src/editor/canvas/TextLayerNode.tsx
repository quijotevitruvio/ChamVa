import { useMemo } from 'react';
import { Text as KonvaText, Shape as KonvaShape } from 'react-konva';
import type Konva from 'konva';
import { konvaFontStyle, displayText, type TextLayer } from '../core/types';
import { drawCurvedText, measureCurved } from '../core/curvedText';
import { drawStyledText, measureStyledText } from '../core/styledText';
import { useEditor } from '../state/store';

interface Props {
  layer: TextLayer;
  registerRef: (id: string, node: Konva.Node | null) => void;
}

const measureCtx = document.createElement('canvas').getContext('2d')!;

export function TextLayerNode({ layer, registerRef }: Props) {
  const clickSelect = useEditor((s) => s.clickSelect);
  const updateLayer = useEditor((s) => s.updateLayer);
  const requestTextEdit = useEditor((s) => s.requestTextEdit);

  const curved = !!layer.curve && layer.curve !== 0;
  const hasEffect = !!layer.textEffect && layer.textEffect !== 'none';
  const metrics = useMemo(
    () => measureCurved(measureCtx, layer),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer.text, layer.fontFamily, layer.fontSize, layer.curve, layer.bold, layer.italic, layer.letterSpacing, layer.textTransform],
  );
  const styledMetrics = useMemo(
    () => measureStyledText(measureCtx, layer),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer.text, layer.fontFamily, layer.fontSize, layer.bold, layer.italic, layer.letterSpacing, layer.textTransform, layer.lineHeight, layer.textEffect, layer.listStyle],
  );

  if (!layer.visible) return null;

  const common = {
    ref: (node: Konva.Node | null) => registerRef(layer.id, node),
    x: layer.x,
    y: layer.y,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    rotation: layer.rotation,
    opacity: layer.opacity,
    draggable: !layer.locked,
    globalCompositeOperation:
      layer.blendMode === 'normal' ? undefined : (layer.blendMode as any),
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) =>
      clickSelect(layer.id, e.evt.shiftKey),
    onTap: () => clickSelect(layer.id, false),
    onDblClick: () => requestTextEdit(layer.id),
    onDblTap: () => requestTextEdit(layer.id),
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

  if (curved) {
    return (
      <KonvaShape
        {...common}
        width={metrics.width}
        height={metrics.height}
        sceneFunc={(ctx) => {
          drawCurvedText((ctx as any)._context, layer, metrics.width);
        }}
        hitFunc={(ctx, node) => {
          ctx.beginPath();
          ctx.rect(0, 0, metrics.width, metrics.height);
          ctx.closePath();
          ctx.fillStrokeShape(node);
        }}
      />
    );
  }

  if (hasEffect) {
    return (
      <KonvaShape
        {...common}
        width={styledMetrics.width}
        height={styledMetrics.height}
        sceneFunc={(ctx) => {
          drawStyledText((ctx as any)._context, layer);
        }}
        hitFunc={(ctx, node) => {
          ctx.beginPath();
          ctx.rect(0, 0, styledMetrics.width, styledMetrics.height);
          ctx.closePath();
          ctx.fillStrokeShape(node);
        }}
      />
    );
  }

  return (
    <KonvaText
      {...common}
      text={displayText(layer)}
      fontFamily={layer.fontFamily}
      fontSize={layer.fontSize}
      fontStyle={konvaFontStyle(layer.bold, layer.italic)}
      fill={layer.fill}
      align={layer.align}
      letterSpacing={layer.letterSpacing}
      stroke={layer.strokeWidth > 0 ? layer.strokeColor : undefined}
      strokeWidth={layer.strokeWidth}
      fillAfterStrokeEnabled
      shadowEnabled={layer.shadow}
      shadowColor={layer.shadowColor}
      shadowBlur={layer.shadowBlur}
      shadowOffsetX={layer.shadowX}
      shadowOffsetY={layer.shadowY}
      lineHeight={layer.lineHeight ?? 1}
    />
  );
}
