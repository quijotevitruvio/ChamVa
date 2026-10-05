import { useEffect, useMemo, useRef, useState } from 'react';
import { BackButton } from './Modal';
import { useDismiss } from './useDismiss';
import { createPortal } from 'react-dom';
import { useEditor } from '../editor/state/store';
import type { TextLayer } from '../editor/core/types';
import { drawCurvedText, measureCurved } from '../editor/core/curvedText';
import { buildArcTable, curveBounds, defaultPathPoints, hasPathText, normalizePathPoints, pathPad, pathToSvgD } from '../editor/core/textFx';
import './textfx.css';

type Pt = { x: number; y: number };

const STAGE_W = 900;
const STAGE_H = 460;
const measureCtx = document.createElement('canvas').getContext('2d')!;

// Editor modal del trazado del texto (al estilo del editor de máscara): se arrastran
// los 4 puntos de control de una curva Bézier (dos extremos y dos asas) y se ve el
// texto sobre la curva en vivo. Al aceptar se guardan los puntos en la capa.
export function PathTextEditor({ layer, onClose }: { layer: TextLayer; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(rootRef, { onClose });
  const updateLayer = useEditor((s) => s.updateLayer);
  const fs = layer.fontSize;

  const initial = useMemo<Pt[]>(() => {
    if (hasPathText(layer)) return layer.pathText!.points.slice(0, 4).map((p) => ({ ...p }));
    const w = measureCurved(measureCtx, { ...layer, curve: 0, pathText: undefined }).width;
    return defaultPathPoints(w, fs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Encaje fijo de la vista: la curva inicial (con margen) cabe en el escenario.
  const view = useMemo(() => {
    const b = curveBounds(initial);
    const pad = pathPad(fs);
    const w = Math.max(1, b.maxX - b.minX + pad * 2);
    const h = Math.max(1, b.maxY - b.minY + pad * 2);
    const s = Math.min(STAGE_W / w, STAGE_H / h, 3);
    return { s, ox: (STAGE_W - (b.maxX - b.minX) * s) / 2 - b.minX * s, oy: (STAGE_H - (b.maxY - b.minY) * s) / 2 - b.minY * s };
  }, [initial, fs]);

  const [pts, setPts] = useState<Pt[]>(initial);
  const [offset, setOffset] = useState(layer.pathText?.offset ?? 0);
  const [drag, setDrag] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Vista previa: el texto sobre la curva (mismo dibujo que el lienzo).
  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
    const tmp: TextLayer = { ...layer, pathText: { points: pts, offset }, textEffect: 'none' };
    drawCurvedText(ctx, tmp, STAGE_W / view.s, STAGE_H / view.s);
  }, [pts, offset, view, layer]);

  const toScreen = (p: Pt): Pt => ({ x: p.x * view.s + view.ox, y: p.y * view.s + view.oy });
  const fromEvent = (e: React.PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * STAGE_W;
    const sy = ((e.clientY - r.top) / r.height) * STAGE_H;
    return { x: (Math.max(0, Math.min(STAGE_W, sx)) - view.ox) / view.s, y: (Math.max(0, Math.min(STAGE_H, sy)) - view.oy) / view.s };
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag === null) return;
    const p = fromEvent(e);
    setPts((list) => list.map((q, i) => (i === drag ? p : q)));
  };

  const apply = () => {
    const norm = normalizePathPoints(pts, fs);
    // La capa se mueve para que el texto no salte: ancla antigua → ancla nueva.
    const oldAnchor = hasPathText(layer) ? layer.pathText!.points[0] : { x: 0, y: fs * 0.8 };
    const dx = (oldAnchor.x - norm.points[0].x) * layer.scaleX;
    const dy = (oldAnchor.y - norm.points[0].y) * layer.scaleY;
    const r = (layer.rotation * Math.PI) / 180;
    updateLayer(layer.id, {
      pathText: { points: norm.points, offset },
      x: layer.x + dx * Math.cos(r) - dy * Math.sin(r),
      y: layer.y + dx * Math.sin(r) + dy * Math.cos(r),
    });
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sp = pts.map(toScreen);
  const total = useMemo(() => buildArcTable(pts).length, [pts]);

  return createPortal(
    <div className="tx-overlay" ref={rootRef} role="dialog" aria-modal="true" aria-label="Editor de trazado del texto">
      <div className="tx-bar">
        <BackButton onClick={onClose} />
        <span className="tx-title">Trazado del texto</span>
        <button onClick={() => setPts(defaultPathPoints(measureCurved(measureCtx, { ...layer, curve: 0, pathText: undefined }).width, fs))}>Restablecer</button>
        <label className="tx-offset">
          Inicio: {Math.round(offset)} px
          <input type="range" min={-400} max={1200} step={1} value={offset} onChange={(e) => setOffset(Number(e.target.value))} />
        </label>
        <span className="tx-spacer" />
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" onClick={apply}>
          Aceptar
        </button>
      </div>
      <div className="tx-stage-wrap">
        <div className="tx-stage" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
          <canvas ref={canvasRef} width={STAGE_W} height={STAGE_H} className="tx-canvas" />
          <svg
            ref={svgRef}
            className="tx-svg"
            viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
            onPointerMove={onMove}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
          >
            <line className="tx-handle-line" x1={sp[0].x} y1={sp[0].y} x2={sp[1].x} y2={sp[1].y} />
            <line className="tx-handle-line" x1={sp[3].x} y1={sp[3].y} x2={sp[2].x} y2={sp[2].y} />
            <path className="tx-curve" d={pathToSvgD(sp)} fill="none" />
            {sp.map((p, i) => (
              <circle
                key={i}
                className={`tx-pt ${i === 0 || i === 3 ? 'anchor' : 'handle'}${drag === i ? ' on' : ''}`}
                cx={p.x}
                cy={p.y}
                r={i === 0 || i === 3 ? 9 : 7}
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture(e.pointerId);
                  setDrag(i);
                }}
              />
            ))}
          </svg>
        </div>
      </div>
      <p className="tx-hint tx-foot">
        Arrastra los 4 puntos: los extremos (negros) fijan el inicio y el final; los círculos tiran de la curva. Longitud del trazado: {Math.round(total)} px.
        Solo se usa la primera línea del texto; la alineación (izquierda / centro / derecha) coloca el texto a lo largo del trazado.
      </p>
    </div>,
    document.body,
  );
}
