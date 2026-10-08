import { useEffect, useMemo, useReducer } from 'react';
import { Shape as KonvaShape } from 'react-konva';
import type Konva from 'konva';
import type { ImageLayer, Layer } from '../core/types';
import { blendOpOrUndefined } from '../core/blend';
import { useRetouchedImage } from './useRetouchedImage';
import { useRenderedImage } from './useRenderedImage';
import { useFxImagesVersion } from './useFxImages';
import { useTextFxImagesVersion } from './useTextFxImages';
import { useEffectiveTool } from '../state/toolStore';
import { useEditor } from '../state/store';
import { isLayerLocked } from '../core/pageOps';
import { defaultFields } from '../core/textMacros';
import { drawGroundFx, hasGroundFx } from '../core/groundFx';
import {
  contentBounds,
  drawImageBody,
  drawMaskedLayer,
  drawShapeBody,
  drawStrokeBody,
  drawTextBody,
  layerLocalBox,
  maskedGroundSource,
  onMaskReady,
} from '../core/maskRender';

// Vista previa de la imagen (igual que ImageLayerNode).
const PREVIEW_MAX = 2048;

interface Props {
  layer: Layer;
  registerRef: (id: string, node: Konva.Node | null) => void;
}

/** Repinta cuando termina de calcularse una máscara (desvanecido grande en el worker). */
function useMaskReady() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onMaskReady(bump), []);
}

// Capa CON máscara (de cualquier tipo): se dibuja con la MISMA función que la exportación
// (maskRender.drawMaskedLayer), así lo que se ve es lo que se exporta. Las capas sin máscara
// siguen con sus nodos de siempre.
export function MaskedLayerNode({ layer, registerRef }: Props) {
  if (layer.type === 'image') return <MaskedImage layer={layer} registerRef={registerRef} />;
  return <MaskedVector layer={layer} registerRef={registerRef} />;
}

function useCommon(layer: Layer, registerRef: Props['registerRef']) {
  const tool = useEffectiveTool();
  const selecting = tool === 'select';
  const clickSelect = useEditor((s) => s.clickSelect);
  const selectLayer = useEditor((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const requestTextEdit = useEditor((s) => s.requestTextEdit);
  const locked = useEditor((s) => isLayerLocked(s.doc, layer));
  const editing = useEditor((s) => s.editingTextId === layer.id);
  const overlay = useEditor((s) => s.maskView && s.maskEditId === layer.id);
  return {
    overlay,
    props: {
      ref: (node: Konva.Node | null) => registerRef(layer.id, node),
      x: layer.x,
      y: layer.y,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      rotation: layer.rotation,
      opacity: editing ? 0 : layer.opacity,
      listening: layer.type !== 'stroke' || selecting,
      draggable: selecting && !locked && !editing,
      globalCompositeOperation: blendOpOrUndefined(layer.blendMode),
      onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => clickSelect(layer.id, e.evt.shiftKey),
      onTap: () => clickSelect(layer.id, false),
      onDblClick: () => (layer.type === 'text' ? !locked && requestTextEdit(layer.id) : selectLayer(layer.id)),
      onDblTap: () => (layer.type === 'text' ? !locked && requestTextEdit(layer.id) : selectLayer(layer.id)),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => updateLayer(layer.id, { x: e.target.x(), y: e.target.y() }),
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
        const node = e.target;
        updateLayer(layer.id, { x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() });
      },
    },
  };
}

const flip = (l: Layer) => ({ x: Math.sign(l.scaleX) || 1, y: Math.sign(l.scaleY) || 1 });

function MaskedImage({ layer, registerRef }: { layer: ImageLayer; registerRef: Props['registerRef'] }) {
  useMaskReady();
  const { image, rev: retouchRev } = useRetouchedImage(layer);
  const fxVersion = useFxImagesVersion(layer.adjust);
  const rendered = useRenderedImage(image, layer, PREVIEW_MAX, [
    image,
    layer.adjust,
    layer.filter,
    layer.flipX,
    layer.flipY,
    layer.naturalWidth,
    layer.naturalHeight,
    layer.crop,
    fxVersion,
    retouchRev,
  ]);
  const cropping = useEditor((s) => s.cropMode && s.selectedId === layer.id);
  const { props, overlay } = useCommon(layer, registerRef);
  if (!rendered || !layer.visible || cropping || !layer.mask) return null;
  const w = layer.naturalWidth;
  const h = layer.naturalHeight;
  const mask = layer.mask;
  return (
    <KonvaShape
      {...props}
      width={w}
      height={h}
      sceneFunc={(ctx) => {
        const c = (ctx as any)._context as CanvasRenderingContext2D;
        if (hasGroundFx(layer)) {
          // Reflejo y sombra proyectada de lo VISIBLE (imagen ya enmascarada).
          const gsrc = maskedGroundSource(rendered, w, h, layer.maskShape, mask, { layerId: layer.id, maxSide: PREVIEW_MAX });
          if (gsrc) drawGroundFx(c, gsrc, w, h, undefined, layer);
        }
        drawMaskedLayer(c, {
          mask,
          layerId: layer.id,
          bounds: contentBounds(layer),
          shadow: layer,
          flipSign: flip(layer),
          overlay,
          body: (b) => drawImageBody(b, rendered, w, h, layer.maskShape),
        });
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

function MaskedVector({ layer, registerRef }: Props) {
  useMaskReady();
  useTextFxImagesVersion(layer.type === 'text' ? layer : ({ type: 'shape' } as never));
  const viewScale = useEditor((s) => s.viewScale);
  const pageNo = useEditor((s) => s.pageIndex + 1);
  const pageTotal = useEditor((s) => s.pages.length);
  const docName = useEditor((s) => s.doc.name);
  const fields = useMemo(() => defaultFields({ pagina: String(pageNo), total: String(pageTotal), diseno: docName }), [pageNo, pageTotal, docName]);
  const { props, overlay } = useCommon(layer, registerRef);
  if (!layer.visible || !layer.mask || layer.type === 'image') return null;
  const box = layerLocalBox(layer, fields);
  const bounds = contentBounds(layer, fields);
  const mask = layer.mask;
  const L = layer;
  return (
    <KonvaShape
      {...props}
      width={box.w}
      height={box.h}
      sceneFunc={(ctx) => {
        const c = (ctx as any)._context as CanvasRenderingContext2D;
        const k = Math.max(1, viewScale * (window.devicePixelRatio || 1) * Math.max(Math.abs(L.scaleX), Math.abs(L.scaleY)));
        drawMaskedLayer(c, {
          mask,
          layerId: L.id,
          bounds,
          shadow: L.type === 'shape' ? L : undefined,
          flipSign: flip(L),
          overlay,
          body: (b) => {
            if (L.type === 'shape') drawShapeBody(b, L, k);
            else if (L.type === 'text') drawTextBody(b, L, fields);
            else if (L.type === 'stroke') drawStrokeBody(b, L);
          },
        });
      }}
      hitFunc={(ctx, node) => {
        ctx.beginPath();
        ctx.rect(0, 0, box.w, box.h);
        ctx.closePath();
        ctx.fillStrokeShape(node);
      }}
    />
  );
}
