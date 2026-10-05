import { useId, useRef, type ReactNode, type MouseEvent } from 'react';
import { t } from '../i18n';
import { backdropShouldClose } from './dismissLogic';
import { useDismiss } from './useDismiss';
import './modal.css';

/** Botón ✕ de cierre: objetivo táctil de 36 px, siempre visible. */
export function CloseButton({ onClick, label, className }: { onClick: () => void; label?: string; className?: string }) {
  const text = label ?? t('Cerrar');
  return (
    <button type="button" className={`modal-x ${className ?? ''}`} onClick={onClick} aria-label={text} title={text}>
      <span aria-hidden="true">✕</span>
    </button>
  );
}

/** Botón «← Volver al diseño» para las pantallas completas. */
export function BackButton({ onClick, label, className }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <button type="button" className={`modal-back ${className ?? ''}`} onClick={onClick}>
      <span aria-hidden="true">← </span>
      {label ?? t('Volver al diseño')}
    </button>
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pantalla completa en vez de tarjeta centrada. */
  fullscreen?: boolean;
  /** Hay cambios sin guardar: el fondo no cierra (Esc/✕ siguen y deben confirmar en onClose). */
  dirty?: boolean;
  busy?: boolean;
  /** false: el clic en el fondo no cierra. */
  backdrop?: boolean;
  className?: string;
  cardClassName?: string;
  /** Cabecera oculta visualmente (el título sigue etiquetando el diálogo). */
  hideTitle?: boolean;
  alert?: boolean;
}

/** Diálogo base: fondo, tarjeta, cabecera con título y ✕, Esc, trampa de foco y retorno de foco. */
export function Modal({
  title,
  onClose,
  children,
  fullscreen,
  dirty,
  busy,
  backdrop,
  className,
  cardClassName,
  hideTitle,
  alert,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(ref, { onClose, busy });
  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (backdropShouldClose(e.target, e.currentTarget, { dirty, busy, backdrop })) onClose();
  };
  return (
    <div className={`modal-overlay ${fullscreen ? 'full' : ''} ${className ?? ''}`} onMouseDown={onBackdrop}>
      <div
        ref={ref}
        className={`modal-card ${cardClassName ?? ''}`}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={id}
      >
        <header className="modal-head">
          {fullscreen && <BackButton onClick={onClose} />}
          <h2 id={id} className={hideTitle ? 'sr-only' : 'modal-title'}>
            {title}
          </h2>
          <CloseButton onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
