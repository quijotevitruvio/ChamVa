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
  const showRulers = useEditor((s) => s.showRulers);
  const showGrid = useEditor((s) => s.showGrid);
  const toggleRulers = useEditor((s) => s.toggleRulers);
  const toggleGrid = useEditor((s) => s.toggleGrid);
  const showGuides = useEditor((s) => s.showGuides);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const toggleGuides = useEditor((s) => s.toggleGuides);
  const toggleSnapToGrid = useEditor((s) => s.toggleSnapToGrid);
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

      <div className="view-toggles">
        <button
          className={`view-toggle${showRulers ? ' on' : ''}`}
          onClick={toggleRulers}
          aria-pressed={showRulers}
          title="Mostrar u ocultar las reglas (en píxeles)"
        >
          {t('Reglas')}
        </button>
        <button
          className={`view-toggle${showGrid ? ' on' : ''}`}
          onClick={toggleGrid}
          aria-pressed={showGrid}
          title="Mostrar u ocultar la cuadrícula"
        >
          {t('Cuadrícula')}
        </button>
        <button
          className={`view-toggle${showGuides ? ' on' : ''}`}
          onClick={toggleGuides}
          aria-pressed={showGuides}
          title="Mostrar u ocultar las guías (arrástralas desde las reglas)"
        >
          {t('Guías')}
        </button>
        <button
          className={`view-toggle${snapToGrid ? ' on' : ''}`}
          onClick={toggleSnapToGrid}
          aria-pressed={snapToGrid}
          title="Al mover una capa, su esquina superior izquierda salta a la cuadrícula"
        >
          {t('Imán')}
        </button>
      </div>

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
