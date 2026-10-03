import { useCallback, useEffect, useRef, useState } from 'react';
import type { Doc } from '../core/types';
import { renderDocToCanvas } from '../../io/export';
import { useSaveMode } from '../../ui/tabletMode';

const MAX_W = 150;
const MAX_H = 130;

// Fracción visible del diseño (0..1 en cada eje) dentro del área con scroll.
export function visibleFraction(
  scroll: number,
  client: number,
  offset: number,
  size: number,
): { a: number; b: number } {
  if (size <= 0) return { a: 0, b: 1 };
  const a = Math.max(0, scroll - offset) / size;
  const b = Math.min(size, scroll + client - offset) / size;
  return { a: Math.max(0, Math.min(1, a)), b: Math.max(0, Math.min(1, b)) };
}

// Minimapa: miniatura del diseño completo con el área visible arrastrable.
// Solo aparece cuando el zoom deja parte del diseño fuera de la vista.
export function Minimap({
  areaRef,
  doc,
  scale,
}: {
  areaRef: React.RefObject<HTMLDivElement | null>;
  doc: Doc;
  scale: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const saveMode = useSaveMode();
  const [view, setView] = useState<{ x0: number; x1: number; y0: number; y1: number } | null>(null);

  const stageBox = useCallback(() => {
    const el = areaRef.current;
    const c = el?.querySelector('.page-stage') as HTMLElement | null;
    if (!el || !c) return null;
    return { el, ox: c.offsetLeft, oy: c.offsetTop, w: c.offsetWidth, h: c.offsetHeight };
  }, [areaRef]);

  // Rectángulo visible; se oculta si todo el diseño cabe en la vista.
  const measure = useCallback(() => {
    const b = stageBox();
    if (!b) return setView(null);
    const { el, ox, oy, w, h } = b;
    if (w <= el.clientWidth + 2 && h <= el.clientHeight + 2) return setView(null);
    const fx = visibleFraction(el.scrollLeft, el.clientWidth, ox, w);
    const fy = visibleFraction(el.scrollTop, el.clientHeight, oy, h);
    setView({ x0: fx.a, x1: fx.b, y0: fy.a, y1: fy.b });
  }, [stageBox]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [areaRef, measure, scale, doc.width, doc.height]);

  const k = Math.min(MAX_W / doc.width, MAX_H / doc.height);
  const mw = Math.max(20, Math.round(doc.width * k));
  const mh = Math.max(20, Math.round(doc.height * k));

  // Miniatura: se recompone un instante después del último cambio del documento
  // (la caché es la propia versión del doc: misma referencia = no se repinta).
  const shown = !!view;
  useEffect(() => {
    if (!shown) return;
    let alive = true;
    const id = window.setTimeout(
      async () => {
        try {
          const thumb = await renderDocToCanvas(doc, mw / doc.width);
          if (!alive) return;
          const c = canvasRef.current;
          if (!c) return;
          c.width = mw;
          c.height = mh;
          const ctx = c.getContext('2d');
          ctx?.clearRect(0, 0, mw, mh);
          ctx?.drawImage(thumb, 0, 0, mw, mh);
        } catch {
          /* sin miniatura: queda el recuadro vacío */
        }
      },
      saveMode ? 1200 : 450,
    );
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [doc, mw, mh, shown, saveMode]);

  const dragging = useRef(false);
  const go = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = stageBox();
    if (!b) return;
    const r = e.currentTarget.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    b.el.scrollLeft = b.ox + fx * b.w - b.el.clientWidth / 2;
    b.el.scrollTop = b.oy + fy * b.h - b.el.clientHeight / 2;
  };

  if (!view) return null;
  return (
    <div
      className="minimap"
      style={{ width: mw, height: mh }}
      title="Minimapa: arrastra el recuadro para moverte por el diseño"
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        go(e);
      }}
      onPointerMove={(e) => dragging.current && go(e)}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => (dragging.current = false)}
    >
      <canvas ref={canvasRef} width={mw} height={mh} />
      <i
        className="minimap-view"
        style={{
          left: `${view.x0 * 100}%`,
          top: `${view.y0 * 100}%`,
          width: `${(view.x1 - view.x0) * 100}%`,
          height: `${(view.y1 - view.y0) * 100}%`,
        }}
      />
    </div>
  );
}
