import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { downloadBlob } from '../../io/export';
import * as VM from '../../video/model';
import { SUB_FILE, decodeSubtitleBytes, formatTimestamp, parseSubtitles, parseTimestamp, serializeSubtitles, type SubFormat } from '../../video/title/srt';
import { SUBTITLE_PRESETS } from '../../video/title/presets';
import * as S from '../../video/title/subtitles';
import { toast } from '../toast';
import { AnimControls } from './AnimControls';
import { Field } from './Field';
import type { PreviewEngine } from './previewEngine';
import { StyleControls } from './StyleControls';

type Commit = (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => void;

interface Props {
  project: VM.VideoProject;
  engine: PreviewEngine;
  selection: string[];
  setSelection: (ids: string[]) => void;
  commit: Commit;
}

/** «mm:ss.mmm» (con horas solo si hacen falta): se puede volver a leer con `parseTimestamp`. */
export const fmtCue = (sec: number): string => {
  const t = formatTimestamp(sec, '.');
  return t.startsWith('00:') ? t.slice(3) : t;
};

/** Lo que escribe el usuario en un campo de tiempo → segundos (acepta «1:02.5», «62,5», «1:02:03»). */
export function parseTimeInput(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const ts = parseTimestamp(s);
  if (ts !== null) return ts;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function TimeInput({ value, label, disabled, onCommit }: { value: number; label: string; disabled?: boolean; onCommit: (sec: number) => void }) {
  const shown = fmtCue(value);
  const [draft, setDraft] = useState<string | null>(null);
  const done = () => {
    if (draft === null) return;
    const v = parseTimeInput(draft);
    if (v !== null && Math.abs(v - value) > 0.0005) onCommit(v);
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className="vx-cue-time"
      aria-label={label}
      value={draft ?? shown}
      disabled={disabled}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          done();
        } else if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLElement).blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowUp' ? 1 : -1);
          onCommit(Math.max(0, Math.round((value + step) * 1000) / 1000));
          setDraft(null);
        }
      }}
    />
  );
}

interface RowProps {
  clip: VM.Clip;
  index: number;
  active: boolean;
  selected: boolean;
  locked: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onSeek: (t: number) => void;
  onText: (id: string, text: string) => void;
  onTimes: (id: string, o: { start?: number; end?: number }) => void;
  onSplit: (id: string, caret: number) => void;
  onAddAfter: (id: string) => void;
  onRemove: (id: string) => void;
  onNav: (id: string, dir: 1 | -1) => void;
}

const CueRow = memo(function CueRow(p: RowProps) {
  const { clip: c, index, locked } = p;
  const dur = VM.clipDuration(c);
  const text = c.text ?? '';
  const cps = S.readingSpeed(text, dur);
  const lines = text.split('\n').length;
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      p.onSplit(c.id, e.currentTarget.selectionStart);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      p.onAddAfter(c.id);
    } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      p.onNav(c.id, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };
  return (
    <div className={`vx-cue${p.active ? ' now' : ''}${p.selected ? ' sel' : ''}${cps > 21 || lines > 2 ? ' warn' : ''}`} role="row" data-cue={c.id}>
      <button type="button" className="vx-cue-n" role="cell" onClick={(e) => (p.onSelect(c.id, e.shiftKey || e.ctrlKey || e.metaKey), p.onSeek(c.start))} aria-pressed={p.selected} aria-label={`Subtítulo ${index + 1}: ir al inicio`} title="Ir al inicio (Mayús o Ctrl suman a la selección)">
        {index + 1}
      </button>
      <div className="vx-cue-times" role="cell">
        <TimeInput value={c.start} label={`Inicio del subtítulo ${index + 1}`} disabled={locked} onCommit={(v) => p.onTimes(c.id, { start: v, end: v + dur })} />
        <TimeInput value={c.start + dur} label={`Fin del subtítulo ${index + 1}`} disabled={locked} onCommit={(v) => p.onTimes(c.id, { end: v })} />
      </div>
      <textarea
        className="vx-cue-text"
        role="cell"
        data-cue-text={c.id}
        aria-label={`Texto del subtítulo ${index + 1}`}
        rows={Math.min(5, Math.max(2, lines))}
        value={text}
        disabled={locked}
        spellCheck
        onFocus={() => p.onSelect(c.id, false)}
        onChange={(e) => p.onText(c.id, e.target.value)}
        onKeyDown={onKey}
      />
      <div className="vx-cue-act" role="cell">
        <button type="button" className="mini" disabled={locked} onClick={() => p.onSplit(c.id, -1)} aria-label={`Dividir el subtítulo ${index + 1} por la mitad o por su salto de línea`} title="Dividir por el salto de línea (o por la mitad). Con el cursor: Alt+Intro">✂</button>
        <button type="button" className="mini" disabled={locked} onClick={() => p.onRemove(c.id)} aria-label={`Quitar el subtítulo ${index + 1}`} title="Quitar">✕</button>
        {(cps > 21 || lines > 2) && (
          <span className="vx-cue-warn" title={lines > 2 ? `${lines} líneas: muchas para un subtítulo` : `Se lee muy rápido: ${cps.toFixed(0)} caracteres por segundo`}>
            {lines > 2 ? '↵' : '⚡'}
          </span>
        )}
      </div>
    </div>
  );
});

/** Pestaña «Subtítulos»: lista editable tipo hoja, importar/exportar SRT·VTT·TXT, desplazar, ajustar a escenas y estilo global. */
export function SubtitlePanel({ project, engine, selection, setSelection, commit }: Props) {
  const tracks = S.subtitleTracks(project);
  const [pick, setPick] = useState<string | null>(null);
  const selTrack = useMemo(() => {
    for (const id of selection) {
      const l = VM.findClip(project, id);
      if (l && l.clip.kind === 'subtitle') return l.track.id;
    }
    return null;
  }, [selection, project]);
  const track = tracks.find((t) => t.id === selTrack) ?? tracks.find((t) => t.id === pick) ?? tracks[0] ?? null;
  const clips = useMemo(() => (track ? track.clips.filter((c) => c.kind === 'subtitle') : []), [track]);
  const locked = !!track?.locked;
  const file = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<SubFormat>('srt');
  const [shift, setShift] = useState('0.5');
  const [focusId, setFocusId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // índice del subtítulo que se está mostrando ahora (se repinta solo cuando cambia)
  const activeId = useSyncExternalStore(engine.subscribeTime, () => {
    const t = engine.time;
    return clips.find((c) => t >= c.start && t < VM.clipEnd(c))?.id ?? '';
  });

  useEffect(() => {
    if (!focusId) return;
    const el = listRef.current?.querySelector<HTMLTextAreaElement>(`[data-cue-text="${CSS.escape(focusId)}"]`);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest' });
      setFocusId(null);
    }
  }, [focusId, clips]);

  // al seguir la reproducción, el subtítulo activo se mantiene a la vista
  useEffect(() => {
    if (!activeId || !engine.isPlaying) return;
    listRef.current?.querySelector(`[data-cue="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId, engine]);

  const ensure = (p: VM.VideoProject, id: string) => (S.subtitleTracks(p).find((t) => t.id === track?.id) ? { p, id: track!.id } : S.ensureSubtitleTrack(p, id));

  const addAt = (t: number) => {
    const cid = VM.uid();
    const tid = VM.uid();
    commit((p) => {
      const e = ensure(p, tid);
      return S.addCue(e.p, e.id, t, { id: cid, text: '' }).p;
    });
    setSelection([cid]);
    setFocusId(cid);
  };

  const importFile = async (f: File) => {
    try {
      const text = decodeSubtitleBytes(new Uint8Array(await f.arrayBuffer()));
      const r = parseSubtitles(text);
      if (!r.cues.length) {
        toast(r.warnings.join(' ') || 'No se encontró ningún subtítulo en el archivo', 'error');
        return;
      }
      const tid = VM.uid();
      let overlaps = 0;
      let ids: string[] = [];
      let intoNew = false;
      commit((p) => {
        const cur = track ? S.subtitleTracks(p).find((t) => t.id === track.id) : null;
        intoNew = !cur || cur.clips.length > 0 || cur.locked;
        const base = intoNew ? S.newSubtitleTrack(p, { id: tid, name: f.name.replace(/\.[^.]+$/, '') || 'Subtítulos' }) : { p, id: cur!.id };
        const res = S.replaceCues(base.p, base.id, r.cues);
        overlaps = res.overlapsFixed;
        ids = res.ids;
        return res.p;
      });
      if (ids.length) setSelection([ids[0]]);
      setPick(intoNew ? tid : (track?.id ?? null));
      const notes = [...r.warnings.filter((w) => !/solapan/.test(w))];
      if (overlaps) notes.push(`${overlaps} solape(s) recortados`);
      toast(`${r.cues.length} subtítulos importados (${r.format.toUpperCase()})${intoNew && track?.clips.length ? ' en una pista nueva' : ''}${notes.length ? ' · ' + notes.join(' · ') : ''}`, notes.length ? 'info' : 'success');
    } catch (e) {
      toast('No se pudo leer el archivo: ' + (e as Error).message, 'error');
    }
  };

  const exportFile = () => {
    if (!track || !clips.length) return;
    const text = serializeSubtitles(S.cuesOfTrack(track), format);
    void downloadBlob(new Blob([text], { type: SUB_FILE[format].mime + ';charset=utf-8' }), `chamva-subtitulos.${SUB_FILE[format].ext}`);
  };

  const selClips = selection.filter((id) => clips.some((c) => c.id === id));
  const onSelect = (id: string, add: boolean) => setSelection(add ? (selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]) : [id]);
  const onNav = (id: string, dir: 1 | -1) => {
    const i = clips.findIndex((c) => c.id === id);
    const n = clips[i + dir];
    if (n) setFocusId(n.id);
  };
  const doSplit = (id: string, caret: number) => {
    const newId = VM.uid();
    let ok = false;
    commit((p) => {
      const l = VM.findClip(p, id);
      if (!l) return p;
      const text = l.clip.text ?? '';
      let r: { p: VM.VideoProject; id: string | null };
      if (caret >= 0) r = S.splitCue(p, id, caret, newId);
      else {
        // sin cursor: por el salto de línea más cercano a la mitad, o por el espacio más cercano a la mitad
        const nl = [...text.matchAll(/\n/g)].map((m) => m.index!);
        const cand = nl.length ? nl : [...text.matchAll(/\s/g)].map((m) => m.index!);
        const mid = text.length / 2;
        const at = cand.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
        r = at === undefined ? { p, id: null } : S.splitCue(p, id, at, newId);
      }
      ok = !!r.id;
      return r.p;
    });
    if (ok) setFocusId(newId);
    else toast('No se puede dividir: hace falta texto a los dos lados del corte', 'info');
  };

  const rows = clips.map((c, i) => (
    <CueRow
      key={c.id}
      clip={c}
      index={i}
      active={c.id === activeId}
      selected={selection.includes(c.id)}
      locked={locked}
      onSelect={onSelect}
      onSeek={(t) => engine.seek(t)}
      onText={(id, text) => commit((p) => S.setCueText(p, id, text), 'cuetext:' + id)}
      onTimes={(id, o) => commit((p) => S.setCueTimes(p, id, o), 'cuetime:' + id)}
      onSplit={doSplit}
      onAddAfter={(id) => {
        const l = VM.findClip(project, id);
        if (l) addAt(VM.clipEnd(l.clip));
      }}
      onRemove={(id) => {
        commit((p) => S.removeCue(p, id));
        setSelection(selection.filter((x) => x !== id));
      }}
      onNav={onNav}
    />
  ));

  const st = track?.subStyle;
  const upStyle = (patch: Parameters<typeof S.setSubtitleStyle>[2], g: string) => track && commit((p) => S.setSubtitleStyle(p, track.id, patch), 'substyle-' + g);
  const oneSel = selClips.length === 1 ? VM.findClip(project, selClips[0])?.clip : undefined;

  return (
    <div className="vx-tabbody vx-subs">
      <div className="vx-tabbar-row">
        <button type="button" className="primary" onClick={() => addAt(engine.time)} disabled={locked} title="Añade un subtítulo en la posición del cabezal">＋ En el cabezal</button>
        <button type="button" onClick={() => file.current?.click()} title="Importar SRT, VTT o TXT con tiempos (si la pista ya tiene subtítulos, va a una pista nueva)">⬆ Importar</button>
        <input
          ref={file}
          type="file"
          accept=".srt,.vtt,.txt,text/plain,text/vtt,application/x-subrip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
        <span className="vx-exp">
          <select value={format} onChange={(e) => setFormat(e.target.value as SubFormat)} aria-label="Formato de exportación">
            <option value="srt">SRT</option>
            <option value="vtt">VTT</option>
            <option value="txt">TXT con tiempos</option>
          </select>
          <button type="button" onClick={exportFile} disabled={!clips.length} title="Guardar los subtítulos en un archivo">⬇ Exportar</button>
        </span>
      </div>

      {tracks.length > 1 && (
        <label className="vx-inline">
          <span>Pista</span>
          <select value={track?.id ?? ''} onChange={(e) => setPick(e.target.value)} aria-label="Pista de subtítulos">
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.clips.length})
              </option>
            ))}
          </select>
        </label>
      )}

      {track && (
        <div className="vx-tabbar-row" role="group" aria-label="Herramientas de la pista">
          <label className="vx-inline">
            <span>Desplazar</span>
            <input type="text" inputMode="decimal" className="vx-num" value={shift} onChange={(e) => setShift(e.target.value)} aria-label="Segundos a desplazar" size={4} />
            <span>s</span>
          </label>
          <button type="button" className="mini" disabled={locked || !clips.length} onClick={() => commit((p) => S.shiftCues(p, track.id, parseTimeInput(shift) ?? 0))} title="Todos los subtítulos, hacia delante">▶ Todos</button>
          <button type="button" className="mini" disabled={locked || !clips.length} onClick={() => commit((p) => S.shiftCues(p, track.id, -(parseTimeInput(shift) ?? 0)))} title="Todos los subtítulos, hacia atrás">◀ Todos</button>
          <button type="button" className="mini" disabled={locked || !oneSel} onClick={() => oneSel && commit((p) => S.shiftCues(p, track.id, parseTimeInput(shift) ?? 0, { fromId: oneSel.id }))} title="Desde el subtítulo elegido, hacia delante">▶ Desde aquí</button>
          <button type="button" className="mini" disabled={locked || !clips.length} onClick={() => commit((p) => S.fitCuesToScenes(p, track.id))} title="Pega el inicio y el final de cada subtítulo a los cortes de escena cercanos (a menos de 0,3 s)">🎞 Ajustar a escenas</button>
          <button type="button" className="mini" disabled={locked || selClips.length < 2} onClick={() => commit((p) => S.mergeCues(p, selClips))} title="Une los subtítulos elegidos (vecinos) en uno de varias líneas">⤓ Unir</button>
          <button type="button" className="mini" disabled={locked || !oneSel || !(oneSel.text ?? '').includes('\n')} onClick={() => oneSel && commit((p) => S.splitCueLines(p, oneSel.id).p)} title="Divide un subtítulo de varias líneas en uno por línea">⤒ Una línea cada uno</button>
        </div>
      )}

      <div className="vx-cuelist" role="table" aria-label="Subtítulos" ref={listRef}>
        <div className="vx-cue head" role="row" aria-hidden="true">
          <span>#</span>
          <span>Inicio · Fin</span>
          <span>Texto</span>
          <span />
        </div>
        {rows}
        {!clips.length && (
          <p className="vx-note">
            {track ? 'Aún no hay subtítulos.' : 'Esta pista se crea sola al añadir el primero.'} Pulsa «＋ En el cabezal», o importa un archivo SRT, VTT o TXT. Con el cursor en un texto: <kbd>Alt</kbd>+<kbd>Intro</kbd> divide, <kbd>Ctrl</kbd>+<kbd>Intro</kbd> añade otro, <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> cambia de fila.
          </p>
        )}
      </div>

      {track && st && (
        <details className="vx-substyle">
          <summary>Estilo de toda la pista «{track.name}»</summary>
          <div className="vx-insp-inner">
            <div className="vx-field wide">
              <label htmlFor="vx-sub-preset">Estilo</label>
              <select
                id="vx-sub-preset"
                value={st.style.presetId ?? ''}
                disabled={locked}
                onChange={(e) => {
                  const pr = SUBTITLE_PRESETS.find((x) => x.id === e.target.value);
                  if (pr) upStyle({ ...pr.style, karaoke: pr.style.karaoke }, 'preset');
                }}
              >
                <option value="">Personalizado</option>
                {SUBTITLE_PRESETS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <span />
            </div>
            <div className="vx-field wide">
              <label htmlFor="vx-sub-pos">Posición</label>
              <select id="vx-sub-pos" value={st.position} disabled={locked} onChange={(e) => upStyle({ position: e.target.value as 'bottom' | 'middle' | 'top' }, 'pos')}>
                <option value="bottom">Abajo</option>
                <option value="middle">Centro</option>
                <option value="top">Arriba</option>
              </select>
              <span />
            </div>
            <Field label="Margen" value={st.margin} min={0} max={0.3} step={0.005} scale={100} unit=" %" digits={1} disabled={locked || st.position === 'middle'} onChange={(v) => upStyle({ margin: v }, 'margin')} />
            <Field label="Líneas máx." value={st.maxLines} min={1} max={4} step={1} disabled={locked} onChange={(v) => upStyle({ maxLines: Math.round(v) }, 'lines')} />
            <Field label="Fundido" value={st.fade ?? 0} min={0} max={1} step={0.05} unit=" s" digits={2} disabled={locked} onChange={(v) => upStyle({ fade: v }, 'fade')} />
            <StyleControls style={st.style} disabled={locked} onChange={(patch, g) => upStyle({ style: { ...patch, presetId: undefined } }, g)} />
            <AnimControls
              karaokeOnly
              anim={st.karaoke ? { karaoke: st.karaoke } : undefined}
              clipDur={2}
              disabled={locked}
              onChange={(a) => upStyle({ karaoke: a?.karaoke }, 'karaoke')}
            />
          </div>
        </details>
      )}
    </div>
  );
}
