import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { toast } from './toast';
import { TRANSPARENT_BG, type Gradient } from '../editor/core/types';
import { GradientEditor } from './GradientEditor';
import { PatternPicker } from './PatternPicker';
import { BackgroundExtras } from './BackgroundExtras';
import { ScreenPicker } from './ScreenPicker';
import { extractPalette, harmonies, HARMONY_LABELS, tonalScale, TONAL_STEPS } from '../editor/core/colorTools';
import { colorName } from '../editor/core/colorNames';
import { moodPalette, surpriseMood, type MoodResult } from '../editor/core/moods';
import {
  exportPalette,
  parsePalette,
  PALETTE_EXPORTS,
  type PaletteExportFormat,
} from '../editor/core/paletteIO';
import { downloadBlob } from '../io/export';
import { ContrastChecker } from './ContrastChecker';
import { ColorBlindPicker } from './ColorBlindView';
import './colortools.css';
import './colortools2.css';
import { gradientFromColor } from '../editor/core/gradients';
import {
  PRESET_SOLIDS,
  PRESET_GRADIENTS,
  GRADIENT_GROUPS,
  gradientToCss,
  resolveColor,
} from '../editor/core/palette';

// Colores y degradados guardados con nombre (localStorage `chamva.savedFills`).
const LS_SAVED = 'chamva.savedFills';
interface SavedFill {
  name: string;
  color?: string;
  gradient?: Gradient;
}
function loadSaved(): SavedFill[] {
  try {
    const raw = localStorage.getItem(LS_SAVED);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => x && (x.color || x.gradient)) : [];
  } catch {
    return [];
  }
}
function persistSaved(list: SavedFill[]) {
  try {
    localStorage.setItem(LS_SAVED, JSON.stringify(list));
  } catch {
    /* noop */
  }
}

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
  const [saved, setSaved] = useState<SavedFill[]>(loadSaved);
  const [saveName, setSaveName] = useState('');
  const [moodText, setMoodText] = useState('');
  const [moodVar, setMoodVar] = useState(0);
  const [mood, setMood] = useState<MoodResult | null>(null);
  const [ioText, setIoText] = useState('');
  const [imported, setImported] = useState<string[]>([]);
  const [exportSrc, setExportSrc] = useState<'brand' | 'doc'>('brand');
  const fileRef = useRef<HTMLInputElement>(null);

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

  // «Colores del diseño»: los del documento actual primero, luego los globales recientes.
  const designColors = useMemo(() => {
    const own = doc.recentColors ?? [];
    return [...own, ...recentColors.filter((c) => !own.includes(c))].slice(0, 16);
  }, [doc.recentColors, recentColors]);

  const curColor = bg.type === 'solid' ? toHex6(bg.color) : null;

  // Guardar el color/degradado actual con nombre.
  const saveCurrent = () => {
    if (bg.type === 'transparent' || bg.type === 'pattern') return;
    const name = saveName.trim() || (bg.type === 'solid' ? colorName(toHex6(bg.color)) : 'Degradado');
    const item: SavedFill = bg.type === 'solid' ? { name, color: bg.color } : { name, gradient: bg.gradient };
    const list = [item, ...saved].slice(0, 48);
    setSaved(list);
    persistSaved(list);
    setSaveName('');
    toast(`Guardado «${name}»`, 'success');
  };
  const removeSaved = (i: number) => {
    const list = saved.filter((_, j) => j !== i);
    setSaved(list);
    persistSaved(list);
  };

  const tonal = useMemo(() => tonalScale(harmSeed), [harmSeed]);

  const runMood = (text: string, v: number) => {
    setMood(text.trim() ? moodPalette(text, v) : surpriseMood());
  };
  const doSurprise = () => {
    const r = surpriseMood();
    setMood(r);
    setMoodText(r.name);
    setMoodVar(0);
  };

  // Colores del diseño para exportar: fondo, recientes del documento y rellenos de capas.
  const docPalette = (): string[] => {
    const out: string[] = [];
    const add = (c: unknown) => {
      if (typeof c !== 'string' || !c) return;
      const h = toHex6(c);
      if (!out.includes(h)) out.push(h);
    };
    if (bg.type === 'solid') add(bg.color);
    (doc.recentColors ?? []).forEach(add);
    doc.layers.forEach((l) => add((l as { fill?: unknown }).fill));
    return out;
  };
  const doExport = async (fmt: PaletteExportFormat) => {
    const colors = exportSrc === 'brand' ? brandColors : docPalette();
    if (colors.length === 0) {
      toast(exportSrc === 'brand' ? 'El kit de marca está vacío.' : 'El diseño no tiene colores.', 'info');
      return;
    }
    const info = PALETTE_EXPORTS[fmt];
    const name = exportSrc === 'brand' ? 'Kit de marca' : doc.name || 'Diseño';
    const text = exportPalette(colors, fmt, name);
    const base = name.replace(/[^\w-]+/g, '_');
    await downloadBlob(new Blob([text], { type: info.mime }), `${base}.${info.ext}`);
  };
  const doImport = (text: string) => {
    const r = parsePalette(text);
    if (r.colors.length === 0) {
      toast('No encontré colores válidos (GPL, CSS, JSON o hex).', 'error');
      return;
    }
    setImported(r.colors);
    toast(`${r.colors.length} colores leídos${r.name ? ` de «${r.name}»` : ''}`, 'success');
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const t = await f.text();
      setIoText(t.slice(0, 200000));
      doImport(t);
    } catch {
      toast('No se pudo leer el archivo.', 'error');
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
      <BackgroundExtras />

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
              title={`${colorName(toHex6(bg.color))} ${toHex6(bg.color)}`}
              style={{ background: bg.color }}
            />
          )}
        </div>
        {curColor && (
          <p className="cp-names">
            {colorName(curColor)} · {curColor}
          </p>
        )}

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

      {designColors.length > 0 && (
        <section className="cp-sec">
          <h4>Colores del diseño</h4>
          <div className="cp-grid">
            {designColors.map((c) => (
              <button
                key={c}
                className="cp-swatch"
                style={{ background: c }}
                title={`${colorName(c)} ${c}`}
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
        <div className="cp-harm-pick">
          <span className="cp-harm-from">Partir de</span>
          <label className="cp-harm-seed" title="Cambiar el color base">
            <span className="cp-harm-dot" style={{ background: harmSeed }} aria-hidden="true" />
            <code>{harmSeed}</code>
            <input
              type="color"
              value={harmSeed}
              aria-label="Color base de las armonías"
              onChange={(e) => setHarmBase(e.target.value)}
            />
          </label>
          {harmBase && (
            <button className="cp-mini" onClick={() => setHarmBase(null)} type="button">
              Usar fondo
            </button>
          )}
        </div>
        {(Object.keys(harm) as (keyof typeof harm)[]).map((k) => (
          <div className="cp-harm" key={k}>
            <div className="cp-harm-name">
              <span>{HARMONY_LABELS[k]}</span>
              <button
                className="cp-mini"
                type="button"
                title="Copiar los hex de esta armonía"
                onClick={() => copyHex(harm[k].join(' '))}
              >
                copiar hex
              </button>
            </div>
            <div className="cp-harm-row">
              {harm[k].map((c, i) => (
                <span className="cp-chip" key={i}>
                  <button
                    type="button"
                    className="cp-swatch"
                    style={{ background: c }}
                    title={`${c} — clic: aplicar · doble clic: copiar · clic derecho: añadir al kit`}
                    aria-label={`${c}, aplicar como color`}
                    onClick={() => pickSolid(c)}
                    onDoubleClick={() => copyHex(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      addBrandColor(c);
                      toast(`${c} añadido al Kit de Marca`, 'success');
                    }}
                  />
                  <button
                    type="button"
                    className="cp-chip-add"
                    title="Añadir al Kit de Marca"
                    aria-label={`Añadir ${c} al Kit de Marca`}
                    onClick={() => {
                      addBrandColor(c);
                      toast(`${c} añadido al Kit de Marca`, 'success');
                    }}
                  >
                    +
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="cp-sec">
        <h4>Escala tonal de {colorName(harmSeed).toLowerCase()}</h4>
        <div className="cp-tonal">
          {tonal.map((c, i) => (
            <button
              key={c + i}
              className="cp-swatch"
              style={{ background: c }}
              title={`${TONAL_STEPS[i]} · ${c} — clic derecho para copiar`}
              onClick={() => pickSolid(c)}
              onContextMenu={(e) => {
                e.preventDefault();
                copyHex(c);
              }}
            />
          ))}
        </div>
        <div className="cp-tonal-labels">
          {TONAL_STEPS.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
        <button className="cp-mini" type="button" style={{ marginTop: 4 }} onClick={() => copyHex(tonal.join(' '))}>
          copiar hex
        </button>
      </section>

      <section className="cp-sec cp-moods">
        <h4>Paletas por palabra</h4>
        <input
          placeholder='"atardecer", "bosque", "café", "playa"…'
          value={moodText}
          onChange={(e) => setMoodText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setMoodVar(0);
              runMood(moodText, 0);
            }
          }}
        />
        <div className="cp-moods-row">
          <button
            className="cp-mini"
            type="button"
            onClick={() => {
              setMoodVar(0);
              runMood(moodText, 0);
            }}
          >
            Generar
          </button>
          <button className="cp-mini" type="button" onClick={doSurprise}>
            Sorpréndeme
          </button>
          {mood && (
            <button
              className="cp-mini"
              type="button"
              onClick={() => {
                const v = moodVar + 1;
                setMoodVar(v);
                setMood(moodPalette(moodText || mood.name, v));
              }}
            >
              Otra variación
            </button>
          )}
        </div>
        {mood && (
          <>
            <p className="cp-sub">
              {mood.name}
              {mood.known ? '' : ' (paleta inventada)'}
            </p>
            <div className="cp-grid">
              {mood.colors.map((c, i) => (
                <button
                  key={c + i}
                  className="cp-swatch"
                  style={{ background: c }}
                  title={`${colorName(c)} ${c} — clic derecho para copiar`}
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
                onClick={() => {
                  mood.colors.forEach((c) => addBrandColor(c));
                  toast('Paleta añadida al kit de marca', 'success');
                }}
              >
                + al kit
              </button>
            </div>
          </>
        )}
      </section>

      <section className="cp-sec">
        <h4>Contraste</h4>
        <ContrastChecker onApplyBg={(hex) => pickSolid(hex)} />
      </section>

      <section className="cp-sec">
        <h4>Simular daltonismo</h4>
        <ColorBlindPicker />
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
        {GRADIENT_GROUPS.map((grp) => (
          <div key={grp.name}>
            <p className="cp-sub">{grp.name}</p>
            <div className="cp-grid">
              {grp.items.map((g, i) => (
                <button
                  key={i}
                  className="cp-swatch"
                  title={grp.name}
                  style={{ background: gradientToCss(g) }}
                  onClick={() => pickGradient(g)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="cp-sec">
        <h4>Guardados</h4>
        <div className="cp-harm-row">
          <input
            placeholder="Nombre (opcional)"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveCurrent()}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            className="cp-mini"
            type="button"
            disabled={bg.type === 'transparent'}
            onClick={saveCurrent}
            title="Guardar el color o degradado actual del fondo"
          >
            Guardar actual
          </button>
        </div>
        {saved.length === 0 ? (
          <p className="cp-empty">Guarda aquí tus colores y degradados favoritos.</p>
        ) : (
          <div className="cp-grid">
            {saved.map((f, i) => (
              <button
                key={i}
                className="cp-swatch"
                style={{ background: f.gradient ? gradientToCss(f.gradient) : f.color }}
                title={`${f.name} — clic derecho para quitar`}
                onClick={() =>
                  f.gradient ? setBackground({ type: 'gradient', gradient: f.gradient }) : f.color && pickSolid(f.color)
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  removeSaved(i);
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="cp-sec cp-io">
        <h4>Importar y exportar paletas</h4>
        <textarea
          placeholder="Pega aquí hex, variables CSS, JSON o un .gpl de GIMP"
          value={ioText}
          onChange={(e) => setIoText(e.target.value)}
        />
        <div className="cp-io-row">
          <button className="cp-mini" type="button" onClick={() => doImport(ioText)}>
            Leer colores
          </button>
          <button className="cp-mini" type="button" onClick={() => fileRef.current?.click()}>
            Abrir archivo…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".gpl,.css,.json,.txt,.hex,text/*,application/json"
            hidden
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        {imported.length > 0 && (
          <>
            <div className="cp-grid" style={{ marginTop: 6 }}>
              {imported.map((c) => (
                <button
                  key={c}
                  className="cp-swatch"
                  style={{ background: c }}
                  title={`${colorName(c)} ${c}`}
                  onClick={() => pickSolid(c)}
                />
              ))}
            </div>
            <div className="cp-io-row">
              <button
                className="cp-mini"
                type="button"
                onClick={() => {
                  imported.forEach((c) => addBrandColor(c));
                  toast(`${imported.length} colores añadidos al kit`, 'success');
                }}
              >
                Añadir todos al kit
              </button>
              <button className="cp-mini" type="button" onClick={() => setImported([])}>
                Limpiar
              </button>
            </div>
          </>
        )}
        <p className="cp-sub">Exportar</p>
        <div className="seg" role="group" aria-label="Origen de la paleta">
          <button className={exportSrc === 'brand' ? 'on' : ''} onClick={() => setExportSrc('brand')}>
            Kit de marca
          </button>
          <button className={exportSrc === 'doc' ? 'on' : ''} onClick={() => setExportSrc('doc')}>
            Este diseño
          </button>
        </div>
        <div className="cp-io-row">
          {(Object.keys(PALETTE_EXPORTS) as PaletteExportFormat[]).map((f) => (
            <button key={f} className="cp-mini" type="button" onClick={() => doExport(f)}>
              {PALETTE_EXPORTS[f].label}
            </button>
          ))}
        </div>
      </section>
      <PatternPicker />
    </div>
  );
}
