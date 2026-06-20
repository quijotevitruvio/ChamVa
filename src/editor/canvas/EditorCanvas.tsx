import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Stage,
  Layer,
  Rect,
  Transformer,
  Line,
  Label,
  Tag,
  Text,
} from 'react-konva';
import type Konva from 'konva';
import { useEditor } from '../state/store';
import { gradientPoints } from '../core/types';
import { animTotalFor, layerAnimAt } from '../core/animations';
import { getCheckerboard } from './useImage';
import { ImageLayerNode } from './ImageLayerNode';
import { TextLayerNode } from './TextLayerNode';
import { ShapeLayerNode } from './ShapeLayerNode';

export function EditorCanvas() {
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectLayer = useEditor((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const cropMode = useEditor((s) => s.cropMode);
  const cropRect = useEditor((s) => s.cropRect);
  const cropAspect = useEditor((s) => s.cropAspect);
  const setCropRect = useEditor((s) => s.setCropRect);
  const setSelRect = useEditor((s) => s.setSelRect);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const setViewScale = useEditor((s) => s.setViewScale);
  const animPlayNonce = useEditor((s) => s.animPlayNonce);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const cropRectRef = useRef<Konva.Rect>(null);
  const cropTrRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const [scale, setScale] = useState(1);
  const [checker] = useState(() => getCheckerboard());
  const [guides, setGuides] = useState<{ vx: number[]; hy: number[] }>({
    vx: [],
    hy: [],
  });
  // Guías de distancia: separación (px) a la capa/borde más cercano por lado.
  const [dists, setDists] = useState<
    { points: number[]; label: string; tx: number; ty: number }[]
  >([]);

  // Arrastre de varias capas a la vez (selección múltiple).
  const groupDrag = useRef<{
    startX: number;
    startY: number;
    others: { id: string; node: Konva.Node; x: number; y: number }[];
  } | null>(null);

  const findLayerId = (node: Konva.Node): string | null => {
    for (const [id, n] of nodeRefs.current) if (n === node) return id;
    return null;
  };

  const onStageDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Node;
    const id = findLayerId(node);
    if (id && selectedIds.length > 1 && selectedIds.includes(id)) {
      groupDrag.current = {
        startX: node.x(),
        startY: node.y(),
        others: selectedIds
          .filter((x) => x !== id)
          .map((x) => {
            const n = nodeRefs.current.get(x);
            return n ? { id: x, node: n, x: n.x(), y: n.y() } : null;
          })
          .filter((o): o is NonNullable<typeof o> => !!o),
      };
    }
  };

  // Imanta la capa arrastrada al centro/bordes del lienzo y muestra guías.
  const onStageDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const stage = stageRef.current;
    const node = e.target as Konva.Node;
    if (!stage || node === stage || node === cropRectRef.current) {
      updateSelRect();
      return;
    }
    // Si es arrastre de grupo, mover las demás capas con el mismo desplazamiento.
    if (groupDrag.current) {
      const dx = node.x() - groupDrag.current.startX;
      const dy = node.y() - groupDrag.current.startY;
      groupDrag.current.others.forEach((o) => {
        o.node.x(o.x + dx);
        o.node.y(o.y + dy);
      });
      setDists([]);
      updateSelRect();
      return;
    }
    const box = node.getClientRect({ relativeTo: stage });
    const thr = 6 / scale;
    const vx: number[] = [];
    const hy: number[] = [];
    // Objetivos: bordes/centro del lienzo + bordes/centro de las demás capas.
    const tX = [0, doc.width / 2, doc.width];
    const tY = [0, doc.height / 2, doc.height];
    nodeRefs.current.forEach((other) => {
      if (other === node) return;
      const b = other.getClientRect({ relativeTo: stage });
      tX.push(b.x, b.x + b.width / 2, b.x + b.width);
      tY.push(b.y, b.y + b.height / 2, b.y + b.height);
    });
    const edgesX = [box.x, box.x + box.width / 2, box.x + box.width];
    outerX: for (const p of tX)
      for (const edge of edgesX)
        if (Math.abs(p - edge) < thr) {
          node.x(node.x() + (p - edge));
          vx.push(p);
          break outerX;
        }
    const edgesY = [box.y, box.y + box.height / 2, box.y + box.height];
    outerY: for (const p of tY)
      for (const edge of edgesY)
        if (Math.abs(p - edge) < thr) {
          node.y(node.y() + (p - edge));
          hy.push(p);
          break outerY;
        }
    setGuides({ vx, hy });
    setDists(computeDistances(node));
    updateSelRect();
  };

  // Calcula la separación (px) entre la capa arrastrada y la vecina/borde más
  // cercano por cada lado (sólo vecinas que se solapan en el eje perpendicular).
  const computeDistances = (node: Konva.Node) => {
    const stage = stageRef.current;
    if (!stage) return [];
    const box = node.getClientRect({ relativeTo: stage });
    const cx0 = box.x;
    const cx1 = box.x + box.width;
    const cy0 = box.y;
    const cy1 = box.y + box.height;
    const others: { x: number; y: number; width: number; height: number }[] =
      [];
    nodeRefs.current.forEach((other) => {
      if (other !== node)
        others.push(other.getClientRect({ relativeTo: stage }));
    });
    const vOverlap = (b: (typeof others)[number]) =>
      cy0 < b.y + b.height && cy1 > b.y;
    const hOverlap = (b: (typeof others)[number]) =>
      cx0 < b.x + b.width && cx1 > b.x;
    const out: { points: number[]; label: string; tx: number; ty: number }[] =
      [];
    const lbl = (g: number) => `${Math.round(g)}`;
    let best: { gap: number; b: (typeof others)[number] } | null;

    // Derecha
    best = null;
    for (const b of others)
      if (vOverlap(b)) {
        const gap = b.x - cx1;
        if (gap > 0.5 && (!best || gap < best.gap)) best = { gap, b };
      }
    if (best) {
      const y = (Math.max(cy0, best.b.y) + Math.min(cy1, best.b.y + best.b.height)) / 2;
      out.push({ points: [cx1, y, cx1 + best.gap, y], label: lbl(best.gap), tx: cx1 + best.gap / 2, ty: y });
    } else if (doc.width - cx1 > 0.5) {
      const y = (cy0 + cy1) / 2;
      out.push({ points: [cx1, y, doc.width, y], label: lbl(doc.width - cx1), tx: (cx1 + doc.width) / 2, ty: y });
    }
    // Izquierda
    best = null;
    for (const b of others)
      if (vOverlap(b)) {
        const gap = cx0 - (b.x + b.width);
        if (gap > 0.5 && (!best || gap < best.gap)) best = { gap, b };
      }
    if (best) {
      const y = (Math.max(cy0, best.b.y) + Math.min(cy1, best.b.y + best.b.height)) / 2;
      out.push({ points: [cx0 - best.gap, y, cx0, y], label: lbl(best.gap), tx: cx0 - best.gap / 2, ty: y });
    } else if (cx0 > 0.5) {
      const y = (cy0 + cy1) / 2;
      out.push({ points: [0, y, cx0, y], label: lbl(cx0), tx: cx0 / 2, ty: y });
    }
    // Abajo
    best = null;
    for (const b of others)
      if (hOverlap(b)) {
        const gap = b.y - cy1;
        if (gap > 0.5 && (!best || gap < best.gap)) best = { gap, b };
      }
    if (best) {
      const x = (Math.max(cx0, best.b.x) + Math.min(cx1, best.b.x + best.b.width)) / 2;
      out.push({ points: [x, cy1, x, cy1 + best.gap], label: lbl(best.gap), tx: x, ty: cy1 + best.gap / 2 });
    } else if (doc.height - cy1 > 0.5) {
      const x = (cx0 + cx1) / 2;
      out.push({ points: [x, cy1, x, doc.height], label: lbl(doc.height - cy1), tx: x, ty: (cy1 + doc.height) / 2 });
    }
    // Arriba
    best = null;
    for (const b of others)
      if (hOverlap(b)) {
        const gap = cy0 - (b.y + b.height);
        if (gap > 0.5 && (!best || gap < best.gap)) best = { gap, b };
      }
    if (best) {
      const x = (Math.max(cx0, best.b.x) + Math.min(cx1, best.b.x + best.b.width)) / 2;
      out.push({ points: [x, cy0 - best.gap, x, cy0], label: lbl(best.gap), tx: x, ty: cy0 - best.gap / 2 });
    } else if (cy0 > 0.5) {
      const x = (cx0 + cx1) / 2;
      out.push({ points: [x, 0, x, cy0], label: lbl(cy0), tx: x, ty: cy0 / 2 });
    }
    return out;
  };

  // Posición en pantalla de la selección → barra flotante (en App).
  const updateSelRect = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || cropMode || !selectedId) {
      setSelRect(null);
      return;
    }
    const node = nodeRefs.current.get(selectedId);
    if (!node) {
      setSelRect(null);
      return;
    }
    const box = node.getClientRect();
    const r = stage.container().getBoundingClientRect();
    setSelRect({ left: r.left + box.x, top: r.top + box.y, width: box.width });
  }, [selectedId, cropMode, setSelRect]);

  useEffect(() => {
    updateSelRect();
  }, [updateSelRect, doc.layers, scale, doc.width, doc.height]);

  useEffect(() => {
    window.addEventListener('resize', updateSelRect);
    window.addEventListener('scroll', updateSelRect, true);
    return () => {
      window.removeEventListener('resize', updateSelRect);
      window.removeEventListener('scroll', updateSelRect, true);
    };
  }, [updateSelRect]);

  // Previsualizar animaciones de entrada (manipula los nodos directamente).
  useEffect(() => {
    if (!animPlayNonce) return;
    const animated = doc.layers.filter(
      (l) =>
        (l.anim && l.anim !== 'none') || (l.animOut && l.animOut !== 'none'),
    );
    if (animated.length === 0) return;
    const total = animTotalFor(doc.layers);
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      animated.forEach((l) => {
        const node = nodeRefs.current.get(l.id);
        if (!node) return;
        const st = layerAnimAt(l, t, total);
        node.opacity(l.opacity * st.opacity);
        node.x(l.x + st.dx * doc.width);
        node.y(l.y + st.dy * doc.height);
        node.scaleX(l.scaleX * st.scale);
        node.scaleY(l.scaleY * st.scale);
      });
      nodeRefs.current.forEach((n) => n.getLayer()?.batchDraw());
      if (t < total) raf = requestAnimationFrame(tick);
      else {
        // Restaurar al estado normal al terminar.
        animated.forEach((l) => {
          const node = nodeRefs.current.get(l.id);
          if (!node) return;
          node.opacity(l.opacity);
          node.x(l.x);
          node.y(l.y);
          node.scaleX(l.scaleX);
          node.scaleY(l.scaleY);
        });
        nodeRefs.current.forEach((n) => n.getLayer()?.batchDraw());
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animPlayNonce]);

  const registerRef = (id: string, node: Konva.Node | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };

  // Ajustar el lienzo al área disponible × el zoom del usuario.
  useEffect(() => {
    const fit = () => {
      const el = containerRef.current;
      if (!el) return;
      const pad = 48;
      const sx = (el.clientWidth - pad) / doc.width;
      const sy = (el.clientHeight - pad) / doc.height;
      const final = Math.min(1, sx, sy) * zoom;
      setScale(final);
      setViewScale(final);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [doc.width, doc.height, zoom, setViewScale]);

  // Conectar el Transformer al nodo seleccionado (oculto durante el recorte).
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const nodes = cropMode
      ? []
      : selectedIds
          .map((id) => doc.layers.find((l) => l.id === id))
          .filter((l): l is NonNullable<typeof l> => !!l && !l.locked)
          .map((l) => nodeRefs.current.get(l.id))
          .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, doc.layers, cropMode]);

  // Conectar el Transformer de recorte al rectángulo de recorte.
  useEffect(() => {
    const tr = cropTrRef.current;
    if (!tr) return;
    tr.nodes(cropMode && cropRectRef.current ? [cropRectRef.current] : []);
    tr.getLayer()?.batchDraw();
  }, [cropMode, cropRect]);

  return (
    <div
      className="canvas-area"
      ref={containerRef}
      onWheel={(e) => {
        if (e.deltaY !== 0) setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
      }}
    >
      <Stage
        ref={stageRef}
        width={doc.width * scale}
        height={doc.height * scale}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          // Click en vacío = deseleccionar.
          if (e.target === e.target.getStage()) selectLayer(null);
        }}
        onDragStart={onStageDragStart}
        onDragMove={onStageDragMove}
        onDragEnd={() => {
          if (groupDrag.current) {
            groupDrag.current.others.forEach((o) =>
              updateLayer(o.id, { x: o.node.x(), y: o.node.y() }),
            );
            groupDrag.current = null;
          }
          setGuides({ vx: [], hy: [] });
          setDists([]);
        }}
        style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.35)' }}
      >
        <Layer listening={false}>
          {/* Tablero de transparencia siempre de base (se ve a través del alfa) */}
          <Rect
            width={doc.width}
            height={doc.height}
            fillPatternImage={checker}
            fillPatternRepeat="repeat"
          />
          {doc.background.type === 'solid' && (
            <Rect
              width={doc.width}
              height={doc.height}
              fill={doc.background.color}
            />
          )}
          {doc.background.type === 'gradient' &&
            (() => {
              const g = doc.background.gradient;
              const p = gradientPoints(g.angle, doc.width, doc.height);
              return (
                <Rect
                  width={doc.width}
                  height={doc.height}
                  fillLinearGradientStartPoint={{ x: p.x0, y: p.y0 }}
                  fillLinearGradientEndPoint={{ x: p.x1, y: p.y1 }}
                  fillLinearGradientColorStops={g.stops.flatMap((s) => [
                    s.offset,
                    s.color,
                  ])}
                />
              );
            })()}
        </Layer>
        <Layer>
          {doc.layers.map((layer) => {
            if (layer.type === 'image')
              return (
                <ImageLayerNode
                  key={layer.id}
                  layer={layer}
                  registerRef={registerRef}
                />
              );
            if (layer.type === 'text')
              return (
                <TextLayerNode
                  key={layer.id}
                  layer={layer}
                  registerRef={registerRef}
                />
              );
            if (layer.type === 'shape')
              return (
                <ShapeLayerNode
                  key={layer.id}
                  layer={layer}
                  registerRef={registerRef}
                />
              );
            return null;
          })}
          <Transformer
            ref={transformerRef}
            rotateEnabled
            keepRatio={false}
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 8 || newBox.height < 8 ? oldBox : newBox
            }
          />

          {guides.vx.map((x, i) => (
            <Line
              key={`v${i}`}
              points={[x, 0, x, doc.height]}
              stroke="#ff3da6"
              strokeWidth={1 / scale}
              listening={false}
            />
          ))}
          {guides.hy.map((y, i) => (
            <Line
              key={`h${i}`}
              points={[0, y, doc.width, y]}
              stroke="#ff3da6"
              strokeWidth={1 / scale}
              listening={false}
            />
          ))}

          {dists.map((d, i) => (
            <Line
              key={`d${i}`}
              points={d.points}
              stroke="#22c55e"
              strokeWidth={1 / scale}
              dash={[4 / scale, 3 / scale]}
              listening={false}
            />
          ))}
          {dists.map((d, i) => (
            <Label
              key={`dl${i}`}
              x={d.tx}
              y={d.ty}
              offsetX={0}
              offsetY={0}
              scaleX={1 / scale}
              scaleY={1 / scale}
              listening={false}
            >
              <Tag fill="#22c55e" cornerRadius={3} />
              <Text
                text={d.label}
                fontSize={11}
                padding={2}
                fill="#06210f"
              />
            </Label>
          ))}

          {cropMode && cropRect && (
            <>
              <Rect
                ref={cropRectRef}
                x={cropRect.x}
                y={cropRect.y}
                width={cropRect.width}
                height={cropRect.height}
                fill="rgba(108,140,255,0.15)"
                stroke="#6c8cff"
                strokeWidth={2 / scale}
                dash={[8 / scale, 6 / scale]}
                draggable
                onDragEnd={(e) =>
                  setCropRect({
                    x: e.target.x(),
                    y: e.target.y(),
                    width: cropRect.width,
                    height: cropRect.height,
                  })
                }
                onTransformEnd={() => {
                  const node = cropRectRef.current;
                  if (!node) return;
                  const w = Math.max(8, node.width() * node.scaleX());
                  let h = Math.max(8, node.height() * node.scaleY());
                  if (cropAspect) h = w / cropAspect;
                  node.scaleX(1);
                  node.scaleY(1);
                  node.width(w);
                  node.height(h);
                  setCropRect({ x: node.x(), y: node.y(), width: w, height: h });
                }}
              />
              <Transformer
                ref={cropTrRef}
                rotateEnabled={false}
                keepRatio={!!cropAspect}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 8 || newBox.height < 8) return oldBox;
                  if (cropAspect) {
                    return { ...newBox, height: newBox.width / cropAspect };
                  }
                  return newBox;
                }}
              />
            </>
          )}
        </Layer>
      </Stage>
    </div>
  );
}
