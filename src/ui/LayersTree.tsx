import { useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { useEditor } from '../editor/state/store';
import type { Doc, Layer } from '../editor/core/types';
import {
  addFolder,
  buildTree,
  deleteFolder,
  dropLayerOnLayer,
  filterLayers,
  folderHidden,
  folderLocked,
  getFolders,
  isFilterActive,
  layerLabel,
  moveFolder,
  moveLayersToFolder,
  moveToNewFolder,
  renameFolder,
  setFolderFlag,
  toggleFolderCollapsed,
  flattenTree,
  type LayerKindFilter,
} from '../editor/core/folders';
import { t } from '../i18n';
import './organize.css';

// Panel «Capas»: árbol con carpetas anidadas, búsqueda y filtros.
// Las carpetas solo organizan: el orden de dibujo sigue siendo el de doc.layers
// (ver core/folders.ts). Arrastrar una capa sobre otra la reordena (como siempre)
// y la mete en la carpeta de destino; arrastrarla sobre una carpeta la mete dentro.

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `f-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const KIND_CHIPS: { id: LayerKindFilter; label: string }[] = [
  { id: 'text', label: 'Texto' },
  { id: 'image', label: 'Imagen' },
  { id: 'shape', label: 'Forma' },
  { id: 'hidden', label: 'Ocultas' },
  { id: 'locked', label: 'Bloqueadas' },
];

const ico = (l: Layer) => (l.type === 'image' ? '🖼' : l.type === 'text' ? '🅣' : l.type === 'stroke' ? '✎' : '◻');
const edit = (fn: (d: Doc) => Doc) => useEditor.getState().editDoc(fn);

type Drag = { kind: 'layer' | 'folder'; id: string };

export function LayersTree() {
  const doc = useEditor((s) => s.doc);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedId = useEditor((s) => s.selectedId);
  const clickSelect = useEditor((s) => s.clickSelect);
  const updateLayer = useEditor((s) => s.updateLayer);

  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<LayerKindFilter[]>([]);
  const [folderFilter, setFolderFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);

  const folders = getFolders(doc);
  const filter = { query, kinds, folderId: folderFilter || undefined };
  const filtering = isFilterActive(filter);
  const rows = useMemo(() => flattenTree(buildTree(doc)), [doc]);
  const results = useMemo(() => (filtering ? filterLayers(doc, filter) : []), [doc, filtering, query, kinds, folderFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = useMemo(() => new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []), [selectedIds, selectedId]);
  const folderName = (id?: string) => folders.find((f) => f.id === id)?.name;

  const pick = (e: MouseEvent, id: string) => clickSelect(id, e.shiftKey || e.ctrlKey || e.metaKey);
  const toggleKind = (k: LayerKindFilter) => setKinds((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]));

  const startRename = (id: string, name: string) => {
    setRenaming(id);
    setDraft(name);
  };
  const finishRename = () => {
    if (renaming) edit((d) => renameFolder(d, renaming, draft));
    setRenaming(null);
  };

  const newFolder = () => {
    const id = uid();
    edit((d) => addFolder(d, id, `${t('Carpeta')} ${getFolders(d).length + 1}`));
    startRename(id, `${t('Carpeta')} ${folders.length + 1}`);
  };
  const folderFromSelection = () => {
    const ids = [...sel];
    if (!ids.length) return;
    const id = uid();
    const name = `${t('Carpeta')} ${folders.length + 1}`;
    edit((d) => moveToNewFolder(d, ids, id, name));
    startRename(id, name);
  };

  // --- arrastrar y soltar ---
  const onDragStart = (e: DragEvent, d: Drag) => {
    drag.current = d;
    setDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', d.id);
    } catch {
      /* algunos navegadores lo exigen; no es crítico */
    }
  };
  const onDragEnd = () => {
    drag.current = null;
    setDragging(false);
    setOver(null);
  };
  const dropOnLayer = (targetId: string) => {
    const d = drag.current;
    onDragEnd();
    if (!d || d.kind !== 'layer') return;
    edit((doc2) => dropLayerOnLayer(doc2, d.id, targetId));
  };
  const dropOnFolder = (folderId: string | undefined) => {
    const d = drag.current;
    onDragEnd();
    if (!d) return;
    if (d.kind === 'folder') {
      if (d.id !== folderId) edit((doc2) => moveFolder(doc2, d.id, folderId));
      return;
    }
    // Si la capa arrastrada forma parte de la selección, se mueve toda la selección.
    const ids = sel.has(d.id) && sel.size > 1 ? [...sel] : [d.id];
    edit((doc2) => moveLayersToFolder(doc2, ids, folderId));
  };
  const allow = (e: DragEvent, key: string) => {
    e.preventDefault();
    if (over !== key) setOver(key);
  };

  const eyeLock = (hidden: boolean, locked: boolean, onEye: () => void, onLock: () => void) => (
    <>
      <button
        className="mini"
        title={locked ? 'Desbloquear' : 'Bloquear'}
        onClick={(e) => {
          e.stopPropagation();
          onLock();
        }}
      >
        {locked ? '🔒' : '🔓'}
      </button>
      <button
        className="mini"
        title={hidden ? 'Mostrar' : 'Ocultar'}
        onClick={(e) => {
          e.stopPropagation();
          onEye();
        }}
      >
        {hidden ? '🚫' : '👁'}
      </button>
    </>
  );

  return (
    <div className="lt">
      <div className="lt-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Buscar capa por nombre o texto…')}
          aria-label={t('Buscar capa')}
        />
        <div className="lt-chips">
          {KIND_CHIPS.map((c) => (
            <button key={c.id} className={`lt-chip${kinds.includes(c.id) ? ' on' : ''}`} onClick={() => toggleKind(c.id)}>
              {t(c.label)}
            </button>
          ))}
        </div>
        {folders.length > 0 && (
          <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)} aria-label={t('Filtrar por carpeta')}>
            <option value="">{t('Todas las carpetas')}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtering ? (
        <>
          <div className="lt-bar">
            <span className="lt-count">
              {results.length} {results.length === 1 ? t('resultado') : t('resultados')}
            </span>
            {results.length > 1 && (
              <button
                className="lt-btn"
                onClick={() =>
                  useEditor.setState({ selectedIds: results.map((l) => l.id), selectedId: results[0].id, textSel: null })
                }
              >
                {t('Seleccionar todos')}
              </button>
            )}
            <button
              className="lt-btn"
              onClick={() => {
                setQuery('');
                setKinds([]);
                setFolderFilter('');
              }}
            >
              {t('Limpiar')}
            </button>
          </div>
          {results.length === 0 && <p className="rail-hint">{t('Ninguna capa coincide.')}</p>}
          <ul className="layers lt-list">
            {results.map((l) => (
              <li key={l.id} className={sel.has(l.id) ? 'sel' : ''} onClick={(e) => pick(e, l.id)}>
                <span className="ico">{ico(l)}</span>
                <span className="name">{layerLabel(l)}</span>
                {l.folderId && <span className="lt-in">{folderName(l.folderId)}</span>}
                {eyeLock(!l.visible, l.locked, () => updateLayer(l.id, { visible: !l.visible }), () => updateLayer(l.id, { locked: !l.locked }))}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="lt-bar">
            <button className="lt-btn" onClick={newFolder} title={t('Crear una carpeta vacía')}>
              ＋ {t('Carpeta')}
            </button>
            <button
              className="lt-btn"
              disabled={sel.size === 0}
              onClick={folderFromSelection}
              title={t('Mete las capas seleccionadas en una carpeta nueva')}
            >
              {t('Mover a carpeta nueva')}
            </button>
          </div>
          {doc.layers.length === 0 && folders.length === 0 && <p className="rail-hint">{t('Aún no hay capas.')}</p>}
          <ul className="layers lt-list">
            {rows.map((n) => {
              const pad = { paddingLeft: 10 + n.depth * 14 };
              if (n.kind === 'folder') {
                const f = n.folder;
                const hidden = folderHidden(folders, f.id);
                const locked = folderLocked(folders, f.id);
                return (
                  <li
                    key={'f' + f.id}
                    className={`lt-folder${over === 'f' + f.id ? ' drop' : ''}${hidden ? ' lt-dim' : ''}`}
                    style={pad}
                    draggable={renaming !== f.id}
                    onDragStart={(e) => onDragStart(e, { kind: 'folder', id: f.id })}
                    onDragEnd={onDragEnd}
                    onDragOver={(e) => allow(e, 'f' + f.id)}
                    onDragLeave={() => setOver(null)}
                    onDrop={() => dropOnFolder(f.id)}
                    onClick={() => edit((d) => toggleFolderCollapsed(d, f.id))}
                  >
                    <span className="lt-caret">{f.collapsed ? '▸' : '▾'}</span>
                    <span className="ico">📁</span>
                    {renaming === f.id ? (
                      <input
                        className="lt-rename"
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={finishRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') finishRename();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : (
                      <span
                        className="name"
                        title={t('Doble clic para renombrar')}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startRename(f.id, f.name);
                        }}
                      >
                        {f.name}
                      </span>
                    )}
                    <span className="lt-in">{n.children.length}</span>
                    {eyeLock(
                      hidden,
                      locked,
                      () => edit((d) => setFolderFlag(d, f.id, 'visible', hidden)),
                      () => edit((d) => setFolderFlag(d, f.id, 'locked', !locked)),
                    )}
                    <button
                      className="mini"
                      title={t('Borrar carpeta (las capas se conservan)')}
                      onClick={(e) => {
                        e.stopPropagation();
                        edit((d) => deleteFolder(d, f.id));
                      }}
                    >
                      ✕
                    </button>
                  </li>
                );
              }
              const l = n.layer;
              return (
                <li
                  key={l.id}
                  className={`${sel.has(l.id) ? 'sel' : ''}${over === l.id ? ' drop' : ''}${!l.visible ? ' lt-dim' : ''}`}
                  style={pad}
                  draggable
                  onDragStart={(e) => onDragStart(e, { kind: 'layer', id: l.id })}
                  onDragEnd={onDragEnd}
                  onDragOver={(e) => allow(e, l.id)}
                  onDragLeave={() => setOver(null)}
                  onDrop={() => dropOnLayer(l.id)}
                  onClick={(e) => pick(e, l.id)}
                >
                  <span className="grip" title="Arrastra para reordenar o meter en una carpeta">
                    ⠿
                  </span>
                  <span className="ico">{ico(l)}</span>
                  <span className="name">{layerLabel(l)}</span>
                  {eyeLock(!l.visible, l.locked, () => updateLayer(l.id, { visible: !l.visible }), () => updateLayer(l.id, { locked: !l.locked }))}
                </li>
              );
            })}
            {dragging && folders.length > 0 && (
              <li
                className={`lt-root${over === 'root' ? ' drop' : ''}`}
                onDragOver={(e) => allow(e, 'root')}
                onDragLeave={() => setOver(null)}
                onDrop={() => dropOnFolder(undefined)}
              >
                {t('Soltar aquí para sacar de la carpeta')}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
