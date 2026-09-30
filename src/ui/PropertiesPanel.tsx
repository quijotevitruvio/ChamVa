import type { RefObject } from 'react';
import { useEditor } from '../editor/state/store';
import { DEFAULT_ADJUST, FONT_FAMILIES } from '../editor/core/types';
import { ANIMATIONS } from '../editor/core/animations';
import { fetchIconAsImage } from '../io/iconify';
import { BG_ENGINES } from '../ai/bgcore';
import { cancelAI, type BgQuality, type EdgeMode } from '../ai/worker-client';
import { t } from '../i18n';

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const;

interface Props {
  bgBusy: boolean;
  bgMsg: string;
  bgQuality: BgQuality;
  chooseBgEngine: (q: BgQuality) => void;
  bgEdges: EdgeMode;
  setBgEdges: (m: EdgeMode) => void;
  onRemoveBackground: () => void;
  upBusy: boolean;
  upMsg: string;
  onUpscale: () => void;
  onOpenMask: () => void;
  onShowFilters: () => void;
  onExportLayer: () => void;
  textEditRef: RefObject<HTMLTextAreaElement | null>;
  fontFileRef: RefObject<HTMLInputElement | null>;
}

// Panel derecho: propiedades de la capa seleccionada. Lee el store
// directamente; App solo aporta lo que depende de IA/diálogos.
export function PropertiesPanel({
  bgBusy,
  bgMsg,
  bgQuality,
  chooseBgEngine,
  bgEdges,
  setBgEdges,
  onRemoveBackground,
  upBusy,
  upMsg,
  onUpscale,
  onOpenMask,
  onShowFilters,
  onExportLayer,
  textEditRef,
  fontFileRef,
}: Props) {
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
  const cropMode = useEditor((s) => s.cropMode);
  const beginCrop = useEditor((s) => s.beginCrop);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const customFonts = useEditor((s) => s.customFonts);

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;

  if (!selected) {
    return (
      <aside className="panel">
        <p className="empty">
          Selecciona un elemento para editarlo, o usa el panel de la izquierda
          para añadir.
        </p>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <section className="props">
        <h3>{t('Propiedades')}</h3>

        {selectedIds.length > 1 && (
          <>
            <p className="rail-sub">{selectedIds.length} seleccionados</p>
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
          </>
        )}

        {selected.type === 'image' && (
          <>
            <div className="bg-quality">
              <button className="magic full" onClick={onRemoveBackground} disabled={bgBusy}>
                {bgBusy ? '✂ …' : '✂ Quitar fondo (IA)'}
              </button>
              <select
                value={bgQuality}
                disabled={bgBusy}
                onChange={(e) => chooseBgEngine(e.target.value as BgQuality)}
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
                value={bgEdges}
                disabled={bgBusy}
                onChange={(e) => setBgEdges(e.target.value as EdgeMode)}
                title="Cómo refinar el borde del recorte"
              >
                <option value="auto">{t('Automático')}</option>
                <option value="photo">{t('Foto (suave)')}</option>
                <option value="graphic">{t('Logo / texto (nítido)')}</option>
                <option value="none">{t('Sin refinar')}</option>
              </select>
            </label>
            {bgBusy && (
              <p className="bgmsg">
                {bgMsg}{' '}
                <button className="mini" onClick={cancelAI}>
                  ✕ {t('Cancelar')}
                </button>
              </p>
            )}

            <div className="row">
              <button onClick={() => updateLayer(selected.id, { flipX: !selected.flipX })}>
                ↔ Voltear H
              </button>
              <button onClick={() => updateLayer(selected.id, { flipY: !selected.flipY })}>
                ↕ Voltear V
              </button>
            </div>

            <button className="full" onClick={beginCrop} disabled={cropMode}>
              ⛶ Recortar
            </button>

            <button className="magic full" onClick={onOpenMask}>
              🪄 Borrador / Pincel
            </button>

            <button className="magic full" onClick={onUpscale} disabled={upBusy}>
              {upBusy ? '🔍 …' : '🔍 Optimizar (HD ×2)'}
            </button>
            {upBusy && (
              <p className="bgmsg">
                {upMsg}{' '}
                <button className="mini" onClick={cancelAI}>
                  ✕ {t('Cancelar')}
                </button>
              </p>
            )}

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

        {selected.type === 'text' && (
          <>
            <label className="prop">
              Texto
              <textarea
                ref={textEditRef}
                className="text-edit"
                rows={2}
                value={selected.text}
                onFocus={checkpoint}
                onChange={(e) => updateLayerLive(selected.id, { text: e.target.value })}
              />
            </label>
            <label className="prop">
              Fuente
              <div className="font-row">
                <select
                  value={selected.fontFamily}
                  onChange={(e) => updateLayer(selected.id, { fontFamily: e.target.value })}
                >
                  {customFonts.length > 0 && (
                    <optgroup label="Mis fuentes">
                      {customFonts.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Fuentes">
                    {FONT_FAMILIES.map((f) => (
                      <option key={f} value={f} style={{ fontFamily: f }}>
                        {f}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <button
                  className="font-upload"
                  title="Cargar fuente propia (.ttf/.otf/.woff)"
                  onClick={() => fontFileRef.current?.click()}
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
                  updateLayerLive(selected.id, {
                    fontSize: Math.max(6, Number(e.target.value) || 6),
                  })
                }
                title="Tamaño"
              />
              <input
                type="color"
                value={selected.fill}
                onChange={(e) => updateLayer(selected.id, { fill: e.target.value })}
                title="Color"
              />
              <button
                className={selected.bold ? 'active' : ''}
                onClick={() => updateLayer(selected.id, { bold: !selected.bold })}
                title="Negrita"
              >
                <b>B</b>
              </button>
              <button
                className={selected.italic ? 'active' : ''}
                onClick={() => updateLayer(selected.id, { italic: !selected.italic })}
                title="Cursiva"
              >
                <i>I</i>
              </button>
            </div>
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

            <div className="row">
              {(
                [
                  ['none', 'Aa'],
                  ['upper', 'AA'],
                  ['lower', 'aa'],
                  ['caps', 'Ab'],
                ] as const
              ).map(([mode, lbl]) => (
                <button
                  key={mode}
                  className={selected.textTransform === mode ? 'active' : ''}
                  onClick={() => updateLayer(selected.id, { textTransform: mode })}
                  title={
                    mode === 'none'
                      ? 'Normal'
                      : mode === 'upper'
                        ? 'MAYÚSCULAS'
                        : mode === 'lower'
                          ? 'minúsculas'
                          : 'Capitalizar'
                  }
                >
                  {lbl}
                </button>
              ))}
            </div>

            <label className="prop">
              Espaciado: {Math.round(selected.letterSpacing)}
              <input
                type="range"
                min={-5}
                max={40}
                step={1}
                value={selected.letterSpacing}
                onPointerDown={checkpoint}
                onChange={(e) =>
                  updateLayerLive(selected.id, { letterSpacing: Number(e.target.value) })
                }
              />
            </label>
            <label className="prop">
              Interlineado: {(selected.lineHeight ?? 1).toFixed(2)}
              <input
                type="range"
                min={0.8}
                max={2.5}
                step={0.05}
                value={selected.lineHeight ?? 1}
                onPointerDown={checkpoint}
                onChange={(e) =>
                  updateLayerLive(selected.id, { lineHeight: Number(e.target.value) })
                }
              />
            </label>
            <label className="prop">
              Curvar: {Math.round(selected.curve ?? 0)}°
              <input
                type="range"
                min={-180}
                max={180}
                step={5}
                value={selected.curve ?? 0}
                onPointerDown={checkpoint}
                onChange={(e) => updateLayerLive(selected.id, { curve: Number(e.target.value) })}
              />
            </label>

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
              <button onClick={() => updateLayer(selected.id, { shadow: false })}>
                Sin efecto
              </button>
            </div>

            <label className="prop">
              Lista
              <select
                value={selected.listStyle ?? 'none'}
                onChange={(e) =>
                  updateLayer(selected.id, {
                    listStyle: e.target.value as 'none' | 'bullet' | 'number',
                  })
                }
              >
                <option value="none">Sin lista</option>
                <option value="bullet">• Viñetas</option>
                <option value="number">1. Numerada</option>
              </select>
            </label>
            <label className="prop">
              Efecto de texto
              <select
                value={selected.textEffect ?? 'none'}
                onChange={(e) =>
                  updateLayer(selected.id, {
                    textEffect: e.target.value as 'none' | 'echo' | 'background',
                    effectColor:
                      selected.effectColor ??
                      (e.target.value === 'background' ? '#000000' : selected.fill),
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
                  title="Color del eco / fondo"
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
            <label className="prop">
              Grosor contorno: {Math.round(selected.strokeWidth)}
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={selected.strokeWidth}
                onPointerDown={checkpoint}
                onChange={(e) =>
                  updateLayerLive(selected.id, { strokeWidth: Number(e.target.value) })
                }
              />
            </label>

            <div className="row text-row">
              <button
                className={selected.shadow ? 'active' : ''}
                style={{ flex: 1 }}
                onClick={() => updateLayer(selected.id, { shadow: !selected.shadow })}
              >
                Sombra {selected.shadow ? '✓' : ''}
              </button>
              <input
                type="color"
                value={selected.shadowColor}
                onChange={(e) => updateLayer(selected.id, { shadowColor: e.target.value })}
                title="Color de la sombra"
              />
            </div>
            {selected.shadow && (
              <label className="prop">
                Desenfoque sombra: {Math.round(selected.shadowBlur)}
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={selected.shadowBlur}
                  onPointerDown={checkpoint}
                  onChange={(e) =>
                    updateLayerLive(selected.id, { shadowBlur: Number(e.target.value) })
                  }
                />
              </label>
            )}
          </>
        )}

        {selected.type === 'shape' && (
          <>
            <div className="row text-row">
              <label className="shape-color">
                Relleno
                <input
                  type="color"
                  value={selected.fill}
                  onChange={(e) => updateLayer(selected.id, { fill: e.target.value })}
                />
              </label>
              <label className="shape-color">
                Borde
                <input
                  type="color"
                  value={selected.stroke}
                  onChange={(e) => updateLayer(selected.id, { stroke: e.target.value })}
                />
              </label>
            </div>
            <label className="prop">
              Grosor del borde: {Math.round(selected.strokeWidth)}
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={selected.strokeWidth}
                onPointerDown={checkpoint}
                onChange={(e) =>
                  updateLayerLive(selected.id, { strokeWidth: Number(e.target.value) })
                }
              />
            </label>
            {selected.shape === 'rect' && (
              <label className="prop">
                Esquinas: {Math.round(selected.cornerRadius)}
                <input
                  type="range"
                  min={0}
                  max={Math.round(Math.min(selected.width, selected.height) / 2)}
                  step={1}
                  value={selected.cornerRadius}
                  onPointerDown={checkpoint}
                  onChange={(e) =>
                    updateLayerLive(selected.id, { cornerRadius: Number(e.target.value) })
                  }
                />
              </label>
            )}
          </>
        )}

        <label className="prop">
          {t('Rotación')}: {Math.round(((selected.rotation % 360) + 360) % 360)}°
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={((Math.round(selected.rotation) % 360) + 360) % 360}
            onPointerDown={checkpoint}
            onChange={(e) => setLayerRotation(selected.id, Number(e.target.value), true)}
          />
        </label>
        <div className="row">
          <button
            onClick={() => setLayerRotation(selected.id, selected.rotation - 90)}
            title="Girar 90° a la izquierda"
          >
            ⟲ 90°
          </button>
          <button
            onClick={() => setLayerRotation(selected.id, selected.rotation + 90)}
            title="Girar 90° a la derecha"
          >
            ⟳ 90°
          </button>
        </div>

        <label className="prop">
          {t('Opacidad')}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={selected.opacity}
            onPointerDown={checkpoint}
            onChange={(e) => updateLayerLive(selected.id, { opacity: Number(e.target.value) })}
          />
        </label>

        <label className="prop">
          Mezcla
          <select
            value={selected.blendMode}
            onChange={(e) =>
              updateLayer(selected.id, {
                blendMode: e.target.value as (typeof BLEND_MODES)[number],
              })
            }
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {m === 'normal'
                  ? 'Normal'
                  : m === 'multiply'
                    ? 'Multiplicar'
                    : m === 'screen'
                      ? 'Trama'
                      : m === 'overlay'
                        ? 'Superponer'
                        : m === 'darken'
                          ? 'Oscurecer'
                          : 'Aclarar'}
              </option>
            ))}
          </select>
        </label>

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
        {((selected.anim ?? 'none') !== 'none' || (selected.animOut ?? 'none') !== 'none') && (
          <label className="prop">
            Duración: {(selected.animDuration ?? 0.6).toFixed(1)}s
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.1}
              value={selected.animDuration ?? 0.6}
              onPointerDown={checkpoint}
              onChange={(e) =>
                updateLayerLive(selected.id, { animDuration: Number(e.target.value) })
              }
            />
          </label>
        )}

        {(selected.type === 'image' || selected.type === 'shape') && (
          <>
            <div className="row text-row">
              <button
                className={selected.shadow ? 'active' : ''}
                style={{ flex: 1 }}
                onClick={() => updateLayer(selected.id, { shadow: !selected.shadow })}
              >
                Sombra {selected.shadow ? '✓' : ''}
              </button>
              <input
                type="color"
                value={selected.shadowColor}
                onChange={(e) => updateLayer(selected.id, { shadowColor: e.target.value })}
                title="Color de la sombra"
              />
            </div>
            {selected.shadow && (
              <label className="prop">
                Desenfoque: {Math.round(selected.shadowBlur)}
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={1}
                  value={selected.shadowBlur}
                  onPointerDown={checkpoint}
                  onChange={(e) =>
                    updateLayerLive(selected.id, { shadowBlur: Number(e.target.value) })
                  }
                />
              </label>
            )}
          </>
        )}

        {selected.type === 'image' && (
          <>
            {(
              [
                ['Brillo', 'brightness'],
                ['Contraste', 'contrast'],
                ['Saturación', 'saturate'],
              ] as const
            ).map(([label, key]) => (
              <label className="prop" key={key}>
                {label}
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.01}
                  value={selected.adjust?.[key] ?? 1}
                  onPointerDown={checkpoint}
                  onChange={(e) =>
                    updateLayerLive(selected.id, {
                      adjust: { ...(selected.adjust ?? DEFAULT_ADJUST), [key]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}

            <button className="magic full" onClick={onShowFilters}>
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
                <option value="ellipse">Círculo</option>
                <option value="rect">Rectángulo</option>
                <option value="triangle">Triángulo</option>
                <option value="star">Estrella</option>
              </select>
            </label>

            {selected.iconName && (
              <label className="prop">
                Color del icono
                <input
                  type="color"
                  onChange={async (e) => {
                    const color = e.target.value;
                    const name = selected.iconName!;
                    try {
                      const img = await fetchIconAsImage(name, 300, color);
                      updateLayer(selected.id, { src: img.src });
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                />
              </label>
            )}
          </>
        )}
        <div className="row">
          <button onClick={() => moveLayer(selected.id, 'up')}>⬆ Subir</button>
          <button onClick={() => moveLayer(selected.id, 'down')}>⬇ Bajar</button>
        </div>
        <div className="row">
          <button onClick={() => updateLayer(selected.id, { locked: !selected.locked })}>
            {selected.locked ? '🔓 Desbloquear' : '🔒 Bloquear'}
          </button>
          <button onClick={() => duplicateLayer(selected.id)}>⧉ Duplicar</button>
        </div>
        <button className="full" onClick={onExportLayer}>
          ⬇ Exportar esta capa (PNG)
        </button>
        <button className="danger full" onClick={() => removeLayer(selected.id)}>
          🗑 Borrar capa
        </button>
      </section>
    </aside>
  );
}
