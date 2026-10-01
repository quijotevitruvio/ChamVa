import { useCallback, useEffect, useRef, useState } from 'react';
import type Konva from 'konva';

export const RULER = 22; // grosor de la regla en px

// Pasos "bonitos" para las marcas: el mayor paso que deja ≥ 60 px en pantalla.
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
function pickStep(scale: number): number {
  return STEPS.find((s) => s * scale >= 60) ?? STEPS[STEPS.length - 1];
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Reglas horizontal y vertical en píxeles del DISEÑO. Siguen al scroll y al
// zoom, y muestran una marca donde está el puntero.
export function Rulers({
  areaRef,
  stageRef,
  scale,
  docW,
  docH,
}: {
  areaRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<Konva.Stage | null>;
  scale: number;
  docW: number;
  docH: number;
}) {
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const draw = useCallback(() => {
    const area = areaRef.current;
    const stage = stageRef.current;
    const top = topRef.current;
    const left = leftRef.current;
    if (!area || !stage || !top || !left) return;
    const a = area.getBoundingClientRect();
    const s = stage.container().getBoundingClientRect();
    const ox = s.left - a.left; // origen del diseño dentro del área visible
    const oy = s.top - a.top;
    const dpr = window.devicePixelRatio || 1;
    const bg = cssVar('--panel', '#ffffff');
    const fg = cssVar('--muted', '#6e6e6a');
    const line = cssVar('--border', '#e3e3e0');
    const strong = cssVar('--text', '#141414');
    const step = pickStep(scale);
    const minor = step >= 10 ? step / 10 : step >= 5 ? 1 : step;
    const mid = step / 2;

    const paint = (cv: HTMLCanvasElement, horizontal: boolean) => {
      const len = horizontal ? a.width : a.height;
      const cssW = horizontal ? len : RULER;
      const cssH = horizontal ? RULER : len;
      cv.width = Math.max(1, Math.round(cssW * dpr));
      cv.height = Math.max(1, Math.round(cssH * dpr));
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
      const c = cv.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = bg;
      c.fillRect(0, 0, cssW, cssH);
      const origin = horizontal ? ox : oy;
      const max = horizontal ? docW : docH;
      // Zona del documento en un tono distinto.
      c.fillStyle = cssVar('--panel-2', '#f0f0ee');
      if (horizontal) c.fillRect(origin, 0, max * scale, RULER);
      else c.fillRect(0, origin, RULER, max * scale);

      c.font = '10px system-ui, sans-serif';
      c.textBaseline = 'top';
      const first = Math.floor(-origin / scale / minor) * minor;
      const last = Math.ceil((len - origin) / scale / minor) * minor;
      for (let v = first; v <= last; v += minor) {
        const p = origin + v * scale;
        const isMajor = v % step === 0;
        const isMid = !isMajor && Math.abs(v % step) === mid && mid >= minor;
        const size = isMajor ? RULER : isMid ? 9 : 5;
        c.strokeStyle = isMajor ? fg : line;
        c.lineWidth = 1;
        c.beginPath();
        if (horizontal) {
          c.moveTo(Math.round(p) + 0.5, RULER - size);
          c.lineTo(Math.round(p) + 0.5, RULER);
        } else {
          c.moveTo(RULER - size, Math.round(p) + 0.5);
          c.lineTo(RULER, Math.round(p) + 0.5);
        }
        c.stroke();
        if (isMajor) {
          c.fillStyle = fg;
          if (horizontal) c.fillText(String(v), p + 3, 2);
          else {
            c.save();
            c.translate(2, p + 3);
            c.rotate(-Math.PI / 2);
            c.textBaseline = 'top';
            // Texto girado hacia arriba, pegado a la marca.
            c.translate(-c.measureText(String(v)).width - 2, 0);
            c.fillText(String(v), 0, 0);
            c.restore();
          }
        }
      }
      // Línea del puntero.
      const ptr = pointer.current;
      if (ptr) {
        const pp = horizontal ? ptr.x : ptr.y;
        c.strokeStyle = strong;
        c.beginPath();
        if (horizontal) {
          c.moveTo(Math.round(pp) + 0.5, 0);
          c.lineTo(Math.round(pp) + 0.5, RULER);
        } else {
          c.moveTo(0, Math.round(pp) + 0.5);
          c.lineTo(RULER, Math.round(pp) + 0.5);
        }
        c.stroke();
      }
      // Filete que separa la regla del lienzo.
      c.strokeStyle = line;
      c.beginPath();
      if (horizontal) {
        c.moveTo(0, RULER - 0.5);
        c.lineTo(cssW, RULER - 0.5);
      } else {
        c.moveTo(RULER - 0.5, 0);
        c.lineTo(RULER - 0.5, cssH);
      }
      c.stroke();
    };
    paint(top, true);
    paint(left, false);
  }, [areaRef, stageRef, scale, docW, docH]);

  // Redibujar al cambiar zoom/tamaño o cuando algo fuerza un tick.
  useEffect(() => {
    draw();
  }, [draw, tick]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const bump = () => setTick((t) => t + 1);
    const move = (e: PointerEvent) => {
      const r = area.getBoundingClientRect();
      pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      draw();
    };
    const leave = () => {
      pointer.current = null;
      draw();
    };
    area.addEventListener('scroll', bump, { passive: true });
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerleave', leave);
    const ro = new ResizeObserver(bump);
    ro.observe(area);
    window.addEventListener('resize', bump);
    // Cambio de tema (manual o del sistema): repintar con los colores nuevos.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', bump);
      mo.disconnect();
      area.removeEventListener('scroll', bump);
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerleave', leave);
      ro.disconnect();
      window.removeEventListener('resize', bump);
    };
  }, [areaRef, draw]);

  return (
    <>
      <div className="ruler-corner" />
      <canvas ref={topRef} className="ruler ruler-top" />
      <canvas ref={leftRef} className="ruler ruler-left" />
    </>
  );
}
