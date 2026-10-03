// Diálogo «Subtítulos automáticos» (V5b): alcance, idioma, traducción y modelo → (consentimiento y descarga si falta)
// → transcripción con progreso → ajustes de longitud, karaoke y estilo → aplicar en UN paso de deshacer.
// La revisión (tabla con el subtítulo activo resaltado, corregir texto, reproducir desde ahí) es la pestaña
// «Subtítulos» de V4, a la que se pasa al aplicar. El motor es `src/ai/transcribe/` (nada se descarga sin permiso).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ASR_LANGUAGES,
  ConsentError,
  MODEL_LABELS,
  browserStorageEnv,
  detectDevice,
  downloadModel,
  downloadPlan,
  formatBytes,
  formatClock,
  modelBytes,
  modelStatus,
  segmentsToSubtitles,
  transcribeEnvironment,
  transcribeProject,
  type DeviceInfo,
  type DownloadPlan,
  type ModelStatus,
  type TranscribeEnvironment,
  type TranscribeResult,
  type WhisperSize,
} from '../../ai/transcribe';
import * as VM from '../../video/model';
import { SUBTITLE_PRESETS } from '../../video/title/presets';
import * as S from '../../video/title/subtitles';
import { toast } from '../toast';
import * as A from './autoSubs';
import type { PreviewEngine } from './previewEngine';

type Step = 'options' | 'consent' | 'download' | 'run' | 'result' | 'error';

interface Props {
  getProject: () => VM.VideoProject;
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => void;
  engine: PreviewEngine;
  selection: string[];
  marks: A.Marks;
  setMarks: (m: A.Marks) => void;
  initialScope: A.AutoScope;
  onClose: () => void;
  /** tras aplicar: seleccionar el primer subtítulo y enseñar la pestaña Subtítulos */
  onApplied: (firstId: string | undefined) => void;
}

const SIZES: WhisperSize[] = ['tiny', 'base', 'small'];
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function AutoSubsDialog(p: Props) {
  const { getProject, engine } = p;
  const storage = useMemo(() => browserStorageEnv(), []);
  const [step, setStep] = useState<Step>('options');
  const [opt, setOpt] = useState<A.AutoOptions>(() => ({ ...A.DEFAULT_AUTO, scope: p.initialScope }));
  const set = (patch: Partial<A.AutoOptions>) => setOpt((o) => ({ ...o, ...patch }));
  const [env, setEnv] = useState<TranscribeEnvironment | null>(null);
  const [info, setInfo] = useState<DeviceInfo>({ webgpu: false });
  const [statuses, setStatuses] = useState<Partial<Record<WhisperSize, ModelStatus>>>({});
  const [plan, setPlan] = useState<DownloadPlan | null>(null);
  const [consent, setConsent] = useState<DownloadPlan['consent'] | null>(null);
  const [dl, setDl] = useState({ ratio: 0, loaded: 0, total: 0, paused: false });
  const [prog, setProg] = useState({ stage: 'audio', overall: 0, ratio: 0 });
  const [now, setNow] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [result, setResult] = useState<(TranscribeResult & { audioSeconds: number }) | null>(null);
  const [err, setErr] = useState<A.ErrorInfo | null>(null);
  const [mode, setMode] = useState<A.ApplyMode>('add');
  const abort = useRef<AbortController | null>(null);
  const started = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const lastPct = useRef(-1);

  const project = getProject();
  const scopePlan = A.resolveScope(project, opt.scope, { selection: p.selection, marks: p.marks });
  const device = env?.device.device ?? 'wasm';

  // equipo y modelo recomendado (se vuelve a mirar al cambiar «Solo CPU»)
  useEffect(() => {
    let live = true;
    void detectDevice().then((i) => live && setInfo(i));
    void transcribeEnvironment(opt.cpuOnly ? 'wasm' : undefined).then((e) => {
      if (!live) return;
      setEnv(e);
      setOpt((o) => (o.size === A.DEFAULT_AUTO.size && !o.cpuOnly ? { ...o, size: e.suggested } : e.allowed.includes(o.size) ? o : { ...o, size: e.suggested }));
    });
    return () => {
      live = false;
    };
  }, [opt.cpuOnly]);

  // estado de cada modelo (descargado / sin descargar con su tamaño exacto)
  const refreshStatuses = async (d = device) => {
    const out: Partial<Record<WhisperSize, ModelStatus>> = {};
    for (const s of SIZES) out[s] = await modelStatus(storage, s, d);
    setStatuses(out);
  };
  useEffect(() => {
    if (env) void refreshStatuses(env.device.device);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env?.device.device]);

  // foco al entrar y al salir
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const o = opener.current as HTMLElement | null;
    return () => o?.focus?.();
  }, []);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [step]);

  // el reloj de «quedan unos…» sigue corriendo aunque el motor no avise
  useEffect(() => {
    if (step !== 'run') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);

  // se cancela lo que esté en marcha si se cierra el diálogo
  useEffect(() => () => abort.current?.abort(), []);

  const busy = step === 'run' || (step === 'download' && !dl.paused);
  const cancelAll = () => {
    abort.current?.abort();
    abort.current = null;
  };
  const close = () => {
    cancelAll();
    p.onClose();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      if (busy) {
        cancelAll();
        setErr(A.describeError(Object.assign(new Error('cancelado'), { name: 'AbortError' }), { size: opt.size, device }));
        setStep('error');
      } else close();
    } else if (e.key === 'Tab') {
      const els = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((x) => x.offsetParent !== null);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    e.stopPropagation(); // los atajos del editor (espacio, S, T…) no deben actuar con el diálogo abierto
  };

  const fail = (e: unknown) => {
    const info = A.describeError(e, { size: opt.size, device });
    setErr(info);
    setStep('error');
    void refreshStatuses();
  };

  // ---------- descarga con consentimiento ----------
  const askConsent = async () => {
    try {
      const pl = await downloadPlan(storage, opt.size, device);
      setPlan(pl);
      setStep('consent');
    } catch (e) {
      fail(e);
    }
  };
  const runDownload = async (c: DownloadPlan['consent']) => {
    const ctl = new AbortController();
    abort.current = ctl;
    setDl((d) => ({ ...d, paused: false }));
    setStep('download');
    try {
      await downloadModel(storage, opt.size, device, {
        consent: { ...c, accepted: true },
        signal: ctl.signal,
        onProgress: (x) => setDl((d) => ({ ...d, ratio: x.ratio, loaded: x.loaded, total: x.total })),
      });
      abort.current = null;
      await refreshStatuses();
      void transcribe();
    } catch (e) {
      if ((e as Error)?.name === 'AbortError' && ctl.signal.aborted && pausing.current) {
        pausing.current = false;
        setDl((d) => ({ ...d, paused: true }));
        return;
      }
      if (e instanceof ConsentError) setErr(A.describeError(e, { size: opt.size, device }));
      else fail(e);
      setStep('error');
    }
  };
  const pausing = useRef(false);
  const pause = () => {
    pausing.current = true;
    abort.current?.abort();
  };
  const acceptConsent = () => {
    if (!plan) return;
    setConsent(plan.consent);
    setDl({ ratio: plan.bytesTotal ? plan.bytesHave / plan.bytesTotal : 0, loaded: plan.bytesHave, total: plan.bytesTotal, paused: false });
    void runDownload(plan.consent);
  };
  const cancelDownload = () => {
    pausing.current = false;
    cancelAll();
    setErr(A.describeError(Object.assign(new Error('cancelado'), { name: 'AbortError' }), { size: opt.size, device }));
    setStep('error');
    void refreshStatuses();
  };

  // ---------- transcripción ----------
  const transcribe = async () => {
    const sc = A.resolveScope(getProject(), opt.scope, { selection: p.selection, marks: p.marks });
    if (!sc.ok) {
      setErr({ kind: 'no-audio', title: sc.reason });
      setStep('error');
      return;
    }
    const ctl = new AbortController();
    abort.current = ctl;
    started.current = Date.now();
    lastPct.current = -1;
    setNow(Date.now());
    setProg({ stage: 'audio', overall: 0, ratio: 0 });
    setAnnounce('Empieza la transcripción. Puedes cancelar cuando quieras.');
    setStep('run');
    try {
      const lang = A.engineLanguage(opt);
      const r = await transcribeProject(getProject(), {
        size: opt.size,
        device,
        language: lang.language,
        translate: lang.translate,
        trackId: sc.trackId,
        range: sc.range,
        signal: ctl.signal,
        storage,
        onProgress: (x) => {
          setProg({ stage: x.stage, overall: x.overall, ratio: x.ratio });
          const pct = Math.floor(x.overall * 10) * 10;
          const key = pct + x.stage.length * 1000;
          if (key !== lastPct.current) {
            lastPct.current = key;
            setAnnounce(`${A.stageText(x.stage)}, ${Math.round(x.overall * 100)} %`);
          }
        },
      });
      abort.current = null;
      if (!r.segments.some((s) => s.words.length)) {
        setErr(A.NO_SPEECH);
        setStep('error');
        return;
      }
      setResult(r);
      setAnnounce(`Transcripción terminada: ${A.countWords(r.segments)} palabras.`);
      setStep('result');
    } catch (e) {
      fail(e);
    }
  };

  const start = () => {
    if (!scopePlan.ok) return;
    const st = statuses[opt.size];
    if (st?.installed) void transcribe();
    else void askConsent();
  };

  // ---------- resultado ----------
  const layout = A.layoutOf(opt);
  const cues = useMemo(() => (result ? segmentsToSubtitles(result.segments, layout) : []), [result, layout.maxChars, layout.maxLines, layout.maxDur]); // eslint-disable-line react-hooks/exhaustive-deps
  const existing = step === 'result' ? S.subtitleTracks(getProject()).filter((t) => t.clips.length > 0) : [];
  const apply = () => {
    if (!cues.length) return;
    let firstId: string | undefined;
    let overlaps = 0;
    p.commit((pr) => {
      const r = A.applySubtitles(pr, cues, { mode: existing.length ? mode : 'replace', karaoke: opt.karaoke && A.hasWordTimes(result?.segments ?? []), presetId: opt.presetId, trackName: 'Subtítulos automáticos' });
      firstId = r.ids[0];
      overlaps = r.overlapsFixed;
      return r.p;
    });
    toast(`${cues.length} subtítulos creados${overlaps ? ` (${overlaps} solape(s) recortados)` : ''}. Revísalos en la pestaña Subtítulos; Ctrl+Z deshace todo de una vez.`, 'success');
    p.onApplied(firstId);
    p.onClose();
  };

  // ---------- partes de la pantalla ----------
  const audioSeconds = scopePlan.ok ? (scopePlan.range ? scopePlan.range.end - scopePlan.range.start : VM.projectDuration(project)) : 0;
  const speed = A.speedWarning(device, audioSeconds);
  const choices = env ? A.modelChoices(info, device) : [];
  const stPct = Math.round(prog.overall * 100);
  const elapsed = now ? now - started.current : 0;
  const scopeRadio = (v: A.AutoScope, text: string) => {
    const r = A.resolveScope(project, v, { selection: p.selection, marks: p.marks });
    return (
      <label className={`vx-as-opt${opt.scope === v ? ' on' : ''}`} key={v}>
        <input type="radio" name="vx-as-scope" checked={opt.scope === v} onChange={() => set({ scope: v })} data-autofocus={v === p.initialScope ? '' : undefined} />
        <span>
          <b>{text}</b>
          <small>{r.ok ? r.label : r.reason}</small>
        </span>
      </label>
    );
  };

  return (
    <div className="vx-as-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div ref={root} className="vx-as" role="dialog" aria-modal="true" aria-labelledby="vx-as-title" onKeyDown={onKey}>
        <div className="vx-as-head">
          <h3 id="vx-as-title">✨ Subtítulos automáticos</h3>
          <button type="button" className="mini" onClick={() => (busy ? cancelAll() : close())} aria-label="Cerrar" title="Cerrar (Esc)">✕</button>
        </div>
        <p className="vx-as-local">Todo ocurre en tu equipo: el audio nunca sale de él.</p>

        {step === 'options' && (
          <div className="vx-as-body">
            <fieldset>
              <legend>Qué transcribir</legend>
              {scopeRadio('project', 'Todo el proyecto')}
              {scopeRadio('clip', 'Clip seleccionado')}
              {scopeRadio('marks', 'Rango entre marcas')}
              {opt.scope === 'marks' && (
                <div className="vx-as-marks">
                  <span>Entrada {p.marks.in === null ? '—' : formatClock(p.marks.in)}</span>
                  <span>Salida {p.marks.out === null ? '—' : formatClock(p.marks.out)}</span>
                  <button type="button" className="mini" onClick={() => p.setMarks({ ...p.marks, in: engine.time })}>Entrada = cabezal</button>
                  <button type="button" className="mini" onClick={() => p.setMarks({ ...p.marks, out: engine.time })}>Salida = cabezal</button>
                  <button type="button" className="mini" onClick={() => p.setMarks({ in: null, out: null })} disabled={p.marks.in === null && p.marks.out === null}>Quitar marcas</button>
                </div>
              )}
            </fieldset>

            <div className="vx-as-grid">
              <label>
                Idioma del audio
                <select value={opt.language} onChange={(e) => set({ language: e.target.value })}>
                  <option value="auto">Detectar automáticamente</option>
                  {ASR_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="vx-as-check">
                <input type="checkbox" checked={opt.translate} onChange={(e) => set({ translate: e.target.checked })} /> Traducir a inglés
              </label>
            </div>
            {opt.translate && <p className="vx-as-warn" role="note">{A.TRANSLATE_WARNING}</p>}

            <fieldset>
              <legend>Modelo</legend>
              {SIZES.map((s) => {
                const c = choices.find((x) => x.size === s);
                const st = statuses[s];
                const bytes = c?.bytes ?? modelBytes(s, device);
                const state = !st ? 'comprobando…' : st.installed ? '✓ descargado' : st.bytesHave > 0 ? `a medias · faltan ${formatBytes(st.bytesNeeded)}` : 'sin descargar';
                const off = !!c && !c.allowed;
                return (
                  <label key={s} className={`vx-as-opt${opt.size === s ? ' on' : ''}${off ? ' off' : ''}`}>
                    <input type="radio" name="vx-as-model" checked={opt.size === s} disabled={off} onChange={() => set({ size: s })} />
                    <span>
                      <b>
                        {MODEL_LABELS[s].label}
                        {c?.recommended ? ' · recomendado' : ''}
                      </b>
                      <small>
                        {MODEL_LABELS[s].note} · {formatBytes(bytes)} · {state}
                        {off ? ' · demasiado grande para este equipo' : ''}
                      </small>
                    </span>
                  </label>
                );
              })}
              {env && <p className="vx-as-note">{env.reason && !opt.cpuOnly ? `Recomendado porque: ${env.reason}.` : ''} {env.device.device === 'webgpu' ? 'Usará la GPU (WebGPU).' : 'Usará la CPU.'}</p>}
              <label className="vx-as-check">
                <input type="checkbox" checked={opt.cpuOnly} onChange={(e) => set({ cpuOnly: e.target.checked })} /> Solo CPU (más lento; úsalo si la GPU da problemas)
              </label>
              {speed && <p className="vx-as-warn" role="note">{speed}</p>}
              {env?.device.warning && !speed && <p className="vx-as-warn" role="note">{env.device.warning}</p>}
            </fieldset>

            <div className="vx-as-actions">
              <button type="button" onClick={close}>Cancelar</button>
              <button type="button" className="primary" onClick={start} disabled={!scopePlan.ok || !env || !statuses[opt.size]} title={scopePlan.ok ? undefined : scopePlan.reason}>
                {statuses[opt.size]?.installed ? 'Transcribir' : 'Descargar el modelo y transcribir…'}
              </button>
            </div>
          </div>
        )}

        {step === 'consent' && plan && (
          <div className="vx-as-body">
            <h4>Falta el modelo «{opt.size}»</h4>
            <p className="vx-as-consent" data-autofocus tabIndex={-1}>{A.consentText(plan.consent.bytes)}</p>
            <p className="vx-as-note">Se descarga una sola vez y queda en este equipo; después transcribe sin conexión. Se puede pausar y reanudar, y se borra desde ⚙ Ajustes.</p>
            {plan.bytesHave > 0 && <p className="vx-as-note">Ya hay {formatBytes(plan.bytesHave)} descargados: solo faltan {formatBytes(plan.bytesNeeded)}.</p>}
            {!plan.fits && <p className="vx-as-warn" role="alert">El navegador indica que no hay espacio suficiente ({plan.storage.free !== undefined ? formatBytes(plan.storage.free) + ' libres' : 'poco espacio'}). Prueba con un modelo menor.</p>}
            <div className="vx-as-actions">
              <button type="button" onClick={() => setStep('options')}>← Volver</button>
              <button type="button" className="primary" onClick={acceptConsent}>Descargar {formatBytes(plan.consent.bytes)}</button>
            </div>
          </div>
        )}

        {step === 'download' && (
          <div className="vx-as-body">
            <h4>{dl.paused ? 'Descarga en pausa' : `Descargando el modelo «${opt.size}»`}</h4>
            <div className="vx-progress" role="progressbar" aria-label="Descarga del modelo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(dl.ratio * 100)}>
              <div className="vx-progress-fill" style={{ width: `${Math.round(dl.ratio * 100)}%` }} />
              <span className="vx-progress-label">
                {formatBytes(dl.loaded)} de {formatBytes(dl.total)} · {Math.round(dl.ratio * 100)} %
              </span>
            </div>
            <p className="vx-as-note" aria-live="polite">{dl.paused ? 'En pausa: lo descargado se conserva.' : 'Descargando desde huggingface.co…'}</p>
            <div className="vx-as-actions">
              <button type="button" onClick={cancelDownload}>✕ Cancelar</button>
              {dl.paused ? (
                <button type="button" className="primary" data-autofocus onClick={() => consent && void runDownload(consent)}>▶ Reanudar</button>
              ) : (
                <button type="button" data-autofocus onClick={pause}>⏸ Pausar</button>
              )}
            </div>
          </div>
        )}

        {step === 'run' && (
          <div className="vx-as-body">
            <h4>Transcribiendo…</h4>
            <div className="vx-progress" role="progressbar" aria-label="Transcripción" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stPct}>
              <div className="vx-progress-fill" style={{ width: `${stPct}%` }} />
              <span className="vx-progress-label">{A.progressText(prog.stage, prog.overall, elapsed)}</span>
            </div>
            <p className="vx-as-note">{scopePlan.ok ? scopePlan.label : ''} · modelo {opt.size} · {device === 'webgpu' ? 'GPU' : 'CPU'}</p>
            {speed && <p className="vx-as-warn" role="note">{speed}</p>}
            <div className="vx-as-actions">
              <button type="button" data-autofocus onClick={() => {
                cancelAll();
                setErr(A.describeError(Object.assign(new Error('cancelado'), { name: 'AbortError' }), { size: opt.size, device }));
                setStep('error');
              }}>✕ Cancelar</button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="vx-as-body">
            <p className="vx-as-ok" data-autofocus tabIndex={-1}>
              Listo: {A.countWords(result.segments)} palabras en {result.segments.length} frases · idioma «{result.language}»{result.languageDetected ? ' (detectado)' : ''} · {formatClock((result.loadMs + result.asrMs) / 1000)}.
            </p>
            <fieldset>
              <legend>Cómo se cortan los subtítulos</legend>
              <div className="vx-as-grid3">
                <label>
                  Caracteres por línea
                  <input type="number" min={12} max={80} value={opt.maxChars} onChange={(e) => set({ maxChars: Number(e.target.value) })} />
                </label>
                <label>
                  Líneas
                  <input type="number" min={1} max={4} value={opt.maxLines} onChange={(e) => set({ maxLines: Number(e.target.value) })} />
                </label>
                <label>
                  Duración máx. (s)
                  <input type="number" min={1} max={12} step={0.5} value={opt.maxDur} onChange={(e) => set({ maxDur: Number(e.target.value) })} />
                </label>
              </div>
              <p className="vx-as-note">{cues.length} subtítulos{cues[0] ? ` · el primero: «${cues[0].text.replace(/\n/g, ' ')}»` : ''}</p>
            </fieldset>
            <fieldset>
              <legend>Estilo</legend>
              <label>
                Estilo de subtítulo
                <select value={opt.presetId} onChange={(e) => set({ presetId: e.target.value })}>
                  {SUBTITLE_PRESETS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="vx-as-check">
                <input type="checkbox" checked={opt.karaoke} onChange={(e) => set({ karaoke: e.target.checked })} /> Karaoke: resaltar cada palabra mientras se dice
              </label>
              {A.karaokeWarning(opt) && <p className="vx-as-warn" role="note">{A.karaokeWarning(opt)}</p>}
            </fieldset>
            {existing.length > 0 && (
              <fieldset>
                <legend>Ya hay subtítulos en el proyecto</legend>
                <label className={`vx-as-opt${mode === 'replace' ? ' on' : ''}`}>
                  <input type="radio" name="vx-as-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  <span><b>Reemplazar</b><small>Sustituye los subtítulos de la pista «{existing[0].name}».</small></span>
                </label>
                <label className={`vx-as-opt${mode === 'add' ? ' on' : ''}`}>
                  <input type="radio" name="vx-as-mode" checked={mode === 'add'} onChange={() => setMode('add')} />
                  <span><b>Añadir pista nueva</b><small>Los que ya tienes no se tocan.</small></span>
                </label>
              </fieldset>
            )}
            <div className="vx-as-actions">
              <button type="button" onClick={() => setStep('options')}>← Otra vez</button>
              <button type="button" className="primary" onClick={apply} disabled={!cues.length}>Aplicar y revisar</button>
            </div>
          </div>
        )}

        {step === 'error' && err && (
          <div className="vx-as-body">
            <p className={err.kind === 'cancelled' ? 'vx-as-note' : 'vx-as-err'} role="alert" data-autofocus tabIndex={-1}>
              {err.title}
            </p>
            {err.hint && <p className="vx-as-note">{err.hint}</p>}
            <div className="vx-as-actions">
              <button type="button" onClick={close}>Cerrar</button>
              {err.trySize && (
                <button type="button" onClick={() => { set({ size: err.trySize! }); setStep('options'); }}>Probar «{err.trySize}»</button>
              )}
              {err.tryCpu && (
                <button type="button" onClick={() => { set({ cpuOnly: true }); setStep('options'); }}>Usar solo CPU</button>
              )}
              <button type="button" className="primary" onClick={() => setStep('options')}>Volver a las opciones</button>
            </div>
          </div>
        )}

        <div className="vx-as-sr" role="status" aria-live="polite">{announce}</div>
      </div>
    </div>
  );
}
