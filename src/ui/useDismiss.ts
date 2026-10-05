import { useEffect, useRef, type RefObject } from 'react';
import { FOCUSABLE, escShouldClose, isTopLayer, popLayer, pushLayer, trapIndex } from './dismissLogic';

export interface DismissOptions {
  /** Cierra la capa (ya incluye la confirmación si hay cambios sin guardar). */
  onClose: () => void;
  /** Si false, no se atrapa el foco ni se reacciona a Esc (capa cerrada). */
  active?: boolean;
  /** Mientras está ocupado, Esc no cierra. */
  busy?: boolean;
  /** Se enfoca este selector al abrir; por defecto el primer control. */
  initialFocus?: string;
  /** false: no cerrar con Esc (el componente ya lo gestiona o hay que confirmar). */
  esc?: boolean;
  /** Devuelve true para que ESTE Esc no cierre (p. ej. un menú interno abierto o un campo de texto). */
  escSkip?: (e: KeyboardEvent) => boolean;
  /** false: popover/guía no modal: ni trampa de foco, ni aria-modal, ni mover el foco al abrir (sí Esc y retorno de foco). */
  modal?: boolean;
}

let uid = 0;

/**
 * Comportamiento común de toda capa sobre el editor:
 * Esc cierra (solo la de arriba), el foco queda atrapado dentro, vuelve al
 * elemento que la abrió y el contenedor lleva role/aria-modal/aria-labelledby.
 * No cambia el marcado: se aplica sobre la raíz existente.
 */
export function useDismiss(root: RefObject<HTMLElement | null>, opts: DismissOptions): void {
  const { active = true, initialFocus, esc = true, modal = true } = opts;
  const closeRef = useRef(opts.onClose);
  const busyRef = useRef(!!opts.busy);
  const skipRef = useRef(opts.escSkip);
  closeRef.current = opts.onClose;
  skipRef.current = opts.escSkip;
  busyRef.current = !!opts.busy;

  useEffect(() => {
    if (!active) return;
    const el = root.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    const layer = pushLayer();

    // Semántica de diálogo si el marcado aún no la declara.
    if (!el.getAttribute('role')) el.setAttribute('role', 'dialog');
    if (modal && !el.hasAttribute('aria-modal')) el.setAttribute('aria-modal', 'true');
    if (!el.hasAttribute('aria-labelledby') && !el.hasAttribute('aria-label')) {
      const h = el.querySelector<HTMLElement>('h1,h2,h3,[data-dialog-title]');
      if (h) {
        if (!h.id) h.id = `dlg-title-${++uid}`;
        el.setAttribute('aria-labelledby', h.id);
      } else {
        el.setAttribute('aria-label', document.title || 'Diálogo');
      }
    }

    const items = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );

    // Foco inicial (si no hay ya algo enfocado dentro).
    if (modal && !el.contains(document.activeElement)) {
      const target = (initialFocus && el.querySelector<HTMLElement>(initialFocus)) || items()[0];
      if (target) target.focus({ preventScroll: true });
      else {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (!isTopLayer(layer)) return;
      if (modal && e.key === 'Tab') {
        const list = items();
        const idx = list.indexOf(document.activeElement as HTMLElement);
        const go = trapIndex(list.length, idx, e.shiftKey);
        if (go !== null) {
          e.preventDefault();
          list[go].focus();
        } else if (list.length === 0) {
          e.preventDefault();
        }
        return;
      }
      if (esc && escShouldClose(e) && !busyRef.current && !skipRef.current?.(e)) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      popLayer(layer);
      // Devuelve el foco a quien abrió la capa (si sigue en pantalla).
      if (opener && opener.isConnected && typeof opener.focus === 'function') {
        setTimeout(() => opener.focus({ preventScroll: true }), 0);
      }
    };
  }, [root, active, initialFocus, esc, modal]);
}
