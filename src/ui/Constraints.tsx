import { useEditor } from '../editor/state/store';
import type { ConstraintH, ConstraintV, Layer, LayerConstraints } from '../editor/core/types';
import { H_OPTIONS, V_OPTIONS } from '../editor/core/constraints';
import { t } from '../i18n';
import './organize.css';

const COLS: ConstraintH[] = ['left', 'center', 'right'];
const ROWS: ConstraintV[] = ['top', 'center', 'bottom'];

// «Restricciones»: cómo se recoloca la capa al cambiar el tamaño del lienzo
// (Tamaño → Aplicar, o Magic Resize). Sin restricciones, escala proporcionalmente como siempre.
export function Constraints({ layer }: { layer: Layer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const c = layer.constraints;
  const set = (patch: Partial<LayerConstraints>) =>
    updateLayer(layer.id, { constraints: { h: c?.h ?? 'left', v: c?.v ?? 'top', ...patch } });

  return (
    <div className="more-group">
      <span className="more-title">{t('Restricciones al redimensionar')}</span>
      <div className="cn-row">
        <div className="cn-grid" role="group" aria-label={t('Anclaje de la capa')}>
          {ROWS.map((v) =>
            COLS.map((h) => (
              <button
                key={`${h}-${v}`}
                className={c && c.h === h && c.v === v ? 'on' : ''}
                title={`${H_OPTIONS.find((o) => o.id === h)!.label} · ${V_OPTIONS.find((o) => o.id === v)!.label}`}
                onClick={() => set({ h, v })}
              />
            )),
          )}
        </div>
        <div className="cn-side">
          <select value={c?.h ?? ''} onChange={(e) => e.target.value && set({ h: e.target.value as ConstraintH })} aria-label={t('Horizontal')}>
            <option value="" disabled>
              {t('Horizontal')}…
            </option>
            {H_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {t('Horizontal')}: {o.label}
              </option>
            ))}
          </select>
          <select value={c?.v ?? ''} onChange={(e) => e.target.value && set({ v: e.target.value as ConstraintV })} aria-label={t('Vertical')}>
            <option value="" disabled>
              {t('Vertical')}…
            </option>
            {V_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {t('Vertical')}: {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {c ? (
        <button className="full" onClick={() => updateLayer(layer.id, { constraints: undefined })}>
          {t('Quitar restricciones')}
        </button>
      ) : (
        <p className="rail-hint">{t('Sin restricciones: la capa escala con el lienzo.')}</p>
      )}
    </div>
  );
}
