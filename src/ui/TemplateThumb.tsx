import { useEffect, useRef } from 'react';
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from '../io/export';

export function TemplateThumb({
  doc,
  label,
  onClick,
}: {
  doc: Doc;
  label: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const scale = Math.min(1, 220 / Math.max(doc.width, doc.height));
      const canvas = await renderDocToCanvas(doc, scale, '#ffffff');
      if (!cancelled && ref.current)
        ref.current.src = canvas.toDataURL('image/jpeg', 0.6);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  return (
    <div className="upload-thumb" onClick={onClick} title={label}>
      <img ref={ref} alt={label} />
    </div>
  );
}
