import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useEditor } from '../editor/state/store';
import { useSaveStatus } from '../io/saveStatus';
import { canAddTab, moveTabBy, neighborTab, tabLabel } from '../editor/state/tabsNav';
import { MAX_TABS } from '../editor/state/sessions';
import { getShortcut } from '../editor/core/shortcuts';
import { t } from '../i18n';
import './tabs.css';

interface Props {
  onNew: () => void;
  onClose: (id: string) => void;
}

/**
 * Tira de pestañas de documentos (una por sesión), sobre la barra superior.
 * Arrastrar reordena; Alt+←/→ también; clic central o ✕ cierra; Ctrl+T/Ctrl+W (o Alt+T/Alt+W).
 * Con una sola pestaña queda baja y discreta.
 */
export function TabStrip({ onNew, onClose }: Props) {
  const tabs = useEditor((s) => s.tabs);
  const activeId = useEditor((s) => s.activeTabId);
  const liveName = useEditor((s) => s.designName);
  const liveFirst = useEditor((s) => s.pages[0]?.name);
  const livePage = useEditor((s) => s.doc.name);
  const pageIndex = useEditor((s) => s.pageIndex);
  const switchTab = useEditor((s) => s.switchTab);
  const reorderTabs = useEditor((s) => s.reorderTabs);
  const save = useSaveStatus();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  // Las aparcadas solo cambian al cambiar de pestaña (lo que ya re-renderiza la tira).
  const parked = useEditor.getState().parked;
  const full = !canAddTab(tabs.length);
  const single = tabs.length === 1;

  const labelOf = (id: string) => {
    if (id === activeId) return tabLabel(liveName, pageIndex === 0 ? livePage : liveFirst);
    const p = parked[id];
    return tabLabel(p?.designName, p?.pages[0]?.name);
  };

  const focusTab = (id: string | null) => {
    if (!id) return;
    switchTab(id);
    requestAnimationFrame(() => refs.current[id]?.focus());
  };

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (e.altKey) {
        const mv = moveTabBy(tabs, id, dir);
        if (mv) {
          reorderTabs(mv.from, mv.to);
          requestAnimationFrame(() => refs.current[id]?.focus());
        }
      } else focusTab(neighborTab(tabs, id, dir));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusTab(e.key === 'Home' ? tabs[0].id : tabs[tabs.length - 1].id);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      onClose(id);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchTab(id);
    }
  };

  const onDrop = (e: DragEvent, id: string) => {
    e.preventDefault();
    const from = tabs.findIndex((x) => x.id === dragId);
    const to = tabs.findIndex((x) => x.id === id);
    if (from >= 0 && to >= 0) reorderTabs(from, to);
    setDragId(null);
    setOverId(null);
  };

  const newTip = full
    ? t('Máximo {n} pestañas abiertas. Cierra alguna para abrir otra.').replace('{n}', String(MAX_TABS))
    : `${t('Nueva pestaña')} (${getShortcut('newTab') || 'Alt+T'})`;

  return (
    <div className={`tabstrip${single ? ' single' : ''}`}>
      <div className="tabstrip-list" role="tablist" aria-label={t('Diseños abiertos')}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const name = labelOf(tab.id);
          const mark = active
            ? save.state === 'error'
              ? 'error'
              : save.state === 'pending' || save.state === 'saving'
                ? 'busy'
                : ''
            : tab.save === 'error'
              ? 'error'
              : tab.save === 'pending'
                ? 'busy'
                : '';
          const markText = mark === 'error' ? t('sin guardar') : mark === 'busy' ? t('guardando') : '';
          return (
            <div
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`tabstrip-tab${active ? ' active' : ''}${dragId === tab.id ? ' dragging' : ''}${overId === tab.id && dragId !== tab.id ? ' over' : ''}`}
              title={`${name}${markText ? ` (${markText})` : ''} — ${t('clic central o ✕ para cerrar; arrastra o Alt+←/→ para reordenar')}`}
              draggable={!single}
              onClick={() => switchTab(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault(); // sin el autodesplazamiento del botón central
              }}
              onKeyDown={(e) => onKey(e, tab.id)}
              onDragStart={(e) => {
                setDragId(tab.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.id);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overId !== tab.id) setOverId(tab.id);
              }}
              onDrop={(e) => onDrop(e, tab.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              {mark && (
                <span className={`tabstrip-mark ${mark}`} role="img" aria-label={markText}>
                  ●
                </span>
              )}
              <span className="tabstrip-name">{name}</span>
              <button
                type="button"
                className="tabstrip-x"
                tabIndex={-1}
                aria-label={`${t('Cerrar')} ${name}`}
                title={`${t('Cerrar pestaña')} (${getShortcut('closeTab') || 'Alt+W'})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="tabstrip-new"
        onClick={onNew}
        disabled={full}
        aria-label={t('Nueva pestaña')}
        title={newTip}
      >
        +
      </button>
    </div>
  );
}
