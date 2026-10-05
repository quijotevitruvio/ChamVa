import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layer as KLayer, Shape } from 'react-konva';
import type Konva from 'konva';
import type { Doc } from '../core/types';
import { useEditor } from '../state/store';
import { combineFromKeys, selectionEdges, simplifyPath } from '../core/selection';
import { currentSel, lassoSelect, usePixelOpts, wandAt } from '../state/pixelOps';
import { toast } from '../../ui/toast';

// Entrada de puntero de la varita y el lazo sobre la página activa (como el pincel: un div encima
// del Stage). Varita: clic. Lazo libre: arrastrar. Lazo poligonal: clic por clic, doble clic (o clic
// sobre el primer punto) cierra, Esc cancela. Mayús suma, Alt resta, Mayús+Alt interseca.
export function SelectionOverlay({ doc, scale, stageRef, tool }: { doc: Doc; scale: number; stageRef: React.RefObject<Konva.Stage | null>; tool: 'wand' | 'lasso' }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const pts = useRef<number[]>([]);
  const dragging = useRef<number | null>(null);
  const hover = useRef<[number, number] | null>(null);
  const keys = useRef({ shift: false, alt: false });
  const [busy, setBusy] = useState(false);
  const poly = usePixelOpts((s) => s.sel.lassoPoly);

  useLayoutEffect(() => {
    const c = stageRef.current?.container();
    if (c) setPos({ left: c.offsetLeft, top: c.offsetTop });
  }, [scale, doc.width, doc.height, stageRef]);

  const k = Math.min(window.devicePixelRatio || 1, 4096 / Math.max(1, doc.width * scale));

  const paint = () => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const p = pts.current;
    if (p.length < 2) return;
    ctx.setTransform(k * scale, 0, 0, k * scale, 0, 0);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    if (hover.current && poly) ctx.lineTo(hover.current[0], hover.current[1]);
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.setLineDash([4 / scale, 4 / scale]);
    ctx.strokeStyle = '#111111';
    ctx.stroke();
  };

  const finishLasso = (mode = combineFromKeys(keys.current.shift, keys.current.alt)) => {
    const p = simplifyPath(pts.current, 0.5);
    pts.current = [];
    hover.current = null;
    paint();
    if (p.length < 6) return;
    lassoSelect(p, mode);
  };

  // Esc cancela el polígono en curso; Enter lo cierra.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!pts.current.length) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        pts.current = [];
        paint();
      } else if (e.key === 'Enter') finishLasso();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poly]);

  const docPoint = (e: { clientX: number; clientY: number }): [number, number] => {
    const rc = hostRef.current!.getBoundingClientRect();
    return [(e.clientX - rc.left) / scale, (e.clientY - rc.top) / scale];
  };

  const onDown = async (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    keys.current = { shift: e.shiftKey, alt: e.altKey };
    const [x, y] = docPoint(e);
    if (tool === 'wand') {
      if (busy) return;
      setBusy(true);
      try {
        await wandAt(x, y, combineFromKeys(e.shiftKey, e.altKey));
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') toast('No se pudo seleccionar: ' + (err as Error).message, 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (poly) {
      const p = pts.current;
      // Clic sobre el primer punto (a 8 px de pantalla) o doble clic: cerrar.
      if (p.length >= 6 && (e.detail >= 2 || Math.hypot(x - p[0], y - p[1]) * scale < 8)) {
        finishLasso();
        return;
      }
      p.push(x, y);
      paint();
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sin captura */
    }
    dragging.current = e.pointerId;
    pts.current = [x, y];
    paint();
  };

  const onMove = (e: React.PointerEvent) => {
    const [x, y] = docPoint(e);
    if (tool === 'lasso' && poly && pts.current.length) {
      hover.current = [x, y];
      paint();
      return;
    }
    if (dragging.current !== e.pointerId) return;
    const native = e.nativeEvent as PointerEvent;
    const evs = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [native]) {
      const [px, py] = docPoint(ev);
      pts.current.push(px, py);
    }
    paint();
  };

  const onUp = (e: React.PointerEvent) => {
    if (dragging.current !== e.pointerId) return;
    dragging.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ya liberado */
    }
    finishLasso();
  };

  if (!pos) return null;
  return (
    <div
      ref={hostRef}
      className="brush-overlay sel-overlay"
      style={{ left: pos.left, top: pos.top, width: doc.width * scale, height: doc.height * scale, cursor: busy ? 'progress' : 'crosshair' }}
      role="application"
      aria-label={tool === 'wand' ? 'Varita mágica: clic para seleccionar' : 'Lazo: dibuja la zona a seleccionar'}
      data-testid="selection-overlay"
      data-busy={busy ? '1' : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => poly && pts.current.length >= 6 && finishLasso()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={cvRef} width={Math.ceil(doc.width * scale * k)} height={Math.ceil(doc.height * scale * k)} />
    </div>
  );
}

// «Hormigas marchantes»: contorno de la selección en una capa de Konva propia (se repinta sola).
export function MarchingAnts({ scale }: { scale: number }) {
  const pixelSel = useEditor((s) => s.pixelSel);
  const docId = useEditor((s) => s.doc.id);
  const layerRef = useRef<Konva.Layer>(null);
  const offset = useRef(0);
  const sel = pixelSel ? currentSel() : null;
  const path = useMemo(() => {
    if (!sel) return null;
    const segs = selectionEdges(sel.data, sel.w, sel.h);
    const p = new Path2D();
    const s = 1 / sel.scale;
    for (let i = 0; i < segs.length; i += 4) {
      p.moveTo(segs[i] * s, segs[i + 1] * s);
      p.lineTo(segs[i + 2] * s, segs[i + 3] * s);
    }
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelSel, docId]);

  useEffect(() => {
    if (!path) return;
    const id = setInterval(() => {
      offset.current = (offset.current + 1) % 8;
      layerRef.current?.batchDraw();
    }, 120);
    return () => clearInterval(id);
  }, [path]);

  if (!path) return null;
  return (
    <KLayer ref={layerRef} listening={false}>
      <Shape
        sceneFunc={(ctx) => {
          const c = (ctx as any)._context as CanvasRenderingContext2D;
          c.save();
          c.lineWidth = 1 / scale;
          c.strokeStyle = '#ffffff';
          c.setLineDash([]);
          c.stroke(path);
          c.strokeStyle = '#000000';
          c.setLineDash([4 / scale, 4 / scale]);
          c.lineDashOffset = -offset.current / scale;
          c.stroke(path);
          c.restore();
        }}
      />
    </KLayer>
  );
}
