import { memo } from 'react';
import type { Track } from '../../video/model';

interface Props {
  track: Track;
  onChange: (id: string, patch: Partial<Pick<Track, 'name' | 'muted' | 'locked' | 'hidden' | 'magnet'>>) => void;
  onRemove: (id: string) => void;
}

function T({ on, label, glyph, onClick, danger }: { on?: boolean; label: string; glyph: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={`vx-tb${on ? ' on' : ''}${danger ? ' danger' : ''}`} aria-pressed={on === undefined ? undefined : on} aria-label={label} title={label} onClick={onClick}>
      {glyph}
    </button>
  );
}

/** Cabecera de una pista: nombre y los interruptores (silenciar, bloquear, ocultar, imán) y borrar. */
export const TrackHeader = memo(function TrackHeader({ track, onChange, onRemove }: Props) {
  return (
    <div className="vx-th" data-track-header={track.id} role="group" aria-label={`Pista ${track.name}`}>
      <input
        className="vx-th-name"
        value={track.name}
        aria-label={`Nombre de la pista ${track.name}`}
        onChange={(e) => onChange(track.id, { name: e.target.value })}
        spellCheck={false}
      />
      <div className="vx-th-btns">
        {track.kind !== 'subtitle' && <T on={track.muted} label={track.muted ? 'Activar el sonido de la pista' : 'Silenciar la pista'} glyph={track.muted ? '🔇' : '🔊'} onClick={() => onChange(track.id, { muted: !track.muted })} />}
        {track.kind !== 'audio' && <T on={track.hidden} label={track.kind === 'subtitle' ? (track.hidden ? 'Mostrar los subtítulos en el video' : 'Ocultar los subtítulos (no se incrustan al exportar)') : track.hidden ? 'Mostrar la pista' : 'Ocultar la pista'} glyph={track.hidden ? '🙈' : '👁'} onClick={() => onChange(track.id, { hidden: !track.hidden })} />}
        <T on={track.locked} label={track.locked ? 'Desbloquear la pista' : 'Bloquear la pista'} glyph={track.locked ? '🔒' : '🔓'} onClick={() => onChange(track.id, { locked: !track.locked })} />
        <T on={track.magnet} label={track.magnet ? 'Quitar el imán (clips sueltos, con huecos)' : 'Imán: clips en secuencia, sin huecos'} glyph="🧲" onClick={() => onChange(track.id, { magnet: !track.magnet })} />
        <T label="Borrar la pista" glyph="✕" danger onClick={() => onRemove(track.id)} />
      </div>
    </div>
  );
});
