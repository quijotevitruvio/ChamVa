// V9b: interfaz de «Quitar fondo» y «Estabilizar» (efectos de origen de V9). Controles del efecto, botón «Calcular» con el
// consentimiento de descarga del modelo, progreso por fotograma con tiempo restante, cancelar/reanudar, vista previa del
// recorte de la estabilización, aviso de la vista previa y la pregunta antes de exportar. La lógica está en `video/ai/*`
// (aiPlan, jobs, persist) y se prueba allí; aquí solo se dibuja. Nada se descarga sin pulsar «Descargar» con el tamaño a la vista.
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as VM from '../../video/model';
import { clipSourceRange } from '../../video/ai/aiFrame';
import { AI_KIND_LABEL, exportPending, formatDownload as formatBytes, exportPromptText, estimateText, noticeItemsAt, partText, rangeCoverage, scopeRange, stabPreview, type AiKind, type AiScope, type ExportPending, type Marks } from '../../video/ai/aiPlan';
import { aiJobs } from '../../video/ai/jobsDefault';
import { MATTE_MODEL, matteModelBytes } from '../../video/ai/models';
import { estimateMatte, formatEta } from '../../video/ai/matteMath';
import { estimateStab } from '../../video/ai/stabMath';
import { isBusy } from '../../video/ai/jobs';
import { motionCache } from '../../video/ai/cache';
import { aiParamsOf } from '../../video/ai/aiFrame';
import { updateFx } from '../../video/fx/clipOps';
import { effectiveParams, fxDef } from '../../video/fx/effects';
import { Modal } from '../Modal';
import { ParamControl, type FxCtx, type KeyClipboard } from './FxInspector';
import type { PreviewEngine } from './previewEngine';
import { useAiCacheVersion, useAiJob, useMatteModel } from './useAi';

export const ORIGIN = `huggingface.co/${MATTE_MODEL.repo}`;
const pct = (r: number) => `${Math.round(r * 100)} %`;

// ---------- barra de progreso accesible ----------
function Bar({ ratio, label }: { ratio: number; label: string }) {
  return (
    <div className="vx-aibar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <div className="vx-aibar-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
    </div>
  );
}

// ---------- calcular ----------

interface CalcProps {
  ctx: FxCtx;
  kind: AiKind;
  marks?: Marks;
}

/** Alcance, estimación, estado de lo calculado, «Calcular» y progreso de UN efecto de origen de UN clip. */
export function AiCalc({ ctx, kind, marks = { in: null, out: null } }: CalcProps) {
  const { project, clip, engine } = ctx;
  const job = useAiJob();
  const cacheV = useAiCacheVersion();
  const { status: model } = useMatteModel();
  const [scope, setScope] = useState<AiScope>('clip');
  // el mismo clip puede mostrarse a la vez en la pestaña Efectos y en el inspector: el grupo de radios es de cada instancia
  const group = useId();
  const sc = useMemo(() => scopeRange(project, clip.id, scope, marks), [project, clip.id, scope, marks.in, marks.out]);
  const range: [number, number] = sc.ok ? sc.range : clipSourceRange(clip);
  const cov = useMemo(() => rangeCoverage(project, clip.id, kind, range, undefined, undefined), [project, clip.id, kind, range[0], range[1], cacheV]);
  const prm = aiParamsOf(clip, clip.start);
  const mode = prm.matte?.mode ?? 'quality';
  const dims = engine.dimsFor(clip);
  const srcW = dims && dims.w > 64 ? dims.w : 1920;
  const srcH = dims && dims.h > 64 ? dims.h : 1080;
  const seconds = Math.max(0, range[1] - range[0]);
  const est = useMemo(() => {
    if (kind === 'bgremove') return estimateMatte({ seconds, srcW, srcH, mode, msPerFrame: aiJobs.measured[mode], cached: cov?.have ?? 0 });
    const e = estimateStab(seconds);
    return { frames: Math.max(0, e.frames - (cov?.have ?? 0)), seconds: e.seconds, cacheBytes: e.bytes, peakBytes: e.bytes, inW: 0, inH: 0, msPerFrame: 0, warnings: [] as string[] };
  }, [kind, seconds, srcW, srcH, mode, cov?.have, cacheV]);

  const mine = job.clipId === clip.id && job.kind === kind;
  const running = isBusy(job) && mine && job.phase === 'running';
  const otherBusy = isBusy(job) && !(job.items.some((i) => i.clipId === clip.id && i.kind === kind));
  const queued = isBusy(job) && !mine && job.items.some((i) => i.clipId === clip.id && i.kind === kind);
  const complete = !!cov && cov.have >= cov.total;
  const needModel = kind === 'bgremove' && !!model && !model.installed;
  const missing = cov ? cov.total - cov.have : 0;
  const lastMine = !isBusy(job) && job.phase !== 'idle' && job.items.some((i) => i.clipId === clip.id && i.kind === kind);

  const start = () => void aiJobs.start([{ clipId: clip.id, kind, range: scope === 'marks' && sc.ok ? sc.range : undefined }]);
  const label = needModel ? `Descargar el modelo (${formatBytes(matteModelBytes())}) y calcular…` : cov && cov.have > 0 && !complete ? `Continuar el cálculo (faltan ${missing} fotogramas)` : 'Calcular';

  return (
    <div className="vx-aicalc" role="group" aria-label={`Calcular ${AI_KIND_LABEL[kind].toLowerCase()}`}>
      <fieldset className="vx-aiscope">
        <legend>Qué calcular</legend>
        <label>
          <input type="radio" name={`aiscope-${group}`} checked={scope === 'clip'} onChange={() => setScope('clip')} disabled={isBusy(job)} /> Clip completo
        </label>
        <label title="Usa las marcas de entrada/salida de la línea de tiempo">
          <input type="radio" name={`aiscope-${group}`} checked={scope === 'marks'} onChange={() => setScope('marks')} disabled={isBusy(job)} /> Selección (entre marcas)
        </label>
      </fieldset>
      {!sc.ok && <p className="vx-note" role="note">{sc.reason}</p>}
      {sc.ok && cov && (
        <p className="vx-note" aria-live="polite">
          <b>{partText({ kind, pct: complete ? 100 : Math.floor((100 * cov.have) / Math.max(1, cov.total)), have: cov.have, total: cov.total })}</b> en {sc.label}.
        </p>
      )}
      {sc.ok && !complete && !running && <p className="vx-note">{estimateText(est)}</p>}
      {est.warnings.map((w) => (
        <p key={w} className="vx-aiwarn" role="note">{w}</p>
      ))}
      {kind === 'bgremove' && (
        <p className="vx-note">
          {model ? (model.installed ? `Modelo MODNet descargado (${formatBytes(model.bytesTotal)}): el cálculo no usa internet.` : `Modelo MODNet sin descargar: ${formatBytes(matteModelBytes())} · ${MATTE_MODEL.license}. Te lo pediremos antes.`) : 'Comprobando el modelo…'}
        </p>
      )}
      {running ? (
        <div className="vx-aijob" role="status" aria-live="polite">
          <Bar ratio={job.ratio} label={`${AI_KIND_LABEL[kind]}: progreso`} />
          <span>
            {job.stage} · {job.done}/{job.total} · {pct(job.ratio)}
            {job.eta !== undefined ? ` · quedan ~${formatEta(job.eta)}` : ''}
          </span>
          <button type="button" onClick={() => aiJobs.cancel()} disabled={job.cancelling}>{job.cancelling ? 'Cancelando…' : '✕ Cancelar'}</button>
          {job.cancelling && <small className="vx-note">Termina el fotograma en curso (hasta unos segundos); lo ya calculado se conserva.</small>}
        </div>
      ) : (
        <div className="vx-actions">
          <button type="button" className="primary" onClick={start} disabled={!sc.ok || otherBusy || queued || complete} title={complete ? 'Todo lo de este tramo ya está calculado' : otherBusy ? 'Hay otro cálculo en marcha' : undefined}>
            {complete ? '✓ Calculado' : label}
          </button>
          {cov && cov.have > 0 && !isBusy(job) && <small className="vx-note">Lo ya calculado no se repite.</small>}
        </div>
      )}
      {(otherBusy || queued) && <p className="vx-note">Hay otro cálculo en marcha ({AI_KIND_LABEL[job.kind ?? 'bgremove']}, {pct(job.ratio)}). Espera o cancélalo desde la barra inferior.</p>}
      {lastMine && job.message && (
        <p className={job.phase === 'error' ? 'vx-aiwarn' : 'vx-note'} role={job.phase === 'error' ? 'alert' : 'status'}>
          {job.message} <button type="button" className="mini" onClick={() => aiJobs.dismiss()}>Entendido</button>
        </p>
      )}
    </div>
  );
}

// ---------- vista previa del recorte de la estabilización ----------

/** Dibuja el encuadre original, el recorte que resulta y el recorrido de la corrección con los parámetros actuales. */
export function StabPreviewBox({ ctx }: { ctx: FxCtx }) {
  const { clip } = ctx;
  const cacheV = useAiCacheVersion();
  const prm = aiParamsOf(clip, clip.start).stab;
  const sp = useMemo(() => (prm && clip.mediaId ? stabPreview(motionCache, clip.mediaId, clipSourceRange(clip), prm) : null), [clip, prm?.smooth, prm?.maxZoom, prm?.rotation, cacheV]);
  if (!sp) return <p className="vx-note">Calcula el análisis para ver aquí el recorte que resultará y cuánto baja el temblor.</p>;
  const W = 160;
  const H = 90;
  const iw = W / sp.zoom;
  const ih = H / sp.zoom;
  const pts = sp.path.map((q) => `${(W / 2 + q.x * W).toFixed(1)},${(H / 2 + q.y * H).toFixed(1)}`).join(' ');
  const txt = `Recorte de ${sp.cropPct.toString().replace('.', ',')} % del encuadre. Temblor ${sp.before.toFixed(1).replace('.', ',')} px a ${sp.after.toFixed(1).replace('.', ',')} px (baja un ${Math.round(sp.reduction * 100)} %).`;
  return (
    <figure className="vx-stabprev">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={txt}>
        <rect x="0.5" y="0.5" width={W - 1} height={H - 1} className="vx-sp-frame" />
        <rect x={(W - iw) / 2} y={(H - ih) / 2} width={iw} height={ih} className="vx-sp-crop" />
        {pts && <polyline points={pts} className="vx-sp-path" />}
      </svg>
      <figcaption>
        <b>Recorte resultante:</b> {sp.cropPct.toString().replace('.', ',')} % (zoom ×{sp.zoom.toFixed(2).replace('.', ',')}). Temblor {sp.before.toFixed(1).replace('.', ',')} → {sp.after.toFixed(1).replace('.', ',')} px (−{Math.round(sp.reduction * 100)} %).
        {sp.clamped && <span className="vx-aiwarn"> El tope de recorte limita la corrección: sube «Recorte máximo» si quedan sacudidas.</span>}
        <small>Marco = fotograma original · rectángulo = lo que se verá · línea = recorrido del encuadre.</small>
      </figcaption>
    </figure>
  );
}

// ---------- controles de un efecto de origen ----------

/** Controles de «Quitar fondo» o «Estabilizar»: solo lo que aplica a lo elegido, y debajo el cálculo. */
export function AiFxControls({ ctx, fx, marks, idp = '' }: { ctx: FxCtx; fx: VM.FxInstance; marks?: Marks; idp?: string }) {
  const { project, clip, commit, locked } = ctx;
  const def = fxDef(fx.type);
  const kind = fx.type as AiKind;
  const q = effectiveParams(fx);
  const images = Object.values(project.media).filter((m) => m.kind === 'image' && !m.missing);
  if (!def) return null;
  const show = (key: string) => {
    if (kind !== 'bgremove') return true;
    if (key === 'color') return q.bg === 'color';
    if (key === 'bgMedia') return q.bg === 'image';
    if (key === 'blur') return q.bg === 'blur';
    return true;
  };
  return (
    <div className="vx-aifx">
      {def.params.filter((pd) => show(pd.key)).map((pd) =>
        pd.key === 'bgMedia' ? (
          <div key={pd.key} className="vx-field wide">
            <label htmlFor={`${idp}vx-p-${fx.id}-bgMedia`}>{pd.label}</label>
            <select id={`${idp}vx-p-${fx.id}-bgMedia`} value={typeof fx.p?.bgMedia === 'string' ? fx.p.bgMedia : ''} disabled={locked} onChange={(e) => commit((p) => updateFx(p, clip.id, fx.id, { p: { bgMedia: e.target.value } }))}>
              <option value="">{images.length ? 'Elegir imagen…' : 'No hay imágenes en la biblioteca'}</option>
              {images.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <ParamControl key={pd.key} ctx={ctx} fxId={fx.id} pd={pd} value={fx.p?.[pd.key]} idp={idp} />
        ),
      )}
      {kind === 'bgremove' && (
        <p className="vx-note">
          El modo y el modelo cambian lo que se calcula (cada modo guarda sus propias máscaras); el fondo, el borde y la coherencia se ven al instante sin recalcular. «Rápido» es unas 3 veces más veloz y de menos detalle.
        </p>
      )}
      {kind === 'stabilize' && <StabPreviewBox ctx={ctx} />}
      {clip.kind === 'video' && clip.mediaId ? <AiCalc ctx={ctx} kind={kind} marks={marks} /> : <p className="vx-note">Este efecto solo funciona en clips de video.</p>}
    </div>
  );
}


// ---------- pestaña Efectos: controles del clip seleccionado ----------

export interface AiTabProps {
  engine: PreviewEngine;
  autoKey: boolean;
  setAutoKey: (v: boolean) => void;
  keyClip: KeyClipboard;
  setKeyClip: (v: KeyClipboard) => void;
  onSelect: (ids: string[]) => void;
  marks: Marks;
}

/** En la pestaña Efectos: los efectos de IA del clip seleccionado con sus controles completos (los mismos que el inspector). */
export function AiSelectedFx({ project, selection, commit, ai }: { project: VM.VideoProject; selection: string[]; commit: FxCtx['commit']; ai: AiTabProps }) {
  const loc = selection.length === 1 ? VM.findClip(project, selection[0]) : null;
  const engine = ai.engine;
  const t = useSyncExternalStore(engine.subscribeTime, () => (engine.isPlaying ? Math.round(engine.getTime() * 15) / 15 : engine.getTime()));
  if (!loc || loc.clip.kind !== 'video') return null;
  const list = (loc.clip.fx ?? []).filter((f) => f.type === 'bgremove' || f.type === 'stabilize');
  if (!list.length) return null;
  const ctx: FxCtx = { project, clip: loc.clip, track: loc.track, engine, t, commit, locked: loc.track.locked, autoKey: ai.autoKey, setAutoKey: ai.setAutoKey, keyClip: ai.keyClip, setKeyClip: ai.setKeyClip, onSelect: ai.onSelect };
  return (
    <section className="vx-fxgroup vx-aisel" aria-label="Efectos de IA del clip seleccionado">
      <h4>IA del clip seleccionado</h4>
      {list.map((fx) => (
        <details key={fx.id} className="vx-sec" open>
          <summary>{fxDef(fx.type)?.label}</summary>
          <AiFxControls ctx={ctx} fx={fx} marks={ai.marks} idp="tab-" />
        </details>
      ))}
    </section>
  );
}

// ---------- miniaturas de la pestaña Efectos ----------
const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90">${body}</svg>`)}`;
export const aiThumb = (type: string): string =>
  type === 'bgremove'
    ? svg(
        `<defs><pattern id="c" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#cfd4da"/><rect width="5" height="5" fill="#eef0f3"/><rect x="5" y="5" width="5" height="5" fill="#eef0f3"/></pattern></defs><rect width="160" height="90" fill="url(#c)"/><circle cx="80" cy="30" r="14" fill="#4b6c8f"/><path d="M48 90c0-24 14-38 32-38s32 14 32 38z" fill="#4b6c8f"/>`,
      )
    : svg(
        `<rect width="160" height="90" fill="#26323f"/><rect x="14" y="8" width="132" height="74" rx="3" fill="none" stroke="#7d8da0" stroke-dasharray="4 3"/><rect x="26" y="16" width="108" height="58" rx="3" fill="#3a5873" stroke="#6ec1ff" stroke-width="2"/><path d="M30 46q10-14 20 0t20 0 20 0 20 0 20 0" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`,
      );

// ---------- diálogo de consentimiento y descarga del modelo ----------

/** Diálogo de la descarga del modelo: tamaño exacto, origen y licencia ANTES de pedir nada; progreso y cancelación después. */
export function AiConsentDialog() {
  const job = useAiJob();
  if (job.phase !== 'consent' && job.phase !== 'download') return null;
  const dlg = job.phase === 'download';
  const bytes = job.consent?.bytes ?? matteModelBytes();
  return (
    <Modal title="Descargar el modelo de «Quitar fondo»" onClose={() => aiJobs.cancel()} busy={dlg} backdrop={false} className="vx-aimodal">
      {!dlg ? (
        <div className="vx-aicons">
          <p data-autofocus tabIndex={-1}>
            Para quitar el fondo hace falta un modelo de inteligencia artificial que <b>aún no está en este equipo</b>. Se descarga <b>una sola vez</b> y después todo funciona <b>sin conexión</b>.
          </p>
          <dl>
            <dt>Tamaño exacto</dt>
            <dd>
              <b>{formatBytes(bytes)}</b> ({bytes.toLocaleString('es')} bytes){job.consent && job.consent.have > 0 ? ` · ya hay ${formatBytes(job.consent.have)} descargados` : ''}
            </dd>
            <dt>Origen</dt>
            <dd>
              {ORIGIN}, versión fijada <code>{MATTE_MODEL.revision.slice(0, 8)}</code> (se verifica el tamaño y la huella de cada archivo)
            </dd>
            <dt>Modelo y licencia</dt>
            <dd>
              MODNet (personas), <b>{MATTE_MODEL.license}</b>: puedes usarlo, también en trabajos comerciales
            </dd>
            <dt>Privacidad</dt>
            <dd>Tus videos no salen del equipo: solo se baja el modelo, y el cálculo corre aquí sin red.</dd>
          </dl>
          {job.consent && !job.consent.fits && <p className="vx-aiwarn" role="alert">El navegador indica poco espacio libre{job.consent.free !== undefined ? ` (${formatBytes(job.consent.free)})` : ''}. Libera espacio antes de descargar.</p>}
          <p className="vx-note">Se borra cuando quieras desde ⚙ Ajustes → «Modelos descargados».</p>
          <div className="vx-actions">
            <button type="button" onClick={() => aiJobs.declineConsent()}>No descargar</button>
            <button type="button" className="primary" onClick={() => aiJobs.acceptConsent()}>Descargar {formatBytes(bytes)} y calcular</button>
          </div>
        </div>
      ) : (
        <div className="vx-aicons" role="status" aria-live="polite">
          <p>Descargando el modelo desde {ORIGIN}…</p>
          <Bar ratio={job.dl?.ratio ?? 0} label="Descarga del modelo" />
          <p className="vx-note">
            {formatBytes(job.dl?.bytes ?? 0)} de {formatBytes(bytes)} · {pct(job.dl?.ratio ?? 0)}
          </p>
          <div className="vx-actions">
            <button type="button" onClick={() => aiJobs.cancel()}>✕ Cancelar la descarga</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- barra de estado global del cálculo ----------

/** Barra inferior con el cálculo en marcha (visible aunque se seleccione otro clip) y el resultado de la última cola. */
export function AiStatusBar({ project }: { project: VM.VideoProject }) {
  const job = useAiJob();
  const running = job.phase === 'running';
  const clip = job.clipId ? VM.findClip(project, job.clipId)?.clip : null;
  const name = clip?.name ?? (clip?.mediaId ? project.media[clip.mediaId]?.name : '') ?? '';
  if (!running && !(job.phase === 'cancelled' || job.phase === 'error' || job.phase === 'done')) return null;
  return (
    <div className="vx-aistatus" role="status" aria-live="polite">
      {running ? (
        <>
          <span className="vx-aistatus-t">
            {job.stage}{name ? ` · ${name}` : ''} · {job.done}/{job.total} · {pct(job.ratio)}
            {job.eta !== undefined ? ` · quedan ~${formatEta(job.eta)}` : ''}
            {job.items.length > 1 ? ` · trabajo ${job.index + 1} de ${job.items.length}` : ''}
          </span>
          <Bar ratio={job.ratio} label="Progreso del cálculo de IA" />
          <button type="button" onClick={() => aiJobs.cancel()} disabled={job.cancelling} title="Cancelar: lo ya calculado se conserva">{job.cancelling ? 'Cancelando…' : '✕ Cancelar'}</button>
        </>
      ) : (
        <>
          <span className="vx-aistatus-t">{job.message}</span>
          <button type="button" className="mini" onClick={() => aiJobs.dismiss()}>Cerrar</button>
        </>
      )}
    </div>
  );
}

// ---------- aviso de la vista previa ----------

/** Aviso del cabezal con botón «Calcular ahora» (empieza por los clips que faltan en este punto). */
export function AiPreviewNotice({ engine, project }: { engine: PreviewEngine; project: VM.VideoProject }) {
  const any = useMemo(() => project.tracks.some((t) => t.clips.some((c) => c.kind === 'video' && c.fx?.some((f) => (f.type === 'bgremove' || f.type === 'stabilize') && f.on !== false))), [project]);
  const cacheV = useAiCacheVersion();
  const job = useAiJob();
  const key = useSyncExternalStore(engine.subscribeTime, () => (any ? noticeItemsAt(project, engine.time).map((i) => [i.clipId, i.kind, i.text].join('\u0001')).join('\u0002') : ''));
  const items = useMemo(() => (key ? key.split('\u0002').map((l) => { const [clipId, kind, text] = l.split('\u0001'); return { clipId, kind: kind as AiKind, text }; }) : []), [key, cacheV]);
  if (!items.length) return null;
  const busy = isBusy(job);
  const calc = () => {
    // un trabajo por efecto sin calcular en el cabezal; cada uno calcula el clip entero (lo ya hecho no se repite)
    void aiJobs.start(items.map((i) => ({ clipId: i.clipId, kind: i.kind })));
  };
  return (
    <span className="vx-pvnote vx-ainote" role="status">
      {[...new Set(items.map((i) => i.text))].join(' ')}
      <button type="button" className="mini" onClick={calc} disabled={busy} title={busy ? 'Hay un cálculo en marcha' : 'Calcula lo que falta de este clip (lo ya calculado no se repite)'}>
        {busy ? 'Calculando…' : 'Calcular ahora'}
      </button>
    </span>
  );
}

// ---------- pregunta antes de exportar ----------

interface ExportAskProps {
  project: () => VM.VideoProject;
  items: ExportPending[];
  /** vuelve a la exportación normal (se llama con un clic nuevo: el selector de archivos lo exige) */
  onExport: () => void;
  onClose: () => void;
}

/** «El 60 % del clip … no está calculado: ¿calcular antes de exportar?» Calcular / exportar sin lo que falta / cancelar. */
export function AiExportDialog({ project, items, onExport, onClose }: ExportAskProps) {
  const job = useAiJob();
  const cacheV = useAiCacheVersion();
  const [started, setStarted] = useState(false);
  const current = useMemo(() => exportPending(project()), [cacheV, project]);
  const busy = started && isBusy(job);
  const finished = started && !busy;
  const allDone = finished && current.length === 0;
  const text = exportPromptText(items);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [finished]);
  const calc = () => {
    setStarted(true);
    void aiJobs.start(items.map((i) => ({ clipId: i.clipId, kind: i.kind })));
  };
  return (
    <Modal title="Efectos de IA sin calcular" onClose={() => (busy ? aiJobs.cancel() : onClose())} busy={false} backdrop={false} className="vx-aimodal">
      <div className="vx-aicons" ref={ref}>
        {!started && (
          <>
            <p data-autofocus tabIndex={-1}>{text}</p>
            <ul className="vx-ailist">
              {items.map((i) => (
                <li key={`${i.clipId}-${i.kind}`}>
                  <b>{i.name}</b>: {AI_KIND_LABEL[i.kind]} calculado al {i.pct} % (faltan ≈ {i.seconds.toFixed(1).replace('.', ',')} s de video)
                </li>
              ))}
            </ul>
            <p className="vx-note">Si exportas sin calcular, lo que falta sale <b>sin el efecto</b> (con el fondo y la sacudida originales) y lo ya calculado sí lo lleva.</p>
          </>
        )}
        {busy && (
          <div role="status" aria-live="polite">
            <p data-autofocus tabIndex={-1}>Calculando antes de exportar…</p>
            <Bar ratio={job.ratio} label="Progreso del cálculo" />
            <p className="vx-note">
              {job.stage} · {job.done}/{job.total} · {pct(job.ratio)}
              {job.eta !== undefined ? ` · quedan ~${formatEta(job.eta)}` : ''}
              {job.items.length > 1 ? ` · trabajo ${job.index + 1} de ${job.items.length}` : ''}
            </p>
          </div>
        )}
        {finished && (
          <p data-autofocus tabIndex={-1} role="status">
            {allDone ? 'Todo calculado. Pulsa «Exportar ahora» para elegir dónde guardarlo.' : job.phase === 'error' ? `El cálculo falló: ${job.message}` : `${job.message} Aún falta calcular parte.`}
          </p>
        )}
        <div className="vx-actions">
          {!started && (
            <>
              <button type="button" className="primary" onClick={calc}>Calcular y exportar</button>
              <button type="button" onClick={onExport}>Exportar sin calcular</button>
              <button type="button" onClick={onClose}>Cancelar</button>
            </>
          )}
          {busy && <button type="button" onClick={() => aiJobs.cancel()}>✕ Cancelar el cálculo</button>}
          {finished && (
            <>
              {allDone ? (
                <button type="button" className="primary" onClick={onExport}>Exportar ahora</button>
              ) : (
                <>
                  <button type="button" className="primary" onClick={calc}>Reintentar el cálculo</button>
                  <button type="button" onClick={onExport}>Exportar sin calcular</button>
                </>
              )}
              <button type="button" onClick={onClose}>Cerrar</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
