import { useMemo, useRef } from 'react';
import type { LevelsAdjust } from '../editor/core/types';
import {
  NEUTRAL_LEVELS,
  gammaToMidFraction,
  isNeutralLevels,
  midFractionToGamma,
  type Histogram,
} from '../editor/core/levels';
import './adjust2.css';

type Handle = 'black' | 'mid' | 'white';

interface Props {
  levels: LevelsAdjust | undefined;
  hist: Histogram | null;
  onStart: () => void;
  onLive: (l: LevelsAdjust | undefined) => void;
  onFinal: (l: LevelsAdjust | undefined) => void;
}

const W = 256;
const HEIGHT = 84;

export function LevelsEditor({ levels, hist, onStart, onLive, onFinal }: Props) {
  const lv: LevelsAdjust = { ...NEUTRAL_LEVELS, ...(levels ?? {}) };
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Handle | null>(null);

  const emit = (next: LevelsAdjust, final = false) => {
    const out = isNeutralLevels(next) ? undefined : next;
    (final ? onFinal : onLive)(out);
  };

  const midX = lv.inBlack + (lv.inWhite - lv.inBlack) * gammaToMidFraction(lv.gamma);

  const histPath = useMemo(() => {
    if (!hist || hist.max === 0) return '';
    // Escala suave para que un pico enorme (negro puro) no aplaste el resto.
    const top = Math.sqrt(hist.max);
    let d = `M0 ${HEIGHT} `;
    for (let i = 0; i < 256; i++) d += `L${i} ${HEIGHT - (Math.sqrt(hist.lum[i]) / top) * HEIGHT} `;
    return d + `L255 ${HEIGHT} Z`;
  }, [hist]);

  const posX = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * W));
  };

  const apply = (h: Handle, x: number) => {
    if (h === 'black') {
      emit({ ...lv, inBlack: Math.round(Math.min(x, lv.inWhite - 2)) });
    } else if (h === 'white') {
      emit({ ...lv, inWhite: Math.round(Math.max(x, lv.inBlack + 2)) });
    } else {
      const t = (x - lv.inBlack) / Math.max(1, lv.inWhite - lv.inBlack);
      emit({ ...lv, gamma: Math.round(midFractionToGamma(t) * 100) / 100 });
    }
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const x = posX(e);
    const cands: [Handle, number][] = [
      ['black', lv.inBlack],
      ['mid', midX],
      ['white', lv.inWhite],
    ];
    cands.sort((a, b) => Math.abs(a[1] - x) - Math.abs(b[1] - x));
    drag.current = cands[0][0];
    onStart();
    svgRef.current!.setPointerCapture(e.pointerId);
    apply(drag.current, x);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current) apply(drag.current, posX(e));
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
  };

  // Auto: recorta el 0,5 % de cada extremo del histograma.
  const auto = () => {
    if (!hist || hist.count === 0) return;
    const cut = hist.count * 0.005;
    let acc = 0;
    let lo = 0;
    for (; lo < 254; lo++) {
      acc += hist.lum[lo];
      if (acc > cut) break;
    }
    acc = 0;
    let hi = 255;
    for (; hi > lo + 2; hi--) {
      acc += hist.lum[hi];
      if (acc > cut) break;
    }
    emit({ ...NEUTRAL_LEVELS, inBlack: lo, inWhite: Math.max(hi, lo + 2) }, true);
  };

  const tri = (x: number) => `${x - 6},${14} ${x + 6},${14} ${x},${2}`;

  return (
    <div className="adj2-box">
      <svg className="adj2-plot" viewBox={`0 0 ${W} ${HEIGHT}`} style={{ cursor: 'default' }}>
        {histPath && <path className="adj2-hist" d={histPath} />}
        <rect className="adj2-grid" x={0.5} y={0.5} width={W - 1} height={HEIGHT - 1} />
      </svg>
      <svg
        ref={svgRef}
        className="adj2-handles"
        viewBox={`0 0 ${W} 16`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <polygon className="adj2-handle black" points={tri(lv.inBlack)} />
        <polygon className="adj2-handle mid" points={tri(midX)} />
        <polygon className="adj2-handle white" points={tri(lv.inWhite)} />
      </svg>
      <div className="adj2-readout">
        <span>Negros {Math.round(lv.inBlack)}</span>
        <span>Medios {lv.gamma.toFixed(2)}</span>
        <span>Blancos {Math.round(lv.inWhite)}</span>
      </div>
      <label className="prop">
        Salida negros: {Math.round(lv.outBlack)}
        <input
          type="range"
          min={0}
          max={255}
          step={1}
          value={lv.outBlack}
          onPointerDown={onStart}
          onChange={(e) => emit({ ...lv, outBlack: Number(e.target.value) })}
        />
      </label>
      <label className="prop">
        Salida blancos: {Math.round(lv.outWhite)}
        <input
          type="range"
          min={0}
          max={255}
          step={1}
          value={lv.outWhite}
          onPointerDown={onStart}
          onChange={(e) => emit({ ...lv, outWhite: Number(e.target.value) })}
        />
      </label>
      <div className="adj2-row">
        <button onClick={auto} disabled={!hist || hist.count === 0}>
          Auto
        </button>
        <button onClick={() => onFinal(undefined)} disabled={isNeutralLevels(levels)}>
          Restablecer niveles
        </button>
      </div>
    </div>
  );
}
