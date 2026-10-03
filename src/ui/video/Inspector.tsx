import { useSyncExternalStore } from 'react';
import * as VM from '../../video/model';
import { clearClipKeys } from '../../video/fx/clipOps';
import { EFFECTS } from '../../video/model/effects';
import { fmtDur } from './ClipView';
import { AnimControls } from './AnimControls';
import { Field } from './Field';
import { AnimField, AnimSection, EffectsSection, TransitionSection, type FxCtx, type KeyClipboard } from './FxInspector';
import type { PreviewEngine } from './previewEngine';
import { StyleControls } from './StyleControls';
import { DEFAULT_TITLE_STYLE } from '../../video/title/style';
import { setCueText, setCueTimes } from '../../video/title/subtitles';

interface Props {
  project: VM.VideoProject;
  selection: string[];
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: (ripple: boolean) => void;
  /** abre la pestaña «Subtítulos» del panel de medios */
  onOpenSubtitles?: () => void;
  /** V6: cabezal, auto-fotograma, portapapeles de fotogramas y selección */
  engine: PreviewEngine;
  autoKey: boolean;
  setAutoKey: (v: boolean) => void;
  keyClip: KeyClipboard;
  setKeyClip: (v: KeyClipboard) => void;
  onSelect: (ids: string[]) => void;
}

export function Inspector({ project, selection, commit, onSplit, onDuplicate, onDelete, onOpenSubtitles, engine, autoKey, setAutoKey, keyClip, setKeyClip, onSelect }: Props) {
  // el cabezal: el inspector se repinta al moverlo (cuantizado mientras se reproduce, para no repintar 60 veces por segundo)
  const t = useSyncExternalStore(engine.subscribeTime, () => (engine.isPlaying ? Math.round(engine.getTime() * 15) / 15 : engine.getTime()));
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
  const sub = c.kind === 'subtitle';
  const styled = c.kind === 'text' && !!c.tstyle;
  const visual = c.kind !== 'audio' && !sub;
  const timed = c.kind === 'video' || c.kind === 'audio';
  const locked = track.locked;
  const upd = (patch: Parameters<typeof VM.updateClip>[2], group?: string) => commit((p) => VM.updateClip(p, c.id, patch), group ? `${group}:${c.id}` : undefined);
  const adjust = c.kind === 'adjust';
  const ctx: FxCtx = { project, clip: c, track, engine, t, commit, locked, autoKey, setAutoKey, keyClip, setKeyClip, onSelect };
  const dur = VM.clipDuration(c);
  const maxLen = timed && media ? Math.max(0.1, (media.duration - c.inP) / (c.speed || 1)) : 600;
  const KIND = { video: 'Video', audio: 'Audio', image: 'Imagen', text: 'Texto', subtitle: 'Subtítulo', adjust: 'Capa de ajuste' }[c.kind];

  return (
    <div className="vx-insp" aria-label={`Clip ${KIND}`}>
      <h3>
        {KIND}
        {locked ? ' 🔒' : ''}
      </h3>
      {locked && <p className="vx-note">La pista está bloqueada: desbloquéala para editar.</p>}
      {styled || sub ? (
        <div className="vx-field area">
          <label htmlFor="vx-text">{sub ? 'Subtítulo' : 'Texto'}</label>
          <textarea
            id="vx-text"
            rows={sub ? 3 : 2}
            value={c.text ?? ''}
            disabled={locked}
            spellCheck
            onChange={(e) => (sub ? commit((p) => setCueText(p, c.id, e.target.value), 'text:' + c.id) : upd({ text: e.target.value }, 'text'))}
          />
        </div>
      ) : c.kind === 'text' ? (
        <>
          <div className="vx-field wide">
            <label htmlFor="vx-text">Texto</label>
            <input id="vx-text" type="text" value={c.text ?? ''} disabled={locked} onChange={(e) => upd({ text: e.target.value }, 'text')} />
            <input type="color" aria-label="Color del texto" value={c.color ?? '#ffffff'} disabled={locked} onChange={(e) => upd({ color: e.target.value }, 'color')} />
          </div>
          <button type="button" className="mini" disabled={locked} title="Usa fuentes, contorno, sombra, caja y animaciones" onClick={() => upd({ tstyle: { ...DEFAULT_TITLE_STYLE, fontFamily: 'Arial', fontSize: Math.round(((c.size ?? 60) * 1080) / 720), fill: c.color ?? '#ffffff', shadow: false }, anim: { in: 'fade', out: 'fade', inDur: 0.3, outDur: 0.3 } })}>
            🎨 Pasar a estilos de título
          </button>
        </>
      ) : (
        <p className="vx-note vx-name">{c.name ?? media?.name ?? ''}</p>
      )}

      {styled && (
        <>
          <h4>Estilo del texto</h4>
          <StyleControls style={c.tstyle!} disabled={locked} onChange={(patch, g) => upd({ tstyle: { ...c.tstyle!, ...patch, presetId: undefined } }, 'ts-' + g)} />
          <AnimControls anim={c.anim} clipDur={dur} disabled={locked} onChange={(a, g) => upd({ anim: a }, 'anim-' + g)} />
        </>
      )}
      {sub && (
        <p className="vx-note">
          El estilo (fuente, posición, caja, karaoke) es de toda la pista de subtítulos.{' '}
          {onOpenSubtitles && (
            <button type="button" className="mini" onClick={onOpenSubtitles}>Abrir pestaña Subtítulos</button>
          )}
        </p>
      )}

      <h4>Tiempo</h4>
      <Field label="Inicio" value={c.start} min={0} max={Math.max(60, VM.projectDuration(project) + 30)} step={0.1} unit=" s" digits={2} disabled={locked} onChange={(v) => commit((p) => (sub ? setCueTimes(p, c.id, { start: v, end: v + dur }) : VM.moveClip(p, c.id, { start: v })), 'start:' + c.id)} />
      <Field label="Duración" value={dur} min={0.1} max={maxLen} step={0.1} unit=" s" digits={2} disabled={locked || !!c.toEnd} onChange={(v) => commit((p) => (sub ? setCueTimes(p, c.id, { end: c.start + v }) : VM.trimClip(p, c.id, 'out', c.start + v)), 'dur:' + c.id)} />
      {timed && (
        <Field label="Velocidad" value={c.speed || 1} min={0.25} max={3} step={0.05} unit="×" digits={2} disabled={locked} onChange={(v) => upd({ speed: v }, 'speed')} />
      )}

      {visual && !adjust && (
        <>
          <h4>Transformación</h4>
          <AnimField ctx={ctx} prop="x" label="Posición X" min={0} max={1} step={0.005} scale={100} unit=" %" digits={1} />
          <AnimField ctx={ctx} prop="y" label="Posición Y" min={0} max={1} step={0.005} scale={100} unit=" %" digits={1} />
          <AnimField ctx={ctx} prop="scale" label="Escala" min={0.1} max={4} step={0.01} scale={100} unit=" %" digits={0} />
          <AnimField ctx={ctx} prop="rotation" label="Rotación" min={-180} max={180} step={1} unit="°" digits={0} />
          <AnimField ctx={ctx} prop="opacity" label="Opacidad" min={0} max={1} step={0.01} scale={100} unit=" %" digits={0} />
          <button
            type="button"
            className="mini"
            disabled={locked}
            title="Vuelve a la posición, escala, rotación y opacidad por defecto y quita sus fotogramas"
            onClick={() =>
              commit((p) => {
                let q = VM.updateClip(p, c.id, { transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 } });
                for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) q = clearClipKeys(q, c.id, k);
                return q;
              })
            }
          >
            Restablecer
          </button>
          {c.kind === 'image' && <Field label="Ancho base" value={c.size ?? 0.3} min={0.05} max={1} step={0.01} scale={100} unit=" %" disabled={locked} onChange={(v) => upd({ size: v }, 'size')} />}
          {c.kind === 'text' && !styled && <Field label="Tamaño" value={c.size ?? 60} min={20} max={200} step={2} unit=" px" disabled={locked} onChange={(v) => upd({ size: v }, 'size')} />}
          <Field label="Fundido de entrada" value={c.fadeIn} min={0} max={3} step={0.1} unit=" s" digits={1} disabled={locked} onChange={(v) => upd({ fadeIn: v }, 'fi')} />
          <Field label="Fundido de salida" value={c.fadeOut} min={0} max={3} step={0.1} unit=" s" digits={1} disabled={locked} onChange={(v) => upd({ fadeOut: v }, 'fo')} />
        </>
      )}
      {adjust && (
        <>
          <h4>Capa de ajuste</h4>
          <p className="vx-note">Los efectos de esta capa se aplican a todo lo que hay debajo de ella durante su duración. Muévela y recórtala como un clip.</p>
          <AnimField ctx={ctx} prop="opacity" label="Opacidad" min={0} max={1} step={0.01} scale={100} unit=" %" digits={0} />
        </>
      )}

      {visual && !adjust && track.kind === 'video' && <TransitionSection ctx={ctx} />}
      {visual && <EffectsSection ctx={ctx} />}
      {!sub && <AnimSection ctx={ctx} />}

      {timed && (
        <>
          <h4>Audio</h4>
          <AnimField ctx={ctx} prop="volume" label="Volumen" min={0} max={2} step={0.05} scale={100} unit=" %" />
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
