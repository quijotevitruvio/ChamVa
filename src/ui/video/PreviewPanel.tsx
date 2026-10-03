import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as VM from '../../video/model';
import { ASPECTS, outputSize, type Aspect } from '../../video/engine/formats';
import type { Fit } from '../../video/engine/timeline';
import type { PreviewEngine } from './previewEngine';
import { QUALITY_MODES, isQualityMode } from './preview/quality';
import { formatClock } from './timelineMath';
import * as TM from './transformMath';

interface Props {
  engine: PreviewEngine;
  project: VM.VideoProject;
  /** clip seleccionado (solo con un clip seleccionado salen las manijas) */
  selectedId: string | null;
  aspect: Aspect;
  fit: Fit;
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => void;
  endGroup: () => void;
  empty: boolean;
}

/** Hora actual: componente aparte para que solo él se repinte en cada fotograma. */
export function TimeLabel({ engine, duration }: { engine: PreviewEngine; duration: number }) {
  const t = useSyncExternalStore(engine.subscribeTime, engine.getTime);
  return (
    <span className="vx-time" aria-live="off">
      {formatClock(t)} <span className="vx-time-total">/ {formatClock(duration)}</span>
    </span>
  );
}

/** Calidad de la vista previa, aviso suave de «vista previa reducida» y fps reales (modo depuración). */
export function PreviewQuality({ engine }: { engine: PreviewEngine }) {
  useSyncExternalStore(engine.subscribeStats, engine.getStatsVersion);
  const m = engine.metrics();
  return (
    <div className="vx-pvbar">
      <label className="vx-pvq" title="Resolución de la vista previa (la exportación siempre sale en la calidad elegida al exportar)">
        Calidad de vista previa
        <select value={engine.qualityMode} onChange={(e) => isQualityMode(e.target.value) && engine.setQualityMode(e.target.value)} aria-label="Calidad de vista previa">
          {QUALITY_MODES.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
      </label>
      {m.reduced && (
        <span className="vx-pvnote" role="status">
          Vista previa reducida ({m.shortSide}p): tu equipo no llega a la fluidez completa. La exportación no se ve afectada.
        </span>
      )}
      <label className="vx-pvdbg" title="Mostrar fotogramas por segundo reales de la vista previa">
        <input type="checkbox" checked={engine.debug} onChange={(e) => engine.setDebug(e.target.checked)} /> fps
      </label>
    </div>
  );
}

function DebugOverlay({ engine }: { engine: PreviewEngine }) {
  useSyncExternalStore(engine.subscribeStats, engine.getStatsVersion);
  if (!engine.debug) return null;
  const m = engine.metrics();
  return (
    <div className="vx-dbg" aria-hidden="true">
      {m.fps.toFixed(0)} fps · {m.workMs.toFixed(1)} ms · perdidos {m.dropped} · {m.shortSide}p · caché {m.cachedFrames}
    </div>
  );
}

export function Transport({ engine, duration, onToggleSnap, snapOn }: { engine: PreviewEngine; duration: number; onToggleSnap?: () => void; snapOn?: boolean }) {
  const playing = useSyncExternalStore(engine.subscribeState, engine.getPlaying);
  return (
    <div className="vx-transport" role="toolbar" aria-label="Reproducción">
      <button type="button" onClick={() => engine.seek(0)} aria-label="Ir al inicio (Inicio)" title="Ir al inicio (Inicio)">⏮</button>
      <button type="button" className="primary" onClick={() => engine.toggle()} aria-label={playing ? 'Pausa (Espacio)' : 'Reproducir (Espacio)'} title={playing ? 'Pausa (Espacio)' : 'Reproducir (Espacio)'} disabled={duration <= 0}>
        {playing ? '⏸' : '▶'}
      </button>
      <button type="button" onClick={() => engine.seek(engine.duration)} aria-label="Ir al final (Fin)" title="Ir al final (Fin)">⏭</button>
      <TimeLabel engine={engine} duration={duration} />
      {onToggleSnap && (
        <button type="button" className={snapOn ? 'on' : ''} aria-pressed={snapOn} onClick={onToggleSnap} title="Imán: pegar a bordes y cabezal (mantén Alt para desactivarlo al arrastrar)">
          🧲 Imán
        </button>
      )}
    </div>
  );
}

type Mode = 'move' | 'scale' | 'rotate';

function TransformBox({ engine, clip, frame, fit, commit, endGroup }: { engine: PreviewEngine; clip: VM.Clip; frame: { w: number; h: number }; fit: Fit; commit: Props['commit']; endGroup: () => void }) {
  const [, force] = useState(0);
  useEffect(() => engine.subscribeState(() => force((n) => n + 1)), [engine]);
  const dims = engine.dimsFor(clip);
  const base = TM.baseBox(clip, engine.frameSize ? { w: engine.frameSize.width, h: engine.frameSize.height } : { w: 1, h: 1 }, dims, fit);
  const h = TM.handlesFor(clip.transform, base);
  const drag = useRef<{ mode: Mode; sx: number; sy: number; tr: VM.Transform; center: { x: number; y: number } } | null>(null);

  const patch = (tr: Partial<VM.Transform>, mode: Mode) => commit((p) => VM.updateClip(p, clip.id, { transform: tr }), `tf:${clip.id}:${mode}`);

  const down = (mode: Mode) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.closest<HTMLElement>('.vx-frame')!.getBoundingClientRect();
    drag.current = {
      mode,
      sx: e.clientX,
      sy: e.clientY,
      tr: { ...clip.transform },
      center: { x: rect.left + clip.transform.x * rect.width, y: rect.top + clip.transform.y * rect.height },
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* evento sintético */
    }
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const now = { x: e.clientX, y: e.clientY };
    if (d.mode === 'move') {
      const c = TM.moveCenter(d.tr.x, d.tr.y, now.x - d.sx, now.y - d.sy, frame, !e.altKey);
      patch(c, 'move');
    } else if (d.mode === 'scale') {
      patch({ scale: TM.scaleFromDrag(d.tr.scale, d.center, { x: d.sx, y: d.sy }, now) }, 'scale');
    } else {
      patch({ rotation: TM.rotationFromDrag(d.tr.rotation, d.center, { x: d.sx, y: d.sy }, now, e.shiftKey) }, 'rotate');
    }
  };
  const up = (e: ReactPointerEvent<HTMLElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* idem */
    }
    drag.current = null;
    endGroup();
  };
  const key = (e: ReactKeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const tr = clip.transform;
    const m: Record<string, Partial<VM.Transform>> = {
      ArrowLeft: { x: tr.x - step },
      ArrowRight: { x: tr.x + step },
      ArrowUp: { y: tr.y - step },
      ArrowDown: { y: tr.y + step },
    };
    if (e.altKey || e.ctrlKey || e.metaKey || !m[e.key]) return;
    e.preventDefault();
    e.stopPropagation();
    patch(m[e.key], 'move');
  };

  return (
    <div
      className="vx-tbox"
      style={{ left: `${h.cx * 100}%`, top: `${h.cy * 100}%`, width: `${h.w * 100}%`, height: `${h.h * 100}%`, transform: `translate(-50%,-50%) rotate(${h.rotation}deg)` }}
      onPointerDown={down('move')}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      tabIndex={0}
      role="group"
      aria-label="Posición del clip en la vista previa: flechas para mover, Mayús para pasos grandes"
    >
      {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
        <i key={c} className={`vx-handle ${c}`} onPointerDown={down('scale')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true" />
      ))}
      <i className="vx-rot-stem" aria-hidden="true" />
      <i className="vx-handle rot" onPointerDown={down('rotate')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true" title="Girar (Mayús = pasos de 15°)" />
    </div>
  );
}

export function PreviewPanel({ engine, project, selectedId, aspect, fit, commit, endGroup, empty }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 320, h: 180 });

  useLayoutEffect(() => {
    engine.attach(canvas.current);
    return () => engine.attach(null);
  }, [engine]);
  useEffect(() => engine.setFormat(aspect, fit), [engine, aspect, fit]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fitBox = () => {
      const r = el.getBoundingClientRect();
      const sz = outputSize(aspect, 720);
      const k = Math.min(r.width / sz.width, r.height / sz.height);
      setBox({ w: Math.max(40, Math.floor(sz.width * k)), h: Math.max(40, Math.floor(sz.height * k)) });
    };
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fitBox);
    });
    ro.observe(el);
    fitBox();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [aspect]);

  const loc = selectedId ? VM.findClip(project, selectedId) : null;
  const dur = VM.projectDuration(project);
  // la manija solo sale si el clip se ve en el instante actual (un booleano: no repinta en cada fotograma)
  const activeNow = useSyncExternalStore(
    engine.subscribeTime,
    () => (loc && loc.clip.kind !== 'audio' ? engine.time >= loc.clip.start && engine.time < VM.effectiveEnd(loc.clip, dur) && !loc.track.hidden : false),
  );

  const aspectLabel = ASPECTS.find((a) => a.id === aspect)?.label ?? aspect;
  return (
    <div className="vx-preview">
      <div className="vx-stage" ref={stage}>
        <div className="vx-frame" style={{ width: box.w, height: box.h }} aria-label={`Vista previa, ${aspectLabel}`}>
          <canvas ref={canvas} className="vx-canvas" aria-hidden="true" />
          {loc && activeNow && !loc.track.locked && <TransformBox engine={engine} clip={loc.clip} frame={box} fit={fit} commit={commit} endGroup={endGroup} />}
          <DebugOverlay engine={engine} />
          {empty && <p className="vx-empty">Importa video, imágenes o audio para empezar.</p>}
        </div>
      </div>
      <PreviewQuality engine={engine} />
    </div>
  );
}
