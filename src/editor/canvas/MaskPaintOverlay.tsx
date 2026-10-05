import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Doc, Layer } from '../core/types';
import { useEditor } from '../state/store';
import { useTool } from '../state/toolStore';
import { usePixelOpts, maskK } from '../state/pixelOps';
import { editableAlpha, invertMatrix, layerMatrix, MaskStroke, withAlpha } from '../core/layerMask';
import { clearLiveMask, setLiveMask, updateLiveMask } from '../core/maskRender';
import { isLayerLocked } from '../core/pageOps';
import '../../ui/brush.css';

// Pincel sobre la MÁSCARA de una capa (modo «editar máscara»): Pincel (B) pinta blanco = mostrar,
// Borrador (E) pinta negro = ocultar, X alterna, [ ] cambian el tamaño. Mientras se pinta, la máscara
// se ve en vivo (maskRender.setLiveMask) y al soltar se guarda con UN paso de deshacer.
export function MaskPaintOverlay({ doc, scale, stageRef, layer }: { doc: Doc; scale: number; stageRef: React.RefObject<Konva.Stage | null>; layer: Layer }) {
  const tool = useTool((s) => s.tool);
  const hostRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const run = useRef<{ id: number; stroke: MaskStroke; plane: Uint8Array; w: number; h: number; last: [number, number] } | null>(null);
  const locked = isLayerLocked(doc, layer);

  useLayoutEffect(() => {
    const c = stageRef.current?.container();
    if (c) setPos({ left: c.offsetLeft, top: c.offsetTop });
  }, [scale, doc.width, doc.height, stageRef]);

  // X alterna mostrar/ocultar; [ y ] cambian el tamaño (como en el editor de recorte).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target as HTMLElement | null;
      if (tg?.closest('input,textarea,select,[contenteditable="true"]')) return;
      const t = useTool.getState().tool;
      if (e.key.toLowerCase() === 'x') {
        e.preventDefault();
        useTool.getState().setTool(t === 'eraser' ? 'brush' : 'eraser');
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        const s = usePixelOpts.getState();
        const n = s.brush.size;
        s.setBrush({ size: e.key === '[' ? Math.max(1, Math.min(n - 2, Math.round(n / 1.15))) : Math.min(2000, Math.max(n + 2, Math.round(n * 1.15))) });
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  useEffect(() => () => clearLiveMask(layer.id), [layer.id]);

  const docPoint = (e: { clientX: number; clientY: number }): [number, number] => {
    const rc = hostRef.current!.getBoundingClientRect();
    return [(e.clientX - rc.left) / scale, (e.clientY - rc.top) / scale];
  };

  // Documento → píxel del plano de la máscara.
  const toPlane = (l: Layer, w: number, h: number, dx: number, dy: number): [number, number] => {
    const inv = invertMatrix(layerMatrix(l));
    if (!inv || !l.mask) return [-1e9, -1e9];
    const [a, b, c, d, e, f] = inv;
    const lx = a * dx + c * dy + e;
    const ly = b * dx + d * dy + f;
    const r = l.mask.rect;
    return [((lx - r.x) / r.w) * w, ((ly - r.y) / r.h) * h];
  };
  // Diámetro del pincel (px del documento) en píxeles del plano.
  const planeSize = (l: Layer, w: number) => {
    const s = (Math.abs(l.scaleX) + Math.abs(l.scaleY)) / 2 || 1;
    return (usePixelOpts.getState().brush.size / s) * (w / l.mask!.rect.w);
  };

  const moveRing = (e: { clientX: number; clientY: number }) => {
    const ring = ringRef.current;
    if (!ring) return;
    const rc = hostRef.current!.getBoundingClientRect();
    const d = Math.max(6, usePixelOpts.getState().brush.size * scale);
    ring.style.width = ring.style.height = `${d}px`;
    ring.style.transform = `translate(${e.clientX - rc.left - d / 2}px, ${e.clientY - rc.top - d / 2}px)`;
    ring.style.opacity = '1';
  };

  const redraw = () => stageRef.current?.batchDraw();

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || locked) return;
    const l = useEditor.getState().doc.layers.find((x) => x.id === layer.id);
    if (!l?.mask) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sin captura */
    }
    const ed = editableAlpha(l.mask, maskK(l));
    if (!ed) return;
    const plane = new Uint8Array(ed.alpha);
    const show = useTool.getState().tool !== 'eraser';
    // Con la máscara invertida, «mostrar» es pintar negro en el plano.
    const value = (show !== !!l.mask.invert ? 255 : 0) as 0 | 255;
    const b = usePixelOpts.getState().brush;
    const stroke = new MaskStroke(plane, ed.w, ed.h, { value, size: planeSize(l, ed.w), hardness: b.hardness, opacity: b.opacity });
    setLiveMask(l.id, l.mask, ed.w, ed.h, plane);
    const [dx, dy] = docPoint(e);
    const p = toPlane(l, ed.w, ed.h, dx, dy);
    const r = stroke.dab(p[0], p[1]);
    if (r) updateLiveMask(l.id, r);
    run.current = { id: e.pointerId, stroke, plane, w: ed.w, h: ed.h, last: p };
    redraw();
    moveRing(e);
  };

  const onMove = (e: React.PointerEvent) => {
    moveRing(e);
    const rn = run.current;
    if (!rn || rn.id !== e.pointerId) return;
    const l = useEditor.getState().doc.layers.find((x) => x.id === layer.id);
    if (!l?.mask) return;
    const native = e.nativeEvent as PointerEvent;
    const evs = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [native]) {
      const [dx, dy] = docPoint(ev);
      const p = toPlane(l, rn.w, rn.h, dx, dy);
      const r = rn.stroke.line(rn.last[0], rn.last[1], p[0], p[1]);
      rn.last = p;
      if (r) updateLiveMask(l.id, r);
    }
    redraw();
  };

  const finish = (e: React.PointerEvent) => {
    const rn = run.current;
    if (!rn || rn.id !== e.pointerId) return;
    run.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ya liberado */
    }
    const st = useEditor.getState();
    const l = st.doc.layers.find((x) => x.id === layer.id);
    if (l?.mask && rn.stroke.changed()) st.updateLayer(l.id, { mask: withAlpha(l.mask, rn.w, rn.h, rn.plane) } as Partial<Layer>);
    clearLiveMask(layer.id);
    redraw();
  };

  if (!pos) return null;
  const hide = tool === 'eraser';
  return (
    <div
      ref={hostRef}
      className={`brush-overlay mask-paint${locked ? ' is-locked' : ''}${hide ? ' is-eraser' : ''}`}
      style={{ left: pos.left, top: pos.top, width: doc.width * scale, height: doc.height * scale }}
      role="application"
      aria-label={hide ? 'Pintar la máscara: ocultar' : 'Pintar la máscara: mostrar'}
      data-testid="mask-paint-overlay"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => {
        if (ringRef.current && !run.current) ringRef.current.style.opacity = '0';
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={ringRef} className="brush-ring" aria-hidden style={{ opacity: 0 }} />
    </div>
  );
}
