import { useRef } from 'react';
import { t } from '../i18n';
import { CloseButton } from './Modal';
import { useDismiss } from './useDismiss';
import './library.css';

interface Props {
  reasons: string[];
  onForce: () => void;
  onCancel: () => void;
}

/** Cerrar la ventana con algo en curso (grabación, guardado fallido): cerrar de todos modos o cancelar. */
export function CloseWindowDialog({ reasons, onForce, onCancel }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose: onCancel, initialFocus: 'button.lib-btn' });
  return (
    <div className="donate-overlay" onClick={onCancel}>
      <div
        ref={cardRef}
        className="settings-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-win-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440 }}
      >
        <CloseButton className="float" onClick={onCancel} />
        <h3 id="close-win-title">{t('¿Cerrar ChamVa?')}</h3>
        <ul style={{ margin: '8px 0 12px', paddingLeft: 18 }}>
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="lib-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="lib-btn" onClick={onCancel}>
            {t('Cancelar')}
          </button>
          <button className="lib-btn danger" onClick={onForce}>
            {t('Cerrar ChamVa')}
          </button>
        </div>
      </div>
    </div>
  );
}
