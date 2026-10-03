// Sección «Reencuadre» del inspector (V8): pasar un video horizontal a 9:16 / 1:1 / 4:5 con un marco que se arrastra sobre
// el fotograma de origen, zoom, fotogramas del marco y «Reencuadre automático» (seguimiento del sujeto con revisión).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as VM from '../../video/model';
import { outputSize, type Aspect } from '../../video/engine/formats';
import type { Fit } from '../../video/engine/timeline';
import { REFRAME_ASPECTS, clampCenter, cropSize, geometry, reframeAt, type Dims } from '../../video/reframe/math';
import { autoReframe, type AutoReframeResult } from '../../video/reframe/auto';
import { TrackAbort, type NBox } from '../../video/reframe/tracker';
import { removeReframe, setReframe } from '../../video/speed/speedOps';
import { Field } from './Field';
import type { PreviewEngine } from './previewEngine';
import { toast } from '../toast';
import type { ReframeKey, ReframeSpec } from '../../video/model';

interface Props {
  project: VM.VideoProject;
  clip: VM.Clip;
  engine: PreviewEngine;
  t: number;
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => unknown;
  locked: boolean;
  aspect: Aspect;
  setAspect: (a: Aspect) => void;
  fit: Fit;
}

const ASPECT_LABEL: Record<ReframeSpec['aspect'], string> = { '9:16': '9:16 vertical', '1:1': '1:1 cuadrado', '4:5': '4:5 retrato', '16:9': '16:9 horizontal' };
const CW = 300;
const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0').replace('.', ',')}`;

export function ReframeSection({ project, clip: c, engine, t, commit, locked, aspect, setAspect, fit }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<Dims>({ w: 16, h: 9 });
  const [subject, setSubject] = useState<NBox | null>(null);
  const [marking, setMarking] = useState(false);
  const [busy, setBusy] = useState<{ ratio: number; stage: string } | null>(null);
  const [result, setResult] = useState<AutoReframeResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  const drag = useRef<boolean>(false);
  const spec = c.reframe;
  const media = c.mediaId ? project.media[c.mediaId] : undefined;
  const target: ReframeSpec['aspect'] = spec?.aspect ?? (aspect === '16:9' ? '9:16' : aspect);
  const out = (a: Aspect | ReframeSpec['aspect']): Dims => {
    const s = outputSize(a as Aspect, 720);
    return { w: s.width, h: s.height };
  };
  const local = Math.max(0, t - c.start);

  // fotograma de origen en el minilienzo (el elemento del clip si ya está listo; si no, la miniatura del medio)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const src = engine.sourceOf(c.id);
    const w = src?.w ?? dims.w;
    const h = src?.h ?? dims.h;
    if (src && (src.w !== dims.w || src.h !== dims.h)) setDims({ w: src.w, h: src.h });
    const ch = Math.round((CW * h) / w);
    if (cv.width !== CW || cv.height !== ch) {
      cv.width = CW;
      cv.height = ch;
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CW, ch);
    if (src) ctx.drawImage(src.el, 0, 0, CW, ch);
    else if (media?.thumb) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, CW, ch);
      img.src = media.thumb;
    }
    // el elemento puede tardar en llegar al fotograma del cabezal: se repinta un momento después
    const id = window.setTimeout(() => setTick((n) => (n < 3 ? n + 1 : n)), 160);
    return () => window.clearTimeout(id);
  }, [engine, c.id, t, tick, dims.w, dims.h, media?.thumb]);
  useEffect(() => setTick(0), [t, c.id]);

  const geo = (a: ReframeSpec['aspect']) => geometry(dims, out(a), fit);
  const cur = spec ? reframeAt(spec, local) : { cx: 0.5, cy: 0.5, zoom: 1 };
  const g = geo(target);
  const { cw, ch } = cropSize(g, out(target), cur.zoom);
  const k = clampCenter(g, out(target), cur);

  const apply = (next: ReframeSpec, group?: string) => commit((p) => setReframe(p, c.id, next, dims, out(next.aspect), fit), group ? `${group}:${c.id}` : undefined);
  const base: ReframeSpec = spec ?? { aspect: target, cx: 0.5, cy: 0.5, zoom: 1 };

  const chooseAspect = (a: ReframeSpec['aspect']) => {
    setAspect(a);
    apply({ ...base, aspect: a });
  };
  const setZoom = (z: number) => apply({ ...base, zoom: z }, 'rzoom');
  const place = (cx: number, cy: number) => {
    const kk = clampCenter(g, out(target), { cx, cy, zoom: cur.zoom });
    if (base.track?.length) {
      // con fotogramas: el marco se guarda como fotograma del cabezal (el existente cercano se actualiza)
      const tr = base.track.filter((q) => Math.abs(q.t - local) > 0.05);
      tr.push({ t: Math.round(local * 1000) / 1000, cx: kk.cx, cy: kk.cy });
      tr.sort((a, b) => a.t - b.t);
      apply({ ...base, track: tr }, 'rframe');
    } else apply({ ...base, cx: kk.cx, cy: kk.cy }, 'rframe');
  };
  const pt = (e: ReactPointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (locked) return;
    const p = pt(e);
    if (marking) {
      setSubject({ cx: p.x, cy: p.y, w: 0.18, h: 0.18 * (dims.w / dims.h) });
      setMarking(false);
      return;
    }
    drag.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sintético */
    }
    place(p.x, p.y);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || locked) return;
    const p = pt(e);
    place(p.x, p.y);
  };
  const up = () => {
    drag.current = false;
  };

  const run = async () => {
    if (!media) return;
    const ac = new AbortController();
    abort.current = ac;
    setBusy({ ratio: 0, stage: 'Preparando' });
    setResult(null);
    try {
      const r = await autoReframe(c, media, { aspect: target, out: out(target), fit, subject: subject ?? undefined, zoom: base.zoom > 1 ? base.zoom : undefined, signal: ac.signal, onProgress: (ratio, stage) => setBusy({ ratio, stage }) });
      setDims(r.src);
      setResult(r);
      const next: ReframeSpec = { aspect: target, cx: r.keys[0]?.cx ?? 0.5, cy: r.keys[0]?.cy ?? 0.5, zoom: base.zoom, track: r.keys };
      commit((p) => setReframe(p, c.id, next, r.src, out(target), fit));
      setAspect(target);
      toast(`Reencuadre automático: ${r.keys.length} fotogramas del marco. Revísalo y corrige donde haga falta.`, 'info');
    } catch (e) {
      if (!(e instanceof TrackAbort) && (e as Error).name !== 'AbortError') toast(`No se pudo seguir al sujeto: ${(e as Error).message}`, 'error');
    } finally {
      abort.current = null;
      setBusy(null);
    }
  };
  useEffect(() => () => abort.current?.abort(), []);

  const track: ReframeKey[] = spec?.track ?? [];
  const delKey = (i: number) => {
    const tr = track.filter((_, j) => j !== i);
    apply({ ...base, track: tr.length ? tr : undefined });
  };
  const addKey = () => apply({ ...base, track: [...track.filter((q) => Math.abs(q.t - local) > 0.05), { t: Math.round(local * 1000) / 1000, cx: k.cx, cy: k.cy }].sort((a, b) => a.t - b.t) });

  const markerStyle = { left: `${(k.cx - cw / 2) * 100}%`, top: `${(k.cy - ch / 2) * 100}%`, width: `${cw * 100}%`, height: `${ch * 100}%` };
  return (
    <details className="vx-sec" open={!!spec}>
      <summary>Reencuadre{spec ? ` · ${spec.aspect}` : ''}</summary>
      <p className="vx-note">Pasa un video horizontal a vertical, cuadrado o retrato: elige la proporción y arrastra el marco sobre el fotograma.</p>
      <div className="vx-presets" role="group" aria-label="Proporción de salida">
        {REFRAME_ASPECTS.map((a) => (
          <button key={a} type="button" className={`mini${(spec?.aspect ?? '') === a ? ' on' : ''}`} aria-pressed={spec?.aspect === a} disabled={locked || !!busy} onClick={() => chooseAspect(a)}>
            {ASPECT_LABEL[a]}
          </button>
        ))}
      </div>
      <div
        className={`vx-refbox${marking ? ' marking' : ''}`}
        style={{ aspectRatio: `${dims.w} / ${dims.h}` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="group"
        aria-label={marking ? 'Haz clic sobre el sujeto' : 'Fotograma de origen con el marco de recorte: arrástralo'}
      >
        <canvas ref={canvas} className="vx-refcv" />
        {spec && <div className="vx-refframe" style={markerStyle} aria-hidden="true" />}
        {subject && <div className="vx-refsubj" style={{ left: `${subject.cx * 100}%`, top: `${subject.cy * 100}%` }} aria-hidden="true" />}
      </div>
      {!spec && <p className="vx-note">Elige una proporción para empezar.</p>}
      {spec && (
        <>
          <Field label="Zoom del marco" value={spec.zoom} min={1} max={6} step={0.05} unit="×" digits={2} disabled={locked || !!busy} onChange={setZoom} />
          <div className="vx-presets">
            <button type="button" className="mini" disabled={locked || !!busy} onClick={addKey} title="Guarda la posición actual del marco como fotograma en el cabezal">
              ◆ Fotograma del marco aquí
            </button>
            <button type="button" className="mini" disabled={locked || !!busy} onClick={() => commit((p) => removeReframe(p, c.id))}>
              Quitar reencuadre
            </button>
          </div>
        </>
      )}
      <div className="vx-presets">
        <button type="button" className={`mini${marking ? ' on' : ''}`} aria-pressed={marking} disabled={locked || !!busy} onClick={() => setMarking((m) => !m)} title="Opcional: señala qué seguir; sin esto se elige lo que más se mueve">
          🎯 {subject ? 'Cambiar sujeto' : 'Marcar sujeto'}
        </button>
        {subject && (
          <button type="button" className="mini" onClick={() => setSubject(null)}>
            Quitar marca
          </button>
        )}
        <button type="button" className="vx-primary" disabled={locked || !!busy || !media} onClick={run}>
          ✨ Reencuadre automático
        </button>
      </div>
      {busy && (
        <div className="vx-prog" role="status" aria-live="polite">
          <progress value={busy.ratio} max={1} aria-label="Progreso del seguimiento" />
          <span>
            {busy.stage} · {Math.round(busy.ratio * 100)} %
          </span>
          <button type="button" className="mini" onClick={() => abort.current?.abort()}>
            Cancelar
          </button>
        </div>
      )}
      {result && !busy && (
        <p className="vx-note">
          {result.confident ? (subject ? 'Sujeto marcado por ti' : 'Sujeto elegido por el movimiento') : 'No se vio un sujeto claro: se siguió el centro; marca el sujeto y repite'}. {result.samples} muestras
          {result.lost ? `, ${result.lost} sin ver al sujeto` : ''}, {String(Math.round(result.elapsedMs / 100) / 10).replace('.', ',')} s.
        </p>
      )}
      {track.length > 0 && (
        <details className="vx-reflist">
          <summary>Fotogramas del marco ({track.length})</summary>
          <ol>
            {track.map((q, i) => (
              <li key={`${q.t}-${i}`}>
                <button type="button" className="mini" onClick={() => engine.seek(c.start + q.t)} title="Ir a este fotograma">
                  {mmss(q.t)}
                </button>
                <span>
                  {Math.round(q.cx * 100)} %, {Math.round(q.cy * 100)} %
                </span>
                <button type="button" className="mini" disabled={locked} onClick={() => delKey(i)} aria-label={`Quitar el fotograma de ${mmss(q.t)}`}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <p className="vx-note">Para corregir: ve a un instante, arrastra el marco (se guarda como fotograma) o quita los que sobren.</p>
        </details>
      )}
    </details>
  );
}
