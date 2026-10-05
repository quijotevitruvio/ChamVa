// «Convertir para editar (proxy)» (V10, solo escritorio). Aparece cuando un
// video no se puede abrir (HEVC de iPhone, ProRes, MKV raro, MP4 fragmentado…).
// Por seguridad, ChamVa solo convierte archivos que el usuario elige en el
// diálogo nativo o suelta sobre la ventana: la interfaz nunca pasa rutas.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { externalClick } from '../../io/openExternal';
import {
  AbortError,
  nativeStatus,
  pickSources,
  probeSource,
  readOutput,
  takeDroppedSources,
  transcodeToProxy,
} from './bridge';
import { defaultProxyOptions, describeProbe, etaSeconds, formatBytes, formatEta, isProxyHeight, proxyFileName, qualityNotice } from './pure';
import type { NativeStatus, ProbeInfo, ProgressInfo, ProxyOptions, SourceRef } from './types';

type Step = 'intro' | 'probing' | 'ready' | 'run' | 'reading' | 'error' | 'missing';

interface Props {
  /** archivos que el editor no puede abrir enteros (nombre, motivo y si `<video>` los reproduce) */
  files: { name: string; reason?: string; playable: boolean }[];
  /** importar sin convertir los que `<video>` reproduce (ruta lenta de siempre) */
  onImportAsIs?: () => void;
  /** true si no hay ffmpeg utilizable (se explica la causa y cómo conseguirlo) */
  missing: boolean;
  onClose: () => void;
  /** el proxy listo, como archivo, para importarlo con el flujo normal */
  onConverted: (file: File) => Promise<void> | void;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function ProxyDialog(p: Props) {
  const [step, setStep] = useState<Step>(p.missing ? 'missing' : 'intro');
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [src, setSrc] = useState<SourceRef | null>(null);
  const [probe, setProbe] = useState<ProbeInfo | null>(null);
  const [opts, setOpts] = useState<ProxyOptions>({ height: '720', video: 'auto', tonemap: true });
  const [prog, setProg] = useState<ProgressInfo | null>(null);
  const [readFrac, setReadFrac] = useState(0);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const [, tick] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);

  useEffect(() => {
    void nativeStatus().then(setStatus);
  }, []);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [step]);
  useEffect(() => {
    const o = opener.current as HTMLElement | null;
    return () => {
      abort.current?.abort();
      o?.focus?.();
    };
  }, []);
  useEffect(() => {
    if (step !== 'run') return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  // soltar un archivo sobre la ventana mientras el diálogo está abierto
  useEffect(() => {
    if (step !== 'intro') return;
    let off: (() => void) | undefined;
    let live = true;
    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('tauri://drag-drop', () => {
          void takeDroppedSources().then((refs) => {
            if (live) void onSources(refs);
          });
        }),
      )
      .then((u) => (live ? (off = u) : u()))
      .catch(() => {});
    return () => {
      live = false;
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const busy = step === 'run' || step === 'reading' || step === 'probing';

  const onSources = async (refs: SourceRef[]) => {
    const r = refs[0];
    if (!r) return;
    if (!r.token) {
      setErr(`«${r.name}»: ${r.error ?? 'no se puede usar'}`);
      setStep('error');
      return;
    }
    setSrc(r);
    setStep('probing');
    try {
      const info = await probeSource(r.token);
      setProbe(info);
      setOpts(defaultProxyOptions(info, status));
      setStep('ready');
    } catch (e) {
      setErr(String(e));
      setStep('error');
    }
  };

  const pick = async () => {
    try {
      await onSources(await pickSources());
    } catch (e) {
      setErr(String(e));
      setStep('error');
    }
  };

  const convert = async () => {
    if (!src?.token) return;
    const ac = new AbortController();
    abort.current = ac;
    started.current = Date.now();
    setProg(null);
    setReadFrac(0);
    setStep('run');
    try {
      const out = await transcodeToProxy(src.token, opts, { signal: ac.signal, onProgress: (x) => setProg(x) });
      setStep('reading');
      const blob = await readOutput(out, setReadFrac, ac.signal);
      const name = proxyFileName(src.name, opts.height, out.mime);
      await p.onConverted(new File([blob], name, { type: out.mime }));
      setDone((d) => [...d, name]);
      setSrc(null);
      setProbe(null);
      setStep('intro');
    } catch (e) {
      if (e instanceof AbortError) {
        setStep('ready');
        return;
      }
      setErr(String(e instanceof Error ? e.message : e));
      setStep('error');
    } finally {
      abort.current = null;
    }
  };

  const cancel = () => abort.current?.abort();
  const close = () => {
    cancel();
    p.onClose();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      if (busy) cancel();
      else close();
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
  };

  const elapsed = (Date.now() - started.current) / 1000;
  const frac = prog?.fraction ?? null;
  const pct = frac === null ? null : Math.round(frac * 100);
  const srcH = probe?.video ? (probe.video.rotation % 180 ? probe.video.width : probe.video.height) : undefined;
  const lgpl = status?.available ? (
    <>
      Usa FFmpeg {status.version?.replace(/^ffmpeg version /, '').split(' ')[0]} ({status.license}), un programa aparte con su propia licencia.{' '}
      <a href={status.ffmpegSourceUrl} onClick={externalClick}>Código fuente</a>
    </>
  ) : (
    <>FFmpeg es software libre (LGPL). </>
  );

  return (
    <div className="vx-as-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div ref={root} className="vx-as" role="dialog" aria-modal="true" aria-labelledby="vx-px-title" onKeyDown={onKey}>
        <div className="vx-as-head">
          <h3 id="vx-px-title">{step === 'missing' ? 'Falta FFmpeg para abrir este video' : '🎞 Convertir para editar (proxy)'}</h3>
          <button type="button" className="mini" onClick={() => (busy ? cancel() : close())} aria-label="Cerrar" title="Cerrar (Esc)">✕</button>
        </div>
        <p className="vx-as-local">Todo ocurre en tu equipo: el video no sale de él.</p>

        {(step === 'intro' || step === 'missing') && (
          <div className="vx-as-body">
            <p>El editor no puede abrir {p.files.length === 1 ? 'este video' : 'estos videos'} directamente (suele pasar con HEVC de iPhone, ProRes, MKV poco comunes o MP4 grabados por fragmentos):</p>
            <ul>
              {p.files.map((f) => (
                <li key={f.name}>
                  «{f.name}»{f.reason ? ` — ${f.reason}` : ''}
                </li>
              ))}
            </ul>
            {done.length > 0 && <p role="status">✔ Importado: {done.join(', ')}</p>}
          </div>
        )}

        {step === 'intro' && (
          <div className="vx-as-body">
            <p>
              ChamVa puede crear una copia ligera (<b>proxy</b>) que sí se edita con fluidez. Se guarda en la caché de la app y se reutiliza si vuelves a convertir el mismo archivo.
            </p>
            <p>Por seguridad, ChamVa solo convierte archivos que eliges tú: vuelve a elegirlo en el diálogo del sistema o suéltalo sobre esta ventana.</p>
            <div className="vx-as-actions">
              <button type="button" className="primary" data-autofocus onClick={pick}>Elegir el archivo…</button>
              {p.onImportAsIs && p.files.some((f) => f.playable) && (
                <button type="button" onClick={p.onImportAsIs} title="Usa el reproductor del sistema: puede ir lento, verse en negro o sin sonido">
                  Importar sin convertir
                </button>
              )}
              <button type="button" onClick={close}>Cerrar</button>
            </div>
          </div>
        )}

        {step === 'missing' && (
          <div className="vx-as-body">
            <p>{status?.reason ? `Causa: ${status.reason}.` : 'Esta copia de ChamVa no incluye FFmpeg.'}</p>
            <p>Alternativas:</p>
            <ul>
              <li>Convierte el video a MP4 (H.264) o WebM con otro programa y vuelve a importarlo.</li>
              <li>Instala la versión de ChamVa que incluye FFmpeg (instalador de escritorio).</li>
              {status?.userInstallSupported && status.userDir && (
                <li>
                  O descarga tú el build verificado y descomprime sus archivos <code>ffmpeg.exe</code>, <code>ffprobe.exe</code> y las <code>.dll</code> de <code>bin/</code> en <code>{status.userDir}</code>. ChamVa solo lo usará si cada archivo coincide con su SHA-256.
                  <br />
                  Descarga ({status.pinnedVersion}, LGPL): <a href={status.pinnedSourceUrl ?? status.releaseUrl} onClick={externalClick}>{status.pinnedSourceUrl ?? status.releaseUrl}</a>
                  <br />
                  SHA-256: <code style={{ wordBreak: 'break-all' }}>{status.pinnedSha256}</code>
                </li>
              )}
            </ul>
            <div className="vx-as-actions">
              <button
                type="button"
                data-autofocus
                onClick={async () => {
                  const s = await nativeStatus(true);
                  setStatus(s);
                  if (s?.available) setStep('intro');
                }}
              >
                Volver a comprobar
              </button>
              <button type="button" onClick={close}>Cerrar</button>
            </div>
          </div>
        )}

        {step === 'probing' && (
          <div className="vx-as-body" role="status">
            Analizando «{src?.name}»…
          </div>
        )}

        {step === 'ready' && probe && src && (
          <div className="vx-as-body">
            <p>
              <b>{src.name}</b> · {formatBytes(src.size)} · {Math.round(probe.duration)} s
            </p>
            <ul>
              {describeProbe(probe, opts).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <div className="vx-as-grid">
              <label>
                Calidad del proxy
                <select value={opts.height} onChange={(e) => isProxyHeight(e.target.value) && setOpts({ ...opts, height: e.target.value })}>
                  <option value="360">360p (muy ligero)</option>
                  <option value="540">540p</option>
                  <option value="720">720p (recomendado)</option>
                  <option value="1080">1080p (para exportar en alta calidad)</option>
                </select>
              </label>
              {probe.video?.hdr && (
                <label className="vx-as-check">
                  <input type="checkbox" checked={opts.tonemap} disabled={!status?.hasZscale} onChange={(e) => setOpts({ ...opts, tonemap: e.target.checked })} />
                  Convertir HDR a SDR
                </label>
              )}
            </div>
            <p className="vx-note">{qualityNotice(opts.height, srcH)}</p>
            <div className="vx-as-actions">
              <button type="button" className="primary" data-autofocus onClick={convert}>Convertir para editar</button>
              <button type="button" onClick={() => setStep('intro')}>Elegir otro</button>
            </div>
          </div>
        )}

        {(step === 'run' || step === 'reading') && (
          <div className="vx-as-body">
            <div className="vx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={step === 'reading' ? Math.round(readFrac * 100) : (pct ?? undefined)} aria-label="Progreso de la conversión">
              <div className="vx-progress-fill" style={{ width: `${step === 'reading' ? readFrac * 100 : (pct ?? 0)}%` }} />
              <span className="vx-progress-label">
                {step === 'reading' ? `Cargando el proxy… ${Math.round(readFrac * 100)} %` : pct === null ? 'Preparando…' : `Convirtiendo… ${pct} %${prog?.speed ? ` · ${prog.speed.toFixed(1).replace('.', ',')}×` : ''} · quedan ${formatEta(etaSeconds(frac, elapsed))}`}
              </span>
            </div>
            <div className="vx-as-actions">
              <button type="button" data-autofocus onClick={cancel}>Cancelar</button>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="vx-as-body">
            <p role="alert">No se pudo convertir: {err}</p>
            <div className="vx-as-actions">
              <button type="button" data-autofocus onClick={() => setStep(src && probe ? 'ready' : 'intro')}>Volver</button>
              <button type="button" onClick={close}>Cerrar</button>
            </div>
          </div>
        )}

        <p className="vx-note" style={{ marginTop: 8 }}>{lgpl}</p>
      </div>
    </div>
  );
}
