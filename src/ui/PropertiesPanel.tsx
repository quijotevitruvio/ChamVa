import { RecolorWithPalette } from './BrandKitPanel';
import { setPageLocked } from './pageActions';
import { FillControl } from './GradientEditor';
import { ContrastBadge } from './ContrastChecker';
import { toHex6 } from '../editor/core/gradients';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { useEditor } from '../editor/state/store';
import { SHAPE_OPTIONS, type BrushStyle, type Gradient, type Layer, type TextLayer } from '../editor/core/types';
import { BRUSHES, resizePatch } from '../editor/core/brush';
import { isStrokeOnly } from '../editor/core/shapes';
import { toggleTarget, resolveCharStyles } from '../editor/core/richText';
import { ANIMATIONS } from '../editor/core/animations';
import { fetchIconAsImage } from '../io/iconify';
import { loadImageFile } from '../io/import';
import { BG_ENGINES } from '../ai/bgcore';
import { cancelAI, type BgQuality, type EdgeMode } from '../ai/worker-client';
import { AdjustPanel } from './AdjustPanel';
import { ImageGeoTools } from './ImageGeoTools';
import { ReflectionSection } from './ReflectionSection';
import { toast } from './toast';
import { t } from '../i18n';
import { FontPicker, MissingFontNotice } from './FontPicker';
import { SymbolPicker } from './SymbolPicker';
import { TextTypography } from './TextTypography';
import { TextEffectsPlus } from './TextEffectsPlus';
import { openFindReplace } from './FindReplace';
import { textStats, formatReadingTime } from '../editor/core/textSearch';
import { loremText, type LoremKind } from '../editor/core/loremText';
import './texttools.css';
import './props-extra.css';
import { StrokeGradient } from './StrokeGradient';
import { SharedStyles } from './SharedStyles';
import { Constraints } from './Constraints';
import { LayerBlendButton } from './BlendPicker';


// Sección plegable; recuerda si el usuario la dejó abierta o cerrada.
function Section({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const key = `chamva.sec.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  return (
    <details
      className="prop-section"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(o);
        try {
          localStorage.setItem(key, o ? '1' : '0');
        } catch {
          /* noop */
        }
      }}
    >
      <summary>{t(title)}</summary>
      <div className="prop-section-body">{children}</div>
    </details>
  );
}

// Contador de palabras/caracteres y tiempo de lectura (200 ppm) bajo el cuadro de texto.
function TextStatsLine({ text }: { text: string }) {
  const s = textStats(text);
  return (
    <p className="tt-stats">
      {s.words} {t('palabras')} · {s.chars} {t('caracteres')} · {t('lectura')} {formatReadingTime(s.readingSeconds)}
    </p>
  );
}

interface Props {
  bgBusy: boolean;
  bgMsg: string;
  bgQuality: BgQuality;
  chooseBgEngine: (q: BgQuality) => void;
  bgEdges: EdgeMode;
  setBgEdges: (m: EdgeMode) => void;
  onRemoveBackground: () => void;
  onPortraitBlur: () => void;
  upBusy: boolean;
  upMsg: string;
  onUpscale: () => void;
  onOpenMask: () => void;
  onShowFilters: () => void;
  onExportLayer: () => void;
  onEditChart: (layerId: string) => void;
  textEditRef: RefObject<HTMLTextAreaElement | null>;
  fontFileRef: RefObject<HTMLInputElement | null>;
  className?: string;
  onCloseSheet?: () => void; // móvil: cerrar la hoja inferior
}

export function PropertiesPanel(p: Props) {
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const updateLayer = useEditor((s) => s.updateLayer);
  const updateLayerLive = useEditor((s) => s.updateLayerLive);
  const setLayerRotation = useEditor((s) => s.setLayerRotation);
  const checkpoint = useEditor((s) => s.checkpoint);
  const moveLayer = useEditor((s) => s.moveLayer);
  const alignLayer = useEditor((s) => s.alignLayer);
  const alignSelected = useEditor((s) => s.alignSelected);
  const distributeSelected = useEditor((s) => s.distributeSelected);
  const groupSelected = useEditor((s) => s.groupSelected);
  const ungroupSelected = useEditor((s) => s.ungroupSelected);
  const cropMode = useEditor((s) => s.cropMode);
  const beginCrop = useEditor((s) => s.beginCrop);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const removeSelected = useEditor((s) => s.removeSelected);
  const textSel = useEditor((s) => s.textSel);
  const setTextSel = useEditor((s) => s.setTextSel);
  const styleTextRange = useEditor((s) => s.styleTextRange);
  const setTextStyleAll = useEditor((s) => s.setTextStyleAll);
  const requestTextEdit = useEditor((s) => s.requestTextEdit);
  const fillFrame = useEditor((s) => s.fillFrame);
  const frameFileRef = useRef<HTMLInputElement>(null);

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const cls = `panel ${p.className ?? ''}`;

  if (!selected) {
    return (
      <aside className={cls}>
        <p className="empty">
          Selecciona un elemento para editarlo, o usa el panel de la izquierda para añadir.
        </p>
      </aside>
    );
  }

  const multi = selectedIds.length > 1;
  const inGroup = !!selected.groupId;
  const maskShapes = SHAPE_OPTIONS.filter((s) => !isStrokeOnly(s.kind));

  // Recuerda qué parte del texto está seleccionada en el cuadro del panel.
  const captureSel = (el: HTMLTextAreaElement) =>
    setTextSel({ id: selected.id, start: el.selectionStart, end: el.selectionEnd });

  // Inserta un símbolo en la posición del cursor del cuadro de texto.
  const insertSymbol = (l: TextLayer, sym: string) => {
    const ta = p.textEditRef.current;
    const a = ta ? Math.min(ta.selectionStart, l.text.length) : l.text.length;
    const b = ta ? Math.min(ta.selectionEnd, l.text.length) : a;
    updateLayer(l.id, { text: l.text.slice(0, a) + sym + l.text.slice(b) });
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.selectionStart = ta.selectionEnd = a + sym.length;
    });
  };
  // Texto de relleno: las capas no ajustan a un ancho, el texto se corta a ~70 % del lienzo.
  const loremWidth = (fontSize: number) =>
    Math.max(12, Math.min(80, Math.round((doc.width * 0.7) / (fontSize * 0.55))));
  const fillLorem = (l: TextLayer, kind: LoremKind) => {
    const patch: Partial<TextLayer> = { text: loremText(kind, loremWidth(l.fontSize)) };
    if (kind === 'list') patch.listStyle = 'bullet';
    else if (l.listStyle && l.listStyle !== 'none') patch.listStyle = 'none';
    updateLayer(l.id, patch);
  };
  const newLorem = (l: TextLayer) => {
    const st = useEditor.getState();
    const size = Math.min(l.fontSize, 40);
    st.beginBatch();
    try {
      st.addTextLayer({ text: loremText('p1', loremWidth(size)), fontSize: size, bold: false });
      const id = useEditor.getState().selectedId;
      if (id) st.updateLayer(id, { name: 'Texto de ejemplo', fontFamily: l.fontFamily, fill: l.fill });
    } finally {
      st.endBatch();
    }
  };

  // --- estilo de texto: a la palabra seleccionada o a todo el texto ---
  const rangeOf = (l: TextLayer) =>
    textSel && textSel.id === l.id && textSel.end > textSel.start ? textSel : null;
  const toggleText = (l: TextLayer, key: 'bold' | 'italic' | 'underline') => {
    const r = rangeOf(l);
    if (r) styleTextRange(l.id, r.start, r.end, { [key]: toggleTarget(l, r.start, r.end, key) });
    else setTextStyleAll(l.id, { [key]: !l[key] });
  };
  const isActive = (l: TextLayer, key: 'bold' | 'italic' | 'underline') => {
    const r = rangeOf(l);
    return r ? !toggleTarget(l, r.start, r.end, key) : !!l[key];
  };
  const colorOf = (l: TextLayer) => {
    const r = rangeOf(l);
    return r ? resolveCharStyles(l)[r.start]?.color ?? l.fill : l.fill;
  };
  const setTextColor = (l: TextLayer, c: string) => {
    const r = rangeOf(l);
    if (r) styleTextRange(l.id, r.start, r.end, { color: c });
    else setTextStyleAll(l.id, { fill: c });
  };

  // «Color | Degradado» del texto: el degradado aplica a todo el texto; el
  // color con una palabra seleccionada sigue siendo sólido y solo de ese rango.
  const onTextFill = (
    l: TextLayer,
    patch: { fill?: string; fillGradient?: Gradient | undefined },
  ) => {
    if (patch.fillGradient) updateLayer(l.id, { fillGradient: patch.fillGradient });
    else if ('fillGradient' in patch && !rangeOf(l)) updateLayer(l.id, { fill: patch.fill ?? l.fill, fillGradient: undefined });
    else if (patch.fill !== undefined) setTextColor(l, patch.fill);
  };

  const range = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    shown?: string,
  ) => (
    <label className="prop">
      {label}: {shown ?? Math.round(value)}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={checkpoint}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );

  const shadowControls = (l: Layer & { shadow: boolean; shadowColor: string; shadowBlur: number }) => (
    <>
      <div className="row text-row">
        <button
          className={l.shadow ? 'active' : ''}
          style={{ flex: 1 }}
          onClick={() => updateLayer(l.id, { shadow: !l.shadow })}
        >
          Sombra {l.shadow ? '✓' : ''}
        </button>
        <input
          type="color"
          value={l.shadowColor}
          onChange={(e) => updateLayer(l.id, { shadowColor: e.target.value })}
          title="Color de la sombra"
        />
      </div>
      {l.shadow &&
        range('Desenfoque', l.shadowBlur, 0, 60, 1, (v) => updateLayerLive(l.id, { shadowBlur: v }))}
    </>
  );

  // Controles comunes (posición, giro, transparencia, mezcla, animación) para «Más opciones».
  const commonMore = (
    <>
        <div className="more-group">
          <span className="more-title">{t('Posición, giro y transparencia')}</span>
          {range(
            t('Rotación'),
            ((Math.round(selected.rotation) % 360) + 360) % 360,
            0,
            360,
            1,
            (v) => setLayerRotation(selected.id, v, true),
            `${Math.round(((selected.rotation % 360) + 360) % 360)}°`,
          )}
          <div className="row">
            <button onClick={() => setLayerRotation(selected.id, selected.rotation - 90)} title="Girar 90° a la izquierda">
              ⟲ 90°
            </button>
            <button onClick={() => setLayerRotation(selected.id, selected.rotation + 90)} title="Girar 90° a la derecha">
              ⟳ 90°
            </button>
          </div>
          {range(
            t('Opacidad'),
            selected.opacity,
            0,
            1,
            0.01,
            (v) => useEditor.getState().setOpacityLive(v),
            `${Math.round(selected.opacity * 100)}%`,
          )}
          <div className="prop-blend">
            <span id="prop-blend-label">{t('Fusión')}</span>
            <LayerBlendButton />
          </div>
          {!multi && (
            <>
              <span className="rail-sub">Alinear en la página</span>
              <div className="align-grid">
                <button onClick={() => alignLayer(selected.id, 'left')} title="Izquierda">⬅</button>
                <button onClick={() => alignLayer(selected.id, 'centerH')} title="Centro H">⬌</button>
                <button onClick={() => alignLayer(selected.id, 'right')} title="Derecha">➡</button>
                <button onClick={() => alignLayer(selected.id, 'top')} title="Arriba">⬆</button>
                <button onClick={() => alignLayer(selected.id, 'centerV')} title="Centro V">⬍</button>
                <button onClick={() => alignLayer(selected.id, 'bottom')} title="Abajo">⬇</button>
              </div>
            </>
          )}
          <div className="row">
            <button onClick={() => moveLayer(selected.id, 'up')}>⬆ Subir capa</button>
            <button onClick={() => moveLayer(selected.id, 'down')}>⬇ Bajar capa</button>
          </div>
        </div>

        <div className="more-group">
          <span className="more-title">{t('Animación')}</span>
          <label className="prop">
            Entrada
            <select
              value={selected.anim ?? 'none'}
              onChange={(e) => updateLayer(selected.id, { anim: e.target.value })}
            >
              {ANIMATIONS.map((an) => (
                <option key={an.id} value={an.id}>
                  {an.label}
                </option>
              ))}
            </select>
          </label>
          <label className="prop">
            Salida
            <select
              value={selected.animOut ?? 'none'}
              onChange={(e) => updateLayer(selected.id, { animOut: e.target.value })}
            >
              {ANIMATIONS.map((an) => (
                <option key={an.id} value={an.id}>
                  {an.label}
                </option>
              ))}
            </select>
          </label>
          {((selected.anim ?? 'none') !== 'none' || (selected.animOut ?? 'none') !== 'none') &&
            range(
              'Duración',
              selected.animDuration ?? 0.6,
              0.2,
              3,
              0.1,
              (v) => updateLayerLive(selected.id, { animDuration: v }),
              `${(selected.animDuration ?? 0.6).toFixed(1)}s`,
            )}
        </div>
        <SharedStyles layer={selected} />
        <Constraints layer={selected} />
    </>
  );

  return (
    <aside className={cls}>
      <section className="props">
        <div className="props-head">
          <h3>{t('Propiedades')}</h3>
          {p.onCloseSheet && (
            <button className="sheet-close" onClick={p.onCloseSheet} title="Cerrar">
              ✕
            </button>
          )}
        </div>

        {doc.locked && (
          <p className="rail-sub">
            🔒 {t('Página bloqueada: sus capas no se mueven, giran ni borran.')}{' '}
            <button onClick={() => setPageLocked(doc.id, false)}>{t('Desbloquear página')}</button>
          </p>
        )}

        {(multi || inGroup) && (
          <Section id="group" title="Selección y grupo" defaultOpen>
            {multi && <p className="rail-sub">{selectedIds.length} seleccionados</p>}
            <div className="row">
              {multi && !selectedIds.every((id) => doc.layers.find((l) => l.id === id)?.groupId === selected.groupId && selected.groupId) && (
                <button onClick={groupSelected} title="Ctrl+G">
                  🔗 {t('Agrupar')}
                </button>
              )}
              {inGroup && (
                <button onClick={ungroupSelected} title="Ctrl+Shift+G">
                  ⛓‍💥 {t('Desagrupar')}
                </button>
              )}
            </div>
            {inGroup && !multi && (
              <p className="rail-hint">Editas un elemento suelto del grupo (doble clic para entrar).</p>
            )}
            {multi && (
              <>
                <div className="align-grid">
                  <button onClick={() => alignSelected('left')} title="Izquierda">⬅</button>
                  <button onClick={() => alignSelected('centerH')} title="Centro H">⬌</button>
                  <button onClick={() => alignSelected('right')} title="Derecha">➡</button>
                  <button onClick={() => alignSelected('top')} title="Arriba">⬆</button>
                  <button onClick={() => alignSelected('centerV')} title="Centro V">⬍</button>
                  <button onClick={() => alignSelected('bottom')} title="Abajo">⬇</button>
                </div>
                {selectedIds.length >= 3 && (
                  <div className="row">
                    <button onClick={() => distributeSelected('h')}>Distribuir H</button>
                    <button onClick={() => distributeSelected('v')}>Distribuir V</button>
                  </div>
                )}
                <button className="danger full" onClick={removeSelected}>
                  🗑 Borrar selección
                </button>
              </>
            )}
          </Section>
        )}

        {selected.type === 'image' && (
          <>
            {(selected.chart || selected.table) && (
              <button className="magic full" onClick={() => p.onEditChart(selected.id)}>
                ✏ {selected.chart ? t('Editar gráfica') : t('Editar tabla')}
              </button>
            )}

            <Section id="img-bg" title="Quitar fondo" defaultOpen>
              <div className="bg-quality">
                <button className="magic full" onClick={p.onRemoveBackground} disabled={p.bgBusy}>
                  {p.bgBusy ? '✂ …' : '✂ Quitar fondo (IA)'}
                </button>
                <select
                  value={p.bgQuality}
                  disabled={p.bgBusy}
                  onChange={(e) => p.chooseBgEngine(e.target.value as BgQuality)}
                  title="Motor de IA para quitar el fondo (todos locales)"
                >
                  {BG_ENGINES.map((en) => (
                    <option key={en.id} value={en.id}>
                      {en.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="prop">
                {t('Bordes')}
                <select
                  value={p.bgEdges}
                  disabled={p.bgBusy}
                  onChange={(e) => p.setBgEdges(e.target.value as EdgeMode)}
                  title="Cómo refinar el borde del recorte"
                >
                  <option value="auto">{t('Automático')}</option>
                  <option value="photo">{t('Foto (suave)')}</option>
                  <option value="graphic">{t('Logo / texto (nítido)')}</option>
                  <option value="none">{t('Sin refinar')}</option>
                </select>
              </label>
              <button
                className="full"
                onClick={p.onPortraitBlur}
                disabled={p.bgBusy}
                title="Deja la persona nítida y desenfoca lo de atrás"
              >
                🌫 {t('Desenfocar fondo (retrato)')}
              </button>
              {p.bgBusy && (
                <p className="bgmsg">
                  {p.bgMsg}{' '}
                  <button className="mini" onClick={cancelAI}>
                    ✕ {t('Cancelar')}
                  </button>
                </p>
              )}
            </Section>

            <Section id="img-edit" title="Editar foto" defaultOpen>
              <div className="row">
                <button onClick={() => updateLayer(selected.id, { flipX: !selected.flipX })}>↔ Voltear H</button>
                <button onClick={() => updateLayer(selected.id, { flipY: !selected.flipY })}>↕ Voltear V</button>
              </div>
              <div className="row">
                <button onClick={beginCrop} disabled={cropMode}>
                  ⛶ Recortar
                </button>
                <button onClick={p.onOpenMask}>🪄 Borrador</button>
              </div>
              <ImageGeoTools layer={selected} />
              <button className="magic full" onClick={p.onUpscale} disabled={p.upBusy}>
                {p.upBusy ? '🔍 …' : '🔍 Optimizar (HD ×2)'}
              </button>
              {p.upBusy && (
                <p className="bgmsg">
                  {p.upMsg}{' '}
                  <button className="mini" onClick={cancelAI}>
                    ✕ {t('Cancelar')}
                  </button>
                </p>
              )}
            </Section>

            <Section id="img-adjust" title="Ajustes de luz y color">
              <AdjustPanel layer={selected} />
            </Section>

            <Section id="more-image" title="Más opciones">
              <button className="magic full" onClick={p.onShowFilters}>
                🎨 Filtros y Duotono
              </button>
              <label className="prop">
                Recortar a forma
                <select
                  value={selected.maskShape ?? ''}
                  onChange={(e) =>
                    updateLayer(selected.id, {
                      maskShape: (e.target.value || undefined) as typeof selected.maskShape,
                    })
                  }
                >
                  <option value="">Ninguna</option>
                  {maskShapes.map((s) => (
                    <option key={s.kind} value={s.kind}>
                      {s.icon} {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {selected.iconName && (
                <label className="prop">
                  Color del icono
                  <input
                    type="color"
                    onChange={async (e) => {
                      const color = e.target.value;
                      try {
                        const img = await fetchIconAsImage(selected.iconName!, 300, color);
                        updateLayer(selected.id, { src: img.src });
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                  />
                </label>
              )}
              <RecolorWithPalette layer={selected} />
              <div className="more-group">
                <span className="more-title">{t('Sombra')}</span>
                {shadowControls(selected)}
              </div>
              <ReflectionSection layer={selected} />
              {commonMore}
            </Section>
          </>
        )}

        {selected.type === 'text' && (
          <>
            <Section id="txt-main" title="Texto" defaultOpen>
              <label className="prop">
                Texto
                <textarea
                  ref={p.textEditRef}
                  className="text-edit"
                  rows={2}
                  value={selected.text}
                  onFocus={checkpoint}
                  onSelect={(e) => captureSel(e.currentTarget)}
                  onMouseUp={(e) => captureSel(e.currentTarget)}
                  onKeyUp={(e) => captureSel(e.currentTarget)}
                  onChange={(e) => updateLayerLive(selected.id, { text: e.target.value })}
                />
              </label>
              <TextStatsLine text={selected.text} />
              <div className="tt-tools">
                <SymbolPicker onPick={(sym) => insertSymbol(selected, sym)} />
                <select
                  value=""
                  title={t('Texto de ejemplo')}
                  onChange={(e) => {
                    if (e.target.value) fillLorem(selected, e.target.value as LoremKind);
                  }}
                >
                  <option value="">{t('Texto de ejemplo…')}</option>
                  <option value="p1">{t('1 párrafo')}</option>
                  <option value="p3">{t('3 párrafos')}</option>
                  <option value="list">{t('Lista')}</option>
                </select>
                <button title={t('Crear una capa nueva con texto de ejemplo')} onClick={() => newLorem(selected)}>
                  + {t('Capa de ejemplo')}
                </button>
                <button title="Ctrl+F" onClick={openFindReplace}>
                  {t('Buscar y reemplazar')}
                </button>
              </div>
              <p className="rail-hint">
                {rangeOf(selected)
                  ? '✨ Los botones B / I / U y el color se aplican a la selección.'
                  : 'Selecciona una palabra (aquí o con doble clic en el lienzo) para darle estilo solo a ella.'}
              </p>
              <button className="full" onClick={() => requestTextEdit(selected.id)}>
                ✎ {t('Editar sobre el diseño')}
              </button>
              <MissingFontNotice layerId={selected.id} family={selected.fontFamily} />
              <label className="prop">
                Fuente
                <div className="font-row">
                  <FontPicker
                    value={selected.fontFamily}
                    sample={selected.text}
                    onPick={(f) => updateLayer(selected.id, { fontFamily: f })}
                  />
                  <button
                    className="font-upload"
                    title="Cargar fuente propia (.ttf/.otf/.woff)"
                    onClick={() => p.fontFileRef.current?.click()}
                  >
                    ⬆
                  </button>
                </div>
              </label>
              <div className="row text-row">
                <input
                  type="number"
                  min={6}
                  value={Math.round(selected.fontSize)}
                  onFocus={checkpoint}
                  onChange={(e) =>
                    updateLayerLive(selected.id, { fontSize: Math.max(6, Number(e.target.value) || 6) })
                  }
                  title="Tamaño"
                />
                <button
                  className={isActive(selected, 'bold') ? 'active' : ''}
                  onClick={() => toggleText(selected, 'bold')}
                  title="Negrita"
                >
                  <b>B</b>
                </button>
                <button
                  className={isActive(selected, 'italic') ? 'active' : ''}
                  onClick={() => toggleText(selected, 'italic')}
                  title="Cursiva"
                >
                  <i>I</i>
                </button>
                <button
                  className={isActive(selected, 'underline') ? 'active' : ''}
                  onClick={() => toggleText(selected, 'underline')}
                  title="Subrayado"
                >
                  <u>U</u>
                </button>
              </div>
              <span className="rail-label">
                {t('Color del texto')} <ContrastBadge fg={colorOf(selected)} />
              </span>
              <FillControl
                fill={colorOf(selected)}
                gradient={rangeOf(selected) ? undefined : selected.fillGradient}
                onChange={(patch) => onTextFill(selected, patch)}
              />
              <div className="row">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button
                    key={a}
                    className={selected.align === a ? 'active' : ''}
                    onClick={() => updateLayer(selected.id, { align: a })}
                  >
                    {a === 'left' ? '⬅' : a === 'center' ? '⬌' : '➡'}
                  </button>
                ))}
              </div>
            </Section>

            <Section id="more-text" title="Más opciones">
            <div className="more-group">
              <span className="more-title">{t('Espaciado, mayúsculas y listas')}</span>
              <div className="row">
                {(
                  [
                    ['none', 'Aa', 'Normal'],
                    ['upper', 'AA', 'MAYÚSCULAS'],
                    ['lower', 'aa', 'minúsculas'],
                    ['caps', 'Ab', 'Capitalizar'],
                  ] as const
                ).map(([mode, lbl, title]) => (
                  <button
                    key={mode}
                    className={selected.textTransform === mode ? 'active' : ''}
                    onClick={() => updateLayer(selected.id, { textTransform: mode })}
                    title={title}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              {range('Espaciado', selected.letterSpacing, -5, 40, 1, (v) =>
                updateLayerLive(selected.id, { letterSpacing: v }),
              )}
              {range(
                'Interlineado',
                selected.lineHeight ?? 1,
                0.8,
                2.5,
                0.05,
                (v) => updateLayerLive(selected.id, { lineHeight: v }),
                (selected.lineHeight ?? 1).toFixed(2),
              )}
              {range(
                'Curvar',
                selected.curve ?? 0,
                -180,
                180,
                5,
                (v) => updateLayerLive(selected.id, { curve: v }),
                `${Math.round(selected.curve ?? 0)}°`,
              )}
              <label className="prop">
                Lista
                <select
                  value={selected.listStyle ?? 'none'}
                  onChange={(e) =>
                    updateLayer(selected.id, { listStyle: e.target.value as 'none' | 'bullet' | 'number' })
                  }
                >
                  <option value="none">Sin lista</option>
                  <option value="bullet">• Viñetas</option>
                  <option value="number">1. Numerada</option>
                </select>
              </label>
            </div>

            <div className="more-group">
              <span className="more-title">{t('Efectos de texto')}</span>
              <div className="row">
                <button
                  onClick={() =>
                    updateLayer(selected.id, {
                      shadow: true,
                      shadowColor: selected.fill,
                      shadowBlur: Math.round(selected.fontSize * 0.5),
                      shadowX: 0,
                      shadowY: 0,
                    })
                  }
                  title="Resplandor de neón"
                >
                  ✨ Neón
                </button>
                <button onClick={() => updateLayer(selected.id, { shadow: false, textEffect: 'none', strokeWidth: 0 })}>
                  Sin efecto
                </button>
              </div>
              <label className="prop">
                Efecto
                <select
                  value={selected.textEffect ?? 'none'}
                  onChange={(e) =>
                    updateLayer(selected.id, {
                      textEffect: e.target.value as 'none' | 'echo' | 'background',
                      effectColor:
                        selected.effectColor ?? (e.target.value === 'background' ? '#000000' : selected.fill),
                    })
                  }
                >
                  <option value="none">Ninguno</option>
                  <option value="echo">Eco</option>
                  <option value="background">Fondo</option>
                </select>
              </label>
              {selected.textEffect && selected.textEffect !== 'none' && (
                <div className="row text-row">
                  <span style={{ fontSize: 13, flex: 1 }}>Color del efecto</span>
                  <input
                    type="color"
                    value={selected.effectColor ?? '#000000'}
                    onChange={(e) => updateLayer(selected.id, { effectColor: e.target.value })}
                  />
                </div>
              )}
              <div className="row text-row">
                <span style={{ fontSize: 13, flex: 1 }}>Contorno</span>
                <input
                  type="color"
                  value={selected.strokeColor}
                  onChange={(e) => updateLayer(selected.id, { strokeColor: e.target.value })}
                  title="Color del contorno"
                />
              </div>
              {range('Grosor contorno', selected.strokeWidth, 0, 20, 1, (v) =>
                updateLayerLive(selected.id, { strokeWidth: v }),
              )}
              {shadowControls(selected)}
              <TextEffectsPlus layer={selected} />
            </div>
              <TextTypography layer={selected} />
              {commonMore}
            </Section>
          </>
        )}

        {selected.type === 'shape' && (
          <Section id="shape" title={selected.frame ? 'Marco' : 'Forma'} defaultOpen>
            {selected.frame && (
              <>
                <button className="magic full" onClick={() => frameFileRef.current?.click()}>
                  🖼 {t('Poner una foto en el marco')}
                </button>
                <input
                  ref={frameFileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    try {
                      await fillFrame(selected.id, await loadImageFile(file));
                    } catch (err) {
                      toast('No se pudo poner la foto: ' + (err as Error).message, 'error');
                    }
                  }}
                />
                <p className="rail-hint">También puedes arrastrar una foto encima del marco.</p>
              </>
            )}
            <span className="rail-label">Relleno</span>
            <FillControl
              fill={selected.fill}
              gradient={selected.fillGradient}
              onChange={(patch) => updateLayer(selected.id, patch)}
            />
            <div className="row text-row">
              <label className="shape-color">
                Borde
                <input
                  type="color"
                  value={toHex6(selected.stroke)}
                  onChange={(e) => updateLayer(selected.id, { stroke: e.target.value })}
                />
              </label>
              <button
                className="no-border-btn"
                disabled={selected.strokeWidth === 0}
                onClick={() => updateLayer(selected.id, { strokeWidth: 0 })}
                title="Quitar el borde"
              >
                Sin borde
              </button>
            </div>
            {range('Grosor del borde', selected.strokeWidth, 0, 40, 1, (v) =>
              updateLayerLive(selected.id, { strokeWidth: v }),
            )}
            <StrokeGradient layer={selected} />
            {selected.shape === 'rect' &&
              range(
                'Esquinas',
                selected.cornerRadius,
                0,
                Math.round(Math.min(selected.width, selected.height) / 2),
                1,
                (v) => updateLayerLive(selected.id, { cornerRadius: v }),
              )}
          </Section>
        )}

        {selected.type === 'stroke' && (
          <Section id="stroke" title="Trazo" defaultOpen>
            <div className="row text-row">
              <label className="shape-color">
                Color
                <input
                  type="color"
                  value={toHex6(selected.color)}
                  onChange={(e) => updateLayer(selected.id, { color: e.target.value })}
                />
              </label>
              <label className="shape-color">
                Pincel
                <select
                  value={selected.brush}
                  onChange={(e) => updateLayer(selected.id, { brush: e.target.value as BrushStyle })}
                >
                  {BRUSHES.map((b) => (
                    <option key={b.id} value={b.id}>
                      {t(b.label)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {range('Grosor', selected.size, 1, 200, 1, (v) => updateLayerLive(selected.id, resizePatch(selected, v)))}
          </Section>
        )}

        {selected.type === 'stroke' && (
          <Section id="more-stroke" title="Más opciones">
            {commonMore}
          </Section>
        )}

        {selected.type === 'shape' && (
          <Section id="more-shape" title="Más opciones">
            <div className="more-group">
              <span className="more-title">{t('Sombra')}</span>
              {shadowControls(selected)}
            </div>
            {commonMore}
          </Section>
        )}

        <div className="props-actions">
          <div className="row">
            <button onClick={() => updateLayer(selected.id, { locked: !selected.locked })}>
              {selected.locked ? '🔓 Desbloquear' : '🔒 Bloquear'}
            </button>
            <button onClick={() => duplicateLayer(selected.id)}>⧉ Duplicar</button>
          </div>
          <button className="full" onClick={p.onExportLayer}>
            ⬇ Exportar esta capa (PNG)
          </button>
          <button className="danger full" onClick={() => removeLayer(selected.id)}>
            🗑 Borrar capa
          </button>
        </div>
      </section>
    </aside>
  );
}
