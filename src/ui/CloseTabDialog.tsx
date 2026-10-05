import { useRef } from 'react';
import { t } from '../i18n';
import { CloseButton } from './Modal';
import { useDismiss } from './useDismiss';
import './library.css';

interface Props {
  name: string;
  onForce: () => void;
  onCancel: () => void;
}

/** El diseño no se pudo guardar en el equipo: cerrar de todos modos o cancelar. */
export function CloseTabDialog({ name, onForce, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose: onCancel, initialFocus: 'button' });

  return (
    <div className="donate-overlay" onClick={onCancel}>
      <div
        ref={cardRef}
        className="settings-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-tab-title"
        aria-describedby="close-tab-desc"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440 }}
      >
        <CloseButton className="float" onClick={onCancel} />
        <h3 id="close-tab-title">{t('No se pudo guardar')}</h3>
        <p id="close-tab-desc">
          {t('«{n}» no se pudo guardar en este equipo. Si lo cierras ahora, se pierden sus últimos cambios.').replace('{n}', name)}
        </p>
        <div className="lib-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button ref={cancelRef} className="lib-btn" onClick={onCancel}>
            {t('Cancelar')}
          </button>
          <button className="lib-btn danger" onClick={onForce}>
            {t('Cerrar de todos modos')}
          </button>
        </div>
      </div>
    </div>
  );
}
