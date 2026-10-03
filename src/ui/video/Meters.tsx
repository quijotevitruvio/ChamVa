// Medidores del mezclador: lectura de sonoridad de la maestra (momentánea, a corto plazo, integrada, pico real) y
// barras de nivel por pista. Los datos llegan de los AudioWorklet (previewAudio.ts) solo mientras algún medidor está en pantalla.
import { useEffect, useRef, useState } from 'react';
import type { MasterMeter } from '../../video/engine/liveDsp';
import type { PreviewEngine } from './previewEngine';

/** Número en español con una cifra decimal; −∞ si no hay señal. */
export const fmtLu = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? '−∞' : v.toFixed(1).replace('.', ',').replace('-', '−'));

/** Suscribe el motor a los medidores mientras el componente está montado; repinta como mucho ~12 veces por segundo. */
export function useMasterMeter(engine: PreviewEngine, on = true): MasterMeter | null {
  const [m, setM] = useState<MasterMeter | null>(null);
  useEffect(() => {
    if (!on) return;
    const release = engine.acquireMetering();
    let last = 0;
    const un = engine.subscribeMeters(() => {
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      const cur = engine.meters.master;
      if (cur) setM({ ...cur });
    });
    return () => {
      un();
      release();
    };
  }, [engine, on]);
  return m;
}

/** Lectura de sonoridad y pico real de la salida (con «Reiniciar»). */
export function MasterReadout({ engine, meter, compact }: { engine: PreviewEngine; meter: MasterMeter | null; compact?: boolean }) {
  const tp = meter?.truePeak ?? -Infinity;
  return (
    <div className={`vx-lufs${compact ? ' compact' : ''}`} role="group" aria-label="Sonoridad de la salida">
      <div title="Sonoridad momentánea (ventana de 400 ms)">
        <b>{fmtLu(meter?.momentary)}</b>
        <span>M · LUFS</span>
      </div>
      <div title="Sonoridad a corto plazo (ventana de 3 s)">
        <b>{fmtLu(meter?.shortTerm)}</b>
        <span>S · LUFS</span>
      </div>
      <div title="Sonoridad integrada con puertas (BS.1770-4) desde el último reinicio">
        <b>{fmtLu(meter?.integrated)}</b>
        <span>I · LUFS</span>
      </div>
      <div className={tp > -1 ? 'over' : ''} title="Pico real (true peak) máximo; el limitador final lo mantiene por debajo de −1 dBTP">
        <b>{fmtLu(tp)}</b>
        <span>TP · dBTP</span>
      </div>
      <button type="button" className="mini" onClick={() => engine.resetMeter()} title="Reiniciar la sonoridad integrada y el pico">
        ↺
      </button>
    </div>
  );
}

const DB_MIN = -60;

/** Barra de nivel (dBFS) de dos canales con retención de pico; escribe directamente en el DOM (sin repintar React). */
export function LevelBar({ engine, trackId, label }: { engine: PreviewEngine; trackId: string; label: string }) {
  const l = useRef<HTMLDivElement | null>(null);
  const r = useRef<HTMLDivElement | null>(null);
  const hold = useRef({ l: 0, r: 0, at: 0 });
  useEffect(() => {
    const draw = () => {
      const p = engine.meters.tracks.get(trackId);
      const now = performance.now();
      const pct = (lin: number) => (lin > 1e-6 ? Math.max(0, Math.min(100, ((20 * Math.log10(lin) - DB_MIN) / -DB_MIN) * 100)) : 0);
      const pl = p ? pct(p.l) : 0;
      const pr = p ? pct(p.r) : 0;
      const h = hold.current;
      const dt = Math.min(0.2, (now - h.at) / 1000);
      h.at = now;
      h.l = Math.max(pl, h.l - 60 * dt); // caída de 60 %/s ≈ 36 dB/s
      h.r = Math.max(pr, h.r - 60 * dt);
      if (l.current) l.current.style.width = `${h.l}%`;
      if (r.current) r.current.style.width = `${h.r}%`;
      if (l.current) l.current.classList.toggle('hot', h.l > 98.3); // > −1 dBFS
      if (r.current) r.current.classList.toggle('hot', h.r > 98.3);
    };
    const un = engine.subscribeMeters(draw);
    const t = window.setInterval(draw, 90);
    return () => {
      un();
      clearInterval(t);
    };
  }, [engine, trackId]);
  return (
    <div className="vx-vu" role="img" aria-label={`Nivel de ${label}`}>
      <div ref={l} className="vx-vu-bar" />
      <div ref={r} className="vx-vu-bar" />
    </div>
  );
}
