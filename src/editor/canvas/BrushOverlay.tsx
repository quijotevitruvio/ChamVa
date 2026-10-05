import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Doc, StrokeLayer } from '../core/types';
import { BRUSHES, buildStrokeGeometry, drawStroke, simulatedPressure, stabilize, strokeHit } from '../core/brush';
import { useEditor } from '../state/store';
import { useBrush } from '../state/brushStore';
import { useTool } from '../state/toolStore';
import { isLayerLocked } from '../core/pageOps';
import '../../ui/brush.css';

interface Run {
  id: number;
  raw: number[]; // [x, y, p, …] en coordenadas del documento
  ema: [number, number];
  lastRaw: [number, number];
  lastT: number;
  p: number;
  seed: number;
  erasing: boolean;
  batched: boolean;
}

const realPressure = (e: { pointerType: string; pressure: number }) =>
  e.pointerType === 'pen' || (e.pointerType === 'touch' && e.pressure > 0 && e.pressure !== 0.5);

// Capa transparente sobre la página activa que recoge el puntero mientras el pincel o el borrador
// están activos. La vista previa se pinta con la misma geometría que se guardará.
export function BrushOverlay({
  doc,
  scale,
  stageRef,
}: {
  doc: Doc;
  scale: number;
  stageRef: React.RefObject<Konva.Stage | null>;
}) {
  const tool = useTool((s) => s.tool);
  const hostRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const run = useRef<Run | null>(null);
  const raf = useRef(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const locked = !!doc.locked;

  useLayoutEffect(() => {
    const c = stageRef.current?.container();
    if (c) setPos({ left: c.offsetLeft, top: c.offsetTop });
  }, [scale, doc.width, doc.height, stageRef]);

  const k = Math.min(window.devicePixelRatio || 1, 4096 / Math.max(1, doc.width * scale));

  const paint = () => {
    raf.current = 0;
    const cv = cvRef.current;
    const r = run.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!r || r.erasing || r.raw.length < 3) return;
    const st = useBrush.getState();
    const g = buildStrokeGeometry(r.raw, st.style, st.size);
    ctx.setTransform(k * scale, 0, 0, k * scale, g.x * k * scale, g.y * k * scale);
    ctx.globalAlpha = st.opacity;
    drawStroke(ctx, { brush: st.style, size: st.size, pts: g.pts, seed: r.seed, color: st.color });
  };
  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(paint);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const docPoint = (e: { clientX: number; clientY: number }): [number, number] => {
    const rc = hostRef.current!.getBoundingClientRect();
    return [(e.clientX - rc.left) / scale, (e.clientY - rc.top) / scale];
  };

  const moveRing = (e: { clientX: number; clientY: number }) => {
    const ring = ringRef.current;
    if (!ring) return;
    const rc = hostRef.current!.getBoundingClientRect();
    const d = Math.max(6, useBrush.getState().size * scale);
    ring.style.width = ring.style.height = `${d}px`;
    ring.style.transform = `translate(${e.clientX - rc.left - d / 2}px, ${e.clientY - rc.top - d / 2}px)`;
    ring.style.opacity = '1';
  };

  const erase = (r: Run, x: number, y: number) => {
    const st = useEditor.getState();
    const radius = useBrush.getState().size / 2;
    const hits = st.doc.layers
      .filter((l): l is StrokeLayer => l.type === 'stroke' && l.visible && !isLayerLocked(st.doc, l) && strokeHit(l, x, y, radius))
      .map((l) => l.id);
    if (!hits.length) return;
    if (!r.batched) {
      st.beginBatch();
      r.batched = true;
    }
    useEditor.getState().removeLayers(hits);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || locked) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* puntero ya liberado: se sigue sin captura */
    }
    const [x, y] = docPoint(e);
    const real = realPressure(e);
    const r: Run = {
      id: e.pointerId,
      raw: [],
      ema: [x, y],
      lastRaw: [x, y],
      lastT: e.timeStamp,
      p: real ? e.pressure : 0.6,
      seed: Math.floor(Math.random() * 2 ** 31),
      erasing: useTool.getState().tool === 'eraser',
      batched: false,
    };
    run.current = r;
    if (r.erasing) erase(r, x, y);
    else {
      r.raw.push(x, y, r.p);
      schedule();
    }
    moveRing(e);
  };

  const onMove = (e: React.PointerEvent) => {
    moveRing(e);
    const r = run.current;
    if (!r || r.id !== e.pointerId) return;
    const st = useBrush.getState();
    const native = e.nativeEvent as PointerEvent;
    const evs = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [native]) {
      const [x, y] = docPoint(ev);
      if (r.erasing) {
        erase(r, x, y);
        continue;
      }
      const dt = Math.max(1, ev.timeStamp - r.lastT);
      const dist = Math.hypot(x - r.lastRaw[0], y - r.lastRaw[1]);
      r.p = realPressure(ev) ? ev.pressure : simulatedPressure(dist / dt, r.p);
      r.lastRaw = [x, y];
      r.lastT = ev.timeStamp;
      r.ema = stabilize(r.ema, [x, y], st.smoothing);
      const n = r.raw.length;
      if (n >= 3 && Math.hypot(r.ema[0] - r.raw[n - 3], r.ema[1] - r.raw[n - 2]) * scale < 1) continue;
      r.raw.push(r.ema[0], r.ema[1], Math.round(r.p * 100) / 100);
    }
    if (!r.erasing) schedule();
  };

  const finish = (e: React.PointerEvent, cancel: boolean) => {
    const r = run.current;
    if (!r || r.id !== e.pointerId) return;
    run.current = null;
    if (r.erasing) {
      if (r.batched) useEditor.getState().endBatch();
    } else if (!cancel && r.raw.length >= 3) {
      const st = useBrush.getState();
      // El estabilizador siempre va con retardo: se cierra el trazo en el punto real donde se levantó.
      const [lx, ly] = r.lastRaw;
      const n = r.raw.length;
      if (st.smoothing > 0 && Math.hypot(lx - r.raw[n - 3], ly - r.raw[n - 2]) * scale >= 1) r.raw.push(lx, ly, r.raw[n - 1]);
      const info = BRUSHES.find((b) => b.id === st.style);
      useEditor.getState().addStrokeLayer({
        brush: st.style,
        color: st.color,
        size: st.size,
        opacity: st.opacity,
        raw: r.raw,
        seed: r.seed,
        blendMode: info?.blend,
        select: false,
      });
    }
    const cv = cvRef.current;
    cv?.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ya liberado */
    }
  };

  if (!pos) return null;
  return (
    <div
      ref={hostRef}
      className={`brush-overlay${locked ? ' is-locked' : ''}${tool === 'eraser' ? ' is-eraser' : ''}`}
      style={{ left: pos.left, top: pos.top, width: doc.width * scale, height: doc.height * scale }}
      role="application"
      aria-label={locked ? 'Página bloqueada: no se puede dibujar' : tool === 'eraser' ? 'Zona de borrado' : 'Zona de dibujo'}
      data-testid="brush-overlay"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onPointerLeave={() => {
        if (ringRef.current && !run.current) ringRef.current.style.opacity = '0';
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={cvRef} width={Math.ceil(doc.width * scale * k)} height={Math.ceil(doc.height * scale * k)} />
      <div ref={ringRef} className="brush-ring" aria-hidden style={{ opacity: 0 }} />
    </div>
  );
}
