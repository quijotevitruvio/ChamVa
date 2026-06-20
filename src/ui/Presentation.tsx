import { useEffect, useRef, useState } from 'react';
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from '../io/export';

export function Presentation({
  pages,
  start,
  onClose,
}: {
  pages: Doc[];
  start: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(start);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = pages[i];
      if (!page) return;
      const scale = Math.min(1, 1600 / Math.max(page.width, page.height));
      const canvas = await renderDocToCanvas(page, scale, '#ffffff');
      if (!cancelled && imgRef.current)
        imgRef.current.src = canvas.toDataURL('image/png');
    })();
    return () => {
      cancelled = true;
    };
  }, [i, pages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ')
        setI((v) => Math.min(pages.length - 1, v + 1));
      else if (e.key === 'ArrowLeft')
        setI((v) => Math.max(0, v - 1));
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pages.length, onClose]);

  return (
    <div className="present-overlay">
      <img ref={imgRef} className="present-img" alt={`Página ${i + 1}`} />
      <div className="present-bar">
        <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}>
          ‹
        </button>
        <span>
          {i + 1} / {pages.length}
        </span>
        <button
          onClick={() => setI((v) => Math.min(pages.length - 1, v + 1))}
          disabled={i === pages.length - 1}
        >
          ›
        </button>
        <button onClick={onClose}>✕ Salir (Esc)</button>
      </div>
    </div>
  );
}
