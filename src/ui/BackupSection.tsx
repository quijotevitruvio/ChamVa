import { useEffect, useRef, useState } from 'react';
import {
  BACKUP_EXT,
  applyBackup,
  backupFileName,
  buildBackup,
  getLastBackup,
  isReminderEnabled,
  markBackupDone,
  parseBackupText,
  setReminderEnabled,
  summarize,
  type BackupFile,
  type BackupSummary,
} from '../io/backup';
import { downloadBlob } from '../io/export';
import { toast } from './toast';
import { t } from '../i18n';
import './backup.css';

const MAX_FILE = 1_500_000_000; // 1,5 GB: más no se puede leer como texto

type Mode = 'merge' | 'replace';

const ROWS: [keyof BackupSummary, string][] = [
  ['designs', 'Diseños'],
  ['trashed', 'En la papelera'],
  ['folders', 'Carpetas'],
  ['templates', 'Plantillas'],
  ['uploads', 'Subidos'],
  ['brandKits', 'Kits de marca'],
  ['logos', 'Logos'],
  ['fonts', 'Fuentes propias'],
  ['snapshots', 'Versiones con nombre'],
  ['images', 'Imágenes'],
];

// Ajustes → «Copia de seguridad»: exportar toda la biblioteca a un archivo
// `.chamva-backup` e importarla (combinar o reemplazar) en este u otro equipo.
export function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<{ file: BackupFile; name: string; summary: BackupSummary } | null>(null);
  const [mode, setMode] = useState<Mode>('merge');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [remind, setRemind] = useState(isReminderEnabled());
  const [last, setLast] = useState(getLastBackup());

  useEffect(() => {
    setConfirmReplace(false);
  }, [mode, pending]);

  const doExport = async () => {
    setBusy(true);
    setErr('');
    setMsg(t('Preparando la copia…'));
    try {
      const { blob, summary } = await buildBackup();
      await downloadBlob(blob, backupFileName());
      markBackupDone();
      setLast(getLastBackup());
      setMsg(`${t('Copia exportada')}: ${summary.designs} ${t('diseños')}, ${summary.images} ${t('imágenes')}.`);
    } catch (e) {
      setMsg('');
      setErr(`${t('No se pudo crear la copia')}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setMsg('');
    setPending(null);
    if (f.size > MAX_FILE) {
      setErr(t('El archivo es demasiado grande para importarlo.'));
      return;
    }
    setBusy(true);
    try {
      const r = parseBackupText(await f.text());
      if (!r.ok) setErr(r.error);
      else {
        setPending({ file: r.file, name: f.name, summary: summarize(r.file) });
        setMode('merge');
      }
    } catch {
      setErr(t('No se pudo leer el archivo.'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doImport = async () => {
    if (!pending) return;
    setBusy(true);
    setErr('');
    try {
      const r = await applyBackup(pending.file, mode);
      const s = r.stats;
      const extra = s
        ? ` (${s.designsAdded} ${t('diseños nuevos')}${s.designsSkippedLimit ? `, ${s.designsSkippedLimit} ${t('omitidos por el límite de diseños')}` : ''})`
        : '';
      const done = `${t('Copia importada')}${extra}. ${t('Recargando…')}`;
      toast(done, 'success');
      setMsg(done);
      setPending(null);
      // La memoria del editor (subidos, plantillas, kits) debe releerse de la copia.
      setTimeout(() => location.reload(), 1400);
    } catch (e) {
      setErr(`${t('No se pudo importar')}: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <span className="settings-label">{t('Copia de seguridad')}</span>
      <div className="bk-box">
        <p className="bk-note">
          {t('Guarda en un solo archivo todos tus diseños (con sus imágenes), carpetas, etiquetas, plantillas, kit de marca, fuentes propias, subidos y preferencias. Sin internet.')}
        </p>
        <div className="bk-actions">
          <button className="bk-btn primary" disabled={busy} onClick={doExport}>
            ⬇ {t('Exportar todo')}
          </button>
          <button className="bk-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            ⬆ {t('Importar copia…')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={`${BACKUP_EXT},.json,application/json`}
            hidden
            onChange={(e) => onPick(e.target.files?.[0])}
          />
        </div>
        <p className="bk-note">
          {last ? `${t('Última copia')}: ${new Date(last).toLocaleDateString()}` : t('Aún no has exportado ninguna copia.')}
        </p>
        <label className="bk-check">
          <input
            type="checkbox"
            checked={remind}
            onChange={(e) => {
              setRemind(e.target.checked);
              setReminderEnabled(e.target.checked);
            }}
          />
          {t('Recordarme cada 30 días')}
        </label>
        {msg && <p className="bk-note">{msg}</p>}
        {err && <p className="bk-note err">{err}</p>}

        {pending && (
          <div className="bk-preview">
            <b>
              {pending.name} · {new Date(pending.summary.createdAt).toLocaleString()}
            </b>
            <ul className="bk-list">
              {ROWS.filter(([k]) => pending.summary[k] > 0).map(([k, label]) => (
                <li key={k}>
                  <span>{t(label)}</span>
                  <span>{pending.summary[k]}</span>
                </li>
              ))}
            </ul>
            <div className="bk-radio">
              <label>
                <input type="radio" name="bk-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                <span>
                  {t('Combinar')}
                  <small>{t('Añade lo que falta y no pisa nada de lo que ya tienes.')}</small>
                </span>
              </label>
              <label>
                <input type="radio" name="bk-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <span>
                  {t('Reemplazar')}
                  <small>{t('Sustituye toda tu biblioteca, fuentes y preferencias por las de la copia.')}</small>
                </span>
              </label>
            </div>
            {mode === 'replace' && confirmReplace ? (
              <div className="bk-confirm">
                <p>
                  {t('Se borrará lo que no esté en la copia (diseños, plantillas, kits, fuentes). Exporta antes una copia si no quieres perderlo. ¿Seguro?')}
                </p>
                <div className="bk-actions">
                  <button className="bk-btn danger" disabled={busy} onClick={doImport}>
                    {t('Sí, reemplazar todo')}
                  </button>
                  <button className="bk-btn" onClick={() => setConfirmReplace(false)}>
                    {t('Cancelar')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bk-actions">
                <button
                  className={mode === 'replace' ? 'bk-btn danger' : 'bk-btn primary'}
                  disabled={busy}
                  onClick={() => (mode === 'replace' ? setConfirmReplace(true) : doImport())}
                >
                  {mode === 'replace' ? t('Reemplazar…') : t('Combinar')}
                </button>
                <button className="bk-btn" disabled={busy} onClick={() => setPending(null)}>
                  {t('Cancelar')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
