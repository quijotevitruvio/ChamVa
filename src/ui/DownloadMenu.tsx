import { useState } from 'react';
import type { ExportFormat } from '../io/export';
import { t } from '../i18n';
import { ExportPreview } from './ExportPreview';
import { ExportSettings } from './ExportSettings';
import { useEditor } from '../editor/state/store';
import { useExtra } from '../io/exportExtra';
import { ExportMoreDialog } from './ExportMoreDialog';
import { openBatchShare } from './ExportQueuePanel';
import './export2.css';

export type Fmt = ExportFormat | 'svg' | 'gif' | 'pdf' | 'anim' | 'anim-mp4' | 'ico';

interface Props {
  format: Fmt;
  setFormat: (f: Fmt) => void;
  scale: number;
  setScale: (n: number) => void;
  quality: number;
  setQuality: (n: number) => void;
  scope: 'page' | 'all' | 'selection';
  setScope: (s: 'page' | 'all' | 'selection') => void;
  pageCount: number;
  transparentCanvas: boolean;
  onDownload: () => void;
  onCopy: () => void;
}

export function DownloadMenu({
  format,
  setFormat,
  scale,
  setScale,
  quality,
  setQuality,
  scope,
  setScope,
  pageCount,
  transparentCanvas,
  onDownload,
  onCopy,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  useExtra(); // re-renderiza al cambiar los ajustes extra
  const selCount = useEditor((s) => s.selectedIds.length);
  const raster = format === 'png' || format === 'jpeg' || format === 'webp' || format === 'avif';
  return (
    <div className="download-menu dl2">
      <label className="dl-row">
        {t('Formato')}
        <select value={format} onChange={(e) => setFormat(e.target.value as Fmt)}>
          <option value="png">PNG (transparente)</option>
          <option value="jpeg">JPG</option>
          <option value="webp">WebP</option>
          <option value="avif">AVIF</option>
          <option value="svg">SVG (vector)</option>
          <option value="ico">ICO (icono)</option>
          <option value="pdf">PDF</option>
          <option value="gif">GIF (páginas)</option>
          <option value="anim">GIF (animación)</option>
          <option value="anim-mp4">MP4 (animación)</option>
        </select>
      </label>

      {raster && (
        <>
          <label className="dl-row">
            {t('Tamaño')}
            <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              <option value={0.5}>@0.5x</option>
              <option value={1}>@1x</option>
              <option value={2}>@2x</option>
              <option value={3}>@3x</option>
            </select>
          </label>
          {format !== 'png' && (
            <label className="dl-row">
              {t('Calidad')}
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.01}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </label>
          )}
        </>
      )}

      {format !== 'gif' && format !== 'anim' && format !== 'anim-mp4' && format !== 'ico' && (
        <label className="dl-row">
          {t('Páginas')}
          <select value={scope} onChange={(e) => setScope(e.target.value as 'page' | 'all' | 'selection')}>
            <option value="page">{t('Esta página')}</option>
            {(raster || format === 'svg') && (
              <option value="selection" disabled={selCount === 0 && scope !== 'selection'}>
                {t('Solo lo seleccionado')}
              </option>
            )}
            <option value="all">
              {t('Todas')} ({pageCount})
            </option>
          </select>
        </label>
      )}
      {format === 'gif' && <p className="dl-hint">El GIF anima todas las páginas ({pageCount}).</p>}
      {format === 'jpeg' && transparentCanvas && (
        <p className="dl-hint dl-warn">
          ⚠ {t('JPG no admite transparencia; usa PNG o WebP.')}
        </p>
      )}
      {(format === 'png' || format === 'webp' || format === 'avif') && transparentCanvas && (
        <p className="dl-hint dl-note">
          ✓ Se descarga con fondo transparente. Si tu visor lo muestra negro o blanco, es normal: la
          transparencia está en el archivo y se ve al ponerlo sobre otro fondo.
        </p>
      )}
      {format === 'anim' && <p className="dl-hint">GIF con las animaciones de entrada de esta página.</p>}

      {scope === 'selection' && (raster || format === 'svg') && (
        <p className="dl-hint">Se recorta a la caja de la selección y el fondo queda transparente.</p>
      )}
      {scope === 'all' && pageCount > 1 && (raster || format === 'svg') && (
        <p className="dl-hint">Una imagen por página, en un ZIP.</p>
      )}

      <ExportSettings
        format={format}
        setFormat={setFormat}
        scale={scale}
        setScale={setScale}
        quality={quality}
        setQuality={setQuality}
        scope={scope}
        setScope={setScope}
      />

      <ExportPreview
        format={format}
        scale={scale}
        quality={quality}
        pageCount={pageCount}
        scope={scope}
      />

      {/* más formatos */}
      <button className="dl-go" onClick={() => setMoreOpen(true)}>
        {t('Más formatos…')}
      </button>
      {moreOpen && <ExportMoreDialog onClose={() => setMoreOpen(false)} />}
      <button className="dl-go" onClick={openBatchShare}>
        {t('Lote y compartir…')}
      </button>

      <button className="primary dl-go" onClick={onDownload}>
        ⬇ {t('Descargar')} {format.toUpperCase()}
      </button>
      <button className="dl-go" onClick={onCopy}>
        📋 {t('Copiar al portapapeles')}
      </button>
    </div>
  );
}
