import type { ImageLayer } from '../editor/core/types';
import { DEFAULT_CAST_SHADOW, DEFAULT_REFLECTION } from '../editor/core/groundFx';
import { useEditor } from '../editor/state/store';
import { t } from '../i18n';
import './imagegeo.css';

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
  onStart,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  onStart: () => void;
}) {
  return (
    <label className="prop">
      {t(label)}
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ flex: 1 }}
          onPointerDown={onStart}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span style={{ minWidth: 38, textAlign: 'right', fontSize: 12 }}>
          {Math.round(value * 100) / 100}
          {unit}
        </span>
      </span>
    </label>
  );
}

// Reflejo en suelo y sombra proyectada de una imagen (efectos de render no destructivos).
// Se monta dentro de «Más opciones» del panel de imagen.
export function ReflectionSection({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const updateLive = useEditor((s) => s.updateLayerLive);
  const checkpoint = useEditor((s) => s.checkpoint);
  const r = layer.reflection;
  const cs = layer.castShadow;

  return (
    <>
      <div className="more-group">
        <label className="geo-check">
          <input
            type="checkbox"
            checked={!!r}
            onChange={(e) =>
              updateLayer(layer.id, { reflection: e.target.checked ? { ...DEFAULT_REFLECTION } : undefined })
            }
          />
          <span className="more-title">{t('Reflejo en suelo')}</span>
        </label>
        {r && (
          <>
            <Slider
              label="Opacidad"
              value={r.opacity}
              min={0.05}
              max={1}
              step={0.05}
              onStart={checkpoint}
              onChange={(v) => updateLive(layer.id, { reflection: { ...r, opacity: v } })}
            />
            <Slider
              label="Longitud"
              value={r.length}
              min={0.1}
              max={1}
              step={0.05}
              onStart={checkpoint}
              onChange={(v) => updateLive(layer.id, { reflection: { ...r, length: v } })}
            />
            <Slider
              label="Separación"
              value={r.gap}
              min={0}
              max={80}
              step={1}
              unit=" px"
              onStart={checkpoint}
              onChange={(v) => updateLive(layer.id, { reflection: { ...r, gap: v } })}
            />
          </>
        )}
      </div>
      <div className="more-group">
        <label className="geo-check">
          <input
            type="checkbox"
            checked={!!cs}
            onChange={(e) =>
              updateLayer(layer.id, { castShadow: e.target.checked ? { ...DEFAULT_CAST_SHADOW } : undefined })
            }
          />
          <span className="more-title">{t('Sombra proyectada en el suelo')}</span>
        </label>
        {cs && (
          <>
            <Slider
              label="Dirección"
              value={cs.angle}
              min={-180}
              max={180}
              step={5}
              unit="°"
              onStart={checkpoint}
              onChange={(v) => updateLive(layer.id, { castShadow: { ...cs, angle: v } })}
            />
            <Slider
              label="Longitud"
              value={cs.length}
              min={0.1}
              max={2}
              step={0.05}
              onStart={checkpoint}
              onChange={(v) => updateLive(layer.id, { castShadow: { ...cs, length: v } })}
            />
            <Slider
              label="Desenfoque"
              value={cs.blur}
              min={0}
              max={60}
              step={1}
              unit=" px"
              onStart={checkpoint}
              onChange={(v) => updateLive(layer.id, { castShadow: { ...cs, blur: v } })}
            />
            <Slider
              label="Opacidad"
              value={cs.opacity}
              min={0.05}
              max={1}
              step={0.05}
              onStart={checkpoint}
              onChange={(v) => updateLive(layer.id, { castShadow: { ...cs, opacity: v } })}
            />
            <label className="prop">
              {t('Color')}
              <input
                type="color"
                value={cs.color}
                onChange={(e) => updateLayer(layer.id, { castShadow: { ...cs, color: e.target.value } })}
              />
            </label>
          </>
        )}
      </div>
    </>
  );
}
