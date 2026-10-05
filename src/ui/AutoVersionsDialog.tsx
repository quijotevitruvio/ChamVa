import { useEffect, useState, useRef } from 'react';
import { useEditor } from '../editor/state/store';
import type { Snapshot } from '../io/snapshots';
import { snapshotPages } from '../io/snapshots';
import { clearAutoVersions, deleteAutoVersion, listAutoVersions, KEEP_DAYS, KEEP_RECENT } from '../io/autoVersions';
import { toast } from './toast';
import { t } from '../i18n';
import './library.css';
import './backup.css';
import { useDismiss } from './useDismiss';

interface Props {
  onClose: () => void;
}

// Versiones automáticas del diseño actual (cada ~10 min mientras se edita):
// restaurar (Ctrl+Z lo deshace) o borrar. Las versiones con nombre van aparte.
export function AutoVersionsDialog({ onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose: onClose });
  const restorePages = useEditor((s) => s.restorePages);
  const designId = useEditor((s) => s.designId);
  const [list, setList] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    listAutoVersions(designId).then(setList);
  }, [designId]);

  const restore = async (s: Snapshot) => {
    setBusy(true);
    try {
      restorePages(await snapshotPages(s), s.pageIndex);
      toast(`${t('Versión restaurada')}: ${new Date(s.ts).toLocaleString()}. Ctrl+Z la deshace.`, 'success');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card lib-dialog" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>{t('Versiones automáticas')}</h3>
        <p className="bk-note">
          {t('ChamVa guarda una copia de este diseño cada 10 min mientras lo editas: las últimas')} {KEEP_RECENT}{' '}
          {t('y una por día de los últimos')} {KEEP_DAYS}. {t('Aparte de las versiones con nombre.')}
        </p>
        {list.length === 0 ? (
          <p className="lib-hint">{t('Aún no hay versiones automáticas de este diseño.')}</p>
        ) : (
          <ul className="lib-snap-list">
            {list.map((s) => (
              <li key={s.id}>
                {s.thumb && <img src={s.thumb} alt="" />}
                <span className="grow">
                  <b>{new Date(s.ts).toLocaleString()}</b>
                  <small>
                    {s.pages.length} {t('página(s)')}
                  </small>
                </span>
                <button className="lib-btn" disabled={busy} onClick={() => restore(s)}>
                  {t('Restaurar')}
                </button>
                <button
                  className="lib-mini"
                  title={t('Borrar')}
                  onClick={async () => setList(await deleteAutoVersion(designId, s.id))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.length > 0 && (
          <div className="lib-actions">
            {confirmAll ? (
              <>
                <button
                  className="lib-btn danger"
                  onClick={async () => {
                    await clearAutoVersions(designId);
                    setList([]);
                    setConfirmAll(false);
                  }}
                >
                  {t('Sí, borrar todas')}
                </button>
                <button className="lib-btn" onClick={() => setConfirmAll(false)}>
                  {t('No')}
                </button>
              </>
            ) : (
              <button className="lib-btn" onClick={() => setConfirmAll(true)}>
                {t('Borrar todas')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
