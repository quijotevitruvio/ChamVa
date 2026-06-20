import { useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { toast } from './toast';
import { TRANSPARENT_BG, type Gradient } from '../editor/core/types';
import {
  PRESET_SOLIDS,
  PRESET_GRADIENTS,
  gradientToCss,
  resolveColor,
} from '../editor/core/palette';

// #rrggbb / #rrggbbaa / rgba(...) → {r,g,b}
function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  if (color.startsWith('rgb')) {
    const m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return null;
  }
  const h = color.replace('#', '');
  if (h.length < 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// Cualquier color → #rrggbb (para el selector nativo, que no admite alfa).
function toHex6(color: string): string {
  const rgb = hexToRgb(color);
  if (!rgb) return '#ffffff';
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

export function ColorPanel({
  onClose,
  embedded,
}: {
  onClose: () => void;
  embedded?: boolean;
}) {
  const doc = useEditor((s) => s.doc);
  const brandColors = useEditor((s) => s.brandColors);
  const recentColors = useEditor((s) => s.recentColors);
  const setBackground = useEditor((s) => s.setBackground);
  const addBrandColor = useEditor((s) => s.addBrandColor);
  const removeBrandColor = useEditor((s) => s.removeBrandColor);

  const colorInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [alpha, setAlpha] = useState(1); // 0..1 nivel de transparencia

  const bg = doc.background;
  const currentSolid = bg.type === 'solid' ? toHex6(bg.color) : '#ffffff';

  // Aplica el nivel de alfa a un color (#rrggbb → rgba(...) si alpha<1).
  const withAlpha = (color: string): string => {
    if (alpha >= 1) return color;
    const rgb = hexToRgb(color);
    if (!rgb) return color;
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${Number(alpha.toFixed(2))})`;
  };

  const pickSolid = (color: string) =>
    setBackground({ type: 'solid', color: withAlpha(color) });
  const pickGradient = (gradient: Gradient) =>
    setBackground({
      type: 'gradient',
      gradient: {
        ...gradient,
        stops: gradient.stops.map((s) => ({
          ...s,
          color: withAlpha(s.color),
        })),
      },
    });

  const onSearch = () => {
    if (/transparent|transparente/i.test(search.trim())) {
      setBackground(TRANSPARENT_BG);
      setSearch('');
      return;
    }
    const c = resolveColor(search);
    if (c) {
      pickSolid(c);
      setSearch('');
    }
  };

  const useEyedropper = async () => {
    if (!window.EyeDropper) {
      toast('El cuentagotas no está disponible en este entorno.', 'error');
      return;
    }
    try {
      const res = await new window.EyeDropper().open();
      pickSolid(res.sRGBHex);
    } catch {
      /* cancelado */
    }
  };

  return (
    <div className={embedded ? 'color-panel embedded' : 'color-panel'}>
      <div className="cp-head">
        <h3>Color</h3>
        <button className="cp-x" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="cp-search">
        <input
          placeholder='Prueba con "azul" o "#00c4cc"'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
        />
      </div>

      <section className="cp-sec">
        <h4>Colores del fondo</h4>
        <div className="cp-row">
          <button
            className="cp-add"
            title="Color personalizado"
            onClick={() => colorInputRef.current?.click()}
          >
            +
          </button>
          <input
            ref={colorInputRef}
            type="color"
            value={currentSolid}
            hidden
            onChange={(e) => pickSolid(e.target.value)}
          />
          <button className="cp-eye" title="Cuentagotas" onClick={useEyedropper}>
            ⛏
          </button>
          <button
            className={`cp-swatch big ${bg.type === 'transparent' ? 'checker sel' : ''}`}
            title="Transparente"
            onClick={() => setBackground(TRANSPARENT_BG)}
          />
          {bg.type === 'solid' && (
            <span
              className="cp-swatch big sel"
              style={{ background: bg.color }}
            />
          )}
        </div>

        <label className="cp-alpha">
          <span>Transparencia</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={alpha}
            onChange={(e) => {
              const a = Number(e.target.value);
              setAlpha(a);
              // Reaplicar el alfa al color/degradado actual en vivo.
              if (bg.type === 'solid') {
                const base = toHex6(bg.color);
                const rgb = hexToRgb(base)!;
                setBackground({
                  type: 'solid',
                  color:
                    a >= 1
                      ? base
                      : `rgba(${rgb.r},${rgb.g},${rgb.b},${Number(a.toFixed(2))})`,
                });
              }
            }}
          />
          <span className="cp-alpha-val">{Math.round(alpha * 100)}%</span>
        </label>
      </section>

      {recentColors.length > 0 && (
        <section className="cp-sec">
          <h4>Colores del diseño</h4>
          <div className="cp-grid">
            {recentColors.map((c) => (
              <button
                key={c}
                className="cp-swatch"
                style={{ background: c }}
                title={c}
                onClick={() => pickSolid(c)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="cp-sec">
        <div className="cp-sec-head">
          <h4>Kit de Marca</h4>
          <button
            className="cp-link"
            onClick={() => bg.type === 'solid' && addBrandColor(bg.color)}
            title="Añadir el color actual al kit"
          >
            + Añadir
          </button>
        </div>
        {brandColors.length === 0 ? (
          <p className="cp-empty">
            Elige un color y pulsa "+ Añadir" para guardarlo.
          </p>
        ) : (
          <div className="cp-grid">
            {brandColors.map((c) => (
              <button
                key={c}
                className="cp-swatch"
                style={{ background: c }}
                title={`${c} — clic derecho para quitar`}
                onClick={() => pickSolid(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  removeBrandColor(c);
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="cp-sec">
        <h4>Colores sólidos predeterminados</h4>
        <div className="cp-grid">
          {PRESET_SOLIDS.map((c) => (
            <button
              key={c}
              className="cp-swatch"
              style={{ background: c }}
              title={c}
              onClick={() => pickSolid(c)}
            />
          ))}
        </div>
      </section>

      <section className="cp-sec">
        <h4>Colores degradados predeterminados</h4>
        <div className="cp-grid">
          {PRESET_GRADIENTS.map((g, i) => (
            <button
              key={i}
              className="cp-swatch"
              style={{ background: gradientToCss(g) }}
              onClick={() => pickGradient(g)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
