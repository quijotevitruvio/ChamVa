// Miniatura de la galería de subidas: carga perezosa (solo cuando entra en
// pantalla) y con miniatura en caché (src/io/thumbs.ts) en lugar de la imagen
// completa. Mismo marcado/clases que la galería original (.upload-thumb).
import { useEffect, useRef, useState } from 'react';
import type { UploadedImage } from '../editor/core/types';
import { cachedThumb, getThumb, pruneThumbs } from '../io/thumbs';
import './perf.css';

export function UploadThumb({
  u,
  onUse,
  onRemove,
  liveIds,
}: {
  u: UploadedImage;
  onUse: () => void;
  onRemove: () => void;
  liveIds: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | undefined>(() => cachedThumb(u.id));

  useEffect(() => {
    if (src) return;
    const el = ref.current;
    let alive = true;
    const load = () => {
      getThumb(u).then((url) => alive && setSrc(url));
      // Limpieza de miniaturas huérfanas: una vez por sesión, cuando ya hay galería.
      void pruneThumbs(liveIds);
    };
    if (!el || typeof IntersectionObserver === 'undefined') {
      load();
      return () => {
        alive = false;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u.id, src]);

  return (
    <div
      ref={ref}
      className="upload-thumb"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/x-chamva-upload', u.id)}
      onClick={onUse}
      title="Clic o arrastra al lienzo"
    >
      {src ? <img src={src} alt={u.name} decoding="async" draggable={false} /> : <span className="thumb-wait" />}
      <button
        className="upload-del"
        title="Quitar de la galería"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ✕
      </button>
    </div>
  );
}
