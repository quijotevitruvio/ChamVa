import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode, RefObject } from 'react';
import type Konva from 'konva';
import { useEditor } from '../state/store';
import { Rulers } from './Rulers';
import { Minimap } from './Minimap';
import { useTouchGestures } from './useTouchGestures';
import { useMinimapOn } from '../../ui/tabletMode';
import '../../ui/touch.css';
import type { Doc } from '../core/types';

// Editores de texto con foco: los atajos del lienzo no deben actuar.
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !!el.isContentEditable;
}

// Refs compartidas entre el contenedor (CanvasViewport) y la página (PageStage).
export interface CanvasBridge {
  areaRef: RefObject<HTMLDivElement | null>; // .canvas-area (scroll)
  stageRef: RefObject<Konva.Stage | null>;
  nodeRefs: MutableRefObject<Map<string, Konva.Node>>;
  // El PageStage deja aquí sus manejadores, que el Viewport invoca.
  updateSelRectRef: MutableRefObject<(() => void) | null>;
  dropRef: MutableRefObject<((e: React.DragEvent) => void) | null>;
  rulerGuideStartRef: MutableRefObject<((axis: 'x' | 'y', e: React.PointerEvent) => void) | null>;
}

// Contenedor con scroll: ajuste (`fit`) y zoom con rueda, paneo, gestos táctiles,
// reglas, minimapa e insignia de transparente. Entrega la escala a `children`.
export function CanvasViewport({
  doc,
  bridge,
  children,
}: {
  doc: Doc;
  bridge: CanvasBridge;
  children: (scale: number) => ReactNode;
}) {
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const setViewScale = useEditor((s) => s.setViewScale);
  const showRulers = useEditor((s) => s.showRulers);
  const containerRef = bridge.areaRef as RefObject<HTMLDivElement>;
  const stageRef = bridge.stageRef;
  const [scale, setScale] = useState(1);

  // Paneo del lienzo: con la barra espaciadora o el botón central del ratón.
  const [spaceDown, setSpaceDown] = useState(false);
  const panDrag = useRef<{ x: number; y: number; sl: number; st: number } | null>(
    null,
  );
  // Gestos táctiles (pellizco/giro/paneo con dos dedos, toques de 2 y 3 dedos, palma).
  const minimapOn = useMinimapOn();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  useTouchGestures(containerRef, bridge.nodeRefs, () => bridge.updateSelRectRef.current?.());

  // Ajustar el lienzo al área disponible × el zoom del usuario.
  // ResizeObserver: también recalcula al abrir/cerrar los paneles laterales.
  useEffect(() => {
    const fit = () => {
      const el = containerRef.current;
      if (!el || el.clientWidth === 0) return; // aún sin layout
      const pad = 48;
      const sx = (el.clientWidth - pad) / doc.width;
      const sy = (el.clientHeight - pad) / doc.height;
      const final = Math.max(0.02, Math.min(1, sx, sy)) * zoom;
      setScale(final);
      setViewScale(final);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [doc.width, doc.height, zoom, setViewScale]);

  return (
    <div className={`canvas-wrap${showRulers ? ' with-rulers' : ''}`}>
      {showRulers && (
        <Rulers areaRef={containerRef} stageRef={stageRef} scale={scale} docW={doc.width} docH={doc.height} onGuideStart={(axis, e) => bridge.rulerGuideStartRef.current?.(axis, e)} />
      )}
      {doc.background.type === 'transparent' && (
        <span
          className="transparent-badge"
          title="El cuadriculado gris y blanco significa transparente. No se exporta: tu imagen saldrá sin fondo."
        >
          <i /> Fondo transparente
        </span>
      )}
    <div
      className={`canvas-area ${spaceDown ? 'panning' : ''}`}
      ref={containerRef}
      onDrop={(e) => bridge.dropRef.current?.(e)}
      onWheel={(e) => {
        if (e.deltaY === 0) return;
        // Zoom hacia el cursor: tras el cambio de escala, reajustar el scroll
        // para que el punto bajo el puntero se quede (aprox.) en su sitio.
        const el = containerRef.current;
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.max(0.1, Math.min(5, zoom * factor));
        const r = newZoom / zoom;
        setZoom(newZoom);
        if (el && r !== 1) {
          const rect = el.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const cx = el.scrollLeft + px;
          const cy = el.scrollTop + py;
          requestAnimationFrame(() => {
            el.scrollLeft = cx * r - px;
            el.scrollTop = cy * r - py;
          });
        }
      }}
      onPointerDownCapture={(e) => {
        // Paneo: espacio + arrastrar, o botón central del ratón.
        if (!spaceDown && e.button !== 1) return;
        const el = containerRef.current;
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        panDrag.current = {
          x: e.clientX,
          y: e.clientY,
          sl: el.scrollLeft,
          st: el.scrollTop,
        };
        el.setPointerCapture(e.pointerId);
      }}
      onPointerMoveCapture={(e) => {
        const p = panDrag.current;
        const el = containerRef.current;
        if (!p || !el) return;
        e.preventDefault();
        e.stopPropagation();
        el.scrollLeft = p.sl - (e.clientX - p.x);
        el.scrollTop = p.st - (e.clientY - p.y);
      }}
      onPointerUpCapture={(e) => {
        if (panDrag.current) {
          panDrag.current = null;
          containerRef.current?.releasePointerCapture(e.pointerId);
        }
      }}
    >
      {children(scale)}
    </div>
      {minimapOn && <Minimap areaRef={containerRef} doc={doc} scale={scale} />}
    </div>
  );
}
