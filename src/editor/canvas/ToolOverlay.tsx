import { useLayoutEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Doc } from '../core/types';
import { useEditor } from '../state/store';
import { useTool } from '../state/toolStore';
import { shapeFromDrag, type ShapeBox, type ShapeTool } from '../state/toolLogic';
import { toast } from '../../ui/toast';
import '../../ui/tools.css';

// Capa transparente sobre la página activa mientras la herramienta es Texto o Forma:
// recoge el puntero (las capas de debajo no se agarran) y crea el elemento.
//  - Texto: un clic pone el texto en ese punto y abre su edición.
//  - Forma: clic = tamaño por defecto centrado; arrastrar = caja entre los dos puntos
//    (Shift = proporcional / ángulos de 15°).
// Tras crear vuelve al puntero salvo con Shift pulsado (herramienta persistente).
export function ToolOverlay({
  doc,
  scale,
  stageRef,
  tool,
  shape,
}: {
  doc: Doc;
  scale: number;
  stageRef: React.RefObject<Konva.Stage | null>;
  tool: 'text' | 'shape';
  shape: ShapeTool;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number]; shift: boolean } | null>(null);
  const locked = !!doc.locked;

  useLayoutEffect(() => {
    const c = stageRef.current?.container();
    if (c) setPos({ left: c.offsetLeft, top: c.offsetTop });
  }, [scale, doc.width, doc.height, stageRef]);

  const docPoint = (e: { clientX: number; clientY: number }): [number, number] => {
    const rc = hostRef.current!.getBoundingClientRect();
    return [(e.clientX - rc.left) / scale, (e.clientY - rc.top) / scale];
  };
  const clampPt = (p: [number, number]): [number, number] => [Math.max(0, Math.min(doc.width, p[0])), Math.max(0, Math.min(doc.height, p[1]))];

  const finish = (a: [number, number], b: [number, number], shift: boolean) => {
    const st = useEditor.getState();
    if (tool === 'text') {
      st.addTextLayer(undefined, { x: a[0], y: a[1] });
      const id = useEditor.getState().selectedId;
      if (id) useEditor.getState().requestTextEdit(id);
    } else {
      const box: ShapeBox = shapeFromDrag(shape, a, b, {
        shift,
        clickSize: Math.round(Math.min(doc.width, doc.height) * 0.3),
      });
      st.addShapeLayer(shape, box);
    }
    useTool.getState().afterCreate(shift);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (locked) {
      toast('La página está bloqueada: desbloquéala para añadir elementos.', 'info');
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* puntero sintético o ya liberado */
    }
    const p = clampPt(docPoint(e));
    setDrag({ a: p, b: p, shift: e.shiftKey });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, b: clampPt(docPoint(e)), shift: e.shiftKey });
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = { ...drag, b: clampPt(docPoint(e)) };
    setDrag(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ya liberado */
    }
    finish(d.a, tool === 'text' ? d.a : d.b, e.shiftKey || d.shift);
  };

  if (!pos) return null;
  const moved = !!drag && Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]) >= 4;
  const prev = drag && tool === 'shape' && moved ? shapeFromDrag(shape, drag.a, drag.b, { shift: drag.shift }) : null;
  return (
    <div
      ref={hostRef}
      className={`tool-overlay is-${tool}${locked ? ' is-locked' : ''}`}
      style={{ left: pos.left, top: pos.top, width: doc.width * scale, height: doc.height * scale }}
      role="application"
      aria-label={locked ? 'Página bloqueada: no se pueden añadir elementos' : tool === 'text' ? 'Haz clic para añadir texto' : 'Arrastra para dibujar la forma'}
      data-testid="tool-overlay"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDrag(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {prev && (
        <div
          className={`tool-preview k-${shape}`}
          style={{
            left: prev.x * scale,
            top: prev.y * scale,
            width: prev.width * scale,
            height: Math.max(prev.height * scale, shape === 'line' ? 2 : 0),
            transform: prev.rotation ? `rotate(${prev.rotation}deg)` : undefined,
            transformOrigin: '0 0',
          }}
        />
      )}
    </div>
  );
}
