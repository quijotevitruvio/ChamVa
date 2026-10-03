// Mezclador desplegable (V7): una fila por pista con silencio, solo, medidor de nivel, volumen en dB, panorámica
// (potencia constante), ecualizador paramétrico y ducking automático; arriba, la lectura de sonoridad de la salida.
// Todo pasa por el modelo (setTrackMix / updateTrack): un gesto = un paso de deshacer.
import { useState } from 'react';
import * as VM from '../../video/model';
import { DEFAULT_DUCK } from '../../video/audio/duck';
import { setTrackMix } from '../../video/audio/mixOps';
import { anySolo } from '../../video/engine/audioPlan';
import { EqEditor } from './EqEditor';
import { Field } from './Field';
import { LevelBar, MasterReadout, useMasterMeter } from './Meters';
import type { PreviewEngine } from './previewEngine';

type Commit = (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => void;

function TrackRow({ project, track, engine, commit }: { project: VM.VideoProject; track: VM.Track; engine: PreviewEngine; commit: Commit }) {
  const [open, setOpen] = useState<null | 'eq' | 'duck'>(null);
  const id = track.id;
  const mix = (patch: Parameters<typeof setTrackMix>[2], group: string) => commit((p) => setTrackMix(p, id, patch), `mx:${group}:${id}`);
  const d = track.duck;
  const others = project.tracks.filter((t) => t.kind !== 'subtitle' && t.id !== id);
  const gain = track.gainDb ?? 0;
  const pan = track.pan ?? 0;
  const dim = track.muted || (anySolo(project) && !track.solo);
  return (
    <div className={`vx-mx-row${dim ? ' dim' : ''}`} role="group" aria-label={`Mezclador de ${track.name}`}>
      <div className="vx-mx-l1">
        <span className="vx-mx-name" title={track.name}>
          {track.kind === 'video' ? '🎬' : '🎵'} {track.name}
        </span>
        <button type="button" className={`vx-mx-b${track.muted ? ' on' : ''}`} aria-pressed={track.muted} aria-label={track.muted ? `Activar el sonido de ${track.name}` : `Silenciar ${track.name}`} title="Silenciar" onClick={() => commit((p) => VM.updateTrack(p, id, { muted: !track.muted }))}>
          M
        </button>
        <button type="button" className={`vx-mx-b solo${track.solo ? ' on' : ''}`} aria-pressed={!!track.solo} aria-label={track.solo ? `Quitar el solo de ${track.name}` : `Solo ${track.name}`} title="Solo: si hay pistas en solo, solo suenan esas (también al exportar)" onClick={() => mix({ solo: !track.solo }, 'solo')}>
          S
        </button>
        <LevelBar engine={engine} trackId={id} label={track.name} />
        <button type="button" className={`vx-mx-b wide${track.eq?.length ? ' on' : ''}`} aria-pressed={open === 'eq'} title="Ecualizador de la pista" onClick={() => setOpen(open === 'eq' ? null : 'eq')}>
          EQ
        </button>
        <button type="button" className={`vx-mx-b wide${d?.on ? ' on' : ''}`} aria-pressed={open === 'duck'} title="Ducking: la pista baja cuando suena voz en otras pistas" onClick={() => setOpen(open === 'duck' ? null : 'duck')}>
          Duck
        </button>
      </div>
      <div className="vx-mx-l2">
        <Field label="Volumen" value={gain} min={-60} max={12} step={0.5} unit=" dB" digits={1} onChange={(v) => mix({ gainDb: v <= -60 ? -60 : v }, 'gain')} />
        <Field label="Panorámica" value={pan} min={-1} max={1} step={0.01} scale={100} unit=" %" digits={0} onChange={(v) => mix({ pan: v }, 'pan')} />
      </div>
      {open === 'eq' && (
        <div className="vx-mx-pane">
          <EqEditor key={id} bands={track.eq} label={`Ecualizador de ${track.name}`} onChange={(b, g) => commit((p) => setTrackMix(p, id, { eq: b ?? null }), `mx:${g}:${id}`)} />
        </div>
      )}
      {open === 'duck' && (
        <div className="vx-mx-pane">
          <label className="vx-check">
            <input type="checkbox" checked={!!d?.on} onChange={(e) => mix({ duck: { ...(d ?? DEFAULT_DUCK), on: e.target.checked } }, 'duck-on')} /> Bajar esta pista cuando suene voz en otras
          </label>
          <Field label="Bajar" value={d?.db ?? DEFAULT_DUCK.db} min={0} max={40} step={0.5} unit=" dB" digits={1} disabled={!d?.on} onChange={(v) => mix({ duck: { db: v } }, 'duck-db')} />
          <Field label="Umbral de voz" value={d?.thr ?? DEFAULT_DUCK.thr} min={-60} max={-10} step={1} unit=" dB" digits={0} disabled={!d?.on} onChange={(v) => mix({ duck: { thr: v } }, 'duck-thr')} />
          <Field label="Ataque" value={d?.attack ?? DEFAULT_DUCK.attack} min={1} max={500} step={1} unit=" ms" digits={0} disabled={!d?.on} onChange={(v) => mix({ duck: { attack: v } }, 'duck-att')} />
          <Field label="Liberación" value={d?.release ?? DEFAULT_DUCK.release} min={50} max={2000} step={10} unit=" ms" digits={0} disabled={!d?.on} onChange={(v) => mix({ duck: { release: v } }, 'duck-rel')} />
          <Field label="Mantener" value={d?.hold ?? DEFAULT_DUCK.hold} min={0} max={1000} step={10} unit=" ms" digits={0} disabled={!d?.on} onChange={(v) => mix({ duck: { hold: v } }, 'duck-hold')} />
          <fieldset className="vx-duck-by" disabled={!d?.on}>
            <legend>La disparan</legend>
            <label className="vx-check">
              <input type="radio" name={`by-${id}`} checked={!d?.by?.length} onChange={() => mix({ duck: { by: undefined } }, 'duck-by')} /> Todas las demás pistas
            </label>
            {others.map((o) => (
              <label key={o.id} className="vx-check">
                <input
                  type="checkbox"
                  checked={!!d?.by?.includes(o.id)}
                  onChange={(e) => {
                    const by = new Set(d?.by ?? []);
                    if (e.target.checked) by.add(o.id);
                    else by.delete(o.id);
                    mix({ duck: { by: by.size ? [...by] : undefined } }, 'duck-by');
                  }}
                />{' '}
                {o.name}
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </div>
  );
}

export function MixerPanel({ project, engine, commit, onClose }: { project: VM.VideoProject; engine: PreviewEngine; commit: Commit; onClose: () => void }) {
  const meter = useMasterMeter(engine, true);
  const tracks = project.tracks.filter((t) => t.kind !== 'subtitle');
  return (
    <section className="vx-mixer" aria-label="Mezclador">
      <div className="vx-mx-head">
        <b>🎚 Mezclador</b>
        <MasterReadout engine={engine} meter={meter} compact />
        <button type="button" className="mini" onClick={onClose} aria-label="Cerrar el mezclador" title="Cerrar el mezclador">
          ✕
        </button>
      </div>
      <div className="vx-mx-rows">
        {tracks.length === 0 && <p className="vx-note">Aún no hay pistas.</p>}
        {tracks.map((t) => (
          <TrackRow key={t.id} project={project} track={t} engine={engine} commit={commit} />
        ))}
      </div>
    </section>
  );
}
