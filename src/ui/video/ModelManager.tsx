// Gestión de los modelos de transcripción descargados (V5b), dentro de ⚙ Ajustes del editor de video:
// qué hay, cuánto ocupa y borrar (cada borrado se confirma). Nunca descarga nada: eso solo se hace desde
// «Subtítulos automáticos», con el permiso y el tamaño a la vista.
import { useMemo, useState } from 'react';
import { MODEL_LABELS, WHISPER_MODELS, browserStorageEnv, deleteModel, formatBytes, modelStatus, type AsrDevice, type WhisperSize } from '../../ai/transcribe';
import { toast } from '../toast';

interface Row {
  size: WhisperSize;
  /** variantes completas */
  done: { device: AsrDevice; bytes: number }[];
  /** bytes de descargas a medias */
  partial: number;
}

const DEVICES: AsrDevice[] = ['wasm', 'webgpu'];
const DEVICE_NAME: Record<AsrDevice, string> = { wasm: 'CPU', webgpu: 'GPU' };

export function ModelManager() {
  const storage = useMemo(() => browserStorageEnv(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ask, setAsk] = useState<WhisperSize | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const out: Row[] = [];
    for (const size of Object.keys(WHISPER_MODELS) as WhisperSize[]) {
      const row: Row = { size, done: [], partial: 0 };
      for (const device of DEVICES) {
        const st = await modelStatus(storage, size, device);
        if (st.installed) row.done.push({ device, bytes: st.bytesTotal });
        else row.partial = Math.max(row.partial, st.bytesHave);
      }
      out.push(row);
    }
    setRows(out);
  };

  const remove = async (size: WhisperSize) => {
    setBusy(true);
    try {
      const freed = await deleteModel(storage, size);
      toast(`Modelo «${size}» borrado: ${formatBytes(freed)} liberados`, 'success');
      setAsk(null);
      await refresh();
    } catch (e) {
      toast('No se pudo borrar el modelo: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const used = (rows ?? []).reduce((n, r) => n + r.done.reduce((m, d) => m + d.bytes, 0) + r.partial, 0);
  const has = (r: Row) => r.done.length > 0 || r.partial > 0;

  return (
    <details className="vx-models" onToggle={(e) => e.currentTarget.open && void refresh()}>
      <summary>Modelos de transcripción</summary>
      <div className="vx-models-body" aria-live="polite">
        {!rows && <p className="vx-note">Comprobando…</p>}
        {rows && !rows.some(has) && <p className="vx-note">No hay ningún modelo descargado. Se descargan (con tu permiso) desde la pestaña Subtítulos → «Subtítulos automáticos».</p>}
        {rows?.filter(has).map((r) => (
          <div key={r.size} className="vx-models-row">
            <span>
              <b>{MODEL_LABELS[r.size].label}</b>
              <small>
                {r.done.map((d) => `${DEVICE_NAME[d.device]} ${formatBytes(d.bytes)}`).join(' · ')}
                {r.partial > 0 ? `${r.done.length ? ' · ' : ''}a medias ${formatBytes(r.partial)}` : ''}
              </small>
            </span>
            {ask === r.size ? (
              <span className="vx-pop-row">
                <button type="button" className="mini" disabled={busy} onClick={() => void remove(r.size)} aria-label={`Confirmar: borrar el modelo ${r.size}`}>Borrar</button>
                <button type="button" className="mini" disabled={busy} onClick={() => setAsk(null)}>No</button>
              </span>
            ) : (
              <button type="button" className="mini" onClick={() => setAsk(r.size)} aria-label={`Borrar el modelo ${r.size}`} title="Libera el espacio; se podrá volver a descargar">🗑</button>
            )}
          </div>
        ))}
        {rows && rows.some(has) && <p className="vx-note">Ocupan {formatBytes(used)} en este equipo.</p>}
      </div>
    </details>
  );
}
