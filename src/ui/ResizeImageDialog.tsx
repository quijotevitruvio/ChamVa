import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageLayer } from '../editor/core/types';
import { useEditor } from '../editor/state/store';
import { RESAMPLE_METHODS, type ResampleMethod } from '../editor/core/resample';
import { resampleAsync } from '../editor/core/resampleAsync';
import {
  dimFromHeight,
  dimFromPercent,
  dimFromWidth,
  dimProblem,
  layerGeometryAfterResize,
  type Dim,
} from '../editor/core/resizeImage';
import { fromPx, isValidDpi } from '../editor/core/units';
import { loadImg } from './imagegeoUtil';
import { toast } from './toast';
import { t } from '../i18n';
import './imagegeo.css';
import { BackButton } from './Modal';
import { useDismiss } from './useDismiss';

// Redimensionar imagen con remuestreo de calidad (bilineal / bicúbico / Lanczos, y reducción por
// pasos para evitar aliasing). Cambia los píxeles de la imagen; la capa conserva su tamaño en el
// diseño y sus ajustes, filtro, volteo y recorte (siguen siendo editables).
export function ResizeImageDialog({ layer, onClose }: { layer: ImageLayer; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDismiss(overlayRef, { onClose: onClose });
  const dpi = useEditor((s) => s.doc.dpi);
  const [src, setSrc] = useState<Dim | null>(null); // tamaño REAL en píxeles de la imagen cargada
  const [dim, setDim] = useState<Dim>({ w: 1, h: 1 });
  const [lock, setLock] = useState(true);
  const [method, setMethod] = useState<ResampleMethod>('bicubic');
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let off = false;
    loadImg(layer.src)
      .then((img) => {
        if (off) return;
        imgRef.current = img;
        const s = { w: img.naturalWidth, h: img.naturalHeight };
        setSrc(s);
        setDim(s);
      })
      .catch(() => toast(t('No se pudo cargar la imagen'), 'error'));
    return () => {
      off = true;
      abortRef.current?.abort();
    };
  }, [layer.src]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, busy]);

  const problem = dimProblem(dim);
  const same = !!src && dim.w === src.w && dim.h === src.h;
  const shrinking = !!src && dim.w * dim.h < src.w * src.h;

  const apply = async () => {
    const img = imgRef.current;
    if (!img || !src || problem || same) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    try {
      const c = document.createElement('canvas');
      c.width = src.w;
      c.height = src.h;
      const cx = c.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(img, 0, 0);
      const data = cx.getImageData(0, 0, src.w, src.h).data;
      const out = await resampleAsync(data, src.w, src.h, dim.w, dim.h, method, {
        priority: 1,
        label: t('Redimensionando imagen'),
        signal: ctrl.signal,
      });
      const o = document.createElement('canvas');
      o.width = dim.w;
      o.height = dim.h;
      o.getContext('2d')!.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, dim.w, dim.h), 0, 0);
      // Una foto JPEG sigue siendo JPEG (calidad alta); lo demás va sin pérdida.
      const jpeg = /^data:image\/jpe?g/i.test(layer.src);
      const url = jpeg ? o.toDataURL('image/jpeg', 0.95) : o.toDataURL('image/png');
      const st = useEditor.getState();
      const geo = layerGeometryAfterResize(layer, src, dim);
      st.beginBatch();
      st.updateLayer(layer.id, { src: url, originalSrc: undefined, ...geo });
      st.endBatch();
      toast(`${t('Imagen redimensionada')}: ${src.w}×${src.h} → ${dim.w}×${dim.h} px`, 'success');
      onClose();
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') toast(t('Redimensionado cancelado'), 'info');
      else {
        console.error(e);
        toast(t('No se pudo redimensionar la imagen'), 'error');
      }
      setBusy(false);
    }
  };

  const num = (v: string) => Number(v.replace(',', '.'));
  const physical =
    isValidDpi(dpi) && !problem
      ? `${t('A')} ${dpi} ppp: ${fromPx(dim.w, 'cm', dpi).toFixed(1)} × ${fromPx(dim.h, 'cm', dpi).toFixed(1)} cm`
      : null;
  const hint = RESAMPLE_METHODS.find((m) => m.id === method)?.hint ?? '';

  return createPortal(
    <div className="mask-overlay" ref={overlayRef}>
      <div className="mask-toolbar">
        <BackButton onClick={onClose} />
        <span className="mask-title">{t('Redimensionar imagen')}</span>
        <span className="spacer" />
        <button onClick={() => (busy ? abortRef.current?.abort() : onClose())}>{t('Cancelar')}</button>
        <button className="primary" onClick={apply} disabled={!src || busy || !!problem || same}>
          {busy ? '…' : t('Aplicar')}
        </button>
      </div>
      <div className="mask-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <label className="geo-tools">
          {t('Ancho')}
          <input
            type="number"
            min={1}
            value={dim.w}
            disabled={!src || busy}
            onChange={(e) => src && setDim((d) => dimFromWidth(num(e.target.value), src, lock, d))}
            style={{ width: 90 }}
          />
          px
        </label>
        <label className="geo-check">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} disabled={busy} />{' '}
          {t('Mantener proporción')}
        </label>
        <label className="geo-tools">
          {t('Alto')}
          <input
            type="number"
            min={1}
            value={dim.h}
            disabled={!src || busy}
            onChange={(e) => src && setDim((d) => dimFromHeight(num(e.target.value), src, lock, d))}
            style={{ width: 90 }}
          />
          px
        </label>
        <div className="seg">
          {[25, 50, 100, 200].map((p) => (
            <button key={p} disabled={!src || busy} onClick={() => src && setDim(dimFromPercent(p, src))}>
              {p}%
            </button>
          ))}
        </div>
        <label className="geo-tools">
          {t('Remuestreo')}
          <select value={method} onChange={(e) => setMethod(e.target.value as ResampleMethod)} disabled={busy}>
            {RESAMPLE_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mask-hint" data-testid="resize-info">
        {src ? `${t('Original')}: ${src.w}×${src.h} px (${((src.w * src.h) / 1e6).toFixed(1)} MP) → ` : ''}
        <b>
          {dim.w}×{dim.h} px ({((dim.w * dim.h) / 1e6).toFixed(1)} MP)
        </b>
        {physical ? ` · ${physical}` : ''}
        {problem ? ` · ${problem}` : ''}
        <br />
        {hint}
        {shrinking ? ` ${t('Al reducir se promedian los píxeles por pasos para evitar dientes de sierra.')}` : ''}
        {layer.originalSrc ? ` ${t('Aviso: se pierde el original guardado para «Restaurar» del quitar fondo.')}` : ''}
      </p>
    </div>,
    document.body,
  );
}
