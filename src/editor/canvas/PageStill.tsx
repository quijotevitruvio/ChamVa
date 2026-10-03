import { useEffect, useRef } from 'react';
import type { Doc } from '../core/types';
import { renderDocToCanvas } from '../../io/export';
import { useEditor } from '../state/store';
import { masterRevision } from '../core/master';
import { pageBox, stillPixelScale } from './stackLayout';

// Imagen de solo lectura de una página inactiva del modo apilado. Solo se monta
// cuando la tarjeta está cerca de la pantalla y libera su canvas al desmontarse.
// Se rehace cuando cambia su firma o la escala (con 250 ms de retardo; mientras
// tanto el canvas anterior se estira por CSS).
export function PageStill({ doc, scale }: { doc: Doc; scale: number }) {
  const host = useRef<HTMLDivElement>(null);
  const mrev = useEditor((s) => {
    if (!doc.masterId) return 0;
    const m = s.doc.id === doc.masterId ? s.doc : s.pages.find((p) => p.id === doc.masterId);
    return m ? masterRevision(m) : 0;
  });
  const sig = `${doc.version}-${doc.layers.length}-${doc.width}x${doc.height}-${doc.background.type}-${mrev}`;
  const { w, h } = pageBox(doc, scale);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const px = stillPixelScale(doc, scale, window.devicePixelRatio || 1);
        const canvas = await renderDocToCanvas(doc, px);
        if (cancelled || !host.current) {
          canvas.width = canvas.height = 0;
          return;
        }
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        // Sustituye el canvas anterior (y lo libera).
        const old = Array.from(host.current.children) as HTMLCanvasElement[];
        host.current.appendChild(canvas);
        old.forEach((c) => {
          c.width = c.height = 0;
          c.remove();
        });
      } catch {
        /* una imagen que falla se queda en blanco */
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, Math.round(scale * 1000)]);

  // Al desmontar: libera la memoria del canvas.
  useEffect(() => {
    const el = host.current;
    return () => {
      if (!el) return;
      (Array.from(el.children) as HTMLCanvasElement[]).forEach((c) => {
        c.width = c.height = 0;
        c.remove();
      });
    };
  }, []);

  return <div ref={host} className="page-still" style={{ width: w, height: h }} />;
}
