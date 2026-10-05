// Diálogo «Grabar»: pantalla, cámara, pantalla con la cámara en una burbuja redonda, o solo micrófono.
// Nada se abre hasta que el usuario pulsa «Activar vista previa» (el navegador pide entonces el permiso) y nada se graba
// hasta «Grabar» (cuenta atrás 3-2-1). Detener: botón, F9 o «Dejar de compartir» del navegador. Al terminar, el clip
// (o los clips, con la cámara aparte) se entrega a `onFinish`, que lo añade al proyecto en un solo paso de deshacer.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from '../toast';
import { useDismiss } from '../useDismiss';
import {
  BUBBLE_MAX,
  BUBBLE_MIN,
  DEFAULT_BUBBLE,
  MAX_RECORD_MINUTES,
  fmtBytes,
  formatClock,
  recordErrorMessage,
  type BubbleCfg,
  type RecordMode,
} from '../../video/record/recordCore';
import { RecordError, RecordSession, detectSupport, listDevices, type RecordSettings, type RecordedClip } from '../../video/record/session';
import type { RecordedItem } from './recordPlace';
import { registerCloseGuard } from '../windowClose';

type Stage = 'config' | 'preparing' | 'ready' | 'countdown' | 'recording' | 'saving';

interface Props {
  onClose: () => void;
  /** recibe lo grabado ya con su duración; devuelve cuando el proyecto ya lo tiene */
  onFinish: (items: RecordedItem[], settings: RecordSettings) => void | Promise<void>;
}

const MODES: { id: RecordMode; icon: string; label: string; hint: string }[] = [
  { id: 'screen', icon: '🖥', label: 'Pantalla', hint: 'Una ventana, una pestaña o toda la pantalla' },
  { id: 'camera', icon: '📷', label: 'Cámara', hint: 'La cámara web, con micrófono' },
  { id: 'screen-cam', icon: '🖥📷', label: 'Pantalla + cámara', hint: 'La cámara en una burbuja redonda en la esquina' },
  { id: 'mic', icon: '🎤', label: 'Solo micrófono', hint: 'Solo voz, como pista de audio' },
];

/** Duración real de lo grabado: el `MediaRecorder` escribe WebM sin duración, así que se prueba con el truco del salto final y, si no, se usa lo medido. */
export function probeRecordedDuration(blob: Blob, hasVideo: boolean, measured: number): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(hasVideo ? 'video' : 'audio');
    let done = false;
    const finish = (d: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      // si lo medido y lo leído difieren mucho, manda lo leído solo cuando es finito y razonable
      resolve(isFinite(d) && d > 0 && Math.abs(d - measured) < Math.max(2, measured * 0.25) ? d : measured);
    };
    const timer = setTimeout(() => finish(measured), 4000);
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => {
      if (isFinite(el.duration) && el.duration > 0) return finish(el.duration);
      el.ondurationchange = () => isFinite(el.duration) && el.duration > 0 && finish(el.duration);
      el.currentTime = 1e6; // fuerza al navegador a calcular la duración real
    };
    el.onerror = () => finish(measured);
    el.src = url;
  });
}

export function RecordDialog({ onClose, onFinish }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const sup = useMemo(() => detectSupport(), []);
  const [mode, setMode] = useState<RecordMode>(sup.screen ? 'screen' : sup.getUserMedia ? 'camera' : 'mic');
  const [height, setHeight] = useState<720 | 1080>(1080);
  const [fps, setFps] = useState<30 | 60>(30);
  const [mic, setMic] = useState(true);
  const [systemAudio, setSystemAudio] = useState(true);
  const [separateCam, setSeparateCam] = useState(false);
  const [bubble, setBubbleState] = useState<BubbleCfg>({ ...DEFAULT_BUBBLE });
  const [camId, setCamId] = useState('');
  const [micId, setMicId] = useState('');
  const [devs, setDevs] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [stage, setStage] = useState<Stage>('config');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [count, setCount] = useState(3);
  const [tick, setTick] = useState({ elapsed: 0, bytes: 0, level: 0, state: 'ok' as 'ok' | 'warn' | 'stop' });
  const [paused, setPaused] = useState(false);
  const sess = useRef<RecordSession | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const stageRef = useRef<Stage>('config');
  stageRef.current = stage;
  useEffect(
    () =>
      registerCloseGuard(() =>
        stageRef.current === 'recording' || stageRef.current === 'countdown' || stageRef.current === 'saving'
          ? 'Hay una grabación en curso: si cierras ChamVa se pierde.'
          : null,
      ),
    [],
  );
  const stoppingRef = useRef(false);
  const bubbleRef = useRef(bubble);
  const stopRef = useRef<(fromEvent?: boolean) => Promise<void>>(async () => undefined);
  const countdownRef = useRef<() => void>(() => undefined);
  const pauseRef = useRef<() => void>(() => undefined);

  const refreshDevices = useCallback(async () => setDevs(await listDevices()), []);
  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  // al cerrar el diálogo o el editor se suelta TODO (cámara, micrófono, pantalla)
  useEffect(() => {
    alive.current = true;
    const hide = () => sess.current?.dispose();
    window.addEventListener('pagehide', hide);
    return () => {
      alive.current = false;
      window.removeEventListener('pagehide', hide);
      sess.current?.dispose();
      sess.current = null;
    };
  }, []);

  const setBubble = (b: BubbleCfg) => {
    bubbleRef.current = b;
    setBubbleState(b);
    sess.current?.setBubble(b);
  };

  const needsScreen = mode === 'screen' || mode === 'screen-cam';
  const needsCam = mode === 'camera' || mode === 'screen-cam';
  const needsMicChoice = mode === 'mic' || mic;

  const settings = (): RecordSettings => ({ mode, height, fps, camId: camId || undefined, micId: micId || undefined, mic: mode === 'mic' ? true : mic, systemAudio: needsScreen && systemAudio, bubble: bubbleRef.current, separateCam: mode === 'screen-cam' && separateCam });

  const discard = () => {
    sess.current?.dispose();
    sess.current = null;
    stoppingRef.current = false;
  };

  const prepare = async () => {
    setError('');
    setNotes([]);
    discard();
    const s = new RecordSession(settings());
    sess.current = s;
    s.onEnded = () => {
      // «Dejar de compartir» del navegador (o se desconectó la cámara): si se estaba grabando, se guarda lo grabado
      if (stageRef.current === 'recording' || stageRef.current === 'countdown') void stopRef.current(true);
      else if (alive.current && stageRef.current === 'ready') {
        discard();
        setStage('config');
        setError('Se dejó de compartir antes de empezar. Pulsa «Activar vista previa» para volver a elegir.');
      }
    };
    setStage('preparing');
    try {
      await s.prepare();
    } catch (e) {
      if (!alive.current) return;
      sess.current = null;
      setStage('config');
      setError(e instanceof RecordError ? e.message : recordErrorMessage(e, 'recorder').message);
      return;
    }
    if (!alive.current) return s.dispose();
    setNotes(s.notes);
    setStage('ready');
    void refreshDevices(); // con permiso, ya salen los nombres
  };

  // vista previa en vivo
  useEffect(() => {
    const s = sess.current;
    if (!s || stage === 'config' || stage === 'preparing') return;
    if (s.previewCanvas && canvasHost.current) {
      const c = s.previewCanvas;
      c.className = 'vx-rec-canvas';
      if (c.parentElement !== canvasHost.current) canvasHost.current.replaceChildren(c);
    } else if (video.current && s.previewStream && video.current.srcObject !== s.previewStream) {
      video.current.srcObject = s.previewStream;
      void video.current.play().catch(() => undefined);
    }
  }, [stage]);

  // medidor y reloj
  useEffect(() => {
    if (stage !== 'ready' && stage !== 'recording' && stage !== 'countdown') return;
    const id = setInterval(() => {
      const s = sess.current;
      if (!s) return;
      const t = s.tick();
      setTick(t);
      if (t.state === 'stop' && stageRef.current === 'recording') {
        toast(`Se alcanzó el límite de la grabación (${Math.round(s.limits.maxSeconds / 60)} min o ${fmtBytes(s.limits.maxBytes)}). Se guardó lo grabado.`, 'info');
        void stopRef.current(true);
      }
    }, 120);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const startCountdown = () => {
    if (!sess.current || stageRef.current !== 'ready') return;
    setStage('countdown');
    setCount(3);
  };
  useEffect(() => {
    if (stage !== 'countdown') return;
    if (count <= 0) {
      sess.current?.start();
      setPaused(false);
      setStage('recording');
      return;
    }
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [stage, count]);

  const stop = async (fromEvent = false) => {
    const s = sess.current;
    if (!s || stoppingRef.current) return;
    if (stageRef.current === 'countdown') {
      discard();
      setStage('config');
      return;
    }
    stoppingRef.current = true;
    setStage('saving');
    let clips: RecordedClip[] = [];
    try {
      clips = await s.stop();
    } catch (e) {
      setError(recordErrorMessage(e, 'recorder').message);
    }
    sess.current = null;
    stoppingRef.current = false;
    if (!clips.length) {
      if (alive.current) {
        setStage('config');
        setError((m) => m || 'No se grabó nada (la grabación duró demasiado poco).');
      }
      return;
    }
    try {
      const items: RecordedItem[] = [];
      for (const c of clips) items.push({ role: c.role, blob: c.blob, mime: c.mime, hasVideo: c.hasVideo, duration: await probeRecordedDuration(c.blob, c.hasVideo, c.duration) });
      await onFinish(items, settings());
      if (fromEvent) toast('Grabación terminada y añadida al proyecto.', 'success');
      if (alive.current) onClose();
    } catch (e) {
      const r = recordErrorMessage(e, 'recorder');
      if (alive.current) {
        setStage('config');
        setError(`La grabación terminó pero no se pudo añadir al proyecto: ${r.message}`);
      }
    }
  };

  const togglePause = () => {
    const s = sess.current;
    if (!s || stageRef.current !== 'recording') return;
    if (s.isPaused) {
      s.resume();
      setPaused(false);
    } else {
      s.pause();
      setPaused(true);
    }
  };

  stopRef.current = stop;
  countdownRef.current = startCountdown;
  pauseRef.current = togglePause;

  // atajos: F9 empieza/detiene, F10 pausa/reanuda
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault();
        if (stageRef.current === 'ready') countdownRef.current();
        else if (stageRef.current === 'recording' || stageRef.current === 'countdown') void stopRef.current();
      } else if (e.key === 'F10' && stageRef.current === 'recording') {
        e.preventDefault();
        pauseRef.current();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = stage === 'preparing' || stage === 'countdown' || stage === 'recording' || stage === 'saving';
  const close = () => {
    if (busy) return;
    discard();
    onClose();
  };
  useDismiss(root, { onClose: close, busy, modal: true });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy) close();
    }
  };

  const noRecorder = !sup.recorder;
  const disabledMode = (m: RecordMode) => noRecorder || ((m === 'screen' || m === 'screen-cam') && !sup.screen) || (m !== 'mic' && !sup.getUserMedia && m !== 'screen');
  const live = stage === 'ready' || stage === 'countdown' || stage === 'recording';
  const levelPct = Math.round(tick.level * 100);
  const limitPct = sess.current ? Math.min(100, Math.round(Math.max(tick.elapsed / sess.current.limits.maxSeconds, tick.bytes / sess.current.limits.maxBytes) * 100)) : 0;

  return (
    <div className="vx-as-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={root} className="vx-as vx-rec" role="dialog" aria-modal="true" aria-labelledby="vx-rec-title" onKeyDown={onKey}>
        <div className="vx-as-head">
          <h3 id="vx-rec-title">⏺ Grabar</h3>
          <button type="button" className="mini" onClick={close} disabled={busy} aria-label="Cerrar" title={busy ? 'Detén la grabación para cerrar' : 'Cerrar (Esc)'}>✕</button>
        </div>
        <p className="vx-as-local">Todo se graba y se guarda en este equipo. No se abre ninguna cámara, micrófono ni pantalla hasta que pulses «Activar vista previa».</p>
        {noRecorder && <p className="vx-as-warn" role="alert">Este navegador no tiene grabación de medios (MediaRecorder): no se puede grabar aquí.</p>}
        {!noRecorder && !sup.screen && sup.screenReason && <p className="vx-as-note" role="note">Grabar pantalla no está disponible: {sup.screenReason}</p>}

        {!live && stage !== 'saving' && (
          <div className="vx-as-body">
            <div className="vx-rec-modes" role="radiogroup" aria-label="Qué grabar">
              {MODES.map((m) => (
                <label key={m.id} data-mode={m.id} className={`vx-as-opt${mode === m.id ? ' on' : ''}`} aria-disabled={disabledMode(m.id)}>
                  <input type="radio" name="vx-rec-mode" checked={mode === m.id} disabled={disabledMode(m.id) || stage === 'preparing'} onChange={() => setMode(m.id)} data-autofocus={mode === m.id ? '' : undefined} />
                  <span>
                    <b>{m.icon} {m.label}</b>
                    <small>{disabledMode(m.id) && (m.id === 'screen' || m.id === 'screen-cam') && !sup.screen ? 'No disponible en este equipo' : m.hint}</small>
                  </span>
                </label>
              ))}
            </div>
            <fieldset disabled={stage === 'preparing'}>
              <legend>Ajustes</legend>
              {mode !== 'mic' && (
                <div className="vx-rec-row">
                  <label>
                    Calidad
                    <select value={height} onChange={(e) => setHeight(Number(e.target.value) as 720 | 1080)}>
                      <option value={720}>720p</option>
                      <option value={1080}>1080p</option>
                    </select>
                  </label>
                  <label>
                    Cuadros por segundo
                    <select value={fps} onChange={(e) => setFps(Number(e.target.value) as 30 | 60)}>
                      <option value={30}>30 fps</option>
                      <option value={60}>60 fps</option>
                    </select>
                  </label>
                </div>
              )}
              {needsCam && (
                <label className="vx-rec-wide">
                  Cámara
                  <select value={camId} onChange={(e) => setCamId(e.target.value)}>
                    <option value="">Predeterminada</option>
                    {devs.cams.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Cámara ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              )}
              {mode !== 'mic' && (
                <label className="vx-check">
                  <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} /> Grabar también el micrófono
                </label>
              )}
              {needsMicChoice && (
                <label className="vx-rec-wide">
                  Micrófono
                  <select value={micId} onChange={(e) => setMicId(e.target.value)}>
                    <option value="">Predeterminado</option>
                    {devs.mics.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Micrófono ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              )}
              {needsScreen && (
                <label className="vx-check" title="Chrome y Edge solo lo ofrecen si marcas «Compartir audio» al elegir qué compartir">
                  <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} /> Audio del sistema (si el navegador lo permite)
                </label>
              )}
              {mode === 'screen-cam' && (
                <>
                  <label className="vx-check">
                    <input type="checkbox" checked={separateCam} onChange={(e) => setSeparateCam(e.target.checked)} /> Grabar la cámara en una pista aparte (para editarla después)
                  </label>
                  <p className="vx-as-note">{separateCam ? 'Se crean dos clips: la pantalla y la cámara (esta como burbuja pequeña que podrás mover y cambiar de tamaño).' : 'La cámara queda en la burbuja redonda dentro de UN solo clip.'}</p>
                </>
              )}
            </fieldset>
            {error && <p className="vx-as-warn" role="alert">{error}</p>}
            <div className="vx-as-actions">
              <button type="button" onClick={close}>Cancelar</button>
              <button type="button" className="primary" onClick={() => void prepare()} disabled={noRecorder || disabledMode(mode) || stage === 'preparing'}>
                {stage === 'preparing' ? 'Esperando permiso…' : 'Activar vista previa'}
              </button>
            </div>
          </div>
        )}

        {live && (
          <div className="vx-as-body">
            {mode !== 'mic' && (
              <div className="vx-rec-stage">
                {sess.current?.previewCanvas ? <div ref={canvasHost} className="vx-rec-canvas-host" /> : <video ref={video} className="vx-rec-video" muted playsInline autoPlay aria-label="Vista previa en vivo" />}
                {stage === 'countdown' && (
                  <div className="vx-rec-count" role="status" aria-live="assertive">
                    {count}
                  </div>
                )}
                {stage === 'recording' && <span className={`vx-rec-badge${paused ? ' paused' : ''}`}>{paused ? '⏸ En pausa' : '● REC'}</span>}
              </div>
            )}
            <div className="vx-rec-bar">
              <span className="vx-rec-time" role="timer" aria-label="Tiempo grabado">{formatClock(tick.elapsed)}</span>
              {sess.current?.hasAudio() ? (
                <span className="vx-rec-meter" role="meter" aria-label="Nivel del micrófono" aria-valuemin={0} aria-valuemax={100} aria-valuenow={levelPct}>
                  <span style={{ width: `${levelPct}%` }} className={levelPct > 92 ? 'hot' : ''} />
                </span>
              ) : (
                <span className="vx-as-note">Sin audio</span>
              )}
              {stage === 'recording' && <small className="vx-as-note">{fmtBytes(tick.bytes)}</small>}
            </div>
            {mode === 'mic' && stage === 'countdown' && (
              <p className="vx-rec-count inline" role="status" aria-live="assertive">
                {count}
              </p>
            )}
            {mode === 'screen-cam' && (
              <fieldset>
                <legend>Burbuja de la cámara</legend>
                <label className="vx-rec-wide">
                  Tamaño
                  <input type="range" min={BUBBLE_MIN * 100} max={BUBBLE_MAX * 100} step={1} value={Math.round(bubble.size * 100)} onChange={(e) => setBubble({ ...bubble, size: Number(e.target.value) / 100 })} aria-label="Tamaño de la burbuja" />
                </label>
                <div className="vx-rec-corners" role="group" aria-label="Esquina de la burbuja">
                  {(
                    [
                      ['↖', 0, 0, 'arriba a la izquierda'],
                      ['↗', 1, 0, 'arriba a la derecha'],
                      ['↙', 0, 1, 'abajo a la izquierda'],
                      ['↘', 1, 1, 'abajo a la derecha'],
                    ] as const
                  ).map(([ic, x, y, name]) => (
                    <button key={name} type="button" className={bubble.px === x && bubble.py === y ? 'on' : ''} aria-label={`Esquina ${name}`} title={name} onClick={() => setBubble({ ...bubble, px: x, py: y })}>{ic}</button>
                  ))}
                </div>
                <label className="vx-rec-wide">
                  Posición horizontal
                  <input type="range" min={0} max={100} value={Math.round(bubble.px * 100)} onChange={(e) => setBubble({ ...bubble, px: Number(e.target.value) / 100 })} aria-label="Posición horizontal de la burbuja" />
                </label>
                <label className="vx-rec-wide">
                  Posición vertical
                  <input type="range" min={0} max={100} value={Math.round(bubble.py * 100)} onChange={(e) => setBubble({ ...bubble, py: Number(e.target.value) / 100 })} aria-label="Posición vertical de la burbuja" />
                </label>
              </fieldset>
            )}
            {notes.map((n) => (
              <p key={n} className="vx-as-note" role="note">{n}</p>
            ))}
            {stage === 'recording' && (
              <>
                <div className="vx-rec-limit" role="progressbar" aria-label="Uso del límite de la grabación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={limitPct}><span style={{ width: `${limitPct}%` }} /></div>
                {tick.state === 'warn' && <p className="vx-as-warn" role="alert">Casi se llega al límite de la grabación ({MAX_RECORD_MINUTES} min o el espacio libre). Se guardará lo grabado al llegar.</p>}
              </>
            )}
            <div className="vx-as-actions">
              {stage === 'ready' && (
                <>
                  <button type="button" onClick={() => { discard(); setStage('config'); }}>← Cambiar ajustes</button>
                  <button type="button" className="primary" onClick={startCountdown} title="Cuenta atrás de 3 s y empieza (F9)">⏺ Grabar (F9)</button>
                </>
              )}
              {stage === 'countdown' && <button type="button" onClick={() => void stop()}>Cancelar</button>}
              {stage === 'recording' && (
                <>
                  <button type="button" onClick={togglePause} title="Pausar o reanudar (F10)">{paused ? '▶ Reanudar (F10)' : '⏸ Pausar (F10)'}</button>
                  <button type="button" className="primary danger" onClick={() => void stop()} title="Detener y añadir al proyecto (F9)">⏹ Detener (F9)</button>
                </>
              )}
            </div>
          </div>
        )}
        {stage === 'saving' && <p className="vx-as-note" role="status">Guardando la grabación…</p>}
      </div>
    </div>
  );
}
