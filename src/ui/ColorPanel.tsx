import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { toast } from './toast';
import { TRANSPARENT_BG, type Gradient } from '../editor/core/types';
import { GradientEditor } from './GradientEditor';
import { ScreenPicker } from './ScreenPicker';
import { extractPalette, harmonies, HARMONY_LABELS } from '../editor/core/colorTools';
import './colortools.css';
import { gradientFromColor } from '../editor/core/gradients';
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
  const [picker, setPicker] = useState(false); // cuentagotas alternativo
  const [harmBase, setHarmBase] = useState<string | null>(null); // null = color del fondo
  const [photoColors, setPhotoColors] = useState<string[]>([]);
  const selectedId = useEditor((s) => s.selectedId);

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

  // Imagen de la que sacar colores: la seleccionada o, si no, la mayor del diseño.
  const photoSrc = useMemo(() => {
    const imgs = doc.layers.filter(
      (l): l is Extract<typeof l, { type: 'image' }> =>
        l.type === 'image' && !!l.src && !l.chart && !l.table,
    );
    if (imgs.length === 0) return null;
    const sel = imgs.find((l) => l.id === selectedId);
    if (sel) return sel.src;
    const area = (l: (typeof imgs)[number]) =>
      l.naturalWidth * l.scaleX * l.naturalHeight * l.scaleY;
    return imgs.reduce((a, b) => (area(b) > area(a) ? b : a)).src;
  }, [doc.layers, selectedId]);

  useEffect(() => {
    if (!photoSrc) {
      setPhotoColors([]);
      return;
    }
    let dead = false;
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, w, h);
        if (!dead) setPhotoColors(extractPalette(ctx.getImageData(0, 0, w, h), 6));
      } catch {
        if (!dead) setPhotoColors([]);
      }
    };
    img.onerror = () => !dead && setPhotoColors([]);
    img.src = photoSrc;
    return () => {
      dead = true;
    };
  }, [photoSrc]);

  const harmSeed =
    harmBase ??
    (bg.type === 'solid'
      ? toHex6(bg.color)
      : bg.type === 'gradient'
        ? toHex6(bg.gradient.stops[0].color)
        : '#3366cc');
  const harm = useMemo(() => harmonies(harmSeed), [harmSeed]);

  const copyHex = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      toast(`Copiado ${hex}`, 'info');
    } catch {
      toast('No se pudo copiar.', 'error');
    }
  };

  const useEyedropper = async () => {
    if (!window.EyeDropper) {
      setPicker(true);
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
      {picker && (
        <ScreenPicker
          doc={doc}
          onClose={() => setPicker(false)}
          onPick={(hex) => {
            pickSolid(hex);
            setPicker(false);
          }}
        />
      )}
      <div className="cp-head">
        <h3>Color</h3>
        <button className="cp-x" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="seg cp-modes" role="group" aria-label="Tipo de fondo">
        <button
          className={bg.type === 'transparent' ? 'on' : ''}
          onClick={() => setBackground(TRANSPARENT_BG)}
          title="Sin fondo: el cuadriculado significa transparente"
        >
          Transparente
        </button>
        <button
          className={bg.type === 'solid' ? 'on' : ''}
          onClick={() =>
            bg.type !== 'solid' &&
            pickSolid(bg.type === 'gradient' ? toHex6(bg.gradient.stops[0].color) : '#ffffff')
          }
        >
          Color
        </button>
        <button
          className={bg.type === 'gradient' ? 'on' : ''}
          onClick={() =>
            bg.type !== 'gradient' &&
            setBackground({
              type: 'gradient',
              gradient: gradientFromColor(bg.type === 'solid' ? toHex6(bg.color) : '#6e6e6a'),
            })
          }
        >
          Degradado
        </button>
      </div>

      {bg.type === 'gradient' && (
        <section className="cp-sec">
          <h4>Degradado de fondo</h4>
          <GradientEditor value={bg.gradient} onChange={(g) => setBackground({ type: 'gradient', gradient: g })} />
        </section>
      )}

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
              title={toHex6(bg.color)}
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
        <h4>Armonías</h4>
        <label className="cp-harm-pick">
          <span>Partir de</span>
          <input
            type="color"
            value={harmSeed}
            onChange={(e) => setHarmBase(e.target.value)}
          />
          <span>{harmSeed}</span>
          {harmBase && (
            <button className="cp-mini" onClick={() => setHarmBase(null)} type="button">
              Usar fondo
            </button>
          )}
        </label>
        {(Object.keys(harm) as (keyof typeof harm)[]).map((k) => (
          <div className="cp-harm" key={k}>
            <div className="cp-harm-name">{HARMONY_LABELS[k]}</div>
            <div className="cp-harm-row">
              {harm[k].map((c, i) => (
                <button
                  key={i}
                  className="cp-swatch"
                  style={{ background: c }}
                  title={`${c} — clic derecho para copiar`}
                  onClick={() => pickSolid(c)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    copyHex(c);
                  }}
                />
              ))}
              <button
                className="cp-mini"
                type="button"
                title="Copiar los hex de esta familia"
                onClick={() => copyHex(harm[k].join(' '))}
              >
                copiar hex
              </button>
            </div>
          </div>
        ))}
      </section>

      {photoColors.length > 0 && (
        <section className="cp-sec">
          <h4>Colores de tu foto</h4>
          <div className="cp-grid">
            {photoColors.map((c) => (
              <button
                key={c}
                className="cp-swatch"
                style={{ background: c }}
                title={c}
                onClick={() => pickSolid(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  copyHex(c);
                }}
              />
            ))}
          </div>
        </section>
      )}

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
