import { useRef, useState, type RefObject } from 'react';
import QRCode from 'qrcode';
import { useEditor } from '../editor/state/store';
import { SHAPE_OPTIONS, TEXT_PRESETS, type Doc } from '../editor/core/types';
import { PRESET_TEMPLATES } from '../editor/core/presetTemplates';
import { searchIcons, iconPreviewUrl, fetchIconAsImage } from '../io/iconify';
import { TemplateThumb } from './TemplateThumb';
import { ColorPanel } from './ColorPanel';
import { Icon } from './Icon';
import { toast } from './toast';
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
  dragUploadId: RefObject<string | null>;
  onSaveTemplate: () => void;
  onExportTemplates: () => void;
  onImportTemplates: (files: FileList | null) => void;
  onApplyTemplate: (doc: Doc) => void;
}

// Riel izquierdo (pestañas) + su panel desplegable.
export function RailPanels({
  fileRef,
  fontFileRef,
  dragUploadId,
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
                      onDragStart={() => (dragUploadId.current = u.id)}
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
              <p className="rail-hint">
                Guarda colores desde el panel <b>Fondo</b> (+ Añadir). Aquí los reutilizas como fondo.
              </p>
              {brandColors.length > 0 && (
                <>
                  <h4 className="rail-sub">{t('Mis colores')}</h4>
                  <div className="rail-swatches">
                    {brandColors.map((c) => (
                      <button key={c} style={{ background: c }} title={c} onClick={() => setBackground({ type: 'solid', color: c })} />
                    ))}
                  </div>
                </>
              )}
              {recentColors.length > 0 && (
                <>
                  <h4 className="rail-sub">{t('Recientes')}</h4>
                  <div className="rail-swatches">
                    {recentColors.map((c) => (
                      <button key={c} style={{ background: c }} title={c} onClick={() => setBackground({ type: 'solid', color: c })} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
