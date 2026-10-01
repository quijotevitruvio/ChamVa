// Panel flotante «Exportaciones»: progreso y cancelación de la cola (io/exportQueue.ts),
// y en la app instalada el aviso «Abrir carpeta» tras guardar un archivo.
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { exportQueue } from '../io/exportQueue';
import { isTauri, onSaved, revealSaved } from '../io/nativeSave';
import './batchshare.css';

const STATUS_TEXT = { waiting: 'En espera', running: '', done: 'Listo', error: 'Error', cancelled: 'Cancelado' } as const;

export function ExportQueuePanel() {
  const jobs = useSyncExternalStore(exportQueue.subscribe, exportQueue.getSnapshot);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onSaved((p) => {
      setSaved(p);
      clearTimeout(timer);
      timer = setTimeout(() => setSaved(null), 9000);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  // Los terminados se quitan solos pasado un rato.
  const finished = jobs.filter((j) => j.status !== 'waiting' && j.status !== 'running').length;
  useEffect(() => {
    if (!finished || finished !== jobs.length) return;
    const id = setTimeout(() => exportQueue.clearFinished(), 6000);
    return () => clearTimeout(id);
  }, [finished, jobs.length]);

  if (!jobs.length && !saved) return null;
  const name = saved ? saved.replace(/^.*[\\/]/, '') : '';

  return (
    <div className="eq-panel" role="status" aria-live="polite">
      {jobs.length > 0 && (
        <div className="eq-head">
          <b>Exportaciones</b>
          {finished > 0 && (
            <button className="eq-x" onClick={() => exportQueue.clearFinished()} title="Quitar los terminados">
              ✕
            </button>
          )}
        </div>
      )}
      {jobs.map((j) => (
        <div key={j.id} className={`eq-job ${j.status}`}>
          <div className="eq-row">
            <span className="eq-label" title={j.error || j.label}>
              {j.label}
            </span>
            {(j.status === 'running' || j.status === 'waiting') && (
              <button className="eq-cancel" onClick={() => exportQueue.cancel(j.id)}>
                Cancelar
              </button>
            )}
            {STATUS_TEXT[j.status] && <span className="eq-state">{STATUS_TEXT[j.status]}</span>}
          </div>
          {j.status === 'running' && (
            <>
              <div className={`eq-bar${j.total ? '' : ' indet'}`}>
                <i style={j.total ? { width: `${Math.min(100, (100 * j.done) / j.total)}%` } : undefined} />
              </div>
              {(j.total > 0 || j.detail) && (
                <div className="eq-detail">
                  {j.total > 0 ? `${j.done}/${j.total}` : ''} {j.detail ?? ''}
                </div>
              )}
            </>
          )}
          {j.status === 'error' && j.error && <div className="eq-detail">{j.error}</div>}
        </div>
      ))}
      {saved && (
        <div className="eq-job saved">
          <div className="eq-row">
            <span className="eq-label" title={saved}>
              Guardado: {name}
            </span>
            <button
              className="eq-cancel"
              onClick={() => {
                revealSaved(saved).catch(() => {});
                setSaved(null);
              }}
            >
              Abrir carpeta
            </button>
            <button className="eq-x" onClick={() => setSaved(null)} aria-label="Cerrar">
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Anfitrión: se monta una vez en App. Muestra la cola y abre el diálogo «Lote y compartir»
// cuando alguien lanza `openBatchShare()` (botón del menú Descargar, paleta Ctrl+K…).
const BatchShareDialog = lazy(() => import('./BatchShareDialog').then((m) => ({ default: m.BatchShareDialog })));
const OPEN_EVENT = 'chamva:batchshare';

export function openBatchShare() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function BatchShareHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  return (
    <>
      <ExportQueuePanel />
      {open && (
        <Suspense fallback={null}>
          <BatchShareDialog onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
