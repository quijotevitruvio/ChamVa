import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { FONT_FAMILIES, type ImageLayer } from '../editor/core/types';
import {
  activeKit,
  colorPair,
  contrastMatrix,
  layoutBrandSheet,
  respectFactor,
  rgbText,
  sheetItemsToLayers,
  type ColorPair,
} from '../editor/core/brandKits';
import { makeLogoVariants } from '../editor/core/logoVariants';
import {
  decodeSvgDataUrl,
  encodeSvgDataUrl,
  extractSvgColors,
  isSvgDataUrl,
  mapByLuminosity,
  replaceSvgColors,
} from '../editor/core/svgRecolor';
import { loadImageFile } from '../io/import';
import { toast } from './toast';
import { t } from '../i18n';
import './brandkit.css';

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `bk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Pestaña «Marca» del riel: kits con nombre, logos (variantes y zona de
// respeto), colores, tipografías, hoja de marca y guía de combinaciones.
export function BrandKitPanel() {
  const kits = useEditor((s) => s.brandKits);
  const activeId = useEditor((s) => s.activeBrandKitId);
  const brandColors = useEditor((s) => s.brandColors);
  const brandLogos = useEditor((s) => s.brandLogos);
  const brandFonts = useEditor((s) => s.brandFonts);
  const customFonts = useEditor((s) => s.customFonts);
  const recentColors = useEditor((s) => s.recentColors);
  const showRespect = useEditor((s) => s.showRespect);
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const addBrandColor = useEditor((s) => s.addBrandColor);
  const removeBrandColor = useEditor((s) => s.removeBrandColor);
  const addBrandLogo = useEditor((s) => s.addBrandLogo);
  const removeBrandLogo = useEditor((s) => s.removeBrandLogo);
  const toggleBrandFont = useEditor((s) => s.toggleBrandFont);
  const setActiveKit = useEditor((s) => s.setActiveBrandKit);
  const createKit = useEditor((s) => s.createBrandKit);
  const duplicateKit = useEditor((s) => s.duplicateBrandKit);
  const renameKit = useEditor((s) => s.renameBrandKit);
  const deleteKit = useEditor((s) => s.deleteBrandKit);
  const setRespect = useEditor((s) => s.setBrandLogoRespect);
  const setShowRespect = useEditor((s) => s.setShowRespect);
  const setBackground = useEditor((s) => s.setBackground);

  const [view, setView] = useState<'kit' | 'combos'>('kit');
  const [nameMode, setNameMode] = useState<'new' | 'rename' | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [newBrandColor, setNewBrandColor] = useState('#737373');
  const [selLogoId, setSelLogoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  const kit = activeKit(kits, activeId);
  const selLogo = brandLogos.find((l) => l.id === selLogoId) ?? null;

  // ---- Kits ----
  const startName = (mode: 'new' | 'rename') => {
    setNameDraft(mode === 'rename' ? kit.name : '');
    setNameMode(mode);
    setConfirmDel(false);
  };
  const commitName = () => {
    const n = nameDraft.trim();
    if (n) {
      if (nameMode === 'new') createKit(n);
      else if (nameMode === 'rename') renameKit(kit.id, n);
    }
    setNameMode(null);
  };

  // ---- Aplicar al diseño ----
  const applyBrandColor = (c: string) => {
    const st = useEditor.getState();
    const l = st.doc.layers.find((x) => x.id === st.selectedId);
    if (l?.type === 'text') st.setTextStyleAll(l.id, { fill: c });
    else if (l?.type === 'shape') st.updateLayer(l.id, { fill: c });
    else setBackground({ type: 'solid', color: c });
  };

  const applyBrandFont = (family: string) => {
    const st = useEditor.getState();
    const l = st.doc.layers.find((x) => x.id === st.selectedId);
    if (l?.type === 'text') {
      st.updateLayer(l.id, { fontFamily: family });
      return;
    }
    st.beginBatch();
    st.addTextLayer({ text: 'Tu texto', fontSize: 72, bold: true });
    const id = useEditor.getState().selectedId;
    if (id) useEditor.getState().updateLayer(id, { fontFamily: family });
    st.endBatch();
  };

  // Aplica un par de la guía: texto → fill del texto; forma → su relleno;
  // sin selección → fondo de la página y todos sus textos.
  const applyPair = (p: ColorPair, only?: 'fg' | 'bg') => {
    const st = useEditor.getState();
    const l = st.doc.layers.find((x) => x.id === st.selectedId);
    if (only === 'fg') {
      if (l?.type === 'text') st.setTextStyleAll(l.id, { fill: p.fg });
      else toast('Selecciona un texto para darle este color', 'info');
      return;
    }
    if (only === 'bg') {
      if (l?.type === 'shape') st.updateLayer(l.id, { fill: p.bg });
      else setBackground({ type: 'solid', color: p.bg });
      return;
    }
    if (l?.type === 'text') st.setTextStyleAll(l.id, { fill: p.fg });
    else if (l?.type === 'shape') st.updateLayer(l.id, { fill: p.bg });
    else {
      st.beginBatch();
      setBackground({ type: 'solid', color: p.bg });
      for (const x of useEditor.getState().doc.layers)
        if (x.type === 'text') useEditor.getState().setTextStyleAll(x.id, { fill: p.fg });
      st.endBatch();
    }
  };

  // ---- Logos ----
  const onUploadLogos = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      try {
        const img = await loadImageFile(file);
        addBrandLogo({ id: uid(), ...img });
      } catch (e) {
        toast('No se pudo cargar el logo: ' + (e as Error).message, 'error');
      }
    }
  };

  const createVariants = async () => {
    if (!selLogo) return;
    setBusy(true);
    try {
      const vs = await makeLogoVariants(selLogo, uid);
      // De la última a la primera: quedan en orden negro, blanco, invertida.
      [...vs].reverse().forEach((v) => addBrandLogo(v));
      toast(`Creadas ${vs.length} variantes de «${selLogo.name}»`, 'success');
    } catch (e) {
      toast('No se pudieron crear las variantes: ' + (e as Error).message, 'error');
    }
    setBusy(false);
  };

  // ---- Hoja de marca ----
  const createSheet = async () => {
    setBusy(true);
    try {
      try {
        await Promise.race([
          Promise.all(kit.fonts.map((f) => document.fonts.load(`700 40px "${f}"`))),
          new Promise((r) => setTimeout(r, 800)),
        ]);
      } catch {
        /* se usa la fuente de reserva */
      }
      useEditor.getState().addPage(); // página nueva con el tamaño del lienzo actual
      const { doc } = useEditor.getState();
      const items = layoutBrandSheet(kit, { width: doc.width, height: doc.height });
      const layers = sheetItemsToLayers(items, kit.logos, uid);
      useEditor.setState((s) => ({
        doc: {
          ...s.doc,
          name: `Hoja de marca · ${kit.name}`,
          background: { type: 'solid', color: '#ffffff' },
          layers,
        },
      }));
      toast('Hoja de marca creada en una página nueva', 'success');
    } catch (e) {
      toast('No se pudo crear la hoja: ' + (e as Error).message, 'error');
    }
    setBusy(false);
  };

  return (
    <>
      {/* Kits */}
      <div className="bk-kit-row">
        <select
          className="bk-select"
          value={kit.id}
          onChange={(e) => {
            setActiveKit(e.target.value);
            setSelLogoId(null);
            setConfirmDel(false);
          }}
          title="Kit de marca activo"
        >
          {kits.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </div>
      {nameMode ? (
        <div className="bk-kit-row">
          <input
            className="bk-input"
            autoFocus
            value={nameDraft}
            placeholder={nameMode === 'new' ? 'Nombre del kit nuevo' : 'Nombre del kit'}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setNameMode(null);
            }}
          />
          <button className="bk-btn" onClick={commitName}>
            OK
          </button>
          <button className="bk-btn" onClick={() => setNameMode(null)}>
            ✕
          </button>
        </div>
      ) : confirmDel ? (
        <div className="bk-kit-row">
          <span className="bk-grow">¿Borrar «{kit.name}»?</span>
          <button
            className="bk-btn"
            onClick={() => {
              deleteKit(kit.id);
              setConfirmDel(false);
              setSelLogoId(null);
            }}
          >
            Sí, borrar
          </button>
          <button className="bk-btn" onClick={() => setConfirmDel(false)}>
            No
          </button>
        </div>
      ) : (
        <div className="bk-kit-row">
          <button className="bk-btn bk-grow" onClick={() => startName('new')}>
            ＋ Nuevo
          </button>
          <button className="bk-btn bk-grow" onClick={() => duplicateKit(kit.id)}>
            Duplicar
          </button>
          <button className="bk-btn bk-grow" onClick={() => startName('rename')}>
            Renombrar
          </button>
          <button
            className="bk-btn bk-grow"
            disabled={kits.length <= 1}
            title={kits.length <= 1 ? 'Debe quedar al menos un kit' : 'Borrar este kit'}
            onClick={() => setConfirmDel(true)}
          >
            Borrar
          </button>
        </div>
      )}

      <div className="seg">
        <button className={view === 'kit' ? 'on' : ''} onClick={() => setView('kit')}>
          Kit
        </button>
        <button className={view === 'combos' ? 'on' : ''} onClick={() => setView('combos')}>
          Combinaciones
        </button>
      </div>

      {view === 'combos' ? (
        <Combos colors={brandColors} onApply={applyPair} />
      ) : (
        <>
          <button className="rail-item bk-wide" disabled={busy} onClick={createSheet}>
            Crear hoja de marca
          </button>
          <p className="rail-hint">Página nueva con logos, paleta (hex y RGB), tipografías y ejemplos, editable.</p>

          <h4 className="rail-sub">{t('Logos')}</h4>
          <button className="rail-big" onClick={() => logoFileRef.current?.click()}>
            ⬆ {t('Subir logo')}
          </button>
          <input
            ref={logoFileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              onUploadLogos(e.target.files);
              e.target.value = '';
            }}
          />
          {brandLogos.length > 0 && (
            <div className="uploads-grid">
              {brandLogos.map((u) => (
                <div
                  key={u.id}
                  className={'upload-thumb' + (u.id === selLogoId ? ' bk-sel' : '')}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/x-chamva-upload', u.id)}
                  onClick={() => addImageLayer(u)}
                  title={u.name + ' — clic o arrastra al lienzo'}
                >
                  <img src={u.src} alt={u.name} />
                  <button
                    className="upload-del"
                    title="Quitar del kit"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (u.id === selLogoId) setSelLogoId(null);
                      removeBrandLogo(u.id);
                    }}
                  >
                    ✕
                  </button>
                  <button
                    className="bk-thumb-opt"
                    title="Opciones del logo (variantes, zona de respeto)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelLogoId(u.id === selLogoId ? null : u.id);
                    }}
                  >
                    ⋯
                  </button>
                </div>
              ))}
            </div>
          )}
          {selLogo && (
            <div className="bk-opts">
              <div className="bk-opts-title">{selLogo.name}</div>
              <button className="bk-btn" disabled={busy} onClick={createVariants}>
                Crear variantes (negro, blanco, sobre fondo)
              </button>
              <label className="bk-row">
                <span className="bk-grow">Zona de respeto</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={5}
                  className="bk-num"
                  value={Math.round(respectFactor(kit, selLogo.id) * 100)}
                  onChange={(e) => setRespect(selLogo.id, (Number(e.target.value) || 0) / 100)}
                />
                <span>% de la altura</span>
              </label>
            </div>
          )}
          {brandLogos.length > 0 && (
            <label className="bk-row">
              <input type="checkbox" checked={showRespect} onChange={(e) => setShowRespect(e.target.checked)} />
              <span>Mostrar zona de respeto</span>
            </label>
          )}
          {showRespect && (
            <p className="rail-hint">Se dibuja alrededor de los logos del kit en el lienzo (no se exporta) y avisa si algo la invade.</p>
          )}

          <h4 className="rail-sub">{t('Colores de marca')}</h4>
          <p className="rail-hint">Clic: se aplica al elemento seleccionado (o al fondo).</p>
          <div className="rail-swatches">
            {brandColors.map((c) => (
              <button
                key={c}
                style={{ background: c }}
                title={`${c} · ${rgbText(c)} — clic derecho para quitar`}
                onClick={() => applyBrandColor(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  removeBrandColor(c);
                }}
              />
            ))}
          </div>
          <div className="font-row">
            <input
              type="color"
              value={newBrandColor}
              onChange={(e) => setNewBrandColor(e.target.value)}
              style={{ width: 36, height: 30, padding: 0, border: 'none', background: 'none' }}
            />
            <button className="rail-item" style={{ flex: 1 }} onClick={() => addBrandColor(newBrandColor)}>
              ＋ {t('Añadir color')}
            </button>
          </div>
          {recentColors.length > 0 && (
            <>
              <h4 className="rail-sub">{t('Recientes')}</h4>
              <div className="rail-swatches">
                {recentColors.map((c) => (
                  <button key={c} style={{ background: c }} title={c} onClick={() => applyBrandColor(c)} />
                ))}
              </div>
            </>
          )}

          <h4 className="rail-sub">{t('Fuentes de marca')}</h4>
          {brandFonts.map((f) => (
            <div key={f} className="font-row">
              <button
                className="rail-item"
                style={{ flex: 1, fontFamily: f }}
                onClick={() => applyBrandFont(f)}
                title="Aplicar al texto seleccionado (o crear uno)"
              >
                {f}
              </button>
              <button className="font-upload" title="Quitar del kit" onClick={() => toggleBrandFont(f)}>
                ✕
              </button>
            </div>
          ))}
          <select
            className="bk-select"
            value=""
            onChange={(e) => e.target.value && toggleBrandFont(e.target.value)}
          >
            <option value="">＋ {t('Añadir fuente de marca')}…</option>
            {[...customFonts, ...FONT_FAMILIES]
              .filter((f) => !brandFonts.includes(f))
              .map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
          </select>
        </>
      )}
    </>
  );
}

// Guía de combinaciones: matriz fondo (filas) × texto (columnas) con contraste WCAG.
function Combos({ colors, onApply }: { colors: string[]; onApply: (p: ColorPair, only?: 'fg' | 'bg') => void }) {
  const [withBW, setWithBW] = useState(true);
  const [onlyAA, setOnlyAA] = useState(false);
  const [sel, setSel] = useState<{ fg: string; bg: string } | null>(null);

  const list = useMemo(() => {
    const base = [...colors];
    if (withBW) for (const c of ['#ffffff', '#000000']) if (!base.includes(c)) base.push(c);
    return [...new Set(base)];
  }, [colors, withBW]);
  const matrix = useMemo(() => contrastMatrix(list), [list]);
  const pair = sel && list.includes(sel.fg) && list.includes(sel.bg) ? colorPair(sel.fg, sel.bg) : null;

  if (colors.length < 1) return <p className="rail-hint">Añade colores al kit para ver qué combinaciones de texto y fondo son legibles.</p>;
  return (
    <>
      <p className="rail-hint">Filas: fondo. Columnas: texto. Marcado = accesible (AA, contraste 4,5 o más).</p>
      <label className="bk-row">
        <input type="checkbox" checked={withBW} onChange={(e) => setWithBW(e.target.checked)} />
        <span>Incluir blanco y negro</span>
      </label>
      <label className="bk-row">
        <input type="checkbox" checked={onlyAA} onChange={(e) => setOnlyAA(e.target.checked)} />
        <span>Resaltar solo las accesibles</span>
      </label>
      <div className="bk-matrix" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
        {matrix.flatMap((row, ri) =>
          row.map((p, ci) =>
            p ? (
              <button
                key={`${ri}-${ci}`}
                className={
                  'bk-cell' +
                  (p.aa ? ' ok' : '') +
                  (onlyAA && !p.aa ? ' dim' : '') +
                  (sel && sel.fg === p.fg && sel.bg === p.bg ? ' sel' : '')
                }
                style={{ background: p.bg, color: p.fg }}
                title={`Texto ${p.fg} sobre ${p.bg}: ${p.ratio.toFixed(2)}:1 (${p.level})`}
                onClick={() => setSel({ fg: p.fg, bg: p.bg })}
              >
                Aa
                {p.aa && <i className="bk-tick">✓</i>}
              </button>
            ) : (
              <span key={`${ri}-${ci}`} className="bk-cell empty" style={{ background: list[ri] }} />
            ),
          ),
        )}
      </div>
      {pair && (
        <div className="bk-opts">
          <div className="bk-sample" style={{ background: pair.bg, color: pair.fg }}>
            Texto de ejemplo
          </div>
          <div className="bk-opts-title">
            {pair.ratio.toFixed(2)}:1 · {pair.level}
            {pair.aa ? '' : ' (poco legible para texto normal)'}
          </div>
          <button className="bk-btn" onClick={() => onApply(pair)}>
            Aplicar par al elemento seleccionado
          </button>
          <div className="bk-kit-row">
            <button className="bk-btn bk-grow" onClick={() => onApply(pair, 'fg')}>
              Solo texto
            </button>
            <button className="bk-btn bk-grow" onClick={() => onApply(pair, 'bg')}>
              Solo fondo
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Recolorear con la paleta de marca: para iconos y capas de imagen SVG.
// Automático (por luminosidad) o manual, color por color.
export function RecolorWithPalette({ layer }: { layer: ImageLayer }) {
  const brandColors = useEditor((s) => s.brandColors);
  const updateLayer = useEditor((s) => s.updateLayer);
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState<Record<string, string>>({});

  const svg = useMemo(() => (isSvgDataUrl(layer.src) ? decodeSvgDataUrl(layer.src) : null), [layer.src]);
  const colors = useMemo(() => (svg ? extractSvgColors(svg) : []), [svg]);
  if (!svg) return null;

  const apply = (map: Record<string, string>) => {
    const next = replaceSvgColors(svg, map);
    if (next === svg) {
      toast('Nada que recolorear', 'info');
      return;
    }
    updateLayer(layer.id, { src: encodeSvgDataUrl(next) });
    setManual({});
  };

  return (
    <div className="more-group">
      <span className="more-title">Recolorear con la paleta</span>
      {brandColors.length === 0 ? (
        <p className="rail-hint">Añade colores al kit de marca (pestaña Marca) para usarlos aquí.</p>
      ) : (
        <>
          <button className="bk-btn bk-wide" onClick={() => apply(mapByLuminosity(colors, brandColors))}>
            Recolorear automáticamente
          </button>
          <button className="bk-btn bk-wide" onClick={() => setOpen(!open)}>
            {open ? 'Ocultar elección manual' : 'Elegir color por color'}
          </button>
          {open && (
            <>
              {colors.map((c) => (
                <label key={c} className="bk-row">
                  <span className="bk-dot" style={{ background: c }} title={c} />
                  <span>→</span>
                  <select
                    className="bk-select"
                    value={manual[c] ?? ''}
                    onChange={(e) => setManual({ ...manual, [c]: e.target.value })}
                  >
                    <option value="">(sin cambiar)</option>
                    {brandColors.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                className="bk-btn bk-wide"
                onClick={() => apply(Object.fromEntries(Object.entries(manual).filter(([, v]) => v)))}
              >
                Aplicar
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
