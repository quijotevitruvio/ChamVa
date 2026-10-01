import { useEffect, useState } from 'react';
import { Image as KImage } from 'react-konva';
import { useEditor } from '../state/store';
import { masterOnlyDoc, masterRevision, masterOf } from '../core/master';
import { renderDocToCanvas } from '../../io/export';

// Capas de la página maestra, detrás de las de la página y SIN interacción (solo lectura).
// Se dibujan como una sola imagen renderizada con la misma función que la exportación.
export function MasterBackdrop() {
  const doc = useEditor((s) => s.doc);
  const pages = useEditor((s) => s.pages);
  const master = doc.masterId ? masterOf(doc, pages.map((p) => (p.id === doc.id ? doc : p))) : null;
  const sig = master ? `${masterRevision(master)}-${doc.width}x${doc.height}` : '';
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!master) {
      setImg(null);
      return;
    }
    const only = masterOnlyDoc(doc, pages.map((p) => (p.id === doc.id ? doc : p)));
    if (!only) {
      setImg(null);
      return;
    }
    // Resolución del lienzo, limitada para no gastar memoria en diseños enormes.
    const scale = Math.min(1, 2400 / Math.max(doc.width, doc.height));
    renderDocToCanvas({ ...only, masterId: undefined }, scale)
      .then((c) => !cancelled && setImg(c))
      .catch(() => !cancelled && setImg(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!img) return null;
  return <KImage image={img} width={doc.width} height={doc.height} listening={false} />;
}
