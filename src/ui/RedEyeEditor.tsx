import { useEffect, useRef, useState } from 'react';
import type { ImageLayer, RedEyePoint } from '../editor/core/types';
import { processImage } from '../editor/core/imageProcessing';
import './effects.css';

const PREVIEW = 520;

// Vista previa de la imagen (con los efectos actuales) donde se marcan las pupilas:
// clic = zona por defecto, arrastrar = ajustar el radio. Devuelve la lista de puntos.
export function RedEyeEditor({
  layer,
  points,
  onChange,
}: {
  layer: ImageLayer;
  points: RedEyePoint[];
  onChange: (pts: RedEyePoint[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [drag, setDrag] = useState<{ x: number; y: number; r: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => alive && setImg(el);
    el.src = layer.src;
    return () => {
      alive = false;
    };
  }, [layer.src]);

  // Redibuja con los ajustes actuales (se ve el efecto de las zonas ya marcadas).
  useEffect(() => {
    const c = canvasRef.current;
    if (!img || !c) return;
    try {
      const out = processImage(img, layer, PREVIEW);
      c.width = out.width;
      c.height = out.height;
      c.getContext('2d')!.drawImage(out, 0, 0);
      setSize({ w: out.width, h: out.height });
    } catch {
      // imagen no legible
    }
  }, [img, layer.adjust, layer.filter, layer.flipX, layer.flipY, layer.naturalWidth, layer.naturalHeight]);

  const longest = Math.max(size.w, size.h);
  const toNorm = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toNorm(e);
    start.current = p;
    setDrag({ ...p, r: 0.02 });
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const p = toNorm(e);
    const r = Math.hypot((p.x - s.x) * size.w, (p.y - s.y) * size.h) / longest;
    setDrag({ ...s, r: Math.max(0.006, r) });
  };
  const onUp = () => {
    if (start.current && drag) onChange([...points, { x: drag.x, y: drag.y, r: Math.min(0.2, Math.max(0.008, drag.r)) }]);
    start.current = null;
    setDrag(null);
  };

  const shown = [...points, ...(drag ? [drag] : [])];
  return (
    <div className="fx-redeye">
      <div
        className="fx-redeye-stage"
        style={{ aspectRatio: `${size.w} / ${size.h}` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <canvas ref={canvasRef} />
        <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden="true">
          {shown.map((p, i) => (
            <circle key={i} cx={p.x * size.w} cy={p.y * size.h} r={Math.max(2, p.r * longest)} />
          ))}
        </svg>
      </div>
      {points.length > 0 && (
        <button onClick={() => onChange(points.slice(0, -1))}>Deshacer última zona</button>
      )}
    </div>
  );
}
