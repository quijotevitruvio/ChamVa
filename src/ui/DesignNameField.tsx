import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { designTitle } from '../editor/state/designIdentity';
import './topbar.css';

/**
 * Nombre editable del diseño (barra superior). Vacío = el nombre de la primera
 * página, como siempre. Enter y salir del campo guardan; Esc cancela.
 * El cambio no crea paso de deshacer (`setDesignName`) y se autoguarda.
 */
export function DesignNameField() {
  const designName = useEditor((s) => s.designName);
  const firstName = useEditor((s) => (s.pageIndex === 0 ? s.doc.name : s.pages[0]?.name));
  const setDesignName = useEditor((s) => s.setDesignName);
  const shown = designTitle(designName, [{ name: firstName } as never]);
  const [text, setText] = useState(shown);
  const editing = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Mientras no se edita, el campo sigue al nombre real (abrir otro diseño, renombrar desde Inicio…).
  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);

  const commit = () => {
    editing.current = false;
    const v = text.trim();
    if (v === shown) return setText(shown); // sin cambios: no fija un nombre propio
    setDesignName(v); // vacío → vuelve al nombre de la primera página
    if (!v) setText(designTitle(null, [{ name: firstName } as never]));
  };

  return (
    <input
      ref={input}
      className="design-name"
      value={text}
      style={{ width: `${Math.min(30, Math.max(12, text.length + 2))}ch` }}
      maxLength={80}
      spellCheck={false}
      aria-label="Nombre del diseño"
      title="Nombre del diseño (Enter para guardar, Esc para cancelar)"
      onFocus={(e) => {
        editing.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // que los atajos del editor no se coman las teclas
        if (e.key === 'Enter') input.current?.blur();
        else if (e.key === 'Escape') {
          editing.current = false;
          setText(shown);
          input.current?.blur();
        }
      }}
    />
  );
}
