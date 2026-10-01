import { useMemo, useRef, useState } from 'react';
import type { CurvePoint, ToneCurves } from '../editor/core/types';
import {
  IDENTITY_CURVE,
  addCurvePoint,
  curveLut,
  hasCurves,
  isIdentityCurve,
  moveCurvePoint,
  normalizeCurve,
  removeCurvePoint,
} from '../editor/core/curves';
import type { Histogram } from '../editor/core/levels';
import './adjust2.css';

type Channel = 'rgb' | 'r' | 'g' | 'b';
const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'rgb', label: 'RGB' },
  { id: 'r', label: 'Rojo' },
  { id: 'g', label: 'Verde' },
  { id: 'b', label: 'Azul' },
];

const PAD = 8;
const HIT = 10; // radio (en unidades 0..255) para coger un punto existente

interface Props {
  curves: ToneCurves | undefined;
  hist: Histogram | null;
  onStart: () => void; // checkpoint de deshacer antes de editar
  onLive: (c: ToneCurves | undefined) => void; // edición en vivo (sin historial)
  onFinal: (c: ToneCurves | undefined) => void; // cambio puntual (con historial)
}

// Sustituye un canal y devuelve undefined si todas las curvas quedan en identidad.
function withChannel(curves: ToneCurves | undefined, ch: Channel, pts: CurvePoint[] | undefined): ToneCurves | undefined {
  const next: ToneCurves = { ...(curves ?? {}) };
  if (!pts || isIdentityCurve(pts)) delete next[ch];
  else next[ch] = pts;
  return hasCurves(next) ? next : undefined;
}

export function CurvesEditor({ curves, hist, onStart, onLive, onFinal }: Props) {
  const [ch, setCh] = useState<Channel>('rgb');
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; pts: CurvePoint[] } | null>(null);

  const pts = useMemo(() => normalizeCurve(curves?.[ch]), [curves, ch]);
  const path = useMemo(() => {
    const lut = curveLut(pts);
    let d = '';
    for (let x = 0; x < 256; x += 4) d += `${x ? 'L' : 'M'}${x} ${255 - lut[x]} `;
    return d + `L255 ${255 - lut[255]}`;
  }, [pts]);

  const histPath = useMemo(() => {
    if (!hist || hist.max === 0) return '';
    const arr = ch === 'r' ? hist.r : ch === 'g' ? hist.g : ch === 'b' ? hist.b : hist.lum;
    let max = 0;
    for (let i = 0; i < 256; i++) if (arr[i] > max) max = arr[i];
    if (!max) return '';
    let d = 'M0 255 ';
    for (let i = 0; i < 256; i++) d += `L${i} ${255 - (arr[i] / max) * 255} `;
    return d + 'L255 255 Z';
  }, [hist, ch]);

  const toCurve = (e: React.PointerEvent | React.MouseEvent): CurvePoint => {
    const r = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * (256 + PAD * 2) - PAD;
    const sy = ((e.clientY - r.top) / r.height) * (256 + PAD * 2) - PAD;
    return [Math.min(255, Math.max(0, sx)), Math.min(255, Math.max(0, 255 - sy))];
  };

  const nearest = (list: CurvePoint[], x: number, y: number) => {
    let best = -1;
    let bd = HIT * HIT;
    list.forEach((p, i) => {
      const dd = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      if (dd <= bd) {
        bd = dd;
        best = i;
      }
    });
    return best;
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const [x, y] = toCurve(e);
    onStart();
    let list = pts;
    let index = nearest(list, x, y);
    if (index < 0) {
      const r = addCurvePoint(list, x, y);
      list = r.points;
      index = r.index;
    }
    drag.current = { index, pts: list };
    svgRef.current!.setPointerCapture(e.pointerId);
    onLive(withChannel(curves, ch, list));
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const dg = drag.current;
    if (!dg) return;
    const [x, y] = toCurve(e);
    dg.pts = moveCurvePoint(dg.pts, dg.index, x, y);
    onLive(withChannel(curves, ch, dg.pts));
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
  };

  // Doble clic o clic derecho sobre un punto interior: lo quita.
  const removeAt = (e: React.MouseEvent) => {
    e.preventDefault();
    const [x, y] = toCurve(e);
    const i = nearest(pts, x, y);
    if (i > 0 && i < pts.length - 1) onFinal(withChannel(curves, ch, removeCurvePoint(pts, i)));
  };

  const chHas = (c: Channel) => !isIdentityCurve(curves?.[c]);

  return (
    <div className="adj2-box">
      <div className="seg">
        {CHANNELS.map((c) => (
          <button key={c.id} className={ch === c.id ? 'on' : ''} onClick={() => setCh(c.id)}>
            {c.label}
            {chHas(c.id) ? ' •' : ''}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="adj2-plot"
        viewBox={`${-PAD} ${-PAD} ${256 + PAD * 2} ${256 + PAD * 2}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={removeAt}
        onContextMenu={removeAt}
      >
        {histPath && <path className="adj2-hist" d={histPath} />}
        {[64, 128, 192].map((v) => (
          <g key={v}>
            <line className="adj2-grid" x1={v} y1={0} x2={v} y2={255} />
            <line className="adj2-grid" x1={0} y1={v} x2={255} y2={v} />
          </g>
        ))}
        <rect className="adj2-grid" x={0} y={0} width={255} height={255} />
        <line className="adj2-diag" x1={0} y1={255} x2={255} y2={0} />
        <path className="adj2-curve" d={path} />
        {pts.map((p, i) => (
          <circle key={i} className="adj2-pt" cx={p[0]} cy={255 - p[1]} r={5} />
        ))}
      </svg>
      <div className="adj2-hint">
        Haz clic para añadir un punto y arrástralo. Doble clic o clic derecho sobre un punto lo quita.
      </div>
      <div className="adj2-row">
        <button onClick={() => onFinal(withChannel(curves, ch, IDENTITY_CURVE))} disabled={!chHas(ch)}>
          Restablecer {ch === 'rgb' ? 'maestra' : 'canal'}
        </button>
        <button onClick={() => onFinal(undefined)} disabled={!hasCurves(curves)}>
          Restablecer todas
        </button>
      </div>
    </div>
  );
}
