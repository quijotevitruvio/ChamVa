import { useEffect, useRef } from 'react';
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from '../io/export';

// Miniatura de una página en la barra inferior.
// Se recalcula solo cuando cambia la "firma" (versión / nº de capas / tamaño),
// no en cada arrastre en vivo, para no recargar imágenes constantemente.
export function PageThumb({ doc }: { doc: Doc }) {
  const ref = useRef<HTMLImageElement>(null);
  const sig = `${doc.version}-${doc.layers.length}-${doc.width}x${doc.height}-${doc.background.type}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const scale = Math.min(0.2, 80 / Math.max(doc.width, doc.height));
      try {
        const canvas = await renderDocToCanvas(doc, scale, '#ffffff');
        if (!cancelled && ref.current)
          ref.current.src = canvas.toDataURL('image/jpeg', 0.6);
      } catch {
        /* ignora errores de render de miniatura */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return <img className="page-thumb" ref={ref} alt="" draggable={false} />;
}
