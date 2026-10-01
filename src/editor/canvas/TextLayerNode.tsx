import { useMemo } from 'react';
import { Text as KonvaText, Shape as KonvaShape } from 'react-konva';
import type Konva from 'konva';
import { konvaFontStyle, displayText, type TextLayer } from '../core/types';
import { drawCurvedText, measureCurved } from '../core/curvedText';
import { drawStyledText, measureStyledText } from '../core/styledText';
import { hasSpans } from '../core/richText';
import { usesTypography, typographyKey } from '../core/typography';
import { defaultFields } from '../core/textMacros';
import { hasPathText, hasTextFx } from '../core/textFx';
import { useTextFxImagesVersion } from './useTextFxImages';
import { useEditor } from '../state/store';

interface Props {
  layer: TextLayer;
  registerRef: (id: string, node: Konva.Node | null) => void;
  onDragEndLayer?: (id: string, node: Konva.Node) => void;
}

const measureCtx = document.createElement('canvas').getContext('2d')!;

export function TextLayerNode({ layer, registerRef }: Props) {
  const clickSelect = useEditor((s) => s.clickSelect);
  const updateLayer = useEditor((s) => s.updateLayer);
  const requestTextEdit = useEditor((s) => s.requestTextEdit);
  const editing = useEditor((s) => s.editingTextId === layer.id);
  // Valores de los campos dinámicos ({{pagina}}, {{total}}, {{diseno}}…).
  const pageNo = useEditor((s) => s.pageIndex + 1);
  const pageTotal = useEditor((s) => s.pages.length);
  const docName = useEditor((s) => s.doc.name);

  useTextFxImagesVersion(layer); // relleno con imagen: redibuja al decodificarse
  const curved = (!!layer.curve && layer.curve !== 0) || hasPathText(layer);
  // El dibujo propio (KonvaShape) cubre efectos, subrayado y estilo por palabra;
  // el Konva.Text nativo queda para el caso simple (más rápido).
  const custom =
    (!!layer.textEffect && layer.textEffect !== 'none') || hasSpans(layer) || !!layer.underline || !!layer.fillGradient || usesTypography(layer) || hasTextFx(layer);
  const metrics = useMemo(
    () => measureCurved(measureCtx, layer),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer.text, layer.fontFamily, layer.fontSize, layer.curve, layer.pathText, layer.bold, layer.italic, layer.letterSpacing, layer.textTransform, layer.spans],
  );
  const fields = useMemo(
    () => defaultFields({ pagina: String(pageNo), total: String(pageTotal), diseno: docName }),
    [pageNo, pageTotal, docName],
  );
  const tKey = typographyKey(layer);
  const styledMetrics = useMemo(
    () => measureStyledText(measureCtx, layer, fields),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer.text, layer.fontFamily, layer.fontSize, layer.bold, layer.italic, layer.letterSpacing, layer.textTransform, layer.lineHeight, layer.textEffect, layer.listStyle, layer.spans, tKey, fields],
  );

  if (!layer.visible) return null;

  const common = {
    ref: (node: Konva.Node | null) => registerRef(layer.id, node),
    x: layer.x,
    y: layer.y,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    rotation: layer.rotation,
    // Mientras se edita encima del lienzo, el editor HTML ocupa su lugar.
    opacity: editing ? 0 : layer.opacity,
    draggable: !layer.locked && !editing,
    globalCompositeOperation:
      layer.blendMode === 'normal' ? undefined : (layer.blendMode as any),
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) =>
      clickSelect(layer.id, e.evt.shiftKey),
    onTap: () => clickSelect(layer.id, false),
    onDblClick: () => !layer.locked && requestTextEdit(layer.id),
    onDblTap: () => !layer.locked && requestTextEdit(layer.id),
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
          drawCurvedText((ctx as any)._context, layer, metrics.width, metrics.height);
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

  if (custom) {
    return (
      <KonvaShape
        {...common}
        width={styledMetrics.width}
        height={styledMetrics.height}
        sceneFunc={(ctx) => {
          drawStyledText((ctx as any)._context, layer, fields);
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
