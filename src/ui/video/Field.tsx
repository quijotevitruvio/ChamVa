import { useId, type ReactNode } from 'react';

/** Deslizador + número + unidad (inspector y paneles de estilo). `scale`: el número se muestra × scale. `keys`: controles bajo la etiqueta (fotogramas clave). */
export function Field({ label, value, min, max, step, unit = '', scale = 1, digits = 0, onChange, disabled, keys }: { label: string; value: number; min: number; max: number; step: number; unit?: string; scale?: number; digits?: number; onChange: (v: number) => void; disabled?: boolean; keys?: ReactNode }) {
  const id = useId();
  const shown = Number((value * scale).toFixed(digits));
  return (
    <div className="vx-field">
      {keys ? (
        <div className="vx-field-l">
          <label htmlFor={id}>{label}</label>
          {keys}
        </div>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
      <input type="range" id={id} min={min} max={max} step={step} value={Math.max(min, Math.min(max, value))} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={`${shown}${unit}`} />
      <input
        type="number"
        className="vx-num"
        aria-label={`${label} (valor)`}
        min={min * scale}
        max={max * scale}
        step={step * scale}
        value={shown}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v / scale);
        }}
      />
      <span className="vx-unit">{unit}</span>
    </div>
  );
}
