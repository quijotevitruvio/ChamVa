import { useEffect, useState } from 'react';
import { useEditor } from '../state/store';
import { NOTE_COLORS } from '../core/layout';
import type { StickyNote } from '../core/types';
import '../../ui/layoutaids.css';

// Notas adhesivas internas: flotan sobre el lienzo, solo existen en el editor
// (no se exportan). Arrastrables por la barra, texto editable, colores grises.
// `origin` = esquina superior izquierda del lienzo dentro del área de scroll.
export function StickyNotes({ scale, origin }: { scale: number; origin: { left: number; top: number } }) {
  const notes = useEditor((s) => s.doc.notes);
  if (!notes?.length) return null;
  return (
    <div className="sn-layer" style={{ left: origin.left, top: origin.top }}>
      {notes.map((n) => (
        <Note key={n.id} note={n} scale={scale} />
      ))}
    </div>
  );
}

function Note({ note, scale }: { note: StickyNote; scale: number }) {
  const updateNote = useEditor((s) => s.updateNote);
  const removeNote = useEditor((s) => s.removeNote);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState(note.text);
  useEffect(() => setText(note.text), [note.text]);

  const x = drag?.x ?? note.x;
  const y = drag?.y ?? note.y;

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const bx = note.x;
    const by = note.y;
    let last = { x: bx, y: by };
    const move = (ev: PointerEvent) => {
      last = { x: bx + (ev.clientX - sx) / scale, y: by + (ev.clientY - sy) / scale };
      setDrag(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (Math.abs(last.x - bx) > 0.5 || Math.abs(last.y - by) > 0.5)
        updateNote(note.id, { x: Math.round(last.x), y: Math.round(last.y) });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const nextColor = () => {
    const i = NOTE_COLORS.indexOf(note.color);
    updateNote(note.id, { color: NOTE_COLORS[(i + 1) % NOTE_COLORS.length] });
  };

  return (
    <div className="sn-note" style={{ left: x * scale, top: y * scale, background: note.color }}>
      <div className="sn-bar" onPointerDown={onDown} title="Arrastra para mover la nota (no se exporta)">
        <span className="sn-grip">⋮⋮ NOTA</span>
        <button className="sn-dot" style={{ background: note.color }} onClick={nextColor} title="Cambiar color" aria-label="Cambiar color" />
        <button className="sn-x" onClick={() => removeNote(note.id)} title="Borrar nota" aria-label="Borrar nota">
          ✕
        </button>
      </div>
      <textarea
        className="sn-text"
        value={text}
        placeholder="Escribe una nota…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== note.text && updateNote(note.id, { text })}
      />
    </div>
  );
}
