// Cachés de IA del editor de video (V9b), dentro de ⚙ Ajustes: lo calculado de «Quitar fondo» y «Estabilizar», en memoria y
// (si se deja) guardado en este equipo para no recalcular al reabrir el proyecto. Con límite de espacio y el botón
// «Borrar cachés de IA». Nada sale del equipo.
import { useState } from 'react';
import { formatMem } from '../../video/ai/aiPlan';
import { matteCache } from '../../video/ai/cache';
import { aiPersist, clearAllAiCaches } from '../../video/ai/jobsDefault';
import { DEFAULT_BUDGET_MB, MAX_BUDGET_MB, MIN_BUDGET_MB, clampBudgetMB, loadSettings, saveSettings, type PersistSettings, type PersistStats } from '../../video/ai/persist';
import { toast } from '../toast';

export function AiCacheManager() {
  const [st, setSt] = useState<PersistStats | null>(null);
  const [cfg, setCfg] = useState<PersistSettings>(loadSettings);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = async () => setSt(await aiPersist.stats());
  const update = async (next: PersistSettings) => {
    saveSettings(next);
    setCfg(next);
    if (next.enabled) await aiPersist.enforceBudget();
    await refresh();
  };
  const clear = async () => {
    setBusy(true);
    try {
      await clearAllAiCaches();
      toast('Cachés de IA borradas: memoria y almacenamiento de este equipo', 'success');
      setAsk(false);
      await refresh();
    } catch (e) {
      toast('No se pudieron borrar las cachés: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="vx-models vx-aicache" onToggle={(e) => e.currentTarget.open && void refresh()}>
      <summary>Cachés de IA (quitar fondo y estabilizar)</summary>
      <div className="vx-models-body" aria-live="polite">
        <label className="vx-check" title="Guarda lo calculado en este equipo para que, al reabrir el proyecto, no haya que recalcular. Nada sale del equipo.">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => void update({ ...cfg, enabled: e.target.checked })} /> Guardar lo calculado en este equipo
        </label>
        <label className="vx-aibudget">
          Límite de espacio (MB)
          <input
            type="number"
            min={MIN_BUDGET_MB}
            max={MAX_BUDGET_MB}
            step={64}
            value={cfg.budgetMB}
            disabled={!cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, budgetMB: Number(e.target.value) })}
            onBlur={() => void update({ ...cfg, budgetMB: clampBudgetMB(cfg.budgetMB) })}
            aria-describedby="vx-aibudget-n"
          />
        </label>
        <p className="vx-note" id="vx-aibudget-n">
          Entre {MIN_BUDGET_MB} y {MAX_BUDGET_MB} MB (por defecto {DEFAULT_BUDGET_MB}). Al llenarse se sueltan primero las menos usadas.
        </p>
        <p className="vx-note">
          En memoria ahora: {formatMem(matteCache.bytes)}. Guardado en el equipo: {st ? `${formatMem(st.bytes)} en ${st.tracks} cálculo(s)` : 'comprobando…'}.
        </p>
        {st?.list.map((m) => (
          <div key={m.key} className="vx-models-row">
            <span>
              <b>{m.name}</b>
              <small>
                {m.kind === 'matte' ? `Quitar fondo (${m.key.split('|')[2] === 'fast' ? 'rápido' : 'calidad'})` : 'Estabilizar'} · {formatMem(m.bytes)} · {m.count} fotogramas
              </small>
            </span>
          </div>
        ))}
        {ask ? (
          <span className="vx-pop-row">
            <button type="button" className="mini" disabled={busy} onClick={() => void clear()}>Sí, borrar todo</button>
            <button type="button" className="mini" disabled={busy} onClick={() => setAsk(false)}>No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setAsk(true)} title="Borra las cachés de memoria y las guardadas en este equipo; los clips tendrán que volver a calcularse">
            🗑 Borrar cachés de IA
          </button>
        )}
      </div>
    </details>
  );
}
