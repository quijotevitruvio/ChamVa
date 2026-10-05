import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageLayer } from '../editor/core/types';
import { inpaintCanvas } from '../ai/inpaint';
import { removeImageBackground } from '../ai/worker-client';
import { toast } from './toast';
import { t } from '../i18n';
import { isPalm, penIsRecent, pressureFactor } from '../editor/canvas/gestures';
import { setPenPressure, usePenPressure } from './tabletMode';
import { BackButton, CloseButton, Modal } from './Modal';
import { useDismiss } from './useDismiss';
import {
  BrushStroke,
  applyPatch,
  commitFull,
  diffPatch,
  eraseAll,
  patchBytes,
  restoreAll,
  smoothEdges,
  smoothPoint,
  type MaskPatch,
  type Rect,
} from '../editor/core/maskEdit';
import { StepHistory } from '../editor/core/maskHistory';
import './maskeditor.css';

// Editor de recorte (Borrar / Restaurar / Mágico). No destructivo hasta «Aplicar»:
//  · `orig` (la foto original, RGBA) no se modifica nunca; `cur` es el recorte vigente.
//  · El historial (Ctrl+Z / Ctrl+Y / lista de pasos) guarda PARCHES de la región tocada
//    (antes/después), no copias de la imagen. Límite: 80 pasos y 160 MB (ver maskHistory.ts);
//    al pasarse se descartan los pasos más antiguos y se avisa en la lista.
//  · Memoria viva: orig + cur (4 B/px cada uno) + marcas (1 B/px); `cur` es también el
//    búfer del lienzo, no hay copia aparte.

type Mode = 'erase' | 'restore' | 'magic';

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

function pixelsOf(img: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

const BG_ENGINE_LS = 'chamva.bgEngine';

const PREVIEW_BGS: { id: string; label: string; color: string | null }[] = [
  { id: 'checker', label: 'Tablero', color: null },
  { id: 'white', label: 'Blanco', color: '#ffffff' },
  { id: 'black', label: 'Negro', color: '#000000' },
  { id: 'green', label: 'Verde', color: '#00b140' },
  { id: 'pink', label: 'Rosa', color: '#ff2d95' },
];

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
  const workRef = useRef<HTMLCanvasElement>(null); // recorte vigente
  const overlayRef = useRef<HTMLCanvasElement>(null); // marcas del modo mágico + entrada de puntero
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  // Estado de píxeles (fuera de React: cambia en cada gota).
  const dims = useRef({ w: 0, h: 0 });
  const curRef = useRef<Uint8ClampedArray | null>(null);
  const origRef = useRef<Uint8ClampedArray | null>(null);
  const marksRef = useRef<Uint8ClampedArray | null>(null);
  const imgDataRef = useRef<ImageData | null>(null);
  const markImgRef = useRef<ImageData | null>(null);
  const hist = useRef(new StepHistory<MaskPatch>());
  const stroke = useRef<BrushStroke | null>(null);
  const marksBefore = useRef<Uint8ClampedArray | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const smoothed = useRef<{ x: number; y: number } | null>(null);
  const baseSize = useRef<{ w: number; h: number } | null>(null);
  // Lápiz: presión del trazo actual (1 con ratón/dedo) y rechazo de palma.
  const pressure = useRef(1);
  const lastPen = useRef(0);
  const penPressure = usePenPressure();

  const [mode, setMode] = useState<Mode>('restore');
  const [size, setSize] = useState(60);
  const [hardness, setHardness] = useState(0.7); // 1 = borde duro
  const [opacity, setOpacity] = useState(1);
  const [smoothing, setSmoothing] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState('');
  const [bgId, setBgId] = useState('checker');
  const [bgCustom, setBgCustom] = useState('#ffcc00');
  const [histOpen, setHistOpen] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [, setVer] = useState(0); // fuerza el repintado de los botones del historial
  const bump = () => setVer((v) => v + 1);
  const hasOriginal = !!layer.originalSrc;

  const requestExit = () => {
    if (busy) return;
    if (hist.current.changed) setConfirmExit(true);
    else onCancel();
  };
  useDismiss(rootRef, { onClose: requestExit, busy: !!busy });

  // Si la barra de la ventana (pestañas + minimizar/cerrar) está visible, la pantalla empieza debajo.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const place = () => {
      const strip = document.querySelector<HTMLElement>('.tabstrip');
      const r = strip?.getBoundingClientRect();
      const top = r && r.height > 0 && r.bottom > 0 ? Math.round(r.bottom) : 0;
      el.style.top = `${top}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  // Carga: recorte (layer.src) y original (layer.originalSrc, o el propio recorte si no hay).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const work = await loadImg(layer.src);
        const orig = layer.originalSrc ? await loadImg(layer.originalSrc) : work;
        if (cancelled) return;
        const w = work.naturalWidth;
        const h = work.naturalHeight;
        dims.current = { w, h };
        const cur = new Uint8ClampedArray(pixelsOf(work, w, h));
        curRef.current = cur;
        origRef.current = layer.originalSrc ? new Uint8ClampedArray(pixelsOf(orig, w, h)) : new Uint8ClampedArray(cur);
        marksRef.current = new Uint8ClampedArray(w * h);
        imgDataRef.current = new ImageData(cur, w, h);
        markImgRef.current = new ImageData(w, h);
        const c = workRef.current!;
        const o = overlayRef.current!;
        c.width = o.width = w;
        c.height = o.height = h;
        c.getContext('2d')!.putImageData(imgDataRef.current, 0, 0);
        hist.current = new StepHistory<MaskPatch>();
        baseSize.current = null;
        setZoom(1);
        setReady(true);
        bump();
      } catch (e) {
        console.error(e);
        toast('No se pudo abrir la imagen: ' + (e as Error).message, 'error');
      }
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

  // El lienzo ocupa todo el espacio libre de la pantalla.
  useEffect(() => {
    const st = stageRef.current;
    if (!st) return;
    const fit = () => {
      st.style.setProperty('--mw', `${Math.max(120, st.clientWidth - 32)}px`);
      st.style.setProperty('--mh', `${Math.max(120, st.clientHeight - 32)}px`);
      if (zoomRef.current === 1) baseSize.current = null;
    };
    fit();
    const ro = new ResizeObserver(() => {
      fit();
      if (zoomRef.current === 1) {
        requestAnimationFrame(() => {
          const r = workRef.current?.getBoundingClientRect();
          if (r && r.width) baseSize.current = { w: r.width, h: r.height };
        });
      }
    });
    ro.observe(st);
    return () => ro.disconnect();
  }, []);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  // ---- pintado ----
  const paintImg = (r?: Rect) => {
    const ctx = workRef.current?.getContext('2d');
    const d = imgDataRef.current;
    if (!ctx || !d) return;
    if (r) ctx.putImageData(d, 0, 0, r.x, r.y, r.w, r.h);
    else ctx.putImageData(d, 0, 0);
  };
  const paintMarks = (r: Rect) => {
    const ctx = overlayRef.current?.getContext('2d');
    const md = markImgRef.current;
    const m = marksRef.current;
    if (!ctx || !md || !m) return;
    const { w } = dims.current;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * w + x;
        md.data[i * 4] = 255;
        md.data[i * 4 + 1] = 40;
        md.data[i * 4 + 2] = 40;
        md.data[i * 4 + 3] = m[i] ? 128 : 0;
      }
    ctx.putImageData(md, 0, 0, r.x, r.y, r.w, r.h);
  };
  const repaint = (plane: 'img' | 'mark', r: Rect) => (plane === 'img' ? paintImg(r) : paintMarks(r));

  // ---- historial ----
  const record = (label: string, patch: MaskPatch | null) => {
    if (!patch) return false;
    hist.current.push(label, patch, patchBytes(patch));
    bump();
    return true;
  };
  const apply = (p: MaskPatch, dir: 'undo' | 'redo') => {
    const { w } = dims.current;
    const buf = p.plane === 'img' ? curRef.current : marksRef.current;
    if (!buf) return;
    repaint(p.plane, applyPatch(buf, w, p, dir));
  };
  const undo = () => {
    if (busy || drawing.current) return;
    const e = hist.current.undo();
    if (e) apply(e.patch, 'undo');
    bump();
  };
  const redo = () => {
    if (busy || drawing.current) return;
    const e = hist.current.redo();
    if (e) apply(e.patch, 'redo');
    bump();
  };
  const jumpTo = (n: number) => {
    if (busy || drawing.current) return;
    const j = hist.current.jump(n);
    for (const e of j.undo) apply(e.patch, 'undo');
    for (const e of j.redo) apply(e.patch, 'redo');
    bump();
  };

  // Atajos: se capturan ANTES de que lleguen al editor de diseño de fondo.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'z' || k === 'y')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (confirmExit) return;
      if (k === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod || e.altKey || confirmExit) return;
    const tg = e.target as HTMLElement | null;
    if (tg?.closest('input[type="text"],input[type="number"],textarea,select,[contenteditable="true"]')) return;
    if (k === 'x') {
      e.preventDefault();
      setMode((m) => (m === 'erase' ? 'restore' : 'erase'));
    } else if (e.key === '[') {
      e.preventDefault();
      setSize((s) => Math.max(5, Math.min(s - 2, Math.round(s / 1.15))));
    } else if (e.key === ']') {
      e.preventDefault();
      setSize((s) => Math.min(600, Math.max(s + 2, Math.round(s * 1.15))));
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, []);

  // ---- trazos ----
  const toCoords = (clientX: number, clientY: number) => {
    const o = overlayRef.current!;
    const r = o.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * o.width,
      y: ((clientY - r.top) / r.height) * o.height,
    };
  };

  const markDab = (x: number, y: number) => {
    const m = marksRef.current!;
    const { w, h } = dims.current;
    const r = Math.max(0.5, (size / 2) * pressure.current);
    const x0 = Math.max(0, Math.floor(x - r));
    const y0 = Math.max(0, Math.floor(y - r));
    const x1 = Math.min(w - 1, Math.ceil(x + r));
    const y1 = Math.min(h - 1, Math.ceil(y + r));
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++)
        if (Math.hypot(px + 0.5 - x, py + 0.5 - y) <= r) m[py * w + px] = 255;
    if (x1 >= x0 && y1 >= y0) paintMarks({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  };

  const dab = (x: number, y: number) => {
    if (mode === 'magic') return markDab(x, y);
    const r = stroke.current?.dab(x, y, pressure.current);
    if (r) paintImg(r);
  };

  const strokeTo = (x: number, y: number) => {
    const l = last.current;
    if (!l) dab(x, y);
    else {
      const dist = Math.hypot(x - l.x, y - l.y);
      const n = Math.ceil(dist / Math.max(1, size / 4));
      for (let i = 1; i <= n; i++) dab(l.x + ((x - l.x) * i) / n, l.y + ((y - l.y) * i) / n);
    }
    last.current = { x, y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy || !ready || e.button !== 0) return;
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
    const { w, h } = dims.current;
    if (mode === 'magic') {
      marksBefore.current = new Uint8ClampedArray(marksRef.current!);
    } else {
      stroke.current = new BrushStroke(curRef.current!, origRef.current!, w, h, {
        mode,
        size,
        hardness,
        opacity,
      });
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sin captura de puntero */
    }
    drawing.current = true;
    last.current = null;
    const p = toCoords(e.clientX, e.clientY);
    smoothed.current = p;
    strokeTo(p.x, p.y);
  };
  const moveRing = (e: React.PointerEvent) => {
    const ring = ringRef.current;
    const wrap = wrapRef.current;
    if (!ring || !wrap) return;
    if (e.pointerType === 'touch') {
      ring.style.display = 'none';
      return;
    }
    const r = wrap.getBoundingClientRect();
    const px = (size * r.width) / (dims.current.w || 1);
    ring.style.display = 'block';
    ring.style.width = ring.style.height = `${Math.max(6, px)}px`;
    ring.style.left = `${e.clientX - r.left}px`;
    ring.style.top = `${e.clientY - r.top}px`;
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') lastPen.current = performance.now();
    moveRing(e);
    if (!drawing.current) return;
    pressure.current = pressureFactor(e.pointerType, e.pressure, penPressure);
    const target = toCoords(e.clientX, e.clientY);
    const sp = smoothPoint(smoothed.current, target, smoothing);
    smoothed.current = sp;
    strokeTo(sp.x, sp.y);
  };
  const stop = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    smoothed.current = null;
    if (mode === 'magic') {
      const { w, h } = dims.current;
      const before = marksBefore.current;
      marksBefore.current = null;
      if (before) record('Pincel mágico', diffPatch(before, marksRef.current!, w, h, 1, 'mark'));
    } else {
      const p = stroke.current?.finish() ?? null;
      stroke.current = null;
      record(mode === 'erase' ? 'Pincel borrar' : 'Restaurar', p);
    }
  };
  const hideRing = () => {
    if (ringRef.current) ringRef.current.style.display = 'none';
  };

  // ---- operaciones sobre toda la imagen ----
  const whole = (label: string, fn: () => MaskPatch | null) => {
    if (busy || !ready) return;
    const p = fn();
    if (!p) {
      toast('Ya está así: no hay nada que cambiar.', 'info');
      return;
    }
    paintImg({ x: p.x, y: p.y, w: p.w, h: p.h });
    record(label, p);
  };
  const doRestoreAll = () =>
    whole('Restaurar todo', () => restoreAll(curRef.current!, origRef.current!, dims.current.w, dims.current.h));
  const doEraseAll = () => whole('Borrar todo', () => eraseAll(curRef.current!, dims.current.w, dims.current.h));
  const doSmooth = () =>
    whole('Suavizar bordes', () =>
      smoothEdges(curRef.current!, origRef.current!, dims.current.w, dims.current.h, 1),
    );
  const doAutoRemove = async () => {
    if (busy || !ready) return;
    setBusy(t('Quitando el fondo…'));
    try {
      const saved = localStorage.getItem(BG_ENGINE_LS);
      const quality = saved === 'birefnet' || saved === 'rmbg' || saved === 'modnet' ? saved : 'modnet';
      const url = await removeImageBackground(layer.originalSrc ?? layer.src, {
        quality,
        edges: 'auto',
        onProgress: (ratio, stage) =>
          setBusy(
            stage.startsWith('fetch')
              ? `${t('Descargando modelo…')} ${Math.round(ratio * 100)}%`
              : `${t('Procesando…')} ${Math.round(ratio * 100)}%`,
          ),
      });
      const img = await loadImg(url);
      const { w, h } = dims.current;
      const next = new Uint8ClampedArray(pixelsOf(img, w, h));
      const p = commitFull(curRef.current!, next, w, h);
      if (p) {
        paintImg({ x: p.x, y: p.y, w: p.w, h: p.h });
        record('Quitar fondo automático', p);
      } else toast('Ya está así: no hay nada que cambiar.', 'info');
    } catch (e) {
      const err = e as Error;
      if (err.message !== 'cancelado')
        toast(
          /fetch|network|load/i.test(err.message)
            ? 'Necesitas internet la primera vez para descargar el modelo (o usa "Preparar offline" en Ajustes).'
            : 'No se pudo quitar el fondo: ' + err.message,
          'error',
        );
    } finally {
      setBusy('');
    }
  };

  const zoomBy = (f: number) => setZoom((z) => Math.max(1, Math.min(8, z * f)));

  // Construye una máscara B/N a partir de las marcas (modo mágico).
  const buildMaskCanvas = (): HTMLCanvasElement => {
    const { w, h } = dims.current;
    const m = marksRef.current!;
    const mask = document.createElement('canvas');
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext('2d')!;
    const dst = mctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const on = m[i] ? 255 : 0;
      dst.data[i * 4] = dst.data[i * 4 + 1] = dst.data[i * 4 + 2] = on;
      dst.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(dst, 0, 0);
    return mask;
  };

  const doApply = async () => {
    if (!ready || busy) return;
    const { w, h } = dims.current;
    try {
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const octx = out.getContext('2d')!;
      octx.putImageData(imgDataRef.current!, 0, 0);
      if (marksRef.current!.some((v) => v)) {
        setBusy(t('Rellenando…'));
        const result = await inpaintCanvas(out, buildMaskCanvas());
        octx.clearRect(0, 0, w, h);
        octx.drawImage(result, 0, 0);
      }
      onApply(out.toDataURL('image/png'));
    } catch (e) {
      console.error(e);
      toast('Error en el borrador mágico: ' + (e as Error).message, 'error');
      setBusy('');
    }
  };

  const zoomStyle =
    zoom > 1 && baseSize.current
      ? { width: baseSize.current.w * zoom, height: baseSize.current.h * zoom }
      : undefined;

  const h = hist.current;
  const previewColor =
    bgId === 'custom' ? bgCustom : (PREVIEW_BGS.find((b) => b.id === bgId)?.color ?? null);
  const wrapStyle = { ...(zoomStyle ?? {}), ...(previewColor ? { background: previewColor } : {}) };
  const modeLabel = mode === 'erase' ? 'Borrar' : mode === 'restore' ? 'Restaurar' : 'Mágico';

  return (
    <div className="mask-overlay mask-v2" ref={rootRef} aria-label={t('Borrador / Pincel')}>
      <header className="mask-head">
        <BackButton onClick={requestExit} />
        <h2 className="mask-title">🪄 {t('Borrador / Pincel')}</h2>
        <span className="mask-head-sep" />
        <button
          type="button"
          className="mask-act"
          onClick={undo}
          disabled={!h.canUndo || !!busy}
          title={`${t('Deshacer')} (Ctrl+Z)`}
          aria-label={t('Deshacer')}
        >
          <span aria-hidden="true">↶</span>
          <span className="mask-act-txt"> {t('Deshacer')}</span>
        </button>
        <button
          type="button"
          className="mask-act"
          onClick={redo}
          disabled={!h.canRedo || !!busy}
          title={`${t('Rehacer')} (Ctrl+Y)`}
          aria-label={t('Rehacer')}
        >
          <span aria-hidden="true">↷</span>
          <span className="mask-act-txt"> {t('Rehacer')}</span>
        </button>
        <div className="mask-hist-wrap">
          <button
            type="button"
            className="mask-act"
            aria-haspopup="true"
            aria-expanded={histOpen}
            onClick={() => setHistOpen((o) => !o)}
          >
            <span aria-hidden="true">🕘</span> {t('Historial')} ({h.cursor}/{h.entries.length})
          </button>
          {histOpen && (
            <HistoryMenu
              labels={h.labels()}
              cursor={h.cursor}
              dropped={h.dropped}
              baseLabel={hasOriginal ? t('Recorte inicial') : t('Imagen inicial')}
              onJump={(n) => {
                jumpTo(n);
              }}
              onClose={() => setHistOpen(false)}
            />
          )}
        </div>
        <span className="spacer" />
        <button type="button" className="mask-act primary" disabled={!ready || !!busy} onClick={doApply}>
          ✓ {t('Aplicar')}
        </button>
        <button type="button" className="mask-act" onClick={requestExit} disabled={!!busy}>
          {t('Cancelar')}
        </button>
        <CloseButton onClick={requestExit} />
      </header>

      <div className="mask-toolbar" role="toolbar" aria-label={t('Herramientas del pincel')}>
        <div className="mask-seg" role="group" aria-label={t('Modo del pincel')}>
          <button
            type="button"
            className={mode === 'restore' ? 'active' : ''}
            aria-pressed={mode === 'restore'}
            onClick={() => setMode('restore')}
            title="Devuelve los píxeles de la foto original (X alterna con Borrar)"
          >
            🖌 {t('Restaurar')}
          </button>
          <button
            type="button"
            className={mode === 'erase' ? 'active' : ''}
            aria-pressed={mode === 'erase'}
            onClick={() => setMode('erase')}
            title="Deja transparente (X alterna con Restaurar)"
          >
            🧽 {t('Borrar')}
          </button>
          <button
            type="button"
            className={mode === 'magic' ? 'active' : ''}
            aria-pressed={mode === 'magic'}
            onClick={() => setMode('magic')}
            title="Pinta un objeto y se rellena con el fondo de alrededor"
          >
            ✨ {t('Mágico')}
          </button>
        </div>
        <label className="mask-size">
          {t('Pincel')}
          <input
            type="range"
            min={5}
            max={600}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            title="[ y ] cambian el tamaño"
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
        <label className="mask-size" title="Cuánto borra o restaura como máximo cada trazo">
          {t('Opacidad')}
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
          <span>{Math.round(opacity * 100)}%</span>
        </label>
        <label className="mask-size" title="Estabiliza el trazo: más suavizado, línea más pausada">
          {t('Suavizado')}
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={smoothing}
            onChange={(e) => setSmoothing(Number(e.target.value))}
          />
          <span>{Math.round((smoothing / 0.9) * 100)}%</span>
        </label>
        <label className="mask-size" title="Con lápiz, el grosor y la dureza responden a la presión">
          <input type="checkbox" checked={penPressure} onChange={(e) => setPenPressure(e.target.checked)} />
          {t('Presión del lápiz')}
        </label>
        <div className="mask-zoom">
          <button type="button" onClick={() => zoomBy(1 / 1.5)} title="Alejar" aria-label="Alejar">
            −
          </button>
          <button type="button" onClick={() => setZoom(1)} title="Ajustar">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => zoomBy(1.5)} title="Acercar" aria-label="Acercar">
            ＋
          </button>
        </div>

        <div className="mask-seg" role="group" aria-label={t('Toda la imagen')}>
          <button
            type="button"
            onClick={doRestoreAll}
            disabled={!ready || !!busy}
            title="Vuelve a la foto original completa, sin quitar fondo"
          >
            ↺ {t('Restaurar todo')}
          </button>
          <button
            type="button"
            onClick={doEraseAll}
            disabled={!ready || !!busy}
            title="Deja toda la imagen transparente (se puede restaurar)"
          >
            ⬚ {t('Borrar todo')}
          </button>
          <button
            type="button"
            onClick={doAutoRemove}
            disabled={!ready || !!busy}
            title="Vuelve a quitar el fondo con el modelo local"
          >
            ✂ {t('Quitar fondo automático')}
          </button>
          <button
            type="button"
            onClick={doSmooth}
            disabled={!ready || !!busy}
            title="Suaviza el borde del recorte"
          >
            ◌ {t('Suavizar bordes')}
          </button>
        </div>

        <div className="mask-seg mask-bgpick" role="group" aria-label={t('Fondo de la vista previa')}>
          <span className="mask-bglabel">{t('Fondo')}</span>
          {PREVIEW_BGS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`mask-sw ${bgId === b.id ? 'active' : ''}`}
              aria-pressed={bgId === b.id}
              aria-label={b.label}
              title={b.label}
              onClick={() => setBgId(b.id)}
              style={b.color ? { background: b.color } : undefined}
              data-checker={b.color ? undefined : ''}
            />
          ))}
          <label
            className={`mask-sw custom ${bgId === 'custom' ? 'active' : ''}`}
            title="Elegir otro color"
            style={{ background: bgCustom }}
          >
            <input
              type="color"
              value={bgCustom}
              aria-label="Elegir color de fondo"
              onChange={(e) => {
                setBgCustom(e.target.value);
                setBgId('custom');
              }}
            />
          </label>
        </div>
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
        <div
          className={`mask-canvas-wrap ${previewColor ? 'solid' : ''}`}
          ref={wrapRef}
          style={Object.keys(wrapStyle).length ? wrapStyle : undefined}
        >
          <canvas ref={workRef} className="mask-canvas" style={zoomStyle} />
          <canvas
            ref={overlayRef}
            className={`mask-canvas mask-overlay-canvas cur-${mode}`}
            style={zoomStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stop}
            onPointerCancel={stop}
            onPointerLeave={hideRing}
            aria-label={`${t('Lienzo del pincel')}: ${modeLabel}`}
          />
          <div ref={ringRef} className={`mask-ring ring-${mode}`} aria-hidden="true" />
        </div>
        {!ready && <p className="mask-loading">{t('Cargando imagen…')}</p>}
      </div>
      <p className="mask-hint" aria-live="polite">
        {busy
          ? busy
          : mode === 'restore'
            ? 'Pinta sobre lo que el quitafondos borró de más para recuperar la foto original. X = alternar con Borrar · [ ] = tamaño · Ctrl+Z / Ctrl+Y = deshacer / rehacer.'
            : mode === 'erase'
              ? 'Pinta sobre lo que quieras borrar (queda transparente y se puede restaurar). X = alternar con Restaurar · [ ] = tamaño.'
              : 'Pinta un objeto para eliminarlo: se rellenará con el fondo de alrededor al pulsar Aplicar.'}
        {!hasOriginal && !busy && ' Esta imagen no guarda su original: Restaurar solo recupera lo que borres aquí.'}
      </p>

      {confirmExit && (
        <Modal
          title={t('¿Salir sin aplicar los cambios?')}
          onClose={() => setConfirmExit(false)}
          alert
          backdrop={false}
        >
          <p className="mask-confirm-text">
            {t('Hiciste cambios en el recorte que todavía no se aplicaron al diseño. Si sales, se pierden.')}
          </p>
          <div className="mask-confirm-btns">
            <button type="button" className="mask-act" onClick={() => setConfirmExit(false)}>
              {t('Seguir editando')}
            </button>
            <button
              type="button"
              className="mask-act danger"
              onClick={() => {
                setConfirmExit(false);
                onCancel();
              }}
            >
              {t('Salir sin aplicar')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Lista desplegable de pasos: el estado inicial y cada paso con nombre; clic = saltar a ese estado. */
function HistoryMenu({
  labels,
  cursor,
  dropped,
  baseLabel,
  onJump,
  onClose,
}: {
  labels: string[];
  cursor: number;
  dropped: number;
  baseLabel: string;
  onJump: (n: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(onClose, [onClose]);
  useDismiss(ref, { onClose: close, modal: false });
  // Clic fuera cierra.
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.mask-hist-wrap')) close();
    };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [close]);
  const items = [baseLabel, ...labels];
  return (
    <div className="mask-hist" ref={ref} role="group" aria-label={t('Historial')}>
      <div className="mask-hist-head">
        <strong>{t('Historial')}</strong>
        <CloseButton onClick={close} />
      </div>
      <ol className="mask-hist-list">
        {items.map((label, i) => (
          <li key={i}>
            <button
              type="button"
              className={`${i === cursor ? 'current' : ''} ${i > cursor ? 'future' : ''}`}
              aria-current={i === cursor ? 'step' : undefined}
              onClick={() => onJump(i)}
            >
              <span className="mask-hist-n">{i === 0 ? '●' : i}</span>
              {i === 0 ? `${t('Inicio')}: ${label}` : t(label)}
            </button>
          </li>
        ))}
      </ol>
      {dropped > 0 && (
        <p className="mask-hist-note">
          {dropped} {t('pasos antiguos descartados para ahorrar memoria')}
        </p>
      )}
    </div>
  );
}
