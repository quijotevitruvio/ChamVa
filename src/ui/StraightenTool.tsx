import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageLayer } from '../editor/core/types';
import { angleToLevel, largestInscribedRect, rotatedBounds, type Pt } from '../editor/core/straighten';
import { bakedCanvas, commitCanvas, toCanvasPoint } from './imagegeoUtil';
import { toast } from './toast';
import { t } from '../i18n';
import './imagegeo.css';
import { BackButton } from './Modal';
import { useDismiss } from './useDismiss';

// Gira `src` por `angle` grados; con `crop` recorta al mayor rectángulo interior.
function rotateCanvas(src: HTMLCanvasElement, angle: number, crop: boolean): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const size = crop ? largestInscribedRect(w, h, angle) : rotatedBounds(w, h, angle);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(size.w));
  out.height = Math.max(1, Math.round(size.h));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2);
  return out;
}

// Enderezar horizonte: 2 clics sobre una línea que debería ser horizontal (o el ángulo a mano).
export function StraightenTool({ layer, onClose }: { layer: ImageLayer; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDismiss(overlayRef, { onClose: onClose });
  const srcRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const prevRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [angle, setAngle] = useState(0);
  const [crop, setCrop] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await bakedCanvas(layer);
      if (cancelled) return;
      srcRef.current = c;
      const v = viewRef.current!;
      v.width = c.width;
      v.height = c.height;
      v.getContext('2d')!.drawImage(c, 0, 0);
      setDims({ w: c.width, h: c.height });
    })();
    return () => {
      cancelled = true;
    };
  }, [layer]);

  // Vista previa (reducida) con el giro actual.
  useEffect(() => {
    const src = srcRef.current;
    const pv = prevRef.current;
    if (!src || !pv) return;
    const k = Math.min(1, 520 / Math.max(src.width, src.height));
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(src.width * k));
    small.height = Math.max(1, Math.round(src.height * k));
    small.getContext('2d')!.drawImage(src, 0, 0, small.width, small.height);
    const out = rotateCanvas(small, angle, crop);
    pv.width = out.width;
    pv.height = out.height;
    pv.getContext('2d')!.drawImage(out, 0, 0);
  }, [angle, crop, dims]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const click = (e: React.MouseEvent) => {
    if (!dims || !viewRef.current) return;
    const p = toCanvasPoint(e, viewRef.current, dims.w, dims.h);
    if (pts.length === 1) {
      const next = [pts[0], p];
      setPts(next);
      setAngle(Math.round(angleToLevel(next[0], next[1]) * 100) / 100);
    } else {
      setPts([p]);
    }
  };

  const apply = () => {
    const src = srcRef.current;
    if (!src || Math.abs(angle) < 0.01) return;
    setBusy(true);
    setTimeout(() => {
      try {
        commitCanvas(layer.id, rotateCanvas(src, angle, crop));
        toast(t('Horizonte enderezado'), 'success');
        onClose();
      } catch (e) {
        console.error(e);
        toast(t('No se pudo enderezar'), 'error');
        setBusy(false);
      }
    }, 20);
  };

  return createPortal(
    <div className="mask-overlay" ref={overlayRef}>
      <div className="mask-toolbar">
        <BackButton onClick={onClose} />
        <span className="mask-title">{t('Enderezar horizonte')}</span>
        <div className="geo-tools">
          <span>{t('Ángulo')}</span>
          <input
            type="range"
            min={-45}
            max={45}
            step={0.1}
            value={angle}
            onChange={(e) => setAngle(Number(e.target.value))}
          />
          <input
            type="number"
            min={-45}
            max={45}
            step={0.1}
            value={angle}
            style={{ width: 64 }}
            onChange={(e) => setAngle(Math.max(-45, Math.min(45, Number(e.target.value) || 0)))}
          />
          <span>°</span>
        </div>
        <label className="geo-check">
          <input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} />
          {t('Recortar bordes vacíos')}
        </label>
        <button onClick={() => (setPts([]), setAngle(0))}>{t('Reiniciar')}</button>
        <span className="spacer" />
        <button onClick={onClose}>{t('Cancelar')}</button>
        <button className="primary" onClick={apply} disabled={busy || Math.abs(angle) < 0.01}>
          {busy ? '…' : t('Aplicar')}
        </button>
      </div>
      <div className="geo-stage">
        <div className="geo-pane geo-cross" onClick={click}>
          <canvas ref={viewRef} />
          {dims && (
            <svg viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none">
              {pts.length === 2 && (
                <line
                  x1={pts[0].x}
                  y1={pts[0].y}
                  x2={pts[1].x}
                  y2={pts[1].y}
                  className="poly"
                />
              )}
            </svg>
          )}
          {dims &&
            pts.map((p, i) => (
              <span
                key={i}
                className="geo-dot"
                style={{ left: `${(p.x / dims.w) * 100}%`, top: `${(p.y / dims.h) * 100}%` }}
              />
            ))}
          <span className="geo-label">{t('Haz 2 clics sobre el horizonte o un borde')}</span>
        </div>
        <div className="geo-pane">
          <canvas ref={prevRef} />
          <span className="geo-label">{t('Resultado')}</span>
        </div>
      </div>
      <p className="mask-hint">
        {t('Traza una línea que debería quedar horizontal (horizonte, mesa, borde); se calcula el giro. Puedes afinarlo con el control.')}
      </p>
    </div>,
    document.body,
  );
}
