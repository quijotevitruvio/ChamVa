import { useEffect, useState } from 'react';
import { useProcessing } from '../editor/core/processingStore';
import { cancelAllProcessing } from '../editor/core/pixelPool';
import { cancelExport } from '../io/runExport';
import './processing.css';

const SHOW_AFTER_MS = 500; // las operaciones cortas no parpadean

// «Procesando…» con barra de progreso por tramos y botón Cancelar, para operaciones largas
// (reducir ruido, neblina, exportar fotos grandes…). El trabajo corre en un worker: la
// interfaz sigue respondiendo; Cancelar termina el worker y descarta el resultado.
export function ProcessingIndicator() {
  const jobs = useProcessing((s) => s.jobs);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!jobs.length) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [jobs.length]);

  const now = Date.now();
  const visible = jobs.filter((j) => now - j.startedAt >= SHOW_AFTER_MS);
  if (!visible.length) return null;
  const job = visible[visible.length - 1];
  const pct = Math.round(job.progress * 100);
  return (
    <div className="proc-ind" role="status" aria-live="polite" data-testid="processing-indicator">
      <div className="proc-top">
        <span className="proc-spin" aria-hidden="true" />
        <span className="proc-label">
          Procesando… {job.label}
          {job.stage ? ` · ${job.stage}` : ''}
          {visible.length > 1 ? ` (+${visible.length - 1})` : ''}
        </span>
        <span className="proc-pct">{pct}%</span>
        <button
          type="button"
          className="proc-cancel"
          onClick={() => {
            if (visible.some((j) => j.priority >= 1)) cancelExport();
            cancelAllProcessing();
          }}
        >
          Cancelar
        </button>
      </div>
      <div className="proc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="proc-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
