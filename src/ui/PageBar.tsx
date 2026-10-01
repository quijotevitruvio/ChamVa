import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { PageThumb } from './PageThumb';
import { t } from '../i18n';
import { LocalBadge } from './LocalBadge';
import { LayoutPopover } from './LayoutPopover';
import { SpeakerNotes } from './SpeakerNotes';
import { PageSorter } from './PageSorter';
import { setPageMaster, setPageMasterId } from './pageActions';
import './organize.css';
import { setMinimapOn, useMinimapOn } from './tabletMode';

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
  const showLayout = useEditor((s) => s.showLayout);
  const showNotes = useEditor((s) => s.showNotes);
  const toggleNotes = useEditor((s) => s.toggleNotes);
  const addNote = useEditor((s) => s.addNote);
  const minimapOn = useMinimapOn();
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [speakerOpen, setSpeakerOpen] = useState(false);
  const [sorterOpen, setSorterOpen] = useState(false);
  const [masterMenu, setMasterMenu] = useState(false);
  const masterBtn = useRef<HTMLButtonElement>(null);
  const masters = pages.map((p, i) => (i === pageIndex ? doc : p)).filter((p) => p.isMaster && p.id !== doc.id);
  const layoutBtn = useRef<HTMLButtonElement>(null);
  const hasAids = !!(doc.margins || doc.bleed || doc.columns);
  const noteCount = doc.notes?.length ?? 0;

  useEffect(() => {
    if (!viewMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.view-menu-wrap')) setViewMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setViewMenu(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [viewMenu]);

  return (
    <>
    {speakerOpen && <SpeakerNotes onClose={() => setSpeakerOpen(false)} />}
    {sorterOpen && <PageSorter onClose={() => setSorterOpen(false)} />}
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
          {(i === pageIndex ? doc : p).isMaster && <span className="page-master">{t('Maestra')}</span>}
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
      <button className="page-add" onClick={() => setSorterOpen(true)} title="Vista en cuadrícula de todas las páginas: reordenar, duplicar, borrar">
        ▦ {t('Clasificar')}
      </button>
      <span className="pm-wrap">
        <button
          ref={masterBtn}
          className="page-add"
          onClick={() => setMasterMenu((v) => !v)}
          title="Página maestra: sus capas (logo, pie, número…) se muestran detrás de otras páginas"
        >
          ◫ {t('Maestra')}
        </button>
        {masterMenu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={() => setMasterMenu(false)} />
            <div
              className="pm-menu"
              style={(() => {
                // Fijo y fuera del scroll de la barra (si no, se recortaría).
                const r = masterBtn.current?.getBoundingClientRect();
                return r ? { left: r.left, bottom: window.innerHeight - r.top + 6 } : undefined;
              })()}
            >
              <button
                onClick={() => {
                  setPageMaster(doc.id, !doc.isMaster);
                  setMasterMenu(false);
                }}
              >
                {doc.isMaster ? t('Quitar condición de maestra') : t('Hacer esta página maestra')}
              </button>
              {!doc.isMaster && (
                <>
                  <span className="pm-title">{t('Usar maestra…')}</span>
                  {masters.length === 0 && <span className="pm-title">{t('Aún no hay páginas maestras')}</span>}
                  {masters.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setPageMasterId(doc.id, m.id);
                        setMasterMenu(false);
                      }}
                    >
                      {doc.masterId === m.id ? '● ' : '○ '}
                      {m.name}
                    </button>
                  ))}
                  {doc.masterId && (
                    <button
                      onClick={() => {
                        setPageMasterId(doc.id, undefined);
                        setMasterMenu(false);
                      }}
                    >
                      {t('Sin maestra')}
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </span>

      <span className="spacer" />

      <LocalBadge />

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
        <span className="view-menu-wrap">
          <button
            ref={layoutBtn}
            data-lp-btn
            className={`view-toggle${viewMenu ? ' on' : ''}`}
            onClick={() => setViewMenu((v) => !v)}
            aria-expanded={viewMenu}
            aria-haspopup="menu"
            title="Guías, imán, maquetación, notas y minimapa"
          >
            {t('Vista')} ▾
          </button>
          {viewMenu && (
            <div className="view-menu" role="menu">
              <button role="menuitemcheckbox" aria-checked={showGuides} onClick={toggleGuides}>
                <i>{showGuides ? '✓' : ''}</i>
                {t('Guías')}
                <small>arrástralas desde las reglas</small>
              </button>
              <button role="menuitemcheckbox" aria-checked={snapToGrid} onClick={toggleSnapToGrid}>
                <i>{snapToGrid ? '✓' : ''}</i>
                {t('Imán')}
                <small>salta a la cuadrícula</small>
              </button>
              <button role="menuitemcheckbox" aria-checked={minimapOn} onClick={() => setMinimapOn(!minimapOn)}>
                <i>{minimapOn ? '✓' : ''}</i>
                {t('Minimapa')}
                <small>aparece al acercar</small>
              </button>
              <div className="view-menu-sep" />
              <button
                role="menuitem"
                onClick={() => {
                  setViewMenu(false);
                  setLayoutOpen(true);
                }}
              >
                <i>{hasAids && showLayout ? '✓' : ''}</i>
                {t('Maquetación')}…
                <small>márgenes, sangrado, columnas</small>
              </button>
              <div className="view-menu-sep" />
              <button role="menuitemcheckbox" aria-checked={showNotes} onClick={toggleNotes}>
                <i>{showNotes ? '✓' : ''}</i>
                {t('Notas')}
                <small>{noteCount ? `${noteCount} en esta página` : 'adhesivas, no se exportan'}</small>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  addNote();
                  setViewMenu(false);
                }}
              >
                <i>＋</i>
                {t('Nota')} nueva
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setSpeakerOpen((v) => !v);
                  setViewMenu(false);
                }}
              >
                <i>{speakerOpen ? '✓' : ''}</i>
                {t('Orador')}
                <small>notas de la presentación</small>
              </button>
            </div>
          )}
        </span>
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
    {layoutOpen && (
      <LayoutPopover onClose={() => setLayoutOpen(false)} anchor={layoutBtn.current?.getBoundingClientRect() ?? null} />
    )}
    </>
  );
}
