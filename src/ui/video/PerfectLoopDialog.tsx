// Diálogo «Bucle perfecto»: busca solo el mejor punto de unión del clip (el final que más se parece al inicio; en audio, el
// cruce por cero más cercano), enseña la unión (fotogramas antes y después del salto, y el sonido) y recorta ahí en UN
// paso de deshacer. El bucle en sí es el de V8 («Velocidad y tiempo › Bucle»).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as VM from '../../video/model';
import { DEFAULT_LOOP_SCAN, applyPerfectLoop, findAudioLoop, findLoopCandidates, joinQuality, planScanTimes, snapToZeroCrossings, type LoopCandidate, type LoopScanOptions } from '../../video/speed/perfectLoop';
import { fmtDur } from './ClipView';
import { decodeAudio, scanFrames, type DecodedAudio, type ScanSample } from './loopScan';
import { toast } from '../toast';
import { useDismiss } from '../useDismiss';

interface Props {
  clip: VM.Clip;
  media: VM.MediaAsset;
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => unknown;
  onClose: () => void;
}

interface Found extends LoopCandidate {
  /** fotogramas de la unión: dos antes del salto y dos después */
  frames: string[];
}

const DT = 1 / 12;
const num = (v: number, d = 2) => v.toFixed(d).replace('.', ',');

export function PerfectLoopDialog({ clip, media, commit, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const isAudio = clip.kind === 'audio';
  const [opt, setOpt] = useState<LoopScanOptions>({ ...DEFAULT_LOOP_SCAN, startWindow: isAudio ? 0.2 : 0.5 });
  const [stage, setStage] = useState<'options' | 'scanning' | 'result'>('options');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [pick, setPick] = useState(0);
  const [snap, setSnap] = useState(true);
  const [frameIdx, setFrameIdx] = useState(0);
  const audio = useRef<DecodedAudio | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const played = useRef<AudioContext | null>(null);
  const set = (patch: Partial<LoopScanOptions>) => setOpt((o) => ({ ...o, ...patch }));
  const range = useMemo(() => ({ inP: clip.inP, outP: clip.outP }), [clip.inP, clip.outP]);

  useEffect(
    () => () => {
      abort.current?.abort();
      void played.current?.close().catch(() => undefined);
    },
    [],
  );

  const close = () => {
    abort.current?.abort();
    onClose();
  };
  useDismiss(root, { onClose: close });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  const search = async () => {
    setError('');
    if (!media.blob) return setError('El archivo de este clip no está disponible.');
    const plan = planScanTimes(range, opt, DT, media.duration || Infinity);
    if (!plan && !isAudio) return setError(`El tramo del clip (${num(range.outP - range.inP)} s) es más corto que la duración mínima del bucle (${num(opt.minLen, 1)} s). Baja la duración mínima o amplía el recorte.`);
    const ac = new AbortController();
    abort.current = ac;
    setStage('scanning');
    setProgress(0);
    try {
      audio.current = await decodeAudio(media.blob);
      setHasAudio(!!audio.current);
      if (ac.signal.aborted) return;
      if (isAudio) {
        if (!audio.current) throw new Error('No se pudo leer el audio de este archivo.');
        const cands = findAudioLoop(audio.current.mono, audio.current.buffer.sampleRate, range, opt);
        if (!cands.length) throw new Error('No se encontró ningún punto de unión: prueba con una ventana más grande o una duración mínima menor.');
        setFound(cands.map((c) => ({ ...c, frames: [] })));
      } else {
        const times = [...new Set([...plan!.starts, ...plan!.ends])].sort((a, b) => a - b);
        const samples = await scanFrames(media.blob, times, { signal: ac.signal, onProgress: setProgress });
        const by = new Map<number, ScanSample>(samples.map((s) => [s.t, s]));
        const starts = plan!.starts.map((t) => by.get(t)!);
        const ends = plan!.ends.map((t) => by.get(t)!);
        const cands = findLoopCandidates(starts, ends, opt, { start: plan!.startNeighbor, end: plan!.endNeighbor });
        if (!cands.length) throw new Error('No se encontró ningún punto de unión: prueba con una ventana más grande o una duración mínima menor.');
        const near = (list: ScanSample[], t: number, back: number) => list.find((s) => Math.abs(s.t - (t + back * DT)) < DT / 4)?.thumb;
        setFound(
          cands.map((c) => ({
            ...c,
            frames: [near(ends, c.outP, -2), near(ends, c.outP, -1), near(starts, c.inP, 0), near(starts, c.inP, 1)].filter((x): x is string => !!x),
          })),
        );
      }
      setPick(0);
      setStage('result');
    } catch (e) {
      if ((e as Error).name === 'AbortError' || ac.signal.aborted) return;
      setStage('options');
      setError((e as Error).message);
    }
  };

  // animación de la unión: fotograma, fotograma, ↺ salto, fotograma, fotograma
  const cur = found[pick];
  useEffect(() => {
    if (stage !== 'result' || !cur || cur.frames.length < 2) return;
    const id = setInterval(() => setFrameIdx((i) => (i + 1) % cur.frames.length), 220);
    return () => clearInterval(id);
  }, [stage, cur]);

  // la unión final: con el ajuste a cruce por cero si hay audio
  const finalOf = (c: LoopCandidate): LoopCandidate => (snap && audio.current ? snapToZeroCrossings(c, audio.current.mono, audio.current.buffer.sampleRate, isAudio ? 0.05 : 1 / 60) : c);

  const listen = () => {
    const a = audio.current;
    if (!a || !cur) return;
    void played.current?.close().catch(() => undefined);
    const ctx = new AudioContext();
    played.current = ctx;
    const f = finalOf(cur);
    const pre = Math.min(1.2, f.outP - f.inP);
    const post = Math.min(1.2, f.outP - f.inP);
    const now = ctx.currentTime + 0.05;
    const s1 = ctx.createBufferSource();
    s1.buffer = a.buffer;
    s1.connect(ctx.destination);
    s1.start(now, Math.max(0, f.outP - pre), pre);
    const s2 = ctx.createBufferSource();
    s2.buffer = a.buffer;
    s2.connect(ctx.destination);
    s2.start(now + pre, f.inP, post);
  };

  const apply = () => {
    if (!cur) return;
    const f = finalOf(cur);
    let ok = false;
    commit((p) => {
      const q = applyPerfectLoop(p, clip.id, f, { mediaDuration: media.duration });
      ok = q !== p;
      return q;
    });
    if (!ok) return setError('No se pudo aplicar al clip (¿la pista está bloqueada?).');
    toast(`Bucle perfecto: el clip se recortó a ${num(f.inP)}–${num(f.outP)} s del archivo y se repite. Ctrl+Z lo deshace de una vez; el número de repeticiones se cambia en «Velocidad y tiempo › Bucle».`, 'success');
    onClose();
  };

  const q = cur ? joinQuality(cur.diff) : null;
  const preview = cur?.frames[frameIdx % Math.max(1, cur.frames.length)];
  const jumping = cur ? frameIdx % cur.frames.length === 2 && cur.frames.length === 4 : false;

  return (
    <div className="vx-as-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={root} className="vx-as vx-pl" role="dialog" aria-modal="true" aria-labelledby="vx-pl-title" onKeyDown={onKey}>
        <div className="vx-as-head">
          <h3 id="vx-pl-title">🔁 Bucle perfecto</h3>
          <button type="button" className="mini" onClick={close} aria-label="Cerrar" title="Cerrar (Esc)">✕</button>
        </div>
        <p className="vx-as-local">
          {isAudio ? 'Busca el punto donde el sonido se repite sin chasquido (cruce por cero).' : 'Busca el fotograma final que más se parece al inicial, para que al repetir no se note el salto.'} Todo se calcula en tu equipo.
        </p>
        <p className="vx-as-note">Clip «{clip.name ?? media.name}» · tramo actual {fmtDur(clip.inP)}–{fmtDur(clip.outP)} del archivo.</p>

        {stage === 'options' && (
          <div className="vx-as-body">
            <fieldset>
              <legend>Dónde buscar</legend>
              <label className="vx-rec-wide">
                Final: últimos
                <input type="number" min={0.2} max={Math.max(0.2, range.outP - range.inP)} step={0.5} value={opt.endWindow} onChange={(e) => set({ endWindow: Math.max(0.2, Number(e.target.value) || 0.2) })} aria-label="Ventana de búsqueda del final, en segundos" /> s
              </label>
              <label className="vx-rec-wide">
                Inicio: mover hasta
                <input type="number" min={0} max={5} step={0.1} value={opt.startWindow} onChange={(e) => set({ startWindow: Math.max(0, Number(e.target.value) || 0) })} aria-label="Cuánto puede moverse el inicio, en segundos" /> s
              </label>
              <label className="vx-rec-wide">
                Duración mínima
                <input type="number" min={0.2} max={60} step={0.5} value={opt.minLen} onChange={(e) => set({ minLen: Math.max(0.2, Number(e.target.value) || 0.2) })} aria-label="Duración mínima del bucle, en segundos" /> s
              </label>
            </fieldset>
            {error && <p className="vx-as-warn" role="alert">{error}</p>}
            <div className="vx-as-actions">
              <button type="button" onClick={close}>Cancelar</button>
              <button type="button" className="primary" onClick={() => void search()} data-autofocus>Buscar el mejor punto</button>
            </div>
          </div>
        )}

        {stage === 'scanning' && (
          <div className="vx-as-body">
            <div className="vx-rec-limit" role="progressbar" aria-label="Analizando" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="vx-as-note" role="status">{isAudio ? 'Analizando el audio…' : `Analizando fotogramas… ${Math.round(progress * 100)} %`}</p>
            <div className="vx-as-actions"><button type="button" onClick={() => { abort.current?.abort(); setStage('options'); }}>Cancelar</button></div>
          </div>
        )}

        {stage === 'result' && cur && q && (
          <div className="vx-as-body">
            <div className="vx-pl-cands" role="radiogroup" aria-label="Puntos de unión encontrados">
              {found.map((c, i) => {
                const f = joinQuality(c.diff);
                return (
                  <label key={i} className={`vx-as-opt${pick === i ? ' on' : ''}`}>
                    <input type="radio" name="vx-pl-pick" checked={pick === i} onChange={() => { setPick(i); setFrameIdx(0); }} />
                    <span>
                      <b>{i === 0 ? 'Mejor: ' : ''}{num(c.inP)} s → {num(c.outP)} s</b>
                      <small>
                        Dura {num(c.outP - c.inP)} s · unión {f.label.toLowerCase()} ({isAudio ? 'forma de onda' : `${num(c.diff * 100, 1)} % de diferencia`})
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
            {!isAudio && cur.frames.length > 0 && (
              <div className="vx-pl-prev" aria-label="Vista previa de la unión">
                <img src={preview} alt="" width={160} height={90} />
                <span className={`vx-pl-jump${jumping ? ' on' : ''}`} role="status">{jumping ? '↺ aquí vuelve al inicio' : 'fotogramas alrededor de la unión'}</span>
              </div>
            )}
            {hasAudio && (
              <div className="vx-rec-row">
                <button type="button" onClick={listen}>🔊 Oír la unión</button>
                <label className="vx-check" title="Mueve el inicio y el final al cruce por cero más cercano para evitar el chasquido">
                  <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Ajustar al cruce por cero
                </label>
              </div>
            )}
            {q.level === 3 && <p className="vx-as-warn" role="note">La unión se va a notar: este clip no se repite de forma natural. Prueba con una ventana de búsqueda mayor, o añade un fundido cruzado en «Velocidad y tiempo › Bucle».</p>}
            <div className="vx-as-actions">
              <button type="button" onClick={() => setStage('options')}>← Cambiar la búsqueda</button>
              <button type="button" className="primary" onClick={apply} data-autofocus>Recortar aquí y repetir</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
