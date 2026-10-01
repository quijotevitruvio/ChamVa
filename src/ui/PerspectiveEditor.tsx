import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageLayer } from '../editor/core/types';
import {
  applyH,
  homography,
  isConvexQuad,
  quadOutputSize,
  warpPerspective,
  type Pt,
} from '../editor/core/perspective';
import { bakedCanvas, commitCanvas, limitCanvas, toCanvasPoint } from './imagegeoUtil';
import { toast } from './toast';
import { t } from '../i18n';
import './imagegeo.css';

const PREVIEW_MAX = 420;

// Corregir perspectiva: se arrastran 4 esquinas sobre la imagen (documento, fachada…) y se
// endereza a un rectángulo. Destructivo: genera una imagen nueva.
export function PerspectiveEditor({ layer, onClose }: { layer: ImageLayer; onClose: () => void }) {
  const srcRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const prevRef = useRef<HTMLCanvasElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const smallRef = useRef<ImageData | null>(null);
  const smallK = useRef(1);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [quad, setQuad] = useState<Pt[]>([]);
  const [busy, setBusy] = useState(false);
  const drag = useRef<number | null>(null);

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
      // Copia reducida para la vista previa en vivo.
      const k = Math.min(1, PREVIEW_MAX / Math.max(c.width, c.height));
      smallK.current = k;
      const s = document.createElement('canvas');
      s.width = Math.max(1, Math.round(c.width * k));
      s.height = Math.max(1, Math.round(c.height * k));
      const sc = s.getContext('2d')!;
      sc.drawImage(c, 0, 0, s.width, s.height);
      smallRef.current = sc.getImageData(0, 0, s.width, s.height);
      const mx = c.width * 0.1;
      const my = c.height * 0.1;
      setQuad([
        { x: mx, y: my },
        { x: c.width - mx, y: my },
        { x: c.width - mx, y: c.height - my },
        { x: mx, y: c.height - my },
      ]);
      setDims({ w: c.width, h: c.height });
    })();
    return () => {
      cancelled = true;
    };
  }, [layer]);

  // Vista previa del resultado.
  useEffect(() => {
    const small = smallRef.current;
    const pv = prevRef.current;
    if (!small || !pv || quad.length !== 4 || !isConvexQuad(quad)) return;
    const k = smallK.current;
    const q = quad.map((p) => ({ x: p.x * k, y: p.y * k }));
    const size = quadOutputSize(q);
    const f = Math.min(1, PREVIEW_MAX / Math.max(size.w, size.h, 1));
    const ow = Math.max(1, Math.round(size.w * f));
    const oh = Math.max(1, Math.round(size.h * f));
    const out = warpPerspective(small, q, ow, oh);
    if (!out) return;
    pv.width = ow;
    pv.height = oh;
    pv.getContext('2d')!.putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, ow, oh), 0, 0);
  }, [quad, dims]);

  // Rejilla proyectada dentro del cuadrilátero (3×3).
  const gridLines = useMemo(() => {
    if (quad.length !== 4) return [];
    const unit: Pt[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const H = homography(unit, quad);
    if (!H) return [];
    const lines: string[] = [];
    for (let i = 1; i < 3; i++) {
      const f = i / 3;
      const a = applyH(H, f, 0);
      const b = applyH(H, f, 1);
      const c = applyH(H, 0, f);
      const d = applyH(H, 1, f);
      lines.push(`M${a.x} ${a.y}L${b.x} ${b.y}`, `M${c.x} ${c.y}L${d.x} ${d.y}`);
    }
    return lines;
  }, [quad]);

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (drag.current === null || !dims || !viewRef.current) return;
      const p = toCanvasPoint(e, viewRef.current, dims.w, dims.h);
      const x = Math.min(dims.w, Math.max(0, p.x));
      const y = Math.min(dims.h, Math.max(0, p.y));
      const i = drag.current;
      setQuad((q) => q.map((pt, j) => (j === i ? { x, y } : pt)));
    },
    [dims],
  );
  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
    };
  }, [onMove]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const valid = quad.length === 4 && isConvexQuad(quad);

  const apply = () => {
    const src = srcRef.current;
    if (!src || !valid) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const size = quadOutputSize(quad);
        const f = Math.min(1, 4096 / Math.max(size.w, size.h));
        const ow = Math.max(1, Math.round(size.w * f));
        const oh = Math.max(1, Math.round(size.h * f));
        const data = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
        const out = warpPerspective(data, quad, ow, oh);
        if (!out) throw new Error('Esquinas no válidas');
        const c = document.createElement('canvas');
        c.width = ow;
        c.height = oh;
        c.getContext('2d')!.putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, ow, oh), 0, 0);
        const lim = limitCanvas(c);
        // Densidad: píxeles nuevos por píxel original en el lado «ancho» del cuadrilátero.
        commitCanvas(layer.id, lim.canvas, f * lim.k);
        toast(t('Perspectiva corregida'), 'success');
        onClose();
      } catch (e) {
        console.error(e);
        toast(t('No se pudo corregir la perspectiva'), 'error');
        setBusy(false);
      }
    }, 20);
  };

  const reset = () => {
    if (!dims) return;
    setQuad([
      { x: 0, y: 0 },
      { x: dims.w, y: 0 },
      { x: dims.w, y: dims.h },
      { x: 0, y: dims.h },
    ]);
  };

  return createPortal(
    <div className="mask-overlay">
      <div className="mask-toolbar">
        <span className="mask-title">{t('Corregir perspectiva')}</span>
        <button onClick={reset} disabled={!dims}>
          {t('Esquinas a los bordes')}
        </button>
        <span className="spacer" />
        <button onClick={onClose}>{t('Cancelar')}</button>
        <button className="primary" onClick={apply} disabled={!valid || busy}>
          {busy ? '…' : t('Aplicar')}
        </button>
      </div>
      <div className="geo-stage">
        <div className="geo-pane" ref={paneRef}>
          <canvas ref={viewRef} />
          {dims && (
            <>
              <svg viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none">
                {quad.length === 4 && (
                  <>
                    <polygon
                      className="poly"
                      points={quad.map((p) => `${p.x},${p.y}`).join(' ')}
                      style={valid ? undefined : { strokeDasharray: '6 4' }}
                    />
                    <path className="grid" d={gridLines.join('')} />
                  </>
                )}
              </svg>
              {quad.map((p, i) => (
                <div
                  key={i}
                  className="geo-handle"
                  style={{ left: `${(p.x / dims.w) * 100}%`, top: `${(p.y / dims.h) * 100}%` }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    drag.current = i;
                  }}
                />
              ))}
            </>
          )}
          <span className="geo-label">{t('Arrastra las 4 esquinas')}</span>
        </div>
        <div className="geo-pane">
          <canvas ref={prevRef} />
          <span className="geo-label">{t('Resultado')}</span>
        </div>
      </div>
      <p className="mask-hint">
        {valid
          ? t('Coloca las esquinas sobre los bordes del documento o la fachada; la rejilla debe quedar paralela a sus líneas.')
          : t('Las esquinas se cruzan: reordénalas para formar un cuadrilátero.')}
      </p>
    </div>,
    document.body,
  );
}
