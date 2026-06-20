import { useEffect, useRef, useState } from 'react';
import type { ImageLayer } from '../editor/core/types';
import { inpaintCanvas } from '../ai/inpaint';
import { toast } from './toast';

type Mode = 'erase' | 'restore' | 'magic';

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

export function MaskEditor({
  layer,
  onApply,
  onCancel,
}: {
  layer: ImageLayer;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const workRef = useRef<HTMLCanvasElement>(null); // imagen editable
  const overlayRef = useRef<HTMLCanvasElement>(null); // máscara roja (modo mágico)
  const origRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const magicPainted = useRef(false);

  const [mode, setMode] = useState<Mode>('restore');
  const [size, setSize] = useState(60);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const work = await loadImg(layer.src);
      const orig = await loadImg(layer.originalSrc ?? layer.src);
      if (cancelled) return;
      origRef.current = orig;
      const c = workRef.current!;
      const o = overlayRef.current!;
      c.width = o.width = work.naturalWidth;
      c.height = o.height = work.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(work, 0, 0);
      o.getContext('2d')!.clearRect(0, 0, o.width, o.height);
      magicPainted.current = false;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [layer.src, layer.originalSrc]);

  const toCoords = (clientX: number, clientY: number) => {
    const o = overlayRef.current!;
    const r = o.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * o.width,
      y: ((clientY - r.top) / r.height) * o.height,
    };
  };

  const dab = (x: number, y: number) => {
    if (mode === 'magic') {
      const ctx = overlayRef.current!.getContext('2d')!;
      ctx.fillStyle = 'rgba(255,40,40,0.5)';
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      magicPainted.current = true;
      return;
    }
    const c = workRef.current!;
    const ctx = c.getContext('2d')!;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.clip();
    if (mode === 'erase') ctx.clearRect(0, 0, c.width, c.height);
    else if (origRef.current) ctx.drawImage(origRef.current, 0, 0);
    ctx.restore();
  };

  const strokeTo = (x: number, y: number) => {
    const l = last.current;
    if (!l) dab(x, y);
    else {
      const dist = Math.hypot(x - l.x, y - l.y);
      const n = Math.ceil(dist / Math.max(1, size / 4));
      for (let i = 1; i <= n; i++)
        dab(l.x + ((x - l.x) * i) / n, l.y + ((y - l.y) * i) / n);
    }
    last.current = { x, y };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    drawing.current = true;
    last.current = null;
    const { x, y } = toCoords(e.clientX, e.clientY);
    strokeTo(x, y);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const { x, y } = toCoords(e.clientX, e.clientY);
    strokeTo(x, y);
  };
  const stop = () => {
    drawing.current = false;
    last.current = null;
  };

  // Construye una máscara B/N a partir de la capa roja (modo mágico).
  const buildMaskCanvas = (): HTMLCanvasElement => {
    const o = overlayRef.current!;
    const mask = document.createElement('canvas');
    mask.width = o.width;
    mask.height = o.height;
    const mctx = mask.getContext('2d')!;
    const src = o.getContext('2d')!.getImageData(0, 0, o.width, o.height);
    const dst = mctx.createImageData(o.width, o.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const on = src.data[i + 3] > 0 ? 255 : 0;
      dst.data[i] = dst.data[i + 1] = dst.data[i + 2] = on;
      dst.data[i + 3] = 255;
    }
    mctx.putImageData(dst, 0, 0);
    return mask;
  };

  const apply = async () => {
    const work = workRef.current!;
    try {
      if (magicPainted.current) {
        setBusy(true);
        const result = await inpaintCanvas(work, buildMaskCanvas());
        const ctx = work.getContext('2d')!;
        ctx.clearRect(0, 0, work.width, work.height);
        ctx.drawImage(result, 0, 0);
      }
      onApply(work.toDataURL('image/png'));
    } catch (e) {
      console.error(e);
      toast('Error en el borrador mágico: ' + (e as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="mask-overlay">
      <div className="mask-toolbar">
        <span className="mask-title">🪄 Borrador / Pincel</span>
        <button
          className={mode === 'restore' ? 'active' : ''}
          onClick={() => setMode('restore')}
        >
          🖌 Restaurar
        </button>
        <button
          className={mode === 'erase' ? 'active' : ''}
          onClick={() => setMode('erase')}
        >
          🧽 Borrar
        </button>
        <button
          className={mode === 'magic' ? 'active' : ''}
          onClick={() => setMode('magic')}
          title="Pinta un objeto y se rellena con el fondo de alrededor"
        >
          ✨ Mágico
        </button>
        <label className="mask-size">
          Pincel
          <input
            type="range"
            min={5}
            max={200}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <span>{size}px</span>
        </label>
        <span className="spacer" />
        <button className="primary" disabled={!ready || busy} onClick={apply}>
          {busy ? '… Rellenando' : '✓ Aplicar'}
        </button>
        <button onClick={onCancel} disabled={busy}>
          ✕ Cancelar
        </button>
      </div>

      <div className="mask-stage">
        <div className="mask-canvas-wrap">
          <canvas ref={workRef} className="mask-canvas" />
          <canvas
            ref={overlayRef}
            className="mask-canvas mask-overlay-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stop}
            onPointerLeave={stop}
          />
        </div>
      </div>
      <p className="mask-hint">
        {mode === 'restore'
          ? 'Pinta sobre lo que el quitafondos borró de más para recuperarlo.'
          : mode === 'erase'
            ? 'Pinta sobre lo que quieras borrar (quedará transparente).'
            : 'Pinta un objeto para eliminarlo: se rellenará con el fondo de alrededor.'}
      </p>
    </div>
  );
}
