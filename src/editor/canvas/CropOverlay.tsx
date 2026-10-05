import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Group, Rect, Shape, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useEditor } from '../state/store';
import { useImage } from './useImage';
import { needsProcessing, processImage } from '../core/imageProcessing';
import { clampBox, displayBox, fitAspect, fullSize, moveInside, type Box } from '../core/imageCrop';
import type { ImageLayer } from '../core/types';

const PREVIEW_MAX = 2048;

// Editor de recorte sobre el lienzo. Trabaja en el marco LOCAL de la capa (un Group con su misma
// posición, giro y escala): el rectángulo gira y escala con ella, así que el recorte de una capa
// girada es exactamente la región que se ve. Muestra la imagen COMPLETA (atenuada fuera del
// recorte) para poder ampliar o restablecer sin pérdida.
export function CropOverlay({ rectRef, scale }: { rectRef: RefObject<Konva.Rect | null>; scale: number }) {
  const layer = useEditor((s) => {
    const l = s.doc.layers.find((x) => x.id === s.selectedId);
    return l && l.type === 'image' ? l : null;
  });
  const cropRect = useEditor((s) => s.cropRect);
  const cropAspect = useEditor((s) => s.cropAspect);
  const setCropRect = useEditor((s) => s.setCropRect);
  const trRef = useRef<Konva.Transformer>(null);
  const image = useImage(layer?.src ?? '');

  // Imagen completa con sus ajustes y volteo (vista previa reducida), sin recorte.
  const full = useMemo<CanvasImageSource | null>(() => {
    if (!image || !layer) return null;
    const f = fullSize(layer);
    const whole: ImageLayer = { ...layer, crop: undefined, naturalWidth: f.w, naturalHeight: f.h };
    return needsProcessing(whole) ? processImage(image, whole, PREVIEW_MAX) : image;
    // Solo al abrir el recorte (la capa no cambia durante la sesión).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, layer?.id]);

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    tr.nodes(rectRef.current ? [rectRef.current] : []);
    tr.getLayer()?.batchDraw();
  }, [cropRect, rectRef, full]);

  if (!layer || !cropRect || !full) return null;
  const size = fullSize(layer);
  const origin = displayBox(layer); // el origen local de la capa es la esquina del recorte actual
  const ax = Math.abs(layer.scaleX) || 1;
  const toBox = (n: Konva.Node, w: number, h: number): Box => ({ x: n.x(), y: n.y(), w, h });
  const commit = (b: Box) => setCropRect({ x: b.x, y: b.y, width: b.w, height: b.h });

  return (
    <>
      <Group
        x={layer.x}
        y={layer.y}
        rotation={layer.rotation}
        scaleX={layer.scaleX}
        scaleY={layer.scaleY}
        offsetX={origin.x}
        offsetY={origin.y}
      >
        <Shape
          listening={false}
          sceneFunc={(ctx) => {
            const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
            const r = cropRect;
            // Fuera del recorte: imagen atenuada y velo (lo que se descartará, recuperable).
            c.save();
            c.beginPath();
            c.rect(0, 0, size.w, size.h);
            c.rect(r.x, r.y, r.width, r.height);
            c.clip('evenodd');
            c.globalAlpha = 0.4;
            c.drawImage(full, 0, 0, size.w, size.h);
            c.globalAlpha = 1;
            c.fillStyle = 'rgba(0,0,0,0.35)';
            c.fillRect(0, 0, size.w, size.h);
            c.restore();
            // Dentro: la región que quedará, nítida.
            c.save();
            c.beginPath();
            c.rect(r.x, r.y, r.width, r.height);
            c.clip();
            c.drawImage(full, 0, 0, size.w, size.h);
            c.restore();
          }}
        />
        <Rect
          ref={rectRef as RefObject<Konva.Rect>}
          name="crop-rect"
          x={cropRect.x}
          y={cropRect.y}
          width={cropRect.width}
          height={cropRect.height}
          fill="rgba(0,0,0,0.001)"
          stroke="#ffffff"
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={[8 / (scale * ax), 6 / (scale * ax)]}
          shadowColor="#000000"
          shadowBlur={2}
          draggable
          onDragMove={(e) => {
            const n = e.target;
            const b = moveInside(toBox(n, cropRect.width, cropRect.height), size);
            n.x(b.x);
            n.y(b.y);
          }}
          onDragEnd={(e) => commit(moveInside(toBox(e.target, cropRect.width, cropRect.height), size))}
          onTransformEnd={() => {
            const n = rectRef.current;
            if (!n) return;
            const w = n.width() * n.scaleX();
            const h = n.height() * n.scaleY();
            n.scaleX(1);
            n.scaleY(1);
            let b = clampBox(toBox(n, w, h), size) ?? { x: cropRect.x, y: cropRect.y, w: cropRect.width, h: cropRect.height };
            if (cropAspect) b = fitAspect(b, cropAspect, layer.scaleX, layer.scaleY, size);
            n.position({ x: b.x, y: b.y });
            n.size({ width: b.w, height: b.h });
            commit(b);
          }}
        />
      </Group>
      <Transformer
        ref={trRef}
        rotateEnabled={false}
        flipEnabled={false}
        keepRatio={!!cropAspect}
        enabledAnchors={
          cropAspect
            ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
            : undefined
        }
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
      />
    </>
  );
}
