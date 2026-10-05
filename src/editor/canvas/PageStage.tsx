import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Stage,
  Layer,
  Rect,
  Group,
  Transformer,
  Line,
  Label,
  Tag,
  Text,
  Shape,
} from 'react-konva';
import type Konva from 'konva';
import { useEditor } from '../state/store';
import { isLayerLocked } from '../core/pageOps';
import { GradientBg, GrainBg } from './BackgroundFx';
import { animTotalFor, layerAnimAt } from '../core/animations';
import { getCheckerboard } from './useImage';
import { ImageLayerNode } from './ImageLayerNode';
import { CropOverlay } from './CropOverlay';
import { TextLayerNode } from './TextLayerNode';
import { ShapeLayerNode } from './ShapeLayerNode';
import { StrokeLayerNode } from './StrokeLayerNode';
import { BrushOverlay } from './BrushOverlay';
import { ToolOverlay } from './ToolOverlay';
import { useTool, useEffectiveTool, isDrawingTool } from '../state/toolStore';
import { boxFromPoints, boxesIntersect, cursorFor, type Box, type OverLayer } from '../state/toolLogic';
import { InlineTextEditor } from './InlineTextEditor';
import { StickyNotes } from './StickyNotes';
import { MasterBackdrop } from './MasterBackdrop';
import { BeforeAfterSlider } from '../../ui/BeforeAfterSlider';
import { RespectZone } from '../../ui/RespectZone';
import { columnBands, hasMargins, layoutSnapTargets } from '../core/layout';
import { renderPatternTile } from '../core/patterns';
import { computeSnap, gridStepFor, snapToStep } from './snap';
import { loadImageFile } from '../../io/import';
import { dragCacheRatio, isHeavyLayer } from './gestures';
import { useSaveMode } from '../../ui/tabletMode';
import type { Layer as DocLayer, Doc } from '../core/types';
import type { CanvasBridge } from './CanvasViewport';

// ¿El punto (en coordenadas del documento) cae dentro de la capa? Tiene en
// cuenta posición, escala y giro (el origen de giro es la esquina superior izq.).
function hitsLayer(l: DocLayer, px: number, py: number, w: number, h: number): boolean {
  const r = (-l.rotation * Math.PI) / 180;
  const dx = px - l.x;
  const dy = py - l.y;
  const lx = (dx * Math.cos(r) - dy * Math.sin(r)) / (l.scaleX || 1);
  const ly = (dx * Math.sin(r) + dy * Math.cos(r)) / (l.scaleY || 1);
  return lx >= 0 && ly >= 0 && lx <= w && ly <= h;
}

// Pantalla táctil: manijas del Transformer más grandes para dedos.
const IS_COARSE =
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;


// Un Stage de Konva con todas sus capas para UNA página (`doc`), a la escala
// `scale` que le da el CanvasViewport. Envuelto en `div.page-stage`
// (position: relative): el editor en línea, las notas y el comparador se
// posicionan relativos a ese envoltorio (offsetLeft/Top del contenedor del Stage).
export function PageStage({
  doc,
  scale,
  bridge,
}: {
  doc: Doc;
  scale: number;
  bridge: CanvasBridge;
}) {
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectLayer = useEditor((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const cropMode = useEditor((s) => s.cropMode);
  const cropRect = useEditor((s) => s.cropRect);
  const setSelRect = useEditor((s) => s.setSelRect);
  const setZoom = useEditor((s) => s.setZoom);
  const showGrid = useEditor((s) => s.showGrid);
  const showGuides = useEditor((s) => s.showGuides);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const showLayout = useEditor((s) => s.showLayout);
  const showNotes = useEditor((s) => s.showNotes);
  const setGuidesDoc = useEditor((s) => s.setGuides);
  const animPlayNonce = useEditor((s) => s.animPlayNonce);
  const textEditNonce = useEditor((s) => s.textEditNonce);
  const editingTextId = useEditor((s) => s.editingTextId);
  const setEditingText = useEditor((s) => s.setEditingText);
  const beginBatch = useEditor((s) => s.beginBatch);
  const endBatch = useEditor((s) => s.endBatch);

  const tool = useEffectiveTool();
  const shapeKind = useTool((s) => s.shape);
  const brushOn = isDrawingTool(tool);
  // Caja de selección (puntero): rectángulo en coordenadas del documento.
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [editorPos, setEditorPos] = useState<{ left: number; top: number } | null>(null);

  const containerRef = bridge.areaRef;
  const stageRef = bridge.stageRef;
  const transformerRef = useRef<Konva.Transformer>(null);
  const cropRectRef = useRef<Konva.Rect>(null);
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const [checker] = useState(() => getCheckerboard());
  const [guides, setGuides] = useState<{ vx: number[]; hy: number[] }>({
    vx: [],
    hy: [],
  });
  // Guías de distancia: separación (px) a la capa/borde más cercano por lado.
  const [dists, setDists] = useState<
    { points: number[]; label: string; tx: number; ty: number }[]
  >([]);
  const saveMode = useSaveMode();

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
    const selectedIds = useEditor.getState().selectedIds;
    cacheHeavy(node);
    if (id && selectedIds.length > 1 && selectedIds.includes(id)) {
      selectedIds.forEach((x) => cacheHeavy(nodeRefs.current.get(x)));
      beginBatch();
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
    // Objetivos: bordes/centro del lienzo + bordes/centro de las demás capas.
    const tX = [0, doc.width / 2, doc.width];
    const tY = [0, doc.height / 2, doc.height];
    nodeRefs.current.forEach((other) => {
      if (other === node) return;
      const b = other.getClientRect({ relativeTo: stage });
      tX.push(b.x, b.x + b.width / 2, b.x + b.width);
      tY.push(b.y, b.y + b.height / 2, b.y + b.height);
    });
    // Márgenes y bordes de columna (solo si se ven) también son destino del imán.
    if (showLayout) {
      const lt = layoutSnapTargets(doc);
      tX.push(...lt.x);
      tY.push(...lt.y);
    }
    const snap = computeSnap({
      box,
      targetsX: tX,
      targetsY: tY,
      guidesX: showGuides ? doc.guides?.x : undefined,
      guidesY: showGuides ? doc.guides?.y : undefined,
      scale,
      gridStep: snapToGrid ? gridStepFor(scale) : undefined,
    });
    if (snap.dx) node.x(node.x() + snap.dx);
    if (snap.dy) node.y(node.y() + snap.dy);
    const vx = snap.vx;
    const hy = snap.hy;
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
    setSelRect({ left: r.left + box.x, top: r.top + box.y, width: box.width, height: box.height });
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

  // Los gestos táctiles (en el CanvasViewport) refrescan la barra flotante por aquí.
  bridge.updateSelRectRef.current = updateSelRect;

  // Vista previa ligera: mientras se arrastra/transforma una capa con efectos
  // costosos se dibuja una copia en caché de baja resolución (clearCache al soltar).
  const cachedNodes = useRef<Set<Konva.Node>>(new Set());
  const cacheHeavy = (node: Konva.Node | undefined | null) => {
    if (!node || cachedNodes.current.has(node)) return;
    const id = findLayerId(node);
    const l = id ? useEditor.getState().doc.layers.find((x) => x.id === id) : null;
    if (!l || !isHeavyLayer(l)) return;
    try {
      node.cache({ pixelRatio: dragCacheRatio(scale) });
      cachedNodes.current.add(node);
    } catch {
      /* caja vacía o sin tamaño: se dibuja normal */
    }
  };
  const uncacheAll = () => {
    if (!cachedNodes.current.size) return;
    cachedNodes.current.forEach((n) => {
      try {
        n.clearCache();
        n.getLayer()?.batchDraw();
      } catch {
        /* nodo ya destruido */
      }
    });
    cachedNodes.current.clear();
  };

  // Modo ahorro: resolución 1× en el lienzo y sin sombras de nodo mientras se edita
  // (la exportación no se ve afectada: no usa estos nodos).
  const wasSaving = useRef(false);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const dpr = window.devicePixelRatio || 1;
    stage.getLayers().forEach((ly) => {
      const c = ly.getCanvas();
      if (c.getPixelRatio() !== (saveMode ? 1 : dpr)) c.setPixelRatio(saveMode ? 1 : dpr);
    });
    stage.batchDraw();
  }, [saveMode, showGrid, showLayout, showGuides, scale, doc.width, doc.height]);
  useEffect(() => {
    if (saveMode) {
      nodeRefs.current.forEach((n) => (n as Konva.Shape).shadowEnabled(false));
    } else if (wasSaving.current) {
      nodeRefs.current.forEach((n, id) => {
        const l = doc.layers.find((x) => x.id === id);
        if (l && 'shadow' in l) (n as Konva.Shape).shadowEnabled(!!l.shadow);
      });
    }
    wasSaving.current = saveMode;
    stageRef.current?.batchDraw();
  }, [saveMode, doc.layers]);

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

  // Conectar el Transformer al nodo seleccionado (oculto durante el recorte
  // y mientras se edita un texto sobre el lienzo).
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const nodes = cropMode
      ? []
      : selectedIds
          .map((id) => doc.layers.find((l) => l.id === id))
          .filter(
            (l): l is NonNullable<typeof l> => !!l && !isLayerLocked(doc, l) && l.id !== editingTextId,
          )
          .map((l) => nodeRefs.current.get(l.id))
          .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, doc.layers, doc.locked, cropMode, editingTextId]);

  // Doble clic en un texto (o "Editar texto"): abrir el editor sobre el lienzo.
  useEffect(() => {
    if (!textEditNonce) return;
    const st = useEditor.getState();
    const l = st.doc.layers.find((x) => x.id === st.selectedId);
    if (l?.type === 'text' && !isLayerLocked(st.doc, l)) setEditingText(l.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textEditNonce]);

  // Posición del editor en línea: origen de la capa dentro del área del lienzo.
  useLayoutEffect(() => {
    const l = doc.layers.find((x) => x.id === editingTextId);
    const stage = stageRef.current;
    if (!l || !stage) {
      setEditorPos(null);
      return;
    }
    const c = stage.container();
    setEditorPos({ left: c.offsetLeft + l.x * scale, top: c.offsetTop + l.y * scale });
    // Solo al abrir y si cambia el zoom (la capa no se mueve mientras se edita).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTextId, scale]);

  // Soltar una foto sobre un marco → rellenarlo. Si no hay marco debajo, el
  // evento sigue hacia App (que la añade como capa normal).
  const onDropOnCanvas = async (e: React.DragEvent) => {
    const stage = stageRef.current;
    if (!stage) return;
    const st = useEditor.getState();
    const frames = st.doc.layers.filter((l) => l.type === 'shape' && l.frame && l.visible);
    if (!frames.length) return;
    stage.setPointersPositions(e.nativeEvent);
    const pt = stage.getPointerPosition();
    if (!pt) return;
    const px = pt.x / scale;
    const py = pt.y / scale;
    const target = [...frames]
      .reverse()
      .find((f) => f.type === 'shape' && hitsLayer(f, px, py, f.width, f.height));
    if (!target) return;
    const uploadId = e.dataTransfer.getData('application/x-chamva-upload');
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (!uploadId && !file) return;
    e.preventDefault();
    e.stopPropagation();
    if (uploadId) {
      const up = st.uploads.find((u) => u.id === uploadId) ?? st.brandLogos.find((u) => u.id === uploadId);
      if (up) await st.fillFrame(target.id, up);
    } else if (file) {
      const img = await loadImageFile(file);
      await st.fillFrame(target.id, img);
    }
  };

  // Cuadrícula: el paso más pequeño de la lista que deja ≥ 18 px en pantalla.
  const gridStep = gridStepFor(scale);
  const drawGrid = (major: boolean) => (ctx: Konva.Context, shape: Konva.Shape) => {
    ctx.beginPath();
    const every = major ? gridStep * 5 : gridStep;
    for (let x = 0; x <= doc.width; x += every) {
      if (!major && x % (gridStep * 5) === 0) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, doc.height);
    }
    for (let y = 0; y <= doc.height; y += every) {
      if (!major && y % (gridStep * 5) === 0) continue;
      ctx.moveTo(0, y);
      ctx.lineTo(doc.width, y);
    }
    ctx.strokeShape(shape);
  };

  // Patrón de fondo: baldosa a la resolución de pantalla (nítida al acercar).
  const bgPattern = doc.background.type === 'pattern' ? doc.background.pattern : null;
  const patternKey = bgPattern ? JSON.stringify(bgPattern) : '';
  const patternK = Math.min(4, Math.max(1, Math.ceil(scale * (window.devicePixelRatio || 1))));
  const patternTile = useMemo(
    () => (bgPattern ? renderPatternTile(bgPattern, patternK) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patternKey, patternK],
  );

  // Ayudas de maquetación (solo editor): márgenes, columnas y sangrado.
  const layoutBands = useMemo(
    () => (doc.columns ? columnBands(doc.width, doc.columns) : []),
    [doc.columns, doc.width],
  );
  const bleedPx = showLayout && doc.bleed ? Math.round(doc.bleed * scale) : 0;

  // Origen del lienzo dentro del área de scroll (para las notas adhesivas).
  const [origin, setOrigin] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const c = stageRef.current?.container();
    if (c && (c.offsetLeft !== origin.left || c.offsetTop !== origin.top))
      setOrigin({ left: c.offsetLeft, top: c.offsetTop });
  });

  const setStageCursor = (c: string) => {
    const el = stageRef.current?.container();
    if (el) el.style.cursor = c;
  };
  // Puntero: cursor según lo que haya bajo el ratón (mover / bloqueada / nada). Las manijas del
  // Transformer ponen el suyo (redimensionar / girar): no se pisa.
  const overRef = useRef<OverLayer | null>(null);
  const onStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'select') return;
    const t = e.target;
    const stage = stageRef.current;
    let over: OverLayer = 'none';
    if (t !== stage) {
      if (t.getParent()?.className === 'Transformer') return;
      const id = findLayerId(t);
      if (!id) return;
      const st = useEditor.getState();
      const l = st.doc.layers.find((x) => x.id === id);
      over = l && isLayerLocked(st.doc, l) ? 'locked' : 'free';
    }
    if (overRef.current === over) return;
    overRef.current = over;
    setStageCursor(over === 'none' ? '' : cursorFor({ tool: 'select', over }));
  };

  // Caja de selección: arrastrar en vacío con el puntero. Suma con Shift; un clic sin arrastre deselecciona.
  const startMarquee = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage || e.evt.button !== 0) return;
    const rect = stage.container().getBoundingClientRect();
    const pt = (ev: { clientX: number; clientY: number }): [number, number] => [(ev.clientX - rect.left) / scale, (ev.clientY - rect.top) / scale];
    const a = pt(e.evt);
    const additive = e.evt.shiftKey;
    const base = additive ? useEditor.getState().selectedIds : [];
    let moved = false;
    const hits = (box: Box): string[] => {
      const st = useEditor.getState();
      const ids = new Set<string>();
      for (const l of st.doc.layers) {
        if (!l.visible || isLayerLocked(st.doc, l)) continue;
        const node = nodeRefs.current.get(l.id);
        if (!node) continue;
        const r = node.getClientRect({ relativeTo: stage });
        if (boxesIntersect(box, { x: r.x, y: r.y, w: r.width, h: r.height })) {
          // un grupo se selecciona entero
          if (l.groupId) st.doc.layers.filter((x) => x.groupId === l.groupId).forEach((x) => ids.add(x.id));
          else ids.add(l.id);
        }
      }
      return [...ids];
    };
    const onMove = (ev: PointerEvent | MouseEvent) => {
      const b = pt(ev);
      if (!moved && Math.hypot(b[0] - a[0], b[1] - a[1]) * scale < 4) return;
      moved = true;
      const box = boxFromPoints(a, b);
      setMarquee(box);
      const ids = [...new Set([...base, ...hits(box)])];
      useEditor.setState({ selectedIds: ids, selectedId: ids.length ? ids[ids.length - 1] : null, textSel: null });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setMarquee(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Guías del usuario: crear desde las reglas, mover o borrar arrastrando.
  const [draft, setDraft] = useState<{
    axis: 'x' | 'y';
    pos: number;
    index: number | null;
    remove: boolean;
  } | null>(null);
  const startGuideDrag = (axis: 'x' | 'y', index: number | null) => {
    const stage = stageRef.current;
    if (!stage) return;
    if (!useEditor.getState().showGuides) useEditor.setState({ showGuides: true });
    const base = useEditor.getState().doc.guides ?? { x: [], y: [] };
    const max = axis === 'x' ? doc.width : doc.height;
    const step = gridStepFor(scale);
    let armed = index !== null; // una guía nueva solo se borra tras entrar al lienzo
    let moved = false;
    let cur = { pos: index !== null ? base[axis][index] : NaN, remove: false };
    const onMove = (ev: PointerEvent) => {
      const r = stage.container().getBoundingClientRect();
      const area = containerRef.current?.getBoundingClientRect();
      let pos = (axis === 'x' ? ev.clientX - r.left : ev.clientY - r.top) / scale;
      pos = useEditor.getState().snapToGrid ? snapToStep(pos, step) : Math.round(pos);
      const inside = pos >= 0 && pos <= max;
      if (inside) armed = true;
      const overRuler = !!area && (axis === 'x' ? ev.clientX < area.left : ev.clientY < area.top);
      cur = { pos, remove: armed && (!inside || overRuler) };
      moved = true;
      setDraft({ axis, pos, index, remove: cur.remove });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDraft(null);
      if (!moved) return;
      const g = useEditor.getState().doc.guides ?? { x: [], y: [] };
      const list = [...g[axis]];
      if (cur.remove) {
        if (index === null) return;
        list.splice(index, 1);
      } else if (!armed) return;
      else if (index !== null) list[index] = cur.pos;
      else list.push(cur.pos);
      setGuidesDoc({ ...g, [axis]: [...new Set(list)] });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  // Desde una regla: si hay una guía junto al puntero se mueve, si no se crea.
  const onRulerGuideStart = (axis: 'x' | 'y', e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage || e.button !== 0) return;
    e.preventDefault();
    const r = stage.container().getBoundingClientRect();
    const pos = (axis === 'x' ? e.clientX - r.left : e.clientY - r.top) / scale;
    const list = doc.guides?.[axis] ?? [];
    const i = list.findIndex((g) => Math.abs(g - pos) <= 4 / scale);
    startGuideDrag(axis, i >= 0 ? i : null);
  };
  const removeGuide = (axis: 'x' | 'y', index: number) => {
    const g = useEditor.getState().doc.guides ?? { x: [], y: [] };
    setGuidesDoc({ ...g, [axis]: g[axis].filter((_, i) => i !== index) });
  };


  // Registro para el CanvasViewport (soltar sobre un marco, guías desde las reglas).
  bridge.dropRef.current = onDropOnCanvas;
  bridge.rulerGuideStartRef.current = onRulerGuideStart;

  return (
    <div className="page-stage">
      <Stage
        ref={stageRef}
        width={doc.width * scale}
        height={doc.height * scale}
        scaleX={scale}
        scaleY={scale}
        onMouseMove={onStageMouseMove}
        onMouseLeave={() => {
          overRef.current = null;
          if (tool === 'select') setStageCursor('');
        }}
        onMouseDown={(e) => {
          // Click en vacío = deseleccionar (con Shift se conserva) y empieza la caja de selección.
          if (e.target !== e.target.getStage() || tool !== 'select') return;
          if (useEditor.getState().cropMode) return; // recortando: un clic fuera no suelta la capa
          if (!e.evt.shiftKey) selectLayer(null);
          startMarquee(e);
        }}
        onTap={(e) => {
          // Tocar fuera de las capas deselecciona.
          if (e.target === e.target.getStage() && !useEditor.getState().cropMode) selectLayer(null);
        }}
        onDblTap={(e) => {
          // Doble toque en vacío: alternar entre ajustar y acercar.
          if (e.target !== e.target.getStage()) return;
          setZoom(useEditor.getState().zoom > 1.05 ? 1 : 2);
        }}
        onDragStart={onStageDragStart}
        onDragMove={onStageDragMove}
        onDragEnd={() => {
          uncacheAll();
          if (groupDrag.current) {
            groupDrag.current.others.forEach((o) =>
              updateLayer(o.id, { x: o.node.x(), y: o.node.y() }),
            );
            groupDrag.current = null;
            endBatch();
          }
          setGuides({ vx: [], hy: [] });
          setDists([]);
        }}
        style={
          bleedPx
            ? {
                // Sangrado: banda tenue fuera del lienzo con borde discontinuo (solo editor).
                margin: 'auto',
                boxShadow: `0 0 0 1px rgba(128,128,128,0.45), 0 0 0 ${bleedPx}px rgba(128,128,128,0.16)`,
                outline: '1px dashed rgba(128,128,128,0.8)',
                outlineOffset: bleedPx,
              }
            : { margin: 'auto', outline: '1px solid rgba(128,128,128,0.45)' }
        }
      >
        <Layer listening={false}>
          {/* Tablero de transparencia siempre de base (se ve a través del alfa) */}
          <Rect
            width={doc.width}
            height={doc.height}
            fillPatternImage={checker as unknown as HTMLImageElement}
            fillPatternRepeat="repeat"
          />
        </Layer>
        <Layer>
          {/* El fondo va en la MISMA capa de Konva que los elementos: así los modos de fusión se mezclan con él (igual que la exportación). */}
          <Group listening={false}>
          {doc.background.type === 'solid' && (
            <Rect
              width={doc.width}
              height={doc.height}
              fill={doc.background.color}
            />
          )}
          {patternTile && (
            <Rect
              width={doc.width}
              height={doc.height}
              fillPatternImage={patternTile.canvas as unknown as HTMLImageElement}
              fillPatternRepeat="repeat"
              fillPatternScale={{ x: patternTile.ps, y: patternTile.ps }}
            />
          )}
          {doc.background.type === 'gradient' &&
            (() => {
              const g = doc.background.gradient;
              return <GradientBg g={g} w={doc.width} h={doc.height} />;
            })()}
          {doc.background.type !== 'transparent' && doc.background.grain && (
            <GrainBg grain={doc.background.grain} w={doc.width} h={doc.height} />
          )}
          <MasterBackdrop />
          </Group>
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
            if (layer.type === 'stroke')
              return (
                <StrokeLayerNode
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
            onTransformStart={() => {
              transformerRef.current?.nodes().forEach((n) => cacheHeavy(n));
              if ((transformerRef.current?.nodes().length ?? 0) > 1) beginBatch();
            }}
            onTransformEnd={() => {
              // Los nodos reciben su transformend después: cerrar el lote luego.
              setTimeout(() => {
                uncacheAll();
                endBatch();
              }, 0);
            }}
            rotateAnchorCursor="grab"
            borderStroke="#111111"
            borderStrokeWidth={1}
            anchorFill="#ffffff"
            anchorStroke="#111111"
            anchorStrokeWidth={1}
            anchorCornerRadius={2}
            anchorSize={IS_COARSE ? 18 : 10}
            rotateAnchorOffset={IS_COARSE ? 40 : 24}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={7}
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 8 || newBox.height < 8 ? oldBox : newBox
            }
          />

          {marquee && (
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              fill="rgba(255,179,0,0.12)"
              stroke="#FFB300"
              strokeWidth={1 / scale}
              dash={[4 / scale, 3 / scale]}
              listening={false}
            />
          )}
          {guides.vx.map((x, i) => (
            <Line
              key={`v${i}`}
              points={[x, 0, x, doc.height]}
              stroke="#808080"
              dash={[4 / scale, 4 / scale]}
              strokeWidth={1 / scale}
              listening={false}
            />
          ))}
          {guides.hy.map((y, i) => (
            <Line
              key={`h${i}`}
              points={[0, y, doc.width, y]}
              stroke="#808080"
              dash={[4 / scale, 4 / scale]}
              strokeWidth={1 / scale}
              listening={false}
            />
          ))}

          {dists.map((d, i) => (
            <Line
              key={`d${i}`}
              points={d.points}
              stroke="#808080"
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
              <Tag fill="#111111" cornerRadius={3} />
              <Text
                text={d.label}
                fontSize={11}
                padding={2}
                fill="#ffffff"
              />
            </Label>
          ))}

          {cropMode && cropRect && <CropOverlay rectRef={cropRectRef} scale={scale} />}
        </Layer>
        {showGrid && (
          <Layer listening={false}>
            <Shape sceneFunc={drawGrid(false)} stroke="rgba(128,128,128,0.35)" strokeWidth={1} strokeScaleEnabled={false} />
            <Shape sceneFunc={drawGrid(true)} stroke="rgba(128,128,128,0.7)" strokeWidth={1} strokeScaleEnabled={false} />
          </Layer>
        )}
        {showLayout && (hasMargins(doc.margins) || layoutBands.length > 0) && (
          <Layer listening={false}>
            {layoutBands.map((b, i) => (
              <Rect key={`c${i}`} x={b.x} y={0} width={b.w} height={doc.height} fill="rgba(128,128,128,0.13)" />
            ))}
            {hasMargins(doc.margins) && (
              <Rect
                x={doc.margins.left}
                y={doc.margins.top}
                width={Math.max(0, doc.width - doc.margins.left - doc.margins.right)}
                height={Math.max(0, doc.height - doc.margins.top - doc.margins.bottom)}
                stroke="rgba(128,128,128,0.9)"
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[6, 4]}
              />
            )}
          </Layer>
        )}
        <RespectZone />
        {showGuides && (
          <Layer>
            {(['x', 'y'] as const).flatMap((axis) =>
              (doc.guides?.[axis] ?? []).map((pos, i) =>
                draft && draft.axis === axis && draft.index === i ? null : (
                  <Line
                    key={`g${axis}${i}`}
                    points={axis === 'x' ? [pos, 0, pos, doc.height] : [0, pos, doc.width, pos]}
                    stroke="#808080"
                    strokeWidth={1 / scale}
                    hitStrokeWidth={10 / scale}
                    onMouseDown={(e) => {
                      if (e.evt.button !== 0) return;
                      e.cancelBubble = true;
                      startGuideDrag(axis, i);
                    }}
                    onDblClick={() => removeGuide(axis, i)}
                    onMouseEnter={() => setStageCursor(axis === 'x' ? 'ew-resize' : 'ns-resize')}
                    onMouseLeave={() => setStageCursor('')}
                  />
                ),
              ),
            )}
            {draft && !draft.remove && (
              <>
                <Line
                  points={
                    draft.axis === 'x'
                      ? [draft.pos, 0, draft.pos, doc.height]
                      : [0, draft.pos, doc.width, draft.pos]
                  }
                  stroke="#111111"
                  strokeWidth={1 / scale}
                  listening={false}
                />
                <Label
                  x={draft.axis === 'x' ? draft.pos + 4 / scale : 4 / scale}
                  y={draft.axis === 'x' ? 4 / scale : draft.pos + 4 / scale}
                  scaleX={1 / scale}
                  scaleY={1 / scale}
                  listening={false}
                >
                  <Tag fill="#111111" cornerRadius={3} />
                  <Text text={`${Math.round(draft.pos)} px`} fontSize={11} padding={2} fill="#ffffff" />
                </Label>
              </>
            )}
          </Layer>
        )}
      </Stage>

      {brushOn && <BrushOverlay doc={doc} scale={scale} stageRef={stageRef} />}
      {(tool === 'text' || tool === 'shape') && <ToolOverlay doc={doc} scale={scale} stageRef={stageRef} tool={tool} shape={shapeKind} />}
      {showNotes && <StickyNotes scale={scale} origin={origin} />}
      <BeforeAfterSlider nodeRefs={nodeRefs} />


      {editingTextId &&
        editorPos &&
        (() => {
          const l = doc.layers.find((x) => x.id === editingTextId);
          if (!l || l.type !== 'text') return null;
          return (
            <InlineTextEditor
              key={editingTextId}
              layer={l}
              left={editorPos.left}
              top={editorPos.top}
              scale={scale}
              onDone={(text, spans) => {
                setEditingText(null);
                const cur = useEditor.getState().doc.layers.find((x) => x.id === l.id);
                if (!cur || cur.type !== 'text') return;
                const same =
                  cur.text === text && JSON.stringify(cur.spans ?? null) === JSON.stringify(spans ?? null);
                if (!same) updateLayer(l.id, { text, spans });
              }}
            />
          );
        })()}
    </div>
  );
}
