import { useEffect, useState } from 'react';
import { useEditor } from '../editor/state/store';
import {
  MAX_SNAPSHOTS,
  type Snapshot,
  deleteSnapshot,
  listSnapshots,
  saveSnapshot,
  snapshotPages,
} from '../io/snapshots';
import { renderDocToCanvas } from '../io/export';
import { toast } from './toast';
import { t } from '../i18n';
import './library.css';

interface Props {
  onClose: () => void;
}

// Versiones con nombre del proyecto actual (todas las páginas): guardar,
// restaurar (Ctrl+Z lo deshace) y borrar. Máximo 20 por diseño.
export function SnapshotsDialog({ onClose }: Props) {
  const restorePages = useEditor((s) => s.restorePages);
  // El diseño se identifica por el id de su primera página, igual que la galería.
  const designId = useEditor((s) => (s.pageIndex === 0 ? s.doc.id : s.pages[0]?.id ?? s.doc.id));
  const [list, setList] = useState<Snapshot[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    listSnapshots(designId).then(setList);
  }, [designId]);

  const save = async () => {
    setBusy(true);
    try {
      const st = useEditor.getState();
      const pages = st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p));
      let thumb: string | undefined;
      try {
        const first = pages[0];
        const s = Math.min(1, 120 / Math.max(first.width, first.height));
        thumb = (await renderDocToCanvas(first, s, '#ffffff')).toDataURL('image/jpeg', 0.6);
      } catch {
        /* miniatura opcional */
      }
      const next = await saveSnapshot(designId, name || new Date().toLocaleString(), pages, st.pageIndex, thumb);
      setList(next);
      setName('');
      toast(t('Versión guardada'), 'success');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (s: Snapshot) => {
    setBusy(true);
    try {
      const pages = await snapshotPages(s);
      restorePages(pages, s.pageIndex);
      toast(`${t('Versión restaurada')}: ${s.name}. Ctrl+Z la deshace.`, 'success');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card lib-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>{t('Versiones del diseño')}</h3>
        <div className="lib-row">
          <input
            className="lib-input"
            placeholder={t('Nombre de la versión (p. ej. «Antes de cambiar colores»)')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && save()}
          />
          <button className="lib-btn" disabled={busy} onClick={save}>
            {t('Guardar versión')}
          </button>
        </div>
        <p className="lib-hint" style={{ textAlign: 'left' }}>
          {list.length}/{MAX_SNAPSHOTS} {t('versiones. Al llegar al límite se descarta la más antigua.')}
        </p>
        {list.length === 0 ? (
          <p className="lib-hint">{t('Aún no hay versiones de este diseño.')}</p>
        ) : (
          <ul className="lib-snap-list">
            {list.map((s) => (
              <li key={s.id}>
                {s.thumb && <img src={s.thumb} alt="" />}
                <span className="grow">
                  <b>{s.name}</b>
                  <small>
                    {new Date(s.ts).toLocaleString()} · {s.pages.length} {t('página(s)')}
                  </small>
                </span>
                <button className="lib-btn" disabled={busy} onClick={() => restore(s)}>
                  {t('Restaurar')}
                </button>
                {confirmDel === s.id ? (
                  <>
                    <button
                      className="lib-btn danger"
                      onClick={async () => {
                        setList(await deleteSnapshot(designId, s.id));
                        setConfirmDel(null);
                      }}
                    >
                      {t('Sí, borrar')}
                    </button>
                    <button className="lib-btn" onClick={() => setConfirmDel(null)}>
                      {t('No')}
                    </button>
                  </>
                ) : (
                  <button className="lib-mini" title={t('Borrar')} onClick={() => setConfirmDel(s.id)}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
