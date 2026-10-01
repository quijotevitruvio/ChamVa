import { useRef, useState, type RefObject } from 'react';
import QRCode from 'qrcode';
import { useEditor } from '../editor/state/store';
import { FONT_FAMILIES, SHAPE_OPTIONS, TEXT_PRESETS, type Doc } from '../editor/core/types';
import { isStrokeOnly } from '../editor/core/shapes';
import { loadImageFile } from '../io/import';
import { PRESET_TEMPLATES } from '../editor/core/presetTemplates';
import { searchIcons, iconPreviewUrl, fetchIconAsImage } from '../io/iconify';
import { TemplateThumb } from './TemplateThumb';
import { ColorPanel } from './ColorPanel';
import { Icon } from './Icon';
import { toast } from './toast';
import { TextPresetsPanel } from './TextPresetsPanel';
import { t } from '../i18n';

const TABS = [
  { id: 'subir', icon: 'upload', label: 'Subir' },
  { id: 'texto', icon: 'text', label: 'Texto' },
  { id: 'elementos', icon: 'shapes', label: 'Elementos' },
  { id: 'fondo', icon: 'palette', label: 'Fondo' },
  { id: 'plantillas', icon: 'templates', label: 'Plantillas' },
  { id: 'capas', icon: 'layers', label: 'Capas' },
  { id: 'marca', icon: 'star', label: 'Marca' },
] as const;

const inputStyle = {
  flex: 1,
  minWidth: 0,
  background: 'var(--panel-2)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '7px 9px',
  fontSize: 13,
} as const;

interface Props {
  fileRef: RefObject<HTMLInputElement | null>;
  fontFileRef: RefObject<HTMLInputElement | null>;
  onOpenChart: (mode: 'chart' | 'table') => void;
  onSaveTemplate: () => void;
  onExportTemplates: () => void;
  onImportTemplates: (files: FileList | null) => void;
  onApplyTemplate: (doc: Doc) => void;
}

// Riel izquierdo (pestañas) + su panel desplegable.
export function RailPanels({
  fileRef,
  fontFileRef,
  onOpenChart,
  onSaveTemplate,
  onExportTemplates,
  onImportTemplates,
  onApplyTemplate,
}: Props) {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [iconQuery, setIconQuery] = useState('');
  const [iconResults, setIconResults] = useState<string[]>([]);
  const [iconBusy, setIconBusy] = useState(false);
  const [qrText, setQrText] = useState('https://');
  const templatesFileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);

  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const uploads = useEditor((s) => s.uploads);
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const removeUpload = useEditor((s) => s.removeUpload);
  const templates = useEditor((s) => s.templates);
  const removeTemplate = useEditor((s) => s.removeTemplate);
  const addTextLayer = useEditor((s) => s.addTextLayer);
  const addShapeLayer = useEditor((s) => s.addShapeLayer);
  const reorderLayers = useEditor((s) => s.reorderLayers);
  const selectLayer = useEditor((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const setBackground = useEditor((s) => s.setBackground);
  const brandColors = useEditor((s) => s.brandColors);
  const recentColors = useEditor((s) => s.recentColors);
  const addBrandColor = useEditor((s) => s.addBrandColor);
  const removeBrandColor = useEditor((s) => s.removeBrandColor);
  const brandLogos = useEditor((s) => s.brandLogos);
  const addBrandLogo = useEditor((s) => s.addBrandLogo);
  const removeBrandLogo = useEditor((s) => s.removeBrandLogo);
  const brandFonts = useEditor((s) => s.brandFonts);
  const toggleBrandFont = useEditor((s) => s.toggleBrandFont);
  const customFonts = useEditor((s) => s.customFonts);
  const addFrame = useEditor((s) => s.addFrame);
  const [newBrandColor, setNewBrandColor] = useState('#737373');

  // Un color de marca se aplica al elemento seleccionado; si no hay, al fondo.
  const applyBrandColor = (c: string) => {
    const st = useEditor.getState();
    const l = st.doc.layers.find((x) => x.id === st.selectedId);
    if (l?.type === 'text') st.setTextStyleAll(l.id, { fill: c });
    else if (l?.type === 'shape') st.updateLayer(l.id, { fill: c });
    else setBackground({ type: 'solid', color: c });
  };

  // Una fuente de marca se aplica al texto seleccionado; si no hay, crea uno.
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

  const onUploadLogos = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      try {
        const img = await loadImageFile(file);
        addBrandLogo({
          id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `logo-${Date.now()}`,
          ...img,
        });
      } catch (e) {
        toast('No se pudo cargar el logo: ' + (e as Error).message, 'error');
      }
    }
  };

  const doIconSearch = async () => {
    if (!iconQuery.trim()) return;
    setIconBusy(true);
    setIconResults(await searchIcons(iconQuery));
    setIconBusy(false);
  };
  const addIcon = async (name: string) => {
    try {
      const img = await fetchIconAsImage(name);
      addImageLayer({ ...img, iconName: name });
    } catch (e) {
      console.error(e);
    }
  };
  const addQR = async () => {
    if (!qrText.trim()) return;
    try {
      const src = await QRCode.toDataURL(qrText, { width: 512, margin: 1 });
      addImageLayer({ src, naturalWidth: 512, naturalHeight: 512, name: 'QR' });
    } catch (e) {
      toast('No se pudo generar el QR: ' + (e as Error).message, 'error');
    }
  };

  // Reordenar capas arrastrando en el panel (vista de arriba hacia abajo).
  const handleLayerDrop = (targetId: string) => {
    const id = dragId.current;
    dragId.current = null;
    if (!id || id === targetId) return;
    const topFirst = doc.layers.map((l) => l.id).reverse();
    const without = topFirst.filter((x) => x !== id);
    const ti = without.indexOf(targetId);
    without.splice(ti, 0, id);
    reorderLayers(without.reverse());
  };

  const head = (title: string) => (
    <div className="rail-head">
      <h3>{t(title)}</h3>
      <button className="cp-x" onClick={() => setActiveTab(null)}>
        ✕
      </button>
    </div>
  );

  return (
    <>
      <nav className="rail">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(activeTab === tab.id ? null : tab.id)}
          >
            <span className="rail-ico">
              <Icon name={tab.icon} size={22} />
            </span>
            <span className="rail-lbl">{t(tab.label)}</span>
          </button>
        ))}
      </nav>

      {activeTab && (
        <div className="rail-panel">
          {activeTab === 'subir' && (
            <>
              {head('Subir')}
              <button className="rail-big" onClick={() => fileRef.current?.click()}>
                📁 {t('Subir imagen')}
              </button>
              <button className="rail-big" onClick={() => fontFileRef.current?.click()}>
                🔤 {t('Subir fuente')}
              </button>
              <p className="rail-hint">
                Tus imágenes quedan aquí. Haz clic o arrástralas al lienzo.
              </p>
              {uploads.length > 0 && (
                <div className="uploads-grid">
                  {uploads.map((u) => (
                    <div
                      key={u.id}
                      className="upload-thumb"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/x-chamva-upload', u.id)}
                      onClick={() => addImageLayer(u)}
                      title="Clic o arrastra al lienzo"
                    >
                      <img src={u.src} alt={u.name} />
                      <button
                        className="upload-del"
                        title="Quitar de la galería"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeUpload(u.id);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'texto' && (
            <>
              {head('Texto')}
              <button className="rail-big" onClick={() => addTextLayer()}>
                ＋ {t('Caja de texto')}
              </button>
              {TEXT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className="rail-item"
                  style={{ fontWeight: p.bold ? 500 : 400 }}
                  onClick={() => addTextLayer({ text: p.text, fontSize: p.fontSize, bold: p.bold })}
                >
                  {p.label}
                </button>
              ))}
              <TextPresetsPanel />
            </>
          )}

          {activeTab === 'elementos' && (
            <>
              {head('Elementos')}
              <div className="rail-shapes">
                {SHAPE_OPTIONS.map((s) => (
                  <button key={s.kind} onClick={() => addShapeLayer(s.kind)} title={s.label}>
                    {s.icon}
                  </button>
                ))}
              </div>

              <h4 className="rail-sub">{t('Marcos para fotos')}</h4>
              <p className="rail-hint">Arrastra una foto encima de un marco para rellenarlo.</p>
              <div className="rail-shapes">
                {SHAPE_OPTIONS.filter((s) => !isStrokeOnly(s.kind)).map((s) => (
                  <button
                    key={'frame-' + s.kind}
                    className="frame-btn"
                    onClick={() => addFrame(s.kind)}
                    title={`Marco: ${s.label}`}
                  >
                    {s.icon}
                  </button>
                ))}
              </div>

              <h4 className="rail-sub">{t('Gráficas y tablas')}</h4>
              <div className="row">
                <button className="rail-item" onClick={() => onOpenChart('chart')}>
                  📊 {t('Gráfica')}
                </button>
                <button className="rail-item" onClick={() => onOpenChart('table')}>
                  ▦ {t('Tabla')}
                </button>
              </div>

              <h4 className="rail-sub">{t('Buscar iconos')}</h4>
              <div className="font-row">
                <input
                  type="text"
                  placeholder="Ej: flecha, corazón…"
                  value={iconQuery}
                  onChange={(e) => setIconQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doIconSearch()}
                  style={inputStyle}
                />
                <button className="font-upload" onClick={doIconSearch}>
                  🔍
                </button>
              </div>
              {iconBusy && <p className="rail-hint">Buscando…</p>}
              <div className="icon-grid">
                {iconResults.map((name) => (
                  <button key={name} className="icon-cell" title={name} onClick={() => addIcon(name)}>
                    <img src={iconPreviewUrl(name, 40)} alt={name} />
                  </button>
                ))}
              </div>

              <h4 className="rail-sub">{t('Código QR')}</h4>
              <div className="font-row">
                <input
                  type="text"
                  placeholder="URL o texto"
                  value={qrText}
                  onChange={(e) => setQrText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addQR()}
                  style={inputStyle}
                />
                <button className="font-upload" onClick={addQR}>
                  ▦
                </button>
              </div>
            </>
          )}

          {activeTab === 'fondo' && <ColorPanel embedded onClose={() => setActiveTab(null)} />}

          {activeTab === 'plantillas' && (
            <>
              {head('Plantillas')}
              <button className="rail-big" onClick={onSaveTemplate}>
                💾 {t('Guardar diseño actual')}
              </button>
              <div className="row">
                <button onClick={onExportTemplates} title="Guarda tus plantillas en un archivo para compartir">
                  ⬇ {t('Exportar plantillas')}
                </button>
                <button onClick={() => templatesFileRef.current?.click()}>
                  ⬆ {t('Importar plantillas')}
                </button>
              </div>
              <input
                ref={templatesFileRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  onImportTemplates(e.target.files);
                  e.target.value = '';
                }}
              />

              <h4 className="rail-sub">{t('Prediseñadas')}</h4>
              <div className="uploads-grid">
                {PRESET_TEMPLATES.map((tpl) => (
                  <TemplateThumb key={tpl.id} doc={tpl} label={tpl.name} onClick={() => onApplyTemplate(tpl)} />
                ))}
              </div>

              <h4 className="rail-sub">{t('Mis plantillas')}</h4>
              {templates.length === 0 && (
                <p className="rail-hint">Guarda un diseño y reutilízalo cuando quieras.</p>
              )}
              <div className="uploads-grid">
                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="upload-thumb"
                    onClick={() => onApplyTemplate(tpl.doc)}
                    title={`Aplicar "${tpl.name}"`}
                  >
                    <img src={tpl.thumb} alt={tpl.name} />
                    <button
                      className="upload-del"
                      title="Quitar plantilla"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTemplate(tpl.id);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'capas' && (
            <>
              {head('Capas')}
              {doc.layers.length === 0 && <p className="rail-hint">{t('Aún no hay capas.')}</p>}
              <ul className="layers">
                {[...doc.layers].reverse().map((l) => (
                  <li
                    key={l.id}
                    className={l.id === selectedId ? 'sel' : ''}
                    draggable
                    onDragStart={() => (dragId.current = l.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleLayerDrop(l.id)}
                    onClick={() => selectLayer(l.id)}
                  >
                    <span className="grip" title="Arrastra para reordenar">
                      ⠿
                    </span>
                    <span className="ico">{l.type === 'image' ? '🖼' : l.type === 'text' ? '🅣' : '◻'}</span>
                    <span className="name">{l.type === 'text' ? l.text || 'Texto' : l.name}</span>
                    <button
                      className="mini"
                      title={l.locked ? 'Desbloquear' : 'Bloquear'}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateLayer(l.id, { locked: !l.locked });
                      }}
                    >
                      {l.locked ? '🔒' : '🔓'}
                    </button>
                    <button
                      className="mini"
                      title={l.visible ? 'Ocultar' : 'Mostrar'}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateLayer(l.id, { visible: !l.visible });
                      }}
                    >
                      {l.visible ? '👁' : '🚫'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {activeTab === 'marca' && (
            <>
              {head('Kit de Marca')}

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
                      className="upload-thumb"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/x-chamva-upload', u.id)}
                      onClick={() => addImageLayer(u)}
                      title="Clic o arrastra al lienzo"
                    >
                      <img src={u.src} alt={u.name} />
                      <button
                        className="upload-del"
                        title="Quitar del kit"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBrandLogo(u.id);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="rail-sub">{t('Colores de marca')}</h4>
              <p className="rail-hint">Clic: se aplica al elemento seleccionado (o al fondo).</p>
              <div className="rail-swatches">
                {brandColors.map((c) => (
                  <button
                    key={c}
                    style={{ background: c }}
                    title={`${c} — clic derecho para quitar`}
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
                value=""
                onChange={(e) => e.target.value && toggleBrandFont(e.target.value)}
                style={inputStyle}
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
        </div>
      )}
    </>
  );
}
