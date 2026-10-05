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
import { stackScale } from './stackLayout';
import { useTool, useEffectiveTool } from '../state/toolStore';
import { isClickGesture, zoomAfterClick, zoomToBox } from '../state/toolLogic';
import { ToolBar } from '../../ui/ToolBar';
import '../../ui/tools.css';

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
  stack,
  children,
}: {
  doc: Doc;
  bridge: CanvasBridge;
  // Modo apilado: tamaños de TODAS las páginas (escala común, Ctrl+rueda = zoom, sin minimapa).
  stack?: { width: number; height: number }[];
  children: (scale: number) => ReactNode;
}) {
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const setViewScale = useEditor((s) => s.setViewScale);
  const showRulers = useEditor((s) => s.showRulers);
  const containerRef = bridge.areaRef as RefObject<HTMLDivElement>;
  const stageRef = bridge.stageRef;
  const [scale, setScale] = useState(1);
  const stackKey = stack ? stack.map((p) => `${p.width}x${p.height}`).join(',') : '';

  // Paneo del lienzo: herramienta Mano (o Espacio mantenido = mano temporal) o botón central del ratón.
  // La herramienta efectiva sale de toolStore (una sola fuente de verdad).
  const tool = useEffectiveTool();
  const setSpaceHeld = useTool((s) => s.setSpaceHeld);
  const [panning, setPanning] = useState(false);
  const [altDown, setAltDown] = useState(false);
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const zoomDrag = useRef<{ x: number; y: number } | null>(null);
  const touchIds = useRef(new Set<number>());
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
        setSpaceHeld(true);
      }
      if (e.key === 'Alt') setAltDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
      if (e.key === 'Alt') setAltDown(false);
    };
    const blur = () => {
      setSpaceHeld(false);
      setAltDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      setSpaceHeld(false);
    };
  }, []);
  useTouchGestures(containerRef, bridge.nodeRefs, () => bridge.updateSelRectRef.current?.());

  // Ajustar el lienzo al área disponible × el zoom del usuario.
  // ResizeObserver: también recalcula al abrir/cerrar los paneles laterales.
  useEffect(() => {
    const fit = () => {
      const el = containerRef.current;
      if (!el || el.clientWidth === 0) return; // aún sin layout
      if (stack) {
        const final = stackScale(stack, { width: el.clientWidth, height: el.clientHeight }, zoom);
        setScale(final);
        setViewScale(final);
        return;
      }
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
  }, [doc.width, doc.height, zoom, setViewScale, stackKey]);

  // En modo apilado la rueda desplaza y solo Ctrl+rueda hace zoom: hay que poder
  // cancelar el zoom del navegador (listener no pasivo).
  useEffect(() => {
    const el = containerRef.current;
    if (!stack || !el) return;
    const stop = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!stack]);

  // Cambia el zoom dejando el punto de pantalla (clientX, clientY) en (targetX, targetY).
  // Se mide la página tras el nuevo ajuste (dos cuadros) y se corrige el scroll.
  const zoomKeepPoint = (newZoom: number, clientX: number, clientY: number, targetX: number, targetY: number) => {
    const page = stageRef.current?.container();
    const el = containerRef.current;
    if (!page || !el) {
      setZoom(newZoom);
      return;
    }
    const pr = page.getBoundingClientRect();
    const fx = (clientX - pr.left) / Math.max(1, pr.width);
    const fy = (clientY - pr.top) / Math.max(1, pr.height);
    setZoom(newZoom);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const p2 = stageRef.current?.container().getBoundingClientRect();
        if (!p2) return;
        el.scrollLeft += p2.left + fx * p2.width - targetX;
        el.scrollTop += p2.top + fy * p2.height - targetY;
      }),
    );
  };

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
      className={`canvas-area${tool !== 'select' ? ` tool-${tool}` : ''}${panning ? ' is-panning' : ''}${tool === 'zoom' && altDown ? ' zoom-out' : ''}${stack ? ' stacked' : ''}`}
      data-tool={tool}
      ref={containerRef}
      onDrop={(e) => bridge.dropRef.current?.(e)}
      onWheel={(e) => {
        if (e.deltaY === 0) return;
        if (stack && !(e.ctrlKey || e.metaKey)) return; // apilado: la rueda sola desplaza
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
        if (e.pointerType === 'touch') touchIds.current.add(e.pointerId);
        const el = containerRef.current;
        if (!el) return;
        // Zoom: clic acerca (Alt aleja); arrastrar un recuadro amplía esa zona.
        if (tool === 'zoom' && e.button === 0) {
          e.preventDefault();
          e.stopPropagation();
          zoomDrag.current = { x: e.clientX, y: e.clientY };
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* puntero sintético */
          }
          return;
        }
        // Paneo: herramienta Mano (o Espacio) con el botón principal, o botón central.
        if (e.button !== 1 && !(tool === 'hand' && e.button === 0)) return;
        e.preventDefault();
        e.stopPropagation();
        panDrag.current = {
          x: e.clientX,
          y: e.clientY,
          sl: el.scrollLeft,
          st: el.scrollTop,
        };
        setPanning(true);
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* puntero sintético */
        }
      }}
      onPointerMoveCapture={(e) => {
        const el = containerRef.current;
        const z = zoomDrag.current;
        if (z && el) {
          e.preventDefault();
          e.stopPropagation();
          const w = e.clientX - z.x;
          const h = e.clientY - z.y;
          if (!isClickGesture(w, h)) setBand({ x: Math.min(z.x, e.clientX), y: Math.min(z.y, e.clientY), w: Math.abs(w), h: Math.abs(h) });
          return;
        }
        const p = panDrag.current;
        if (!p || !el) return;
        if (touchIds.current.size > 1) return; // dos dedos: lo llevan los gestos táctiles
        e.preventDefault();
        e.stopPropagation();
        el.scrollLeft = p.sl - (e.clientX - p.x);
        el.scrollTop = p.st - (e.clientY - p.y);
      }}
      onPointerUpCapture={(e) => {
        touchIds.current.delete(e.pointerId);
        const el = containerRef.current;
        const z = zoomDrag.current;
        if (z && el) {
          zoomDrag.current = null;
          setBand(null);
          try {
            el.releasePointerCapture(e.pointerId);
          } catch {
            /* ya liberado */
          }
          const w = e.clientX - z.x;
          const h = e.clientY - z.y;
          const r = el.getBoundingClientRect();
          if (isClickGesture(w, h)) {
            const nz = zoomAfterClick(zoom, e.altKey);
            if (nz !== zoom) zoomKeepPoint(nz, e.clientX, e.clientY, e.clientX, e.clientY);
          } else {
            const box = { x: Math.min(z.x, e.clientX) - r.left, y: Math.min(z.y, e.clientY) - r.top, w: Math.abs(w), h: Math.abs(h) };
            const res = zoomToBox(zoom, box, { w: el.clientWidth, h: el.clientHeight, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop });
            zoomKeepPoint(res.zoom, r.left + box.x + box.w / 2, r.top + box.y + box.h / 2, r.left + el.clientWidth / 2, r.top + el.clientHeight / 2);
          }
          e.stopPropagation();
          return;
        }
        if (panDrag.current) {
          panDrag.current = null;
          setPanning(false);
          try {
            el?.releasePointerCapture(e.pointerId);
          } catch {
            /* ya liberado */
          }
        }
      }}
      onPointerCancelCapture={(e) => {
        touchIds.current.delete(e.pointerId);
        zoomDrag.current = null;
        panDrag.current = null;
        setBand(null);
        setPanning(false);
      }}
    >
      {children(scale)}
    </div>
      <ToolBar />
      {band && <div className="zoom-band" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} aria-hidden />}
      {minimapOn && !stack && <Minimap areaRef={containerRef} doc={doc} scale={scale} />}
    </div>
  );
}
