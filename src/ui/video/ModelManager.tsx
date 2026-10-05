// Gestión de los modelos de transcripción descargados (V5b), dentro de ⚙ Ajustes del editor de video:
// qué hay, cuánto ocupa y borrar (cada borrado se confirma). Nunca descarga nada: eso solo se hace desde
// «Subtítulos automáticos», con el permiso y el tamaño a la vista.
import { useMemo, useState } from 'react';
import { MODEL_LABELS, WHISPER_MODELS, browserStorageEnv, deleteModel, formatBytes, modelStatus, type AsrDevice, type WhisperSize } from '../../ai/transcribe';
import { toast } from '../toast';
import { MATTE_MODEL, deleteMatteModel, matteModelStatus, type MatteModelStatus } from '../../video/ai/models';

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
  const [matte, setMatte] = useState<MatteModelStatus | null>(null);
  const [askMatte, setAskMatte] = useState(false);
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
    setMatte(await matteModelStatus(storage));
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

  const removeMatte = async () => {
    setBusy(true);
    try {
      const freed = matte?.bytesHave ?? 0;
      await deleteMatteModel(storage);
      toast(`Modelo de «Quitar fondo» borrado: ${formatBytes(freed)} liberados`, 'success');
      setAskMatte(false);
      await refresh();
    } catch (e) {
      toast('No se pudo borrar el modelo: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const matteHas = !!matte && (matte.installed || matte.bytesHave > 0);
  const used = (rows ?? []).reduce((n, r) => n + r.done.reduce((m, d) => m + d.bytes, 0) + r.partial, 0) + (matte?.bytesHave ?? 0);
  const has = (r: Row) => r.done.length > 0 || r.partial > 0;

  return (
    <details className="vx-models" onToggle={(e) => e.currentTarget.open && void refresh()}>
      <summary>Modelos descargados</summary>
      <div className="vx-models-body" aria-live="polite">
        {!rows && <p className="vx-note">Comprobando…</p>}
        {rows && !rows.some(has) && !matteHas && <p className="vx-note">No hay ningún modelo descargado. Se descargan (con tu permiso y mostrando el tamaño) desde Subtítulos → «Subtítulos automáticos» y desde el efecto «Quitar fondo».</p>}
        {matteHas && matte && (
          <div className="vx-models-row">
            <span>
              <b>Quitar fondo (video): {MATTE_MODEL.label}</b>
              <small>
                {matte.installed ? `descargado ${formatBytes(matte.bytesTotal)}` : `a medias ${formatBytes(matte.bytesHave)}`} · {MATTE_MODEL.license}
              </small>
            </span>
            {askMatte ? (
              <span className="vx-pop-row">
                <button type="button" className="mini" disabled={busy} onClick={() => void removeMatte()} aria-label="Confirmar: borrar el modelo de quitar fondo">Borrar</button>
                <button type="button" className="mini" disabled={busy} onClick={() => setAskMatte(false)}>No</button>
              </span>
            ) : (
              <button type="button" className="mini" onClick={() => setAskMatte(true)} aria-label="Borrar el modelo de quitar fondo" title="Libera el espacio; se podrá volver a descargar (te pediremos permiso)">🗑</button>
            )}
          </div>
        )}
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
        {rows && (rows.some(has) || matteHas) && <p className="vx-note">Ocupan {formatBytes(used)} en este equipo.</p>}
      </div>
    </details>
  );
}
