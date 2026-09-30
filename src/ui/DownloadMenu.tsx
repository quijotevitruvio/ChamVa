import type { ExportFormat } from '../io/export';
import { t } from '../i18n';

export type Fmt = ExportFormat | 'svg' | 'gif' | 'pdf' | 'anim' | 'anim-mp4' | 'ico';

interface Props {
  format: Fmt;
  setFormat: (f: Fmt) => void;
  scale: number;
  setScale: (n: number) => void;
  quality: number;
  setQuality: (n: number) => void;
  scope: 'page' | 'all';
  setScope: (s: 'page' | 'all') => void;
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
  const raster = format === 'png' || format === 'jpeg' || format === 'webp' || format === 'avif';
  return (
    <div className="download-menu">
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
          <select value={scope} onChange={(e) => setScope(e.target.value as 'page' | 'all')}>
            <option value="page">{t('Esta página')}</option>
            <option value="all">
              {t('Todas')} ({pageCount})
            </option>
          </select>
        </label>
      )}
      {format === 'gif' && <p className="dl-hint">El GIF anima todas las páginas ({pageCount}).</p>}
      {format === 'jpeg' && transparentCanvas && (
        <p className="dl-hint" style={{ color: '#ffb84d', opacity: 1 }}>
          ⚠ {t('JPG no admite transparencia; usa PNG o WebP.')}
        </p>
      )}
      {format === 'anim' && <p className="dl-hint">GIF con las animaciones de entrada de esta página.</p>}

      <button className="primary dl-go" onClick={onDownload}>
        ⬇ {t('Descargar')} {format.toUpperCase()}
      </button>
      <button className="dl-go" onClick={onCopy}>
        📋 {t('Copiar al portapapeles')}
      </button>
    </div>
  );
}
