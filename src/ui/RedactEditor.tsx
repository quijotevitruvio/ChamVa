import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageLayer } from '../editor/core/types';
import {
  redactMargin,
  redactRegion,
  type RedactMode,
  type RedactRect,
  type RedactShape,
} from '../editor/core/redact';
import { bakedCanvas, commitCanvas, toCanvasPoint } from './imagegeoUtil';
import { toast } from './toast';
import { t } from '../i18n';
import './imagegeo.css';
import { BackButton } from './Modal';
import { useDismiss } from './useDismiss';

const MAX_UNDO = 8;

// Censurar zona: se dibuja un rectángulo o elipse y se pixela, desenfoca o tapa con una barra.
// La vista previa es en vivo; al aplicar se hornea en la imagen (irreversible).
export function RedactEditor({ layer, onClose }: { layer: ImageLayer; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDismiss(overlayRef, { onClose: onClose });
  const baseRef = useRef<HTMLCanvasElement | null>(null); // estado ya confirmado
  const viewRef = useRef<HTMLCanvasElement>(null);
  const undoRef = useRef<ImageData[]>([]);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<RedactMode>('pixelate');
  const [shape, setShape] = useState<RedactShape>('rect');
  const [intensity, setIntensity] = useState(40);
  const [pending, setPending] = useState<RedactRect | null>(null);
  const [dragging, setDragging] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await bakedCanvas(layer);
      if (cancelled) return;
      baseRef.current = c;
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

  // Redibuja: base + zona pendiente con el efecto aplicado.
  useEffect(() => {
    const base = baseRef.current;
    const v = viewRef.current;
    if (!base || !v || dragging) return;
    const ctx = v.getContext('2d')!;
    ctx.clearRect(0, 0, v.width, v.height);
    ctx.drawImage(base, 0, 0);
    if (!pending || pending.w < 2 || pending.h < 2) return;
    const longest = Math.max(base.width, base.height);
    const m = redactMargin(mode, intensity, longest);
    const x0 = Math.max(0, Math.floor(pending.x - m));
    const y0 = Math.max(0, Math.floor(pending.y - m));
    const x1 = Math.min(base.width, Math.ceil(pending.x + pending.w + m));
    const y1 = Math.min(base.height, Math.ceil(pending.y + pending.h + m));
    if (x1 <= x0 || y1 <= y0) return;
    const region = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    redactRegion(
      region,
      { x: pending.x - x0, y: pending.y - y0, w: pending.w, h: pending.h },
      shape,
      mode,
      intensity,
      longest,
    );
    ctx.putImageData(region, x0, y0);
  }, [pending, mode, shape, intensity, dragging, dims]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // Confirma la zona pendiente en el lienzo base (con deshacer).
  const commitPending = () => {
    const base = baseRef.current;
    const v = viewRef.current;
    if (!base || !v || !pending) return;
    const bctx = base.getContext('2d')!;
    undoRef.current.push(bctx.getImageData(0, 0, base.width, base.height));
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
    bctx.clearRect(0, 0, base.width, base.height);
    bctx.drawImage(v, 0, 0);
    setPending(null);
    setCanUndo(true);
  };

  const undo = () => {
    const base = baseRef.current;
    const prev = undoRef.current.pop();
    setCanUndo(undoRef.current.length > 0);
    setPending(null);
    if (!base || !prev) return;
    base.getContext('2d')!.putImageData(prev, 0, 0);
    // fuerza redibujado
    setDragging(true);
    setTimeout(() => setDragging(false), 0);
  };

  const down = (e: React.PointerEvent) => {
    if (!dims || !viewRef.current) return;
    if (pending) commitPending();
    const p = toCanvasPoint(e, viewRef.current, dims.w, dims.h);
    start.current = p;
    setDragging(true);
    setPending({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current || !dims || !viewRef.current) return;
    const p = toCanvasPoint(e, viewRef.current, dims.w, dims.h);
    const x = Math.max(0, Math.min(dims.w, Math.min(start.current.x, p.x)));
    const y = Math.max(0, Math.min(dims.h, Math.min(start.current.y, p.y)));
    const x2 = Math.max(0, Math.min(dims.w, Math.max(start.current.x, p.x)));
    const y2 = Math.max(0, Math.min(dims.h, Math.max(start.current.y, p.y)));
    setPending({ x, y, w: x2 - x, h: y2 - y });
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    setPending((r) => (r && r.w >= 2 && r.h >= 2 ? r : null));
  };

  const apply = () => {
    if (!baseRef.current || !viewRef.current) return;
    setBusy(true);
    setTimeout(() => {
      try {
        // Lo que se ve (base + zona pendiente) es el resultado.
        const out = document.createElement('canvas');
        out.width = viewRef.current!.width;
        out.height = viewRef.current!.height;
        out.getContext('2d')!.drawImage(viewRef.current!, 0, 0);
        commitCanvas(layer.id, out);
        toast(t('Zona censurada'), 'success');
        onClose();
      } catch (e) {
        console.error(e);
        toast(t('No se pudo censurar'), 'error');
        setBusy(false);
      }
    }, 20);
  };

  const changed = canUndo || (!!pending && pending.w >= 2 && pending.h >= 2);

  return createPortal(
    <div className="mask-overlay" ref={overlayRef}>
      <div className="mask-toolbar">
        <BackButton onClick={onClose} />
        <span className="mask-title">{t('Censurar zona')}</span>
        <div className="seg">
          <button className={mode === 'pixelate' ? 'on' : ''} onClick={() => setMode('pixelate')}>
            {t('Pixelar')}
          </button>
          <button className={mode === 'blur' ? 'on' : ''} onClick={() => setMode('blur')}>
            {t('Desenfocar')}
          </button>
          <button className={mode === 'bar' ? 'on' : ''} onClick={() => setMode('bar')}>
            {t('Barra negra')}
          </button>
        </div>
        <div className="seg">
          <button className={shape === 'rect' ? 'on' : ''} onClick={() => setShape('rect')}>
            {t('Rectángulo')}
          </button>
          <button className={shape === 'ellipse' ? 'on' : ''} onClick={() => setShape('ellipse')}>
            {t('Elipse')}
          </button>
        </div>
        {mode !== 'bar' && (
          <div className="geo-tools">
            <span>{t('Intensidad')}</span>
            <input
              type="range"
              min={5}
              max={100}
              value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
            />
          </div>
        )}
        <button onClick={commitPending} disabled={!pending || dragging}>
          {t('Añadir otra zona')}
        </button>
        <button onClick={undo} disabled={!canUndo}>
          {t('Deshacer')}
        </button>
        <span className="spacer" />
        <button onClick={onClose}>{t('Cancelar')}</button>
        <button className="primary" onClick={apply} disabled={!changed || busy}>
          {busy ? '…' : t('Aplicar')}
        </button>
      </div>
      <div className="geo-stage">
        <div
          className="geo-pane single geo-cross"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
        >
          <canvas ref={viewRef} />
          {dims && pending && pending.w > 0 && pending.h > 0 && (
            <svg viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none">
              {shape === 'rect' ? (
                <rect className="poly" x={pending.x} y={pending.y} width={pending.w} height={pending.h} />
              ) : (
                <ellipse
                  className="poly"
                  cx={pending.x + pending.w / 2}
                  cy={pending.y + pending.h / 2}
                  rx={pending.w / 2}
                  ry={pending.h / 2}
                />
              )}
            </svg>
          )}
        </div>
      </div>
      <p className="mask-hint">
        {t('Arrastra sobre la imagen para marcar la zona (matrícula, rostro, datos). El efecto es irreversible al aplicar: se hornea en la imagen.')}
      </p>
    </div>,
    document.body,
  );
}
