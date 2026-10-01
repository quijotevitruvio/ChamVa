import { useEffect, useRef, useState } from 'react';
import type { Doc } from '../editor/core/types';
import { exportDoc } from '../io/export';
import { rgbToHex, readableOn } from '../editor/core/colorTools';
import './colortools.css';

const MAX_W = 760;
const MAX_H = 520;
const LUPA = 9; // píxeles por lado en la lupa
const LUPA_ZOOM = 12;

// Alternativa al EyeDropper nativo: elige un color del diseño renderizado.
export function ScreenPicker({
  doc,
  onPick,
  onClose,
}: {
  doc: Doc;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lupaRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [hover, setHover] = useState<{ hex: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const k = Math.min(1, MAX_W / doc.width, MAX_H / doc.height);
        // Escala >=1 para exportDoc; el canvas se reduce después a la vista.
        const blob = await exportDoc(doc, { format: 'png', scale: 1 });
        const bmp = await createImageBitmap(blob);
        if (dead) return;
        const c = canvasRef.current!;
        c.width = Math.max(1, Math.round(doc.width * k));
        c.height = Math.max(1, Math.round(doc.height * k));
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close?.();
        setReady(true);
      } catch {
        if (!dead) setError(true);
      }
    })();
    return () => {
      dead = true;
    };
  }, [doc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const sample = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const x = Math.min(c.width - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * c.width)));
    const y = Math.min(c.height - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * c.height)));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const d = ctx.getImageData(x, y, 1, 1).data;
    return { x, y, hex: rgbToHex({ r: d[0], g: d[1], b: d[2] }), a: d[3] };
  };

  const drawLupa = (x: number, y: number) => {
    const l = lupaRef.current;
    const c = canvasRef.current;
    if (!l || !c) return;
    const ctx = l.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, l.width, l.height);
    const half = (LUPA - 1) / 2;
    ctx.drawImage(c, x - half, y - half, LUPA, LUPA, 0, 0, l.width, l.height);
    // cruz sobre el píxel central
    const mid = half * LUPA_ZOOM;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(mid + 0.5, mid + 0.5, LUPA_ZOOM - 1, LUPA_ZOOM - 1);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(mid + 1.5, mid + 1.5, LUPA_ZOOM - 3, LUPA_ZOOM - 3);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sample(e);
    setHover({ hex: s.hex, x: e.clientX, y: e.clientY });
    drawLupa(s.x, s.y);
  };

  return (
    <div className="sp-overlay" onMouseDown={onClose}>
      <div
        className="sp-modal"
        role="dialog"
        aria-label="Elige un color de tu diseño"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sp-head">
          <h3>Elige un color de tu diseño</h3>
          <button className="cp-x" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="sp-stage">
          <canvas
            ref={canvasRef}
            className="sp-canvas"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => onPick(sample(e as unknown as React.PointerEvent<HTMLCanvasElement>).hex)}
          />
          {!ready && !error && <p className="sp-msg">Preparando…</p>}
          {error && <p className="sp-msg">No se pudo renderizar el diseño.</p>}
        </div>
        <div className="sp-foot">
          <canvas
            ref={lupaRef}
            className="sp-lupa"
            width={LUPA * LUPA_ZOOM}
            height={LUPA * LUPA_ZOOM}
          />
          <span
            className="sp-chip"
            style={hover ? { background: hover.hex, color: readableOn(hover.hex) } : undefined}
          >
            {hover ? hover.hex : '—'}
          </span>
          <span className="sp-hint">Clic para elegir · Esc para cancelar</span>
        </div>
      </div>
    </div>
  );
}
