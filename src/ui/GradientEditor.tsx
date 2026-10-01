import type { Gradient } from '../editor/core/types';
import { PRESET_GRADIENTS } from '../editor/core/palette';
import {
  addStop,
  gradientCss,
  gradientFromColor,
  isRadial,
  parseColor,
  reverseGradient,
  toHex6,
  withAlphaColor,
} from '../editor/core/gradients';

// Editor de degradados: tipo (lineal / radial), ángulo, paradas de color con
// opacidad, invertir y degradados listos. Sirve para el fondo y para formas.
export function GradientEditor({ value, onChange }: { value: Gradient; onChange: (g: Gradient) => void }) {
  const radial = isRadial(value);
  const setStop = (i: number, patch: Partial<{ offset: number; color: string }>) =>
    onChange({ ...value, stops: value.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="ge">
      <div
        className="ge-preview"
        style={{ background: gradientCss({ ...value, kind: 'linear', angle: 0 }) }}
        aria-label="Vista previa del degradado"
      />

      <div className="seg" role="group" aria-label="Tipo de degradado">
        <button className={!radial ? 'on' : ''} onClick={() => onChange({ ...value, kind: 'linear' })}>
          Lineal
        </button>
        <button className={radial ? 'on' : ''} onClick={() => onChange({ ...value, kind: 'radial' })}>
          Radial
        </button>
      </div>

      {!radial && (
        <div className="ge-angle">
          <label>
            <span>Ángulo</span>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={((Math.round(value.angle) % 360) + 360) % 360}
              onChange={(e) => onChange({ ...value, angle: Number(e.target.value) })}
            />
            <span className="ge-val">{((Math.round(value.angle) % 360) + 360) % 360}°</span>
          </label>
          <div className="ge-quick">
            {[
              ['→', 0],
              ['↘', 45],
              ['↓', 90],
              ['↙', 135],
              ['←', 180],
              ['↖', 225],
              ['↑', 270],
              ['↗', 315],
            ].map(([icon, a]) => (
              <button
                key={a}
                className={Math.round(value.angle) % 360 === a ? 'on' : ''}
                onClick={() => onChange({ ...value, angle: a as number })}
                title={`${a}°`}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ge-stops">
        {value.stops.map((s, i) => {
          const a = parseColor(s.color)?.a ?? 1;
          return (
            <div className="ge-stop" key={i}>
              <input
                type="color"
                value={toHex6(s.color)}
                onChange={(e) => setStop(i, { color: withAlphaColor(e.target.value, a) })}
                aria-label={`Color ${i + 1}`}
              />
              <label title="Posición del color">
                <span>Pos.</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(s.offset * 100)}
                  onChange={(e) => setStop(i, { offset: Number(e.target.value) / 100 })}
                />
              </label>
              <label title="Opacidad de este color (0 = transparente)">
                <span>Opac.</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(a * 100)}
                  onChange={(e) => setStop(i, { color: withAlphaColor(s.color, Number(e.target.value) / 100) })}
                />
              </label>
              <button
                className="ge-del"
                disabled={value.stops.length <= 2}
                onClick={() => onChange({ ...value, stops: value.stops.filter((_, j) => j !== i) })}
                title="Quitar este color"
                aria-label="Quitar color"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="ge-actions">
        <button onClick={() => onChange(addStop(value))}>+ Añadir color</button>
        <button onClick={() => onChange(reverseGradient(value))} title="Invierte el orden de los colores">
          ⇄ Invertir
        </button>
        {!radial && (
          <button onClick={() => onChange({ ...value, angle: (value.angle + 90) % 360 })}>↻ Girar 90°</button>
        )}
      </div>

      <div className="ge-presets" aria-label="Degradados listos">
        {PRESET_GRADIENTS.map((g, i) => (
          <button
            key={i}
            className="cp-swatch"
            style={{ background: gradientCss({ ...g, kind: value.kind }) }}
            onClick={() => onChange({ ...g, kind: value.kind })}
            title="Usar este degradado"
          />
        ))}
      </div>
    </div>
  );
}

// Relleno de una forma: Color · Degradado · Transparente (siempre a mano).
export function FillControl({
  fill,
  gradient,
  onChange,
}: {
  fill: string;
  gradient?: Gradient;
  onChange: (patch: { fill?: string; fillGradient?: Gradient | undefined }) => void;
}) {
  const parts = parseColor(fill);
  const mode: 'solid' | 'gradient' | 'none' = gradient ? 'gradient' : parts && parts.a === 0 ? 'none' : 'solid';
  const hex = toHex6(fill);
  const alpha = parts ? parts.a : 1;

  return (
    <div className="fill-control">
      <div className="seg" role="group" aria-label="Tipo de relleno">
        <button
          className={mode === 'solid' ? 'on' : ''}
          onClick={() => onChange({ fill: withAlphaColor(hex, alpha === 0 ? 1 : alpha), fillGradient: undefined })}
        >
          Color
        </button>
        <button
          className={mode === 'gradient' ? 'on' : ''}
          onClick={() => onChange({ fillGradient: gradient ?? gradientFromColor(hex === '#000000' && alpha === 0 ? '#808080' : hex) })}
        >
          Degradado
        </button>
        <button
          className={mode === 'none' ? 'on' : ''}
          onClick={() => onChange({ fill: withAlphaColor(hex, 0), fillGradient: undefined })}
          title="Sin relleno: la forma queda transparente"
        >
          Transparente
        </button>
      </div>

      {mode === 'solid' && (
        <div className="fill-solid">
          <input type="color" value={hex} onChange={(e) => onChange({ fill: withAlphaColor(e.target.value, alpha) })} aria-label="Color de relleno" />
          <label>
            <span>Opacidad</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(alpha * 100)}
              onChange={(e) => onChange({ fill: withAlphaColor(hex, Number(e.target.value) / 100) })}
            />
            <span className="ge-val">{Math.round(alpha * 100)}%</span>
          </label>
        </div>
      )}
      {mode === 'gradient' && gradient && (
        <GradientEditor value={gradient} onChange={(g) => onChange({ fillGradient: g })} />
      )}
    </div>
  );
}
