import { useState } from 'react';
import { useEditor } from '../editor/state/store';
import { PageThumb } from './PageThumb';
import { t } from '../i18n';

// Barra inferior: miniaturas de páginas, añadir/duplicar, zoom y ayuda.
export function PageBar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const doc = useEditor((s) => s.doc);
  const pages = useEditor((s) => s.pages);
  const pageIndex = useEditor((s) => s.pageIndex);
  const addPage = useEditor((s) => s.addPage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const switchPage = useEditor((s) => s.switchPage);
  const deletePage = useEditor((s) => s.deletePage);
  const reorderPages = useEditor((s) => s.reorderPages);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const viewScale = useEditor((s) => s.viewScale);
  const [dragPage, setDragPage] = useState<number | null>(null);

  return (
    <footer className="page-bar">
      {pages.map((p, i) => (
        <button
          key={p.id}
          className={`page-tab ${i === pageIndex ? 'sel' : ''} ${
            dragPage !== null && dragPage !== i ? 'drop-target' : ''
          }`}
          onClick={() => switchPage(i)}
          title={`Página ${i + 1} (arrastra para reordenar)`}
          draggable
          onDragStart={() => setDragPage(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragPage !== null) reorderPages(dragPage, i);
            setDragPage(null);
          }}
          onDragEnd={() => setDragPage(null)}
        >
          <PageThumb doc={i === pageIndex ? doc : p} />
          <span className="page-num">{i + 1}</span>
          {pages.length > 1 && (
            <span
              className="page-del"
              onClick={(e) => {
                e.stopPropagation();
                deletePage(i);
              }}
            >
              ✕
            </span>
          )}
        </button>
      ))}
      <button className="page-add" onClick={addPage}>
        + {t('Agregar página')}
      </button>
      <button className="page-add" onClick={duplicatePage} title="Duplica la página actual con todas sus capas">
        ⧉ {t('Duplicar página')}
      </button>

      <span className="spacer" />

      <div className="zoom-controls">
        <button onClick={() => setZoom(zoom * 0.9)} title="Alejar">
          −
        </button>
        <button className="zoom-pct" onClick={() => setZoom(1)} title="Ajustar">
          {Math.round(viewScale * 100)}%
        </button>
        <button onClick={() => setZoom(zoom * 1.1)} title="Acercar">
          ＋
        </button>
        <button onClick={onShowShortcuts} title="Atajos de teclado (?)">
          ?
        </button>
      </div>
    </footer>
  );
}
