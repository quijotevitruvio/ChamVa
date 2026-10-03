import { useId } from 'react';
import * as VM from '../../video/model';
import { EFFECTS } from '../../video/model/effects';
import { fmtDur } from './ClipView';

interface Props {
  project: VM.VideoProject;
  selection: string[];
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: (ripple: boolean) => void;
}

function Field({ label, value, min, max, step, unit = '', scale = 1, digits = 0, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; unit?: string; scale?: number; digits?: number; onChange: (v: number) => void; disabled?: boolean }) {
  const id = useId();
  const shown = Number((value * scale).toFixed(digits));
  return (
    <div className="vx-field">
      <label htmlFor={id}>{label}</label>
      <input type="range" id={id} min={min} max={max} step={step} value={Math.max(min, Math.min(max, value))} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={`${shown}${unit}`} />
      <input
        type="number"
        className="vx-num"
        aria-label={`${label} (valor)`}
        min={min * scale}
        max={max * scale}
        step={step * scale}
        value={shown}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v / scale);
        }}
      />
      <span className="vx-unit">{unit}</span>
    </div>
  );
}

export function Inspector({ project, selection, commit, onSplit, onDuplicate, onDelete }: Props) {
  const loc = selection.length === 1 ? VM.findClip(project, selection[0]) : null;

  if (selection.length === 0 || (selection.length === 1 && !loc)) {
    const dur = VM.projectDuration(project);
    const n = project.tracks.reduce((a, t) => a + t.clips.length, 0);
    return (
      <div className="vx-insp" aria-label="Proyecto">
        <h3>Proyecto</h3>
        <p className="vx-note">
          {n} clip{n === 1 ? '' : 's'} · {project.tracks.length} pista{project.tracks.length === 1 ? '' : 's'} · {fmtDur(dur)}
        </p>
        <h4>Audio general</h4>
        {(['low', 'mid', 'high'] as const).map((band) => (
          <Field key={band} label={band === 'low' ? 'Graves' : band === 'mid' ? 'Medios' : 'Agudos'} value={project.eq[band]} min={-12} max={12} step={1} unit=" dB" onChange={(v) => commit((p) => VM.updateProject(p, { eq: { ...p.eq, [band]: v } }), 'eq:' + band)} />
        ))}
        <label className="vx-check">
          <input type="checkbox" checked={project.normalize} onChange={(e) => commit((p) => VM.updateProject(p, { normalize: e.target.checked }))} /> Normalizar volumen
        </label>
        <p className="vx-note">Selecciona un clip para editar su transformación, velocidad, volumen y fundidos.</p>
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="vx-insp" aria-label="Varios clips">
        <h3>{selection.length} clips seleccionados</h3>
        <div className="vx-actions">
          <button type="button" onClick={onSplit}>✂ Dividir en el cabezal</button>
          <button type="button" onClick={onDuplicate}>⧉ Duplicar</button>
          <button type="button" onClick={() => onDelete(false)}>🗑 Eliminar</button>
          <button type="button" onClick={() => onDelete(true)}>🗑 Eliminar y cerrar hueco</button>
        </div>
        <p className="vx-note">Arrastra uno para mover todos. Mayús o Ctrl + clic suma o quita clips; arrastrar en un hueco dibuja una caja de selección.</p>
      </div>
    );
  }

  const c = loc!.clip;
  const track = loc!.track;
  const media = c.mediaId ? project.media[c.mediaId] : undefined;
  const visual = c.kind !== 'audio';
  const timed = c.kind === 'video' || c.kind === 'audio';
  const locked = track.locked;
  const upd = (patch: Parameters<typeof VM.updateClip>[2], group?: string) => commit((p) => VM.updateClip(p, c.id, patch), group ? `${group}:${c.id}` : undefined);
  const upTr = (tr: Partial<VM.Transform>, g: string) => upd({ transform: tr }, g);
  const dur = VM.clipDuration(c);
  const maxLen = timed && media ? Math.max(0.1, (media.duration - c.inP) / (c.speed || 1)) : 600;
  const KIND = { video: 'Video', audio: 'Audio', image: 'Imagen', text: 'Texto' }[c.kind];

  return (
    <div className="vx-insp" aria-label={`Clip ${KIND}`}>
      <h3>
        {KIND}
        {locked ? ' 🔒' : ''}
      </h3>
      {locked && <p className="vx-note">La pista está bloqueada: desbloquéala para editar.</p>}
      {c.kind === 'text' ? (
        <div className="vx-field wide">
          <label htmlFor="vx-text">Texto</label>
          <input id="vx-text" type="text" value={c.text ?? ''} disabled={locked} onChange={(e) => upd({ text: e.target.value }, 'text')} />
          <input type="color" aria-label="Color del texto" value={c.color ?? '#ffffff'} disabled={locked} onChange={(e) => upd({ color: e.target.value }, 'color')} />
        </div>
      ) : (
        <p className="vx-note vx-name">{c.name ?? media?.name ?? ''}</p>
      )}

      <h4>Tiempo</h4>
      <Field label="Inicio" value={c.start} min={0} max={Math.max(60, VM.projectDuration(project) + 30)} step={0.1} unit=" s" digits={2} disabled={locked} onChange={(v) => commit((p) => VM.moveClip(p, c.id, { start: v }), 'start:' + c.id)} />
      <Field label="Duración" value={dur} min={0.1} max={maxLen} step={0.1} unit=" s" digits={2} disabled={locked || !!c.toEnd} onChange={(v) => commit((p) => VM.trimClip(p, c.id, 'out', c.start + v), 'dur:' + c.id)} />
      {timed && (
        <Field label="Velocidad" value={c.speed || 1} min={0.25} max={3} step={0.05} unit="×" digits={2} disabled={locked} onChange={(v) => upd({ speed: v }, 'speed')} />
      )}

      {visual && (
        <>
          <h4>Transformación</h4>
          <Field label="Posición X" value={c.transform.x} min={0} max={1} step={0.005} scale={100} unit=" %" digits={1} disabled={locked} onChange={(v) => upTr({ x: v }, 'tx')} />
          <Field label="Posición Y" value={c.transform.y} min={0} max={1} step={0.005} scale={100} unit=" %" digits={1} disabled={locked} onChange={(v) => upTr({ y: v }, 'ty')} />
          <Field label="Escala" value={c.transform.scale} min={0.1} max={4} step={0.01} scale={100} unit=" %" digits={0} disabled={locked} onChange={(v) => upTr({ scale: v }, 'ts')} />
          <Field label="Rotación" value={c.transform.rotation} min={-180} max={180} step={1} unit="°" digits={0} disabled={locked} onChange={(v) => upTr({ rotation: v }, 'tr')} />
          <Field label="Opacidad" value={c.transform.opacity} min={0} max={1} step={0.01} scale={100} unit=" %" digits={0} disabled={locked} onChange={(v) => upTr({ opacity: v }, 'to')} />
          <button type="button" className="mini" disabled={locked} onClick={() => commit((p) => VM.updateClip(p, c.id, { transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 } }))}>
            Restablecer
          </button>
          {c.kind === 'image' && <Field label="Ancho base" value={c.size ?? 0.3} min={0.05} max={1} step={0.01} scale={100} unit=" %" disabled={locked} onChange={(v) => upd({ size: v }, 'size')} />}
          {c.kind === 'text' && <Field label="Tamaño" value={c.size ?? 60} min={20} max={200} step={2} unit=" px" disabled={locked} onChange={(v) => upd({ size: v }, 'size')} />}
          <Field label="Fundido de entrada" value={c.fadeIn} min={0} max={3} step={0.1} unit=" s" digits={1} disabled={locked} onChange={(v) => upd({ fadeIn: v }, 'fi')} />
          <Field label="Fundido de salida" value={c.fadeOut} min={0} max={3} step={0.1} unit=" s" digits={1} disabled={locked} onChange={(v) => upd({ fadeOut: v }, 'fo')} />
        </>
      )}

      {timed && (
        <>
          <h4>Audio</h4>
          <Field label="Volumen" value={c.volume} min={0} max={2} step={0.05} scale={100} unit=" %" disabled={locked} onChange={(v) => upd({ volume: v }, 'vol')} />
          <Field label="Fundido de entrada (audio)" value={c.audioFadeIn} min={0} max={5} step={0.1} unit=" s" digits={1} disabled={locked} onChange={(v) => upd({ audioFadeIn: v }, 'afi')} />
          <Field label="Fundido de salida (audio)" value={c.audioFadeOut} min={0} max={5} step={0.1} unit=" s" digits={1} disabled={locked} onChange={(v) => upd({ audioFadeOut: v }, 'afo')} />
          <div className="vx-field wide">
            <label htmlFor="vx-voice">Voz</label>
            <select id="vx-voice" value={c.effect} disabled={locked} onChange={(e) => upd({ effect: e.target.value })}>
              {EFFECTS.map((fx) => (
                <option key={fx.id} value={fx.id}>
                  {fx.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="vx-actions">
        <button type="button" onClick={onSplit} disabled={locked}>✂ Dividir (S)</button>
        <button type="button" onClick={onDuplicate} disabled={locked}>⧉ Duplicar (Ctrl+D)</button>
        <button type="button" onClick={() => onDelete(false)} disabled={locked}>🗑 Eliminar (Supr)</button>
        <button type="button" onClick={() => onDelete(true)} disabled={locked}>🗑 Eliminar y cerrar hueco</button>
      </div>
    </div>
  );
}
