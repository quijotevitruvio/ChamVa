import { useEffect, useRef, useState } from 'react';
import type { ImageLayer } from '../editor/core/types';
import { inpaintCanvas } from '../ai/inpaint';
import { toast } from './toast';
import { t } from '../i18n';
import { isPalm, penIsRecent, pressureFactor } from '../editor/canvas/gestures';
import { setPenPressure, usePenPressure } from './tabletMode';
import { BackButton } from './Modal';
import { useDismiss } from './useDismiss';

type Mode = 'erase' | 'restore' | 'magic';

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

const MAX_UNDO = 20;

export function MaskEditor({
  layer,
  onApply,
  onCancel,
}: {
  layer: ImageLayer;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(rootRef, { onClose: onCancel });
  const workRef = useRef<HTMLCanvasElement>(null); // imagen editable
  const overlayRef = useRef<HTMLCanvasElement>(null); // máscara roja (modo mágico)
  const stageRef = useRef<HTMLDivElement>(null);
  const origRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const magicPainted = useRef(false);
  // Lápiz: presión del trazo actual (1 con ratón/dedo) y rechazo de palma.
  const pressure = useRef(1);
  const lastPen = useRef(0);
  const penPressure = usePenPressure();
  // Historial de trazos (deshacer): instantáneas de ambos lienzos.
  const undoStack = useRef<{ work: ImageData; overlay: ImageData }[]>([]);
  const baseSize = useRef<{ w: number; h: number } | null>(null);

  const [mode, setMode] = useState<Mode>('restore');
  const [size, setSize] = useState(60);
  const [hardness, setHardness] = useState(0.7); // 1 = borde duro
  const [zoom, setZoom] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
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
      undoStack.current = [];
      setCanUndo(false);
      setZoom(1);
      baseSize.current = null;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [layer.src, layer.originalSrc]);

  // Tamaño en pantalla a zoom 1 (para escalar con zoom manteniendo el encaje).
  useEffect(() => {
    if (!ready || baseSize.current) return;
    const r = workRef.current?.getBoundingClientRect();
    if (r && r.width) baseSize.current = { w: r.width, h: r.height };
  }, [ready]);

  const toCoords = (clientX: number, clientY: number) => {
    const o = overlayRef.current!;
    const r = o.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * o.width,
      y: ((clientY - r.top) / r.height) * o.height,
    };
  };

  // Pincel con dureza: degradado radial (opaco hasta r·dureza, luego se desvanece).
  const brushGradient = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
  ) => {
    // Con poca presión el borde también se suaviza.
    const hard = hardness * (0.5 + 0.5 * pressure.current);
    const g = ctx.createRadialGradient(x, y, r * hard, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    return g;
  };

  const dab = (x: number, y: number) => {
    const r = Math.max(0.5, (size / 2) * pressure.current);
    if (mode === 'magic') {
      const ctx = overlayRef.current!.getContext('2d')!;
      ctx.fillStyle = 'rgba(255,40,40,0.5)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      magicPainted.current = true;
      return;
    }
    const c = workRef.current!;
    const ctx = c.getContext('2d')!;
    if (mode === 'erase') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = brushGradient(ctx, x, y, r);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    // Restaurar: recorta el original con el pincel suave y lo pinta encima.
    const orig = origRef.current;
    if (!orig) return;
    const d = Math.ceil(r * 2);
    const sx = Math.floor(x - r);
    const sy = Math.floor(y - r);
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = d;
    const tctx = tmp.getContext('2d')!;
    tctx.drawImage(orig, sx, sy, d, d, 0, 0, d, d);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.fillStyle = brushGradient(tctx, x - sx, y - sy, r);
    tctx.fillRect(0, 0, d, d);
    ctx.drawImage(tmp, sx, sy);
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

  const snapshot = () => {
    const c = workRef.current!;
    const o = overlayRef.current!;
    undoStack.current.push({
      work: c.getContext('2d')!.getImageData(0, 0, c.width, c.height),
      overlay: o.getContext('2d')!.getImageData(0, 0, o.width, o.height),
    });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    setCanUndo(true);
  };

  const undo = () => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    workRef.current!.getContext('2d')!.putImageData(snap.work, 0, 0);
    overlayRef.current!.getContext('2d')!.putImageData(snap.overlay, 0, 0);
    setCanUndo(undoStack.current.length > 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy || e.button !== 0) return;
    if (e.pointerType === 'pen') lastPen.current = performance.now();
    // Rechazo de palma: con el lápiz en uso se ignoran los toques anchos.
    if (
      isPalm({
        pointerType: e.pointerType,
        width: e.width,
        height: e.height,
        penRecent: penIsRecent(lastPen.current, performance.now()),
      })
    )
      return;
    pressure.current = pressureFactor(e.pointerType, e.pressure, penPressure);
    snapshot();
    drawing.current = true;
    last.current = null;
    const { x, y } = toCoords(e.clientX, e.clientY);
    strokeTo(x, y);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') lastPen.current = performance.now();
    if (!drawing.current) return;
    pressure.current = pressureFactor(e.pointerType, e.pressure, penPressure);
    const { x, y } = toCoords(e.clientX, e.clientY);
    strokeTo(x, y);
  };
  const stop = () => {
    drawing.current = false;
    last.current = null;
  };

  const zoomBy = (f: number) => setZoom((z) => Math.max(1, Math.min(8, z * f)));

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

  const zoomStyle =
    zoom > 1 && baseSize.current
      ? { width: baseSize.current.w * zoom, height: baseSize.current.h * zoom }
      : undefined;

  return (
    <div className="mask-overlay" ref={rootRef}>
      <div className="mask-toolbar">
        <BackButton onClick={onCancel} />
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
            max={300}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <span>{size}px</span>
        </label>
        <label className="mask-size" title="1 = borde duro, 0 = muy suave">
          {t('Dureza')}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={hardness}
            onChange={(e) => setHardness(Number(e.target.value))}
          />
          <span>{Math.round(hardness * 100)}%</span>
        </label>
        <label className="mask-size" title="Con lápiz, el grosor y la dureza responden a la presión">
          <input type="checkbox" checked={penPressure} onChange={(e) => setPenPressure(e.target.checked)} />
          {t('Presión del lápiz')}
        </label>
        <div className="mask-zoom">
          <button onClick={() => zoomBy(1 / 1.5)} title="Alejar">−</button>
          <button onClick={() => setZoom(1)} title="Ajustar">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => zoomBy(1.5)} title="Acercar">＋</button>
        </div>
        <button onClick={undo} disabled={!canUndo} title="Ctrl+Z">
          ↶ {t('Deshacer')}
        </button>
        <span className="spacer" />
        <button className="primary" disabled={!ready || busy} onClick={apply}>
          {busy ? '… Rellenando' : '✓ Aplicar'}
        </button>
        <button onClick={onCancel} disabled={busy}>
          ✕ {t('Cancelar')}
        </button>
      </div>

      <div
        className={`mask-stage ${zoom > 1 ? 'zoomed' : ''}`}
        ref={stageRef}
        onWheel={(e) => {
          if (!e.ctrlKey && zoom === 1 && e.deltaY > 0) return;
          e.preventDefault();
          zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
        }}
      >
        <div className="mask-canvas-wrap" style={zoomStyle}>
          <canvas ref={workRef} className="mask-canvas" style={zoomStyle} />
          <canvas
            ref={overlayRef}
            className="mask-canvas mask-overlay-canvas"
            style={zoomStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stop}
            onPointerLeave={stop}
          />
        </div>
      </div>
      <p className="mask-hint">
        {mode === 'restore'
          ? 'Pinta sobre lo que el quitafondos borró de más para recuperarlo. Rueda del ratón = zoom, Ctrl+Z = deshacer.'
          : mode === 'erase'
            ? 'Pinta sobre lo que quieras borrar (quedará transparente). Baja la dureza para bordes suaves.'
            : 'Pinta un objeto para eliminarlo: se rellenará con el fondo de alrededor.'}
      </p>
    </div>
  );
}
