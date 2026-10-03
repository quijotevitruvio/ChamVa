// Sección «Velocidad» del inspector (V8): velocidad constante 0,1×–100×, curva de velocidad editable (puntos arrastrables,
// preajustes), invertir, conservar el tono, congelar fotograma, fotograma a imagen y bucle. Cada gesto es un paso de deshacer.
import { useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as VM from '../../video/model';
import { reverseCheck } from '../../video/engine/reverse';
import { addPoint, curveSamples, movePoint, removePoint, setPointSpeed, speedAt, SPEED_PRESETS } from '../../video/speed/curve';
import { averageSpeed, loopInfo, passDuration } from '../../video/speed/clipTime';
import { applySpeedPreset, curveFromSpeed, freezeFrame, setConstantSpeed, setLoop, setPitch, setReverse, setSpeedCurve, stillFromFrame } from '../../video/speed/speedOps';
import { fmtDur } from './ClipView';
import { Field } from './Field';
import type { PreviewEngine } from './previewEngine';
import { fmtSpeed, fromPx, nudgeSpeed, sliderToSpeed, speedToSlider, toPx, type SpeedBox } from './speedCurveMath';
import { toast } from '../toast';

interface Props {
  project: VM.VideoProject;
  clip: VM.Clip;
  engine: PreviewEngine;
  /** cabezal (s de la línea de tiempo) */
  t: number;
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => unknown;
  locked: boolean;
}

const BOX: SpeedBox = { w: 300, h: 150, pad: 14 };
const num = (v: number, d = 1) => v.toFixed(d).replace('.', ',');

/** Editor de la curva: SVG con puntos arrastrables (ratón, táctil y teclado). */
export function SpeedCurveEditor({ clip, t, commit, locked }: Pick<Props, 'clip' | 't' | 'commit' | 'locked'>) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const curve = clip.curve!;
  const lo = clip.inP;
  const hi = Math.max(clip.inP + 0.01, clip.outP);
  const id = clip.id;
  const upd = (fn: (c: typeof curve) => typeof curve, group = `curve:${id}`) => commit((p) => {
    const loc = VM.findClip(p, id);
    return loc?.clip.curve ? setSpeedCurve(p, id, fn(loc.clip.curve)) : p;
  }, group);

  const at = (e: ReactPointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const k = BOX.w / r.width;
    return fromPx(BOX, lo, hi, (e.clientX - r.left) * k, (e.clientY - r.top) * k);
  };
  const down = (i: number) => (e: ReactPointerEvent<SVGElement>) => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = i;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* evento sintético */
    }
  };
  const move = (e: ReactPointerEvent<SVGElement>) => {
    const i = drag.current;
    if (i === null || locked) return;
    const { s, v } = at(e);
    upd((c) => {
      const last = c.pts.length - 1;
      // el primero y el último punto no se mueven en horizontal (son los bordes del recorte)
      const moved = i === 0 || i === last ? c : movePoint(c, i, s, lo, hi);
      return setPointSpeed(moved, i, v);
    });
  };
  const up = (e: ReactPointerEvent<SVGElement>) => {
    drag.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* idem */
    }
  };
  const key = (i: number) => (e: ReactKeyboardEvent<SVGElement>) => {
    if (locked) return;
    const last = curve.pts.length - 1;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      upd((c) => removePoint(c, i), `curve-del:${id}`);
      return;
    }
    const span = (hi - lo) * (e.shiftKey ? 0.1 : 0.02);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      upd((c) => setPointSpeed(c, i, nudgeSpeed(c.pts[i].v, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)));
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && i !== 0 && i !== last) {
      e.preventDefault();
      upd((c) => movePoint(c, i, c.pts[i].s + (e.key === 'ArrowRight' ? span : -span), lo, hi));
    }
  };
  const addAt = (e: ReactPointerEvent<SVGElement>) => {
    if (locked) return;
    const { s, v } = at(e);
    upd((c) => addPoint(c, s, v), `curve-add:${id}`);
  };

  const pts = curve.pts.map((p, i) => ({ i, p, xy: toPx(BOX, lo, hi, p.s, p.v) }));
  const line = curveSamples(curve, lo, hi, 90).map(([s, v], k) => `${k ? 'L' : 'M'}${toPx(BOX, lo, hi, s, v).join(' ')}`).join(' ');
  const grid = [0.1, 1, 10, 100].map((v) => ({ v, y: toPx(BOX, lo, hi, lo, v)[1] }));
  const phSrc = Math.max(lo, Math.min(hi, VM.sourceTimeAt(clip, Math.max(clip.start, t))));
  const inside = t >= clip.start && t <= VM.clipEnd(clip);
  const ph = toPx(BOX, lo, hi, phSrc, speedAt(curve, phSrc))[0];
  return (
    <svg ref={svg} className="vx-speedcv" viewBox={`0 0 ${BOX.w} ${BOX.h}`} role="group" aria-label="Curva de velocidad: arrastra los puntos; doble clic añade uno; Supr quita el elegido" onDoubleClick={(e) => addAt(e as unknown as ReactPointerEvent<SVGElement>)}>
      <rect x={BOX.pad} y={BOX.pad} width={BOX.w - BOX.pad * 2} height={BOX.h - BOX.pad * 2} className="vx-cv-box" />
      {grid.map((g) => (
        <g key={g.v}>
          <line x1={BOX.pad} x2={BOX.w - BOX.pad} y1={g.y} y2={g.y} className={g.v === 1 ? 'vx-cv-one' : 'vx-cv-diag'} />
          <text x={BOX.pad + 2} y={g.y - 2} className="vx-cv-lbl">{fmtSpeed(g.v)}</text>
        </g>
      ))}
      <path d={line} className="vx-cv-line" fill="none" />
      {inside && <line x1={ph} x2={ph} y1={BOX.pad} y2={BOX.h - BOX.pad} className="vx-cv-ph" />}
      {pts.map(({ i, p, xy }) => (
        <circle
          key={i}
          cx={xy[0]}
          cy={xy[1]}
          r={7}
          className="vx-cv-handle"
          tabIndex={locked ? -1 : 0}
          role="slider"
          aria-label={`Punto ${i + 1} de la curva de velocidad`}
          aria-valuetext={`${fmtSpeed(p.v)} en ${num(p.s - lo, 2)} s del clip`}
          aria-valuenow={Math.round(p.v * 100)}
          aria-disabled={locked}
          onPointerDown={down(i)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key(i)}
        />
      ))}
    </svg>
  );
}

export function SpeedSection({ project, clip: c, engine, t, commit, locked }: Props) {
  const idp = useId();
  const [showCurve, setShowCurve] = useState(!!c.curve);
  const [freezeDur, setFreezeDur] = useState(2);
  const media = c.mediaId ? project.media[c.mediaId] : undefined;
  const video = c.kind === 'video';
  const dur = VM.clipDuration(c);
  const li = loopInfo(c);
  const chk = reverseCheck(c.outP - c.inP);
  const end = VM.clipEnd(c);
  const inside = t >= c.start && t <= end;
  const frozen = !!c.freeze;
  const isCurve = !!c.curve;
  const sp = c.speed || 1;
  const saved = isCurve ? (c.outP - c.inP) / Math.max(0.001, passDuration(c)) : sp;
  const upd = (fn: (p: VM.VideoProject) => VM.VideoProject, g?: string) => commit(fn, g ? `${g}:${c.id}` : undefined);

  const onFreeze = () => {
    const ids = { freeze: VM.uid(), right: VM.uid() };
    commit((p) => freezeFrame(p, c.id, t, freezeDur, ids));
  };
  const onStill = async () => {
    const blob = await engine.frameBlob();
    if (!blob) return toast('No se pudo crear la imagen.', 'error');
    const stamp = fmtDur(t).replace(':', '-');
    const m: VM.MediaAsset = { id: VM.uid(), kind: 'image', name: `Fotograma ${stamp}.png`, duration: 0, blob };
    const ids = { track: VM.uid(), clip: VM.uid() };
    commit((p) => stillFromFrame(p, m, t, 3, ids));
    toast('Fotograma añadido como imagen (3 s, en una pista nueva encima).', 'info');
  };

  return (
    <details className="vx-sec" open>
      <summary>Velocidad y tiempo</summary>

      {!frozen && (
        <div className="vx-field">
          <label htmlFor={`${idp}-sp`}>Velocidad</label>
          <input
            type="range"
            id={`${idp}-sp`}
            min={0}
            max={1000}
            step={1}
            value={speedToSlider(isCurve ? averageSpeed(c) : sp)}
            disabled={locked || isCurve}
            aria-valuetext={fmtSpeed(isCurve ? averageSpeed(c) : sp)}
            onChange={(e) => upd((p) => setConstantSpeed(p, c.id, sliderToSpeed(Number(e.target.value))), 'speed')}
          />
          <input
            type="number"
            className="vx-num"
            aria-label="Velocidad (valor)"
            min={0.1}
            max={100}
            step={0.05}
            value={Number((isCurve ? averageSpeed(c) : sp).toFixed(2))}
            disabled={locked || isCurve}
            onChange={(e) => Number.isFinite(Number(e.target.value)) && upd((p) => setConstantSpeed(p, c.id, Number(e.target.value)), 'speed')}
          />
          <span className="vx-unit">×</span>
        </div>
      )}
      {!frozen && (
        <p className="vx-note">
          {isCurve ? `Curva de velocidad (media ${fmtSpeed(averageSpeed(c))}). ` : 'De 0,1× (muy lento) a 100× (muy rápido). '}
          Dura {num(passDuration(c), 2)} s{Math.abs(saved - 1) > 0.005 ? ` (el original dura ${num(c.outP - c.inP, 2)} s)` : ''}.
        </p>
      )}

      {!frozen && (
        <>
          <div className="vx-presets">
            <button type="button" className="mini" aria-expanded={showCurve} onClick={() => setShowCurve((v) => !v)}>
              {showCurve ? '▾' : '▸'} Curva de velocidad
            </button>
            {isCurve && (
              <button type="button" className="mini" disabled={locked} onClick={() => upd((p) => setSpeedCurve(p, c.id, null))} title="Vuelve a una velocidad constante">
                Quitar curva
              </button>
            )}
          </div>
          {showCurve && (
            <div className="vx-speedbox">
              <div className="vx-field wide">
                <label htmlFor={`${idp}-pre`}>Preajuste</label>
                <select
                  id={`${idp}-pre`}
                  value=""
                  disabled={locked}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) upd((p) => applySpeedPreset(p, c.id, v));
                  }}
                >
                  <option value="">{isCurve ? 'Cambiar a…' : 'Elegir…'}</option>
                  {SPEED_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              {!isCurve ? (
                <button type="button" className="mini" disabled={locked} onClick={() => upd((p) => curveFromSpeed(p, c.id))}>
                  Editar como curva
                </button>
              ) : (
                <>
                  <SpeedCurveEditor clip={c} t={t} commit={commit} locked={locked} />
                  <label className="vx-check">
                    <input type="checkbox" checked={!!c.curve!.smooth} disabled={locked} onChange={(e) => upd((p) => setSpeedCurve(p, c.id, { ...c.curve!, smooth: e.target.checked || undefined }))} /> Transiciones suaves entre puntos
                  </label>
                  <p className="vx-note">Eje horizontal: posición en el clip. Eje vertical: velocidad (escala logarítmica). Arrastra un punto; doble clic en la curva añade otro; con un punto elegido, ←→ ↑↓ lo mueven y Supr lo quita.</p>
                </>
              )}
            </div>
          )}
        </>
      )}

      {video && (
        <label className="vx-check" title={!chk.ok ? chk.warnings[0] : undefined}>
          <input type="checkbox" checked={!!c.reverse} disabled={locked || frozen || (!chk.ok && !c.reverse)} onChange={(e) => upd((p) => setReverse(p, c.id, e.target.checked))} /> Invertir (imagen y sonido)
        </label>
      )}
      {c.kind === 'audio' && (
        <label className="vx-check">
          <input type="checkbox" checked={!!c.reverse} disabled={locked} onChange={(e) => upd((p) => setReverse(p, c.id, e.target.checked))} /> Invertir
        </label>
      )}
      {c.reverse && chk.warnings.map((w) => (
        <p key={w} className="vx-note vx-warn">{w}</p>
      ))}
      {c.reverse && <p className="vx-note">La vista previa de un clip invertido va sin sonido y a saltos; la exportación sale exacta.</p>}
      {!frozen && (
        <label className="vx-check" title="Al cambiar la velocidad, el sonido no se vuelve más agudo ni más grave">
          <input type="checkbox" checked={!!c.pitch} disabled={locked || !!c.reverse} onChange={(e) => upd((p) => setPitch(p, c.id, e.target.checked))} /> Conservar el tono del sonido
        </label>
      )}

      {video && (
        <div className="vx-freeze">
          <h5>Congelar fotograma</h5>
          {frozen ? (
            <Field label="Duración del congelado" value={c.freeze!} min={0.1} max={60} step={0.1} unit=" s" digits={1} disabled={locked} onChange={(v) => upd((p) => VM.updateClip(p, c.id, { freeze: v }), 'freeze')} />
          ) : (
            <>
              <Field label="Duración" value={freezeDur} min={0.1} max={30} step={0.1} unit=" s" digits={1} onChange={setFreezeDur} />
              <button type="button" className="mini" disabled={locked || !inside} title={inside ? 'Divide el clip en el cabezal y deja ese fotograma quieto el tiempo indicado' : 'Pon el cabezal dentro del clip'} onClick={onFreeze}>
                ❄ Congelar fotograma en el cabezal
              </button>
            </>
          )}
          <button type="button" className="mini" onClick={onStill} title="Guarda lo que se ve en el cabezal como imagen (PNG) y la pone encima en la línea de tiempo">
            📷 Fotograma a imagen
          </button>
        </div>
      )}

      {(video || c.kind === 'audio') && !frozen && (
        <div className="vx-loop">
          <h5>Bucle</h5>
          <label className="vx-check">
            <input
              type="checkbox"
              checked={!!c.loop}
              disabled={locked}
              onChange={(e) => upd((p) => setLoop(p, c.id, e.target.checked ? { n: 3 } : null))}
            />{' '}
            Repetir el tramo
          </label>
          {c.loop && (
            <>
              <div className="vx-field">
                <label htmlFor={`${idp}-lm`}>Repetir</label>
                <select
                  id={`${idp}-lm`}
                  value={c.loop.dur ? 'dur' : 'n'}
                  disabled={locked}
                  onChange={(e) => upd((p) => setLoop(p, c.id, e.target.value === 'dur' ? { dur: Math.max(passDuration(c) * 2, 1), xf: c.loop!.xf } : { n: 3, xf: c.loop!.xf }))}
                >
                  <option value="n">un número de veces</option>
                  <option value="dur">hasta una duración</option>
                </select>
              </div>
              {c.loop.dur ? (
                <Field label="Duración total" value={c.loop.dur} min={passDuration(c)} max={Math.max(600, c.loop.dur)} step={0.5} unit=" s" digits={1} disabled={locked} onChange={(v) => upd((p) => setLoop(p, c.id, { ...c.loop!, dur: v }), 'loop')} />
              ) : (
                <Field label="Veces" value={c.loop.n ?? 3} min={2} max={50} step={1} unit="×" digits={0} disabled={locked} onChange={(v) => upd((p) => setLoop(p, c.id, { ...c.loop!, n: v }), 'loop')} />
              )}
              <Field label="Fundido cruzado" value={c.loop.xf ?? 0} min={0} max={Math.max(0.1, passDuration(c) / 2)} step={0.05} unit=" s" digits={2} disabled={locked} onChange={(v) => upd((p) => setLoop(p, c.id, { ...c.loop!, xf: v || undefined }), 'loop')} />
              <p className="vx-note">
                {li ? `${li.passes} pasada${li.passes === 1 ? '' : 's'} · dura ${num(li.total, 2)} s.` : ''} Con fundido, el final de cada pasada se mezcla con el principio de la siguiente (en la vista previa el fundido es solo de imagen).
              </p>
            </>
          )}
        </div>
      )}
      <p className="vx-note vx-dur">Duración del clip: {fmtDur(dur)}{media ? ` · archivo ${fmtDur(media.duration)}` : ''}</p>
    </details>
  );
}
