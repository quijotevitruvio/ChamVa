// Paneles de audio de V7 para el inspector: ajustes de audio de un clip (ganancia en dB, panorámica, reducción de
// ruido, ecualizador, normalizar el clip a LUFS, ritmo) y ajustes de audio del proyecto (sonoridad objetivo, medidor,
// ecualizador maestro, fundido cruzado, marcas de ritmo). Cada cambio es UN paso de deshacer (los deslizadores se agrupan).
import { useRef, useState } from 'react';
import { LOUDNESS_TARGETS } from '../../video/audio/loudness';
import { setClipAudio, setMediaBeats, setProjectAudio } from '../../video/audio/mixOps';
import { analyzeProjectLoudness, measureClipLoudness } from '../../video/engine/audioExport';
import { analyzeMediaBeats } from '../../video/engine/beatAnalysis';
import type { Clip, Track, VideoProject } from '../../video/model';
import { toast } from '../toast';
import { EqEditor } from './EqEditor';
import { Field } from './Field';
import { MasterReadout, fmtLu, useMasterMeter } from './Meters';
import { useLoudnessState } from './loudness';
import type { PreviewEngine } from './previewEngine';

type Commit = (fn: (p: VideoProject) => VideoProject, group?: string) => void;

const dB = (lin: number) => (lin > 0 ? 20 * Math.log10(lin) : -Infinity);

/** Audio de un clip de video o de audio. */
export function ClipAudioPanel({ project, clip, track, commit }: { project: VideoProject; clip: Clip; track: Track; commit: Commit }) {
  const locked = track.locked;
  const [target, setTarget] = useState(-16);
  const [busy, setBusy] = useState<'norm' | 'beats' | null>(null);
  const abort = useRef<AbortController | null>(null);
  const media = clip.mediaId ? project.media[clip.mediaId] : undefined;
  const set = (patch: Parameters<typeof setClipAudio>[2], group: string) => commit((p) => setClipAudio(p, clip.id, patch), `${group}:${clip.id}`);

  const normalize = async () => {
    if (busy) return;
    setBusy('norm');
    abort.current = new AbortController();
    try {
      const r = await measureClipLoudness(project, clip.id, { signal: abort.current.signal });
      if (!r || !Number.isFinite(r.integrated)) {
        toast('Este clip no tiene sonido medible', 'info');
        return;
      }
      // el volumen del clip (x1 por defecto) también cuenta: el resultado final sale en el objetivo
      const vol = dB(Math.max(clip.volume, 1e-6));
      const gain = Math.max(-60, Math.min(60, target - r.integrated - (Number.isFinite(vol) ? vol : 0)));
      commit((p) => setClipAudio(p, clip.id, { gainDb: gain }));
      toast(`Clip normalizado: medía ${fmtLu(r.integrated)} LUFS, ganancia ${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(1).replace('.', ',')} dB`, 'success');
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast('No se pudo medir el clip: ' + (e as Error).message, 'error');
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const detectBeats = async () => {
    if (busy || !media?.blob) return;
    setBusy('beats');
    abort.current = new AbortController();
    try {
      const res = await analyzeMediaBeats(media.blob, { duration: media.duration, signal: abort.current.signal });
      if (!res) {
        toast('No se encontró un ritmo claro en este audio', 'info');
        return;
      }
      commit((p) => setProjectAudio(setMediaBeats(p, media.id, res), { showBeats: true }));
      toast(`Ritmo detectado: ${res.bpm.toString().replace('.', ',')} pulsos por minuto, ${res.beats.length} marcas en la regla`, 'success');
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast('No se pudo analizar el ritmo: ' + (e as Error).message, 'error');
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  return (
    <>
      <Field label="Ganancia" value={clip.gainDb ?? 0} min={-24} max={24} step={0.5} unit=" dB" digits={1} disabled={locked} onChange={(v) => set({ gainDb: v }, 'gdb')} />
      <Field label="Panorámica" value={clip.pan ?? 0} min={-1} max={1} step={0.01} scale={100} unit=" %" digits={0} disabled={locked} onChange={(v) => set({ pan: v }, 'pan')} />
      <p className="vx-note vx-pan-note" aria-live="polite">
        {!clip.pan ? 'Centro' : clip.pan < 0 ? `${Math.round(-clip.pan * 100)} % a la izquierda` : `${Math.round(clip.pan * 100)} % a la derecha`} · potencia constante
      </p>
      <Field label="Quitar ruido" value={clip.denoise ?? 0} min={0} max={1} step={0.01} scale={100} unit=" %" digits={0} disabled={locked} onChange={(v) => set({ denoise: v }, 'dn')} />
      {(clip.denoise ?? 0) > 0 && <p className="vx-note">Reduce el ruido constante (siseo, ventilador, zumbido) sin perfil previo; retrasa el sonido de este clip unos 21 ms.</p>}
      <details className="vx-eqbox" open={!!clip.eq?.length}>
        <summary>Ecualizador del clip{clip.eq?.length ? ' ●' : ''}</summary>
        <EqEditor key={clip.id} bands={clip.eq} disabled={locked} label="Ecualizador del clip" onChange={(b, g) => commit((p) => setClipAudio(p, clip.id, { eq: b ?? null }), `${g}:${clip.id}`)} />
      </details>
      <div className="vx-field wide">
        <label htmlFor="vx-norm-t">Normalizar clip</label>
        <select id="vx-norm-t" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
          {LOUDNESS_TARGETS.map((t) => (
            <option key={t.id} value={t.lufs}>{t.label}</option>
          ))}
        </select>
        <button type="button" className="mini" disabled={locked || !!busy} onClick={normalize} title="Mide la sonoridad del clip (BS.1770) y fija su ganancia para que quede en el objetivo">
          {busy === 'norm' ? 'Midiendo…' : 'Aplicar'}
        </button>
      </div>
      {media && media.kind !== 'image' && (
        <div className="vx-field wide">
          <label>Ritmo</label>
          <span className="vx-note">{media.beats ? `${String(media.beats.bpm).replace('.', ',')} BPM · ${media.beats.beats.length} marcas` : 'sin analizar'}</span>
          <span className="vx-pop-row">
            <button type="button" className="mini" disabled={!!busy || !media.blob} onClick={detectBeats} title="Detecta los pulsos del audio y los muestra en la regla (se pueden usar como imán)">
              {busy === 'beats' ? 'Analizando…' : media.beats ? 'Repetir' : 'Detectar'}
            </button>
            {media.beats && (
              <button type="button" className="mini" onClick={() => commit((p) => setMediaBeats(p, media.id, null))} title="Quitar las marcas de ritmo de este archivo">
                Quitar
              </button>
            )}
          </span>
        </div>
      )}
    </>
  );
}

/** Audio del proyecto: sonoridad objetivo con medidor, ecualizador maestro, fundido cruzado y ritmo. */
export function ProjectAudioPanel({ project, commit, engine }: { project: VideoProject; commit: Commit; engine: PreviewEngine }) {
  const audio = project.audio;
  const loud = audio?.loud;
  const st = useLoudnessState();
  const meter = useMasterMeter(engine, true);
  const [analyzing, setAnalyzing] = useState(false);
  const [last, setLast] = useState<{ integrated: number; truePeak: number } | null>(null);
  const preset = !loud?.on ? 'off' : (LOUDNESS_TARGETS.find((t) => t.lufs === loud.target)?.id ?? 'custom');
  const setPreset = (id: string) => {
    if (id === 'off') commit((p) => setProjectAudio(p, { loud: { on: false, target: p.audio?.loud?.target ?? -14 } }));
    else if (id === 'custom') commit((p) => setProjectAudio(p, { loud: { on: true, target: p.audio?.loud?.target ?? -14 } }));
    else commit((p) => setProjectAudio(p, { loud: { on: true, target: LOUDNESS_TARGETS.find((t) => t.id === id)!.lufs } }));
  };
  const analyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const r = await analyzeProjectLoudness(project, { gainDb: st.solve && !st.solve.silent && loud?.on ? st.solve.gainDb : 0 });
      if (!r) toast('No hay audio que medir', 'info');
      else setLast({ integrated: Number.isFinite(r.integrated) ? r.integrated : r.ungated, truePeak: r.truePeak });
    } catch (e) {
      toast('No se pudo medir: ' + (e as Error).message, 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <>
      <h4>Sonoridad (LUFS)</h4>
      <div className="vx-field wide">
        <label htmlFor="vx-loud">Objetivo</label>
        <select id="vx-loud" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="off">Sin normalizar</option>
          {LOUDNESS_TARGETS.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
          <option value="custom">Personalizado…</option>
        </select>
      </div>
      {preset === 'custom' && <Field label="Objetivo" value={loud?.target ?? -14} min={-40} max={-10} step={0.5} unit=" LUFS" digits={1} onChange={(v) => commit((p) => setProjectAudio(p, { loud: { on: true, target: v } }), 'loud')} />}
      {loud?.on && (
        <p className="vx-note" aria-live="polite">
          {st.status === 'analyzing' || st.status === 'wait'
            ? `Midiendo la mezcla… ${Math.round(st.progress * 100)} %`
            : st.status === 'error'
              ? 'No se pudo medir la mezcla.'
              : st.solve && !st.solve.silent
                ? `La mezcla mide ${fmtLu(st.solve.measured)} LUFS: se aplica ${st.solve.gainDb >= 0 ? '+' : '−'}${Math.abs(st.solve.gainDb).toFixed(1).replace('.', ',')} dB antes del limitador (−1 dBTP). Previsto: ${fmtLu(st.solve.result)} LUFS, pico ${fmtLu(st.solve.truePeak)} dBTP.`
                : 'Sin sonido medible.'}
        </p>
      )}
      <MasterReadout engine={engine} meter={meter} />
      <div className="vx-field wide">
        <label>Medir mezcla</label>
        <span className="vx-note">{last ? `${fmtLu(last.integrated)} LUFS · pico ${fmtLu(last.truePeak)} dBTP` : 'La salida completa, sin exportar'}</span>
        <button type="button" className="mini" disabled={analyzing} onClick={analyze}>{analyzing ? 'Midiendo…' : 'Analizar'}</button>
      </div>

      <h4>Ecualizador maestro</h4>
      <EqEditor bands={audio?.eq} label="Ecualizador maestro" onChange={(b, g) => commit((p) => setProjectAudio(p, { eq: b }), g)} />

      <h4>Uniones y ritmo</h4>
      <Field label="Fundido cruzado" value={audio?.xfade ?? 0} min={0} max={2} step={0.05} unit=" s" digits={2} onChange={(v) => commit((p) => setProjectAudio(p, { xfade: v > 0 ? v : undefined }), 'xfade')} />
      <p className="vx-note">En cada unión de dos clips contiguos de una pista, el sonido se mezcla con potencia constante (usa lo que el archivo tenga fuera del recorte).</p>
      <label className="vx-check">
        <input type="checkbox" checked={!!audio?.showBeats} onChange={(e) => commit((p) => setProjectAudio(p, { showBeats: e.target.checked || undefined }))} /> Mostrar marcas de ritmo en la regla
      </label>
      <label className="vx-check">
        <input type="checkbox" checked={!!audio?.beatSnap} onChange={(e) => commit((p) => setProjectAudio(p, { beatSnap: e.target.checked || undefined }))} /> Imán a las marcas de ritmo
      </label>
    </>
  );
}
