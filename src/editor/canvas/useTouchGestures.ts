import { useEffect, useRef } from 'react';
import Konva from 'konva';
import { useEditor } from '../state/store';
import { isLayerLocked } from '../core/pageOps';
import { toast } from '../../ui/toast';
import {
  angleDelta,
  detectMultiTap,
  isPalm,
  penIsRecent,
  pinchMetrics,
  pinchScale,
  rotationAfterDeadzone,
  snapAngle,
  type TouchTrack,
} from './gestures';

// Aviso discreto con el sistema de avisos de la app.
export const touchToast = (msg: string) => toast(msg);

function firstTimeHint(key: string, msg: string) {
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    /* sin almacenamiento: se avisa siempre */
  }
  touchToast(msg);
}

// Detiene los arrastres de Konva en curso (al entrar un segundo dedo).
function stopKonvaDrags() {
  const dd = (Konva as unknown as { DD?: { _dragElements?: Map<number, { node: Konva.Node }> } }).DD;
  dd?._dragElements?.forEach((el) => {
    try {
      el.node.stopDrag();
    } catch {
      /* nada que detener */
    }
  });
}

// Gestos táctiles del lienzo:
//  · dos dedos: zoom (pellizco), paneo (mover el centro) y giro de la capa
//    seleccionada con ajuste a 45°. Un dedo sigue moviendo capas (Konva).
//  · toque rápido con dos dedos = deshacer, con tres = rehacer.
//  · rechazo de palma: con el lápiz activo se ignoran toques anchos.
export function useTouchGestures(
  areaRef: React.RefObject<HTMLDivElement | null>,
  nodeRefs: React.RefObject<Map<string, Konva.Node>>,
  updateSelRect: () => void,
) {
  const selRectFn = useRef(updateSelRect);
  selRectFn.current = updateSelRect;

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;

    let lastPenAt = 0;
    const touchPointers = new Set<number>();
    const tracks = new Map<number, TouchTrack>();
    let hadPinch = false;
    let pinch: {
      dist: number;
      angle: number;
      cx: number;
      cy: number;
      total: number;
      baseRot: number;
      id: string | null;
      center: { x: number; y: number } | null;
    } | null = null;
    // Zoom/paneo pendientes: se aplican juntos en el siguiente frame.
    let pend: { r: number; px: number; py: number; dx: number; dy: number } | null = null;
    let raf = 0;

    const palmRadius = (t: Touch) => Math.max(t.radiusX ?? 0, t.radiusY ?? 0) * 2;
    const isPalmTouch = (t: Touch) =>
      isPalm({
        pointerType: 'touch',
        width: palmRadius(t),
        height: 0,
        penRecent: penIsRecent(lastPenAt, performance.now()),
      });

    // --- Punteros: lápiz reciente, palma y segundo dedo (no llega a Konva) ---
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'pen') lastPenAt = performance.now();
      if (e.pointerType !== 'touch') return;
      if (
        isPalm({
          pointerType: 'touch',
          width: e.width,
          height: e.height,
          penRecent: penIsRecent(lastPenAt, performance.now()),
        })
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (touchPointers.size >= 1) {
        // Segundo dedo o más: gesto de pellizco/toque múltiple, no mueve capas.
        e.stopPropagation();
        touchPointers.add(e.pointerId);
        stopKonvaDrags();
        return;
      }
      touchPointers.add(e.pointerId);
    };
    const onPointerEnd = (e: PointerEvent) => {
      touchPointers.delete(e.pointerId);
    };
    const onPointerMovePen = (e: PointerEvent) => {
      if (e.pointerType === 'pen') lastPenAt = performance.now();
    };

    // --- Aplicar zoom + paneo acumulados ---
    const flush = () => {
      raf = 0;
      const p = pend;
      pend = null;
      if (!p) return;
      const cx = el.scrollLeft + p.px;
      const cy = el.scrollTop + p.py;
      el.scrollLeft = cx * p.r - p.px - p.dx;
      el.scrollTop = cy * p.r - p.py - p.dy;
      selRectFn.current();
    };
    const queue = (r: number, px: number, py: number, dx: number, dy: number) => {
      if (pend) {
        // Acumula: factores se multiplican, desplazamientos se suman.
        pend = { r: pend.r * r, px, py, dx: pend.dx + dx, dy: pend.dy + dy };
      } else pend = { r, px, py, dx, dy };
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const selectedNode = () => {
      const st = useEditor.getState();
      if (!st.selectedId) return null;
      const l = st.doc.layers.find((x) => x.id === st.selectedId);
      if (!l || isLayerLocked(st.doc, l) || !l.visible) return null;
      const node = nodeRefs.current?.get(l.id);
      return node ? { l, node } : null;
    };

    const liveTouches = (e: TouchEvent): Touch[] =>
      Array.from(e.touches).filter((t) => !isPalmTouch(t));

    const onTouchStart = (e: TouchEvent) => {
      const now = performance.now();
      for (const t of Array.from(e.changedTouches)) {
        if (isPalmTouch(t)) continue;
        tracks.set(t.identifier, { id: t.identifier, x0: t.clientX, y0: t.clientY, t0: now, maxMove: 0 });
      }
      const live = liveTouches(e);
      if (live.length === 2) {
        const m = pinchMetrics(
          { x: live[0].clientX, y: live[0].clientY },
          { x: live[1].clientX, y: live[1].clientY },
        );
        const sel = selectedNode();
        pinch = {
          dist: m.dist,
          angle: m.angle,
          cx: m.cx,
          cy: m.cy,
          total: 0,
          baseRot: sel ? sel.node.rotation() : 0,
          id: sel ? sel.l.id : null,
          center: null,
        };
        if (sel) {
          const r = (sel.node as Konva.Shape).getSelfRect();
          const c = sel.node.getTransform().point({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
          pinch.center = c;
        }
      } else if (live.length > 2) {
        pinch = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const k = tracks.get(t.identifier);
        if (k) k.maxMove = Math.max(k.maxMove, Math.hypot(t.clientX - k.x0, t.clientY - k.y0));
      }
      const live = liveTouches(e);
      if (live.length !== 2 || !pinch) return;
      e.preventDefault();
      const m = pinchMetrics(
        { x: live[0].clientX, y: live[0].clientY },
        { x: live[1].clientX, y: live[1].clientY },
      );
      // Solo cuenta como pellizco si los dedos se han movido de verdad.
      const movedEnough = Array.from(tracks.values()).some((k) => k.maxMove > 10);
      if (!movedEnough) return;
      hadPinch = true;

      // Zoom hacia el centro de los dedos + paneo por el movimiento del centro.
      const st = useEditor.getState();
      const f = pinchScale(pinch.dist, m.dist);
      const newZoom = Math.max(0.1, Math.min(5, st.zoom * f));
      const r = newZoom / st.zoom;
      if (r !== 1) st.setZoom(newZoom);
      const rect = el.getBoundingClientRect();
      queue(r, m.cx - rect.left, m.cy - rect.top, m.cx - pinch.cx, m.cy - pinch.cy);

      // Giro de la capa seleccionada (alrededor de su centro), con ajuste a 45°.
      pinch.total += angleDelta(pinch.angle, m.angle);
      if (pinch.id && pinch.center) {
        const node = nodeRefs.current?.get(pinch.id);
        const rot = rotationAfterDeadzone(pinch.total);
        if (node && rot !== 0) {
          const before = node.getTransform().point(
            (() => {
              const s = (node as Konva.Shape).getSelfRect();
              return { x: s.x + s.width / 2, y: s.y + s.height / 2 };
            })(),
          );
          node.rotation(snapAngle(pinch.baseRot + rot));
          const s = (node as Konva.Shape).getSelfRect();
          const after = node.getTransform().point({ x: s.x + s.width / 2, y: s.y + s.height / 2 });
          node.x(node.x() + before.x - after.x);
          node.y(node.y() + before.y - after.y);
          node.getLayer()?.batchDraw();
          selRectFn.current();
        }
      }
      pinch.dist = m.dist;
      pinch.angle = m.angle;
      pinch.cx = m.cx;
      pinch.cy = m.cy;
    };

    const finish = (cancel: boolean) => {
      // Confirmar el giro de la capa en el documento.
      if (pinch?.id && pinch.total !== 0) {
        const node = nodeRefs.current?.get(pinch.id);
        if (node && !cancel && Math.abs(pinch.total) > 6) {
          useEditor.getState().updateLayer(pinch.id, {
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
          });
        }
      }
      pinch = null;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const live = liveTouches(e);
      if (live.length < 2) finish(false);
      if (e.touches.length === 0) {
        const list = Array.from(tracks.values());
        const kind = hadPinch ? null : detectMultiTap(list, performance.now());
        tracks.clear();
        hadPinch = false;
        if (kind) {
          const st = useEditor.getState();
          if (kind === 'undo') {
            st.undo();
            firstTimeHint(
              'chamva.hint.twoFinger',
              'Toque con dos dedos = deshacer; con tres dedos = rehacer.',
            );
          } else {
            st.redo();
          }
        }
      }
    };
    const onTouchCancel = () => {
      finish(true);
      tracks.clear();
      hadPinch = false;
    };

    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointermove', onPointerMovePen, true);
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    el.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    el.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    el.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMovePen, true);
      window.removeEventListener('pointerup', onPointerEnd, true);
      window.removeEventListener('pointercancel', onPointerEnd, true);
      el.removeEventListener('touchstart', onTouchStart, true);
      el.removeEventListener('touchmove', onTouchMove, true);
      el.removeEventListener('touchend', onTouchEnd, true);
      el.removeEventListener('touchcancel', onTouchCancel, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
