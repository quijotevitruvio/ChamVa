import { useEffect, useMemo, useState } from 'react';
import {
  type SavedDesign,
  addFolder,
  deleteFolder,
  emptyTrash,
  loadFolders,
  moveDesignToFolder,
  removeDesign,
  renameFolder,
  restoreDesign,
  setDesignTags,
  trashDesign,
} from '../io/designs';
import {
  type LibraryView,
  allTags,
  cleanFolderName,
  filterDesigns,
  isTrashed,
  mergeFolders,
  trashDaysLeft,
  TRASH_DAYS,
} from '../editor/core/libraryMeta';
import { projectSummary } from '../editor/core/projectsList';
import { t } from '../i18n';
import './library.css';

interface Props {
  designs: SavedDesign[];
  onChange: (list: SavedDesign[]) => void;
  onOpen: (d: SavedDesign) => void;
  // Solo el riel Proyectos: marca el diseño abierto y muestra páginas y fecha en cada tarjeta.
  currentId?: string;
}

// Biblioteca de la pantalla de inicio: pestañas «Todos» / carpetas / «Papelera»,
// búsqueda por texto, filtro por etiqueta y gestión (mover, etiquetar, papelera).
export function DesignFolders({ designs, onChange, onOpen, currentId }: Props) {
  const [savedFolders, setSavedFolders] = useState<string[]>([]);
  const [view, setView] = useState<LibraryView>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [detail, setDetail] = useState<SavedDesign | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null); // null = campo oculto
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'empty' | 'delfolder' | { forever: string } | null>(null);

  useEffect(() => {
    loadFolders().then(setSavedFolders);
  }, []);

  const folders = useMemo(() => mergeFolders(savedFolders, designs), [savedFolders, designs]);
  const tags = useMemo(() => allTags(designs), [designs]);
  const trashCount = designs.filter(isTrashed).length;
  const shown = filterDesigns(designs, view, query, tag);
  const countIn = (f: string) => designs.filter((d) => !isTrashed(d) && d.folder === f).length;
  const liveCount = designs.length - trashCount;

  // Si la carpeta abierta desaparece (borrada o renombrada), volver a «Todos».
  useEffect(() => {
    if (view.kind === 'folder' && !folders.includes(view.folder)) setView({ kind: 'all' });
  }, [folders, view]);

  const submitFolder = async () => {
    const name = cleanFolderName(newFolder ?? '');
    setNewFolder(null);
    if (!name) return;
    setSavedFolders(await addFolder(name));
    setView({ kind: 'folder', folder: name });
  };
  const submitRename = async (from: string, to: string) => {
    setRenaming(null);
    const r = await renameFolder(from, to);
    setSavedFolders(r.folders);
    onChange(r.designs);
    const clean = cleanFolderName(to);
    if (clean) setView({ kind: 'folder', folder: clean });
  };

  return (
    <div className="lib">
      <div className="lib-tabs">
        <button className={`lib-tab ${view.kind === 'all' ? 'on' : ''}`} onClick={() => setView({ kind: 'all' })}>
          {t('Todos')}
          <small>{liveCount}</small>
        </button>
        {folders.map((f) => (
          <button
            key={f}
            className={`lib-tab ${view.kind === 'folder' && view.folder === f ? 'on' : ''}`}
            onClick={() => setView({ kind: 'folder', folder: f })}
          >
            📁 {f}
            <small>{countIn(f)}</small>
          </button>
        ))}
        <button className="lib-tab add" onClick={() => setNewFolder('')} title={t('Crear carpeta')}>
          + {t('Carpeta')}
        </button>
        <button className={`lib-tab ${view.kind === 'trash' ? 'on' : ''}`} onClick={() => setView({ kind: 'trash' })}>
          🗑 {t('Papelera')}
          <small>{trashCount}</small>
        </button>
      </div>

      <div className="lib-bar">
        {newFolder !== null && (
          <>
            <input
              className="lib-input"
              autoFocus
              placeholder={t('Nombre de la carpeta')}
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitFolder();
                if (e.key === 'Escape') setNewFolder(null);
              }}
            />
            <button className="lib-btn" onClick={submitFolder}>
              {t('Crear')}
            </button>
            <button className="lib-btn" onClick={() => setNewFolder(null)}>
              {t('Cancelar')}
            </button>
          </>
        )}

        {newFolder === null && view.kind === 'folder' && renaming === null && confirm !== 'delfolder' && (
          <>
            <button className="lib-btn" onClick={() => setRenaming(view.folder)}>
              ✎ {t('Renombrar carpeta')}
            </button>
            <button className="lib-btn danger" onClick={() => setConfirm('delfolder')}>
              {t('Borrar carpeta')}
            </button>
          </>
        )}
        {renaming !== null && view.kind === 'folder' && (
          <RenameField
            initial={renaming}
            onOk={(to) => submitRename(view.folder, to)}
            onCancel={() => setRenaming(null)}
          />
        )}
        {confirm === 'delfolder' && view.kind === 'folder' && (
          <span className="lib-confirm">
            {t('Se borra la carpeta; sus diseños pasan a «Todos».')}
            <button
              className="lib-btn danger"
              onClick={async () => {
                const r = await deleteFolder(view.folder);
                setSavedFolders(r.folders);
                onChange(r.designs);
                setConfirm(null);
                setView({ kind: 'all' });
              }}
            >
              {t('Sí, borrar')}
            </button>
            <button className="lib-btn" onClick={() => setConfirm(null)}>
              {t('No')}
            </button>
          </span>
        )}

        {view.kind === 'trash' &&
          (confirm === 'empty' ? (
            <span className="lib-confirm">
              {t('Se borrarán para siempre {n} diseño(s). No se puede deshacer.').replace('{n}', String(trashCount))}
              <button
                className="lib-btn danger"
                onClick={async () => {
                  onChange(await emptyTrash());
                  setConfirm(null);
                }}
              >
                {t('Sí, vaciar')}
              </button>
              <button className="lib-btn" onClick={() => setConfirm(null)}>
                {t('No')}
              </button>
            </span>
          ) : (
            <button className="lib-btn danger" disabled={trashCount === 0} onClick={() => setConfirm('empty')}>
              {t('Vaciar papelera')}
            </button>
          ))}

        <input
          className="lib-input"
          type="search"
          placeholder={t('Buscar diseños…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 160 }}
        />
      </div>

      {tags.length > 0 && view.kind !== 'trash' && (
        <div className="lib-chips">
          {tags.map((tg) => (
            <button
              key={tg}
              className={`lib-chip ${tag?.toLowerCase() === tg.toLowerCase() ? 'on' : ''}`}
              onClick={() => setTag(tag?.toLowerCase() === tg.toLowerCase() ? null : tg)}
            >
              #{tg}
            </button>
          ))}
        </div>
      )}

      {view.kind === 'trash' && (
        <p className="lib-hint">
          {t('Los diseños de la papelera se borran solos a los {n} días.').replace('{n}', String(TRASH_DAYS))}
        </p>
      )}
      {shown.length === 0 && (
        <p className="lib-hint">
          {view.kind === 'trash'
            ? t('La papelera está vacía.')
            : query || tag
              ? t('Ningún diseño coincide.')
              : view.kind === 'folder'
                ? t('Carpeta vacía: mueve diseños aquí con el botón 📁 de cada diseño.')
                : t('Aún no hay diseños guardados.')}
        </p>
      )}

      <div className="lib-grid">
        {shown.map((d) => {
          const trashed = isTrashed(d);
          return (
            <div
              key={d.id}
              className={`lib-card${d.id === currentId ? ' current' : ''}`}
              onClick={() => !trashed && onOpen(d)}
              title={`${d.name} — ${new Date(d.updatedAt).toLocaleString()}`}
              style={trashed ? { cursor: 'default' } : undefined}
            >
              <img src={d.thumb} alt={d.name} />
              <span className="lib-card-name">{d.name}</span>
              {currentId !== undefined && !trashed && (
                <span className="lib-card-meta">
                  {d.id === currentId ? `${t('Abierto')} · ` : ''}
                  {projectSummary(d)}
                </span>
              )}
              <span className="lib-card-meta">
                {trashed
                  ? t('Quedan {n} días').replace('{n}', String(trashDaysLeft(d)))
                  : [d.folder ? `📁 ${d.folder}` : '', ...(d.tags ?? []).map((x) => `#${x}`)].filter(Boolean).join(' ')}
              </span>
              <div className="lib-card-acts" onClick={(e) => e.stopPropagation()}>
                {trashed ? (
                  confirm && typeof confirm === 'object' && confirm.forever === d.id ? (
                    <>
                      <button
                        className="lib-mini"
                        title={t('Borrar para siempre')}
                        onClick={async () => {
                          onChange(await removeDesign(d.id));
                          setConfirm(null);
                        }}
                      >
                        ✓
                      </button>
                      <button className="lib-mini" onClick={() => setConfirm(null)}>
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="lib-mini"
                        title={t('Restaurar')}
                        onClick={async () => onChange(await restoreDesign(d.id))}
                      >
                        ↩
                      </button>
                      <button
                        className="lib-mini"
                        title={t('Borrar para siempre')}
                        onClick={() => setConfirm({ forever: d.id })}
                      >
                        ✕
                      </button>
                    </>
                  )
                ) : (
                  <>
                    <button className="lib-mini" title={t('Carpeta y etiquetas')} onClick={() => setDetail(d)}>
                      📁
                    </button>
                    <button
                      className="lib-mini"
                      title={t('Quitar de recientes (va a la papelera)')}
                      onClick={async () => onChange(await trashDesign(d.id))}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <DesignDetail
          design={detail}
          folders={folders}
          onClose={() => setDetail(null)}
          onSave={async (folder, tagText) => {
            await moveDesignToFolder(detail.id, folder || undefined);
            onChange(await setDesignTags(detail.id, tagText));
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}

function RenameField({ initial, onOk, onCancel }: { initial: string; onOk: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <input
        className="lib-input"
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOk(v);
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button className="lib-btn" onClick={() => onOk(v)}>
        {t('Guardar')}
      </button>
      <button className="lib-btn" onClick={onCancel}>
        {t('Cancelar')}
      </button>
    </>
  );
}

// Carpeta (existente o nueva) y etiquetas de un diseño.
function DesignDetail({
  design,
  folders,
  onClose,
  onSave,
}: {
  design: SavedDesign;
  folders: string[];
  onClose: () => void;
  onSave: (folder: string, tags: string) => void;
}) {
  const [folder, setFolder] = useState(design.folder ?? '');
  const [fresh, setFresh] = useState('');
  const [tagText, setTagText] = useState((design.tags ?? []).join(', '));
  const target = cleanFolderName(fresh) || folder;
  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card lib-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>{design.name}</h3>
        <div className="lib-row">
          <label>{t('Carpeta')}</label>
          <select className="lib-input" value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">{t('Sin carpeta')}</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div className="lib-row">
          <label>{t('Carpeta nueva')}</label>
          <input
            className="lib-input"
            placeholder={t('(opcional)')}
            value={fresh}
            onChange={(e) => setFresh(e.target.value)}
          />
        </div>
        <div className="lib-row">
          <label>{t('Etiquetas')}</label>
          <input
            className="lib-input"
            placeholder={t('boda, cliente, rosa')}
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
          />
        </div>
        <div className="lib-actions">
          <button className="lib-btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button
            className="lib-btn"
            onClick={async () => {
              // Una carpeta nueva se registra antes de asignarla.
              if (cleanFolderName(fresh)) await addFolder(fresh);
              onSave(target, tagText);
            }}
          >
            {t('Guardar')}
          </button>
        </div>
      </div>
    </div>
  );
}
