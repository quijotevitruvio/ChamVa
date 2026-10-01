import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { exportDoc, type ExportFormat } from '../io/export';
import { finalSize, formatBytes, isTooLargeToPreview } from '../io/exportPreview';
import './exportpreview.css';

interface Props {
  format: string;
  scale: number;
  quality: number;
  pageCount: number;
  scope: 'page' | 'all';
}

const RASTER = ['png', 'jpeg', 'webp', 'avif'];

interface Result {
  url: string;
  size: number;
}

export function ExportPreview({ format, scale, quality, pageCount, scope }: Props) {
  const doc = useEditor((s) => s.doc);
  const raster = RASTER.includes(format);
  const dims = finalSize(doc, raster ? scale : 1);
  const tooBig = raster && isTooLargeToPreview(dims.pixels);

  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);
  const urlRef = useRef<string | null>(null);

  const revoke = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };

  // Invalida peticiones en curso y libera la URL al desmontar.
  useEffect(
    () => () => {
      token.current++;
      revoke();
    },
    [],
  );

  // El PNG no usa calidad: no recalcular al moverla.
  const qualityDep = format === 'png' ? 0 : quality;
  useEffect(() => {
    const my = ++token.current;
    if (!raster || tooBig) {
      revoke();
      setResult(null);
      setBusy(false);
      setError(null);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const blob = await exportDoc(doc, { format: format as ExportFormat, quality, scale });
        if (my !== token.current) return; // resultado obsoleto
        revoke();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setResult({ url, size: blob.size });
        setError(null);
      } catch (e) {
        if (my !== token.current) return;
        setError(e instanceof Error ? e.message : 'error desconocido');
      } finally {
        if (my === token.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, format, scale, qualityDep, raster, tooBig]);

  const dimText = `${dims.width} × ${dims.height} px`;

  if (!raster) {
    let extra: string;
    if (format === 'svg') extra = 'Vector: sin límite de resolución';
    else if (format === 'pdf') extra = scope === 'all' ? `${pageCount} páginas` : '1 página';
    else if (format === 'gif') extra = `${pageCount} fotogramas`;
    else if (format === 'ico') extra = 'Varias resoluciones';
    else extra = 'Animación';
    return (
      <div className="xp">
        <div className="xp-info">
          <span>{format === 'svg' || format === 'ico' ? 'Lienzo' : dimText}</span>
          <span>{extra}</span>
        </div>
      </div>
    );
  }

  if (tooBig) {
    return (
      <div className="xp">
        <div className="xp-info">
          <span>{dimText}</span>
          <span>El tamaño se calcula al descargar</span>
        </div>
      </div>
    );
  }

  return (
    <div className="xp">
      <div className={`xp-thumb${busy ? ' is-busy' : ''}`}>
        {result && <img src={result.url} alt="Vista previa de la exportación" />}
        {busy && <div className="xp-state">Calculando…</div>}
      </div>
      {error && <div className="xp-err">No se pudo calcular la vista previa: {error}</div>}
      <div className="xp-info">
        <span>{dimText}</span>
        <span>{result ? `≈ ${formatBytes(result.size)}` : busy ? 'Calculando…' : '—'}</span>
      </div>
    </div>
  );
}
