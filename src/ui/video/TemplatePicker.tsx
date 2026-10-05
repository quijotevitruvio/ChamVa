// Selector «Plantillas» del editor de video: 12 plantillas locales. «Usar» crea un proyecto nuevo (Ctrl+Z recupera el
// anterior); las de intro, cierre, cuenta regresiva y recordatorio también se pueden «Insertar en el cabezal».
import { useRef, useState, type KeyboardEvent } from 'react';
import { VIDEO_TEMPLATES, type VideoTemplate } from '../../video/templates/templates';
import { useDismiss } from '../useDismiss';

interface Props {
  /** ya hay algo en el proyecto: se avisa de que «Usar» lo reemplaza (con Ctrl+Z para volver) */
  hasContent: boolean;
  onApply: (t: VideoTemplate, how: 'project' | 'insert') => Promise<void>;
  onClose: () => void;
}

const cover = (t: VideoTemplate) => {
  const h = t.placeholders[0];
  return h ? `linear-gradient(135deg, ${h.c1}, ${h.c2})` : 'linear-gradient(135deg, #334155, #0f172a)';
};

export function TemplatePicker({ hasContent, onApply, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  useDismiss(root, { onClose, busy: !!busy });
  const run = async (t: VideoTemplate, how: 'project' | 'insert') => {
    setBusy(t.id + how);
    setError('');
    try {
      await onApply(t, how);
      onClose();
    } catch (e) {
      setError(`No se pudo aplicar la plantilla: ${(e as Error).message}`);
      setBusy(null);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy) onClose();
    }
  };
  return (
    <div className="vx-as-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={root} className="vx-as vx-tpl" role="dialog" aria-modal="true" aria-labelledby="vx-tpl-title" onKeyDown={onKey}>
        <div className="vx-as-head">
          <h3 id="vx-tpl-title">▦ Plantillas de video</h3>
          <button type="button" className="mini" onClick={onClose} disabled={!!busy} aria-label="Cerrar" title="Cerrar (Esc)">✕</button>
        </div>
        <p className="vx-as-local">Son proyectos con marcadores: cambia los textos y arrastra tus medios sobre los marcadores. Todo es local.</p>
        {hasContent && <p className="vx-as-note" role="note">«Usar» reemplaza el proyecto actual; con Ctrl+Z vuelve.</p>}
        {error && <p className="vx-as-warn" role="alert">{error}</p>}
        <ul className="vx-tpl-grid">
          {VIDEO_TEMPLATES.map((t) => (
            <li key={t.id} className="vx-tpl-card" data-template={t.id}>
              <div className="vx-tpl-cover" style={{ background: cover(t) }} aria-hidden="true">
                <span className={`vx-tpl-asp${t.aspect === '9:16' ? ' tall' : ''}`}>{t.aspect}</span>
              </div>
              <div className="vx-tpl-info">
                <b>{t.name}</b>
                <small>{t.category} · {t.duration.toString().replace('.', ',')} s</small>
                <p>{t.description}</p>
              </div>
              <div className="vx-tpl-actions">
                <button type="button" className="primary" disabled={!!busy} onClick={() => void run(t, 'project')} title="Crea un proyecto nuevo con esta plantilla">
                  {busy === t.id + 'project' ? 'Aplicando…' : 'Usar'}
                </button>
                {t.insertable && (
                  <button type="button" disabled={!!busy} onClick={() => void run(t, 'insert')} title="Añade la plantilla en el cabezal sin cambiar tu proyecto">
                    {busy === t.id + 'insert' ? 'Insertando…' : 'Insertar en el cabezal'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
