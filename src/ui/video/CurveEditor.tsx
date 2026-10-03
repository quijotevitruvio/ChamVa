import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Bezier } from '../../video/model';
import { DEFAULT_BEZIER } from '../../video/fx/ease';
import { fromPx, nudgeHandle, pathOf, samples, setHandle, toPx, type Box } from './curveMath';

const BOX: Box = { size: 160, pad: 14 };
const f2 = (n: number) => n.toFixed(2).replace('.', ',');

interface Props {
  /** curva de progreso a dibujar (p 0..1 → valor); en modo editable es la bézier misma */
  fn: (p: number) => number;
  /** manijas (solo si es editable) */
  bz?: Bezier;
  /** con `onChange` la curva se puede editar; sin él es una vista previa de solo lectura */
  onChange?: (bz: Bezier) => void;
  disabled?: boolean;
  label: string;
}

/** Editor ligero de curva de aceleración: SVG con dos manijas arrastrables (o con flechas del teclado). */
export function CurveEditor({ fn, bz, onChange, disabled, label }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<0 | 1 | null>(null);
  const editable = !!onChange && !!bz && !disabled;
  const cur = bz ?? DEFAULT_BEZIER;
  const [x0, y0] = toPx(BOX, 0, 0);
  const [x1, y1] = toPx(BOX, 1, 1);
  const h1 = toPx(BOX, cur[0], cur[1]);
  const h2 = toPx(BOX, cur[2], cur[3]);

  const pointFor = (e: ReactPointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const k = BOX.size / r.width;
    return fromPx(BOX, (e.clientX - r.left) * k, (e.clientY - r.top) * k);
  };
  const down = (which: 0 | 1) => (e: ReactPointerEvent<SVGElement>) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = which;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* evento sintético */
    }
    (e.currentTarget as SVGElement & HTMLElement).focus?.();
  };
  const move = (e: ReactPointerEvent<SVGElement>) => {
    if (drag.current === null || !editable) return;
    const [x, y] = pointFor(e);
    onChange!(setHandle(cur, drag.current, x, y));
  };
  const up = (e: ReactPointerEvent<SVGElement>) => {
    drag.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* idem */
    }
  };
  const key = (which: 0 | 1) => (e: ReactKeyboardEvent<SVGElement>) => {
    if (!editable) return;
    const s = e.shiftKey ? 0.1 : 0.02;
    const d: Record<string, [number, number]> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    onChange!(nudgeHandle(cur, which, m[0], m[1]));
  };

  const handle = (which: 0 | 1, p: [number, number], from: [number, number]) => (
    <g key={which}>
      <line x1={from[0]} y1={from[1]} x2={p[0]} y2={p[1]} className="vx-cv-stem" />
      <circle
        cx={p[0]}
        cy={p[1]}
        r={7}
        className="vx-cv-handle"
        tabIndex={editable ? 0 : -1}
        role="slider"
        aria-label={`Manija ${which + 1} de la curva`}
        aria-valuetext={`x ${f2(cur[which * 2])}, y ${f2(cur[which * 2 + 1])}`}
        aria-valuenow={Math.round(cur[which * 2 + 1] * 100)}
        aria-disabled={!editable}
        onPointerDown={down(which)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key(which)}
      />
    </g>
  );

  return (
    <svg ref={svg} className={`vx-curve${editable ? ' edit' : ''}`} viewBox={`0 0 ${BOX.size} ${BOX.size}`} role="group" aria-label={label}>
      <rect x={x0} y={y1} width={x1 - x0} height={y0 - y1} className="vx-cv-box" />
      <line x1={x0} y1={y0} x2={x1} y2={y1} className="vx-cv-diag" />
      <path d={pathOf(BOX, samples(fn))} className="vx-cv-line" fill="none" />
      {editable && (
        <>
          {handle(0, h1, [x0, y0])}
          {handle(1, h2, [x1, y1])}
        </>
      )}
    </svg>
  );
}
