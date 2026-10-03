import { flushSave } from '../io/autosave';
import { useSaveStatus } from '../io/saveStatus';
import { t } from '../i18n';
import './topbar.css';

/** Nube de la barra superior: Guardando… (cian), Guardado (verde), Sin guardar (rojo, con reintento). Todo es local. */
export function SaveIndicator() {
  const { state, savedAt } = useSaveStatus();
  if (state === 'idle') return null;

  const label =
    state === 'error' ? t('Sin guardar') : state === 'saved' ? t('Guardado') : t('Guardando…');
  const hora = savedAt ? new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const title =
    state === 'error'
      ? 'No se pudo guardar en este equipo (¿espacio lleno o almacenamiento bloqueado?). Clic para reintentar y guarda tu proyecto como archivo.'
      : state === 'saved'
        ? `Guardado en este equipo${hora ? ` a las ${hora}` : ''}`
        : 'Guardando en este equipo…';

  const cloud = (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.5 12a3.5 3.5 0 0 0 1 7z" />
      {state === 'saved' && <path d="m9 13 2.2 2.2L15 11.5" />}
      {state === 'error' && <path d="M12 9v4 M12 16.2v.1" />}
    </svg>
  );

  if (state === 'error') {
    return (
      <button type="button" className="save-ind error" title={title} onClick={() => void flushSave()} role="status">
        {cloud}
        <span className="save-ind-label">{label}</span>
      </button>
    );
  }
  return (
    <span className={`save-ind ${state === 'saved' ? 'saved' : 'busy'}`} title={title} role="status" aria-live="polite">
      {cloud}
      <span className="save-ind-label">{label}</span>
    </span>
  );
}
