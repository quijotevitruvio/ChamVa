import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import './layoutaids.css';

// Panel inferior con las notas del orador de la página actual (se muestran en
// el modo presentación con la tecla N). Se guarda al salir del campo.
export function SpeakerNotes({ onClose }: { onClose: () => void }) {
  const docId = useEditor((s) => s.doc.id);
  const saved = useEditor((s) => s.doc.speakerNotes ?? '');
  const setSpeakerNotes = useEditor((s) => s.setSpeakerNotes);
  const [text, setText] = useState(saved);
  const textRef = useRef(text);
  textRef.current = text;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  // Al cambiar de página (o desde deshacer) se recarga el texto guardado.
  useEffect(() => setText(saved), [docId, saved]);

  // Al cambiar de página o cerrar el panel se guarda lo pendiente.
  useEffect(
    () => () => {
      if (textRef.current !== savedRef.current) setSpeakerNotes(textRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  );

  return (
    <div className="sp-panel">
      <div className="sp-head">
        <span>Notas del orador · solo se ven en el modo presentación (tecla N); no se exportan</span>
        <button className="lp-reset" style={{ flex: 'none' }} onClick={onClose}>
          Cerrar
        </button>
      </div>
      <textarea
        className="sp-text"
        value={text}
        placeholder="Escribe lo que dirás en esta página…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== saved && setSpeakerNotes(text)}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
