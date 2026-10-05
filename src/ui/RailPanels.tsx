import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { UploadThumb } from './UploadThumb';
import QRCode from 'qrcode';
import { useEditor } from '../editor/state/store';
import { SHAPE_OPTIONS, TEXT_PRESETS, type Doc } from '../editor/core/types';
import { isStrokeOnly } from '../editor/core/shapes';
import { searchIcons, iconPreviewUrl, fetchIconAsImage } from '../io/iconify';
import { TemplateLists } from './TemplateLists';
import { ColorPanel } from './ColorPanel';
import { Icon } from './Icon';
import { toast } from './toast';
import { TextPresetsPanel } from './TextPresetsPanel';
import { LayersTree } from './LayersTree';
import { t } from '../i18n';
import { BrandKitPanel } from './BrandKitPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { BrushPanel, BrushShortcuts } from './BrushPanel';
import type { SavedDesign } from '../io/designs';
import { actionForEvent, getShortcut } from '../editor/core/shortcuts';
import {
  clampRail,
  loadRailHidden,
  loadRailWidth,
  railKeyStep,
  railMax,
  RAIL_DEFAULT,
  RAIL_MIN,
  saveRailHidden,
  saveRailWidth,
} from './railWidth';

const TABS = [
  { id: 'proyectos', icon: 'templates', label: 'Proyectos' },
  { id: 'subir', icon: 'upload', label: 'Subir' },
  { id: 'texto', icon: 'text', label: 'Texto' },
  { id: 'elementos', icon: 'shapes', label: 'Elementos' },
  { id: 'pinceles', icon: 'brush', label: 'Pinceles' },
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
  onOpenDesign: (d: SavedDesign) => void | Promise<void>;
  onGoHome: () => void;
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
  onOpenDesign,
  onGoHome,
}: Props) {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [iconQuery, setIconQuery] = useState('');
  const [iconResults, setIconResults] = useState<string[]>([]);
  const [iconBusy, setIconBusy] = useState(false);
  const [qrText, setQrText] = useState('https://');
  const templatesFileRef = useRef<HTMLInputElement>(null);

  // Ancho del panel (uno solo para todos) y ocultarlo sin perder la pestaña abierta.
  const panelRef = useRef<HTMLDivElement>(null);
  const [winW, setWinW] = useState(() => window.innerWidth);
  const [railW, setRailW] = useState(() => loadRailWidth(window.innerWidth));
  const [hidden, setHidden] = useState(() => loadRailHidden());
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number; k: number } | null>(null);
  const width = clampRail(railW, winW);
  const maxW = railMax(winW);

  useEffect(() => {
    const on = () => setWinW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // El lienzo, las reglas y el minimapa se reajustan solos (ResizeObserver); el aviso
  // de «resize» cubre lo que solo escucha a la ventana (p. ej. el marco de selección).
  const settle = useCallback(() => {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }, []);
  const applyWidth = useCallback(
    (w: number, persist: boolean) => {
      const v = clampRail(w, window.innerWidth);
      setRailW(v);
      if (persist) saveRailWidth(v);
      settle();
    },
    [settle],
  );
  const toggleHidden = useCallback(() => {
    setHidden((h) => {
      saveRailHidden(!h);
      return !h;
    });
    settle();
  }, [settle]);

  const activeRef = useRef(activeTab);
  activeRef.current = activeTab;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (actionForEvent(e) !== 'togglePanel') return;
      if (document.querySelector('.vx-root')) return; // el editor de video tiene su propio diseño
      if (!activeRef.current) return;
      e.preventDefault();
      toggleHidden();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleHidden]);

  const onGripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = panelRef.current;
    if (!el) return;
    e.preventDefault();
    // Con «Tamaño de la interfaz» el panel va con zoom: se convierte píxeles de pantalla a CSS.
    const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
    drag.current = { x: e.clientX, w: width, k: k || 1 };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('rail-resizing');
    setDragging(true);
  };
  const onGripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    applyWidth(d.w + (e.clientX - d.x) / d.k, false);
  };
  const onGripUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ya soltado */
    }
    document.documentElement.classList.remove('rail-resizing');
    setDragging(false);
    applyWidth(d.w + (e.clientX - d.x) / d.k, true);
  };
  useEffect(() => () => document.documentElement.classList.remove('rail-resizing'), []);
  const onGripKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const w = railKeyStep(e.key, width, window.innerWidth);
    if (w == null) return;
    e.preventDefault();
    applyWidth(w, true);
  };

  const uploads = useEditor((s) => s.uploads);
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const removeUpload = useEditor((s) => s.removeUpload);
  const templates = useEditor((s) => s.templates);
  const removeTemplate = useEditor((s) => s.removeTemplate);
  const setTemplateTags = useEditor((s) => s.setTemplateTags);
  const addTextLayer = useEditor((s) => s.addTextLayer);
  const addShapeLayer = useEditor((s) => s.addShapeLayer);
  const addFrame = useEditor((s) => s.addFrame);

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
      <BrushShortcuts />
      <nav className="rail">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            aria-pressed={activeTab === tab.id && !hidden}
            title={t(tab.label)}
            onClick={() => {
              if (hidden && activeTab === tab.id) {
                toggleHidden();
                return;
              }
              if (hidden) toggleHidden();
              setActiveTab(activeTab === tab.id ? null : tab.id);
            }}
          >
            <span className="rail-ico">
              <Icon name={tab.icon} size={22} />
            </span>
            <span className="rail-lbl">{t(tab.label)}</span>
          </button>
        ))}
        {activeTab && (
          <button
            className="rail-toggle"
            onClick={toggleHidden}
            aria-pressed={hidden}
            aria-label={hidden ? 'Mostrar el panel' : 'Ocultar el panel'}
            title={`${hidden ? 'Mostrar' : 'Ocultar'} el panel (${getShortcut('togglePanel')})`}
          >
            <span className="rail-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
                <path d={hidden ? 'M14 9l3 3-3 3' : 'M17 9l-3 3 3 3'} />
              </svg>
            </span>
            <span className="rail-lbl">{t(hidden ? 'Mostrar' : 'Ocultar')}</span>
          </button>
        )}
      </nav>

      {activeTab && (
        <div
          ref={panelRef}
          className={'rail-panel' + (hidden ? ' rail-hidden' : '')}
          style={{ ['--rail-w' as string]: width + 'px' }}
        >
          {activeTab === 'proyectos' && (
            <>
              {head('Proyectos')}
              <ProjectsPanel onOpenDesign={onOpenDesign} onGoHome={onGoHome} />
            </>
          )}

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
                    <UploadThumb
                      key={u.id}
                      u={u}
                      liveIds={uploads.map((x) => x.id)}
                      onUse={() => addImageLayer(u)}
                      onRemove={() => removeUpload(u.id)}
                    />
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

          {activeTab === 'pinceles' && (
            <>
              {head('Pinceles')}
              <BrushPanel />
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

              <TemplateLists
                templates={templates}
                onApply={onApplyTemplate}
                onRemove={removeTemplate}
                onSetTags={setTemplateTags}
              />
            </>
          )}

          {activeTab === 'capas' && (
            <>
              {head('Capas')}
              <LayersTree />
            </>
          )}

          {activeTab === 'marca' && (
            <>
              {head('Kit de Marca')}

              <BrandKitPanel />
            </>
          )}
        </div>
      )}

      {activeTab && (
        <div className="rail-resize-slot">
          <div
            className={'rail-resize' + (dragging ? ' dragging' : '')}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('Ancho del panel')}
            aria-valuenow={width}
            aria-valuemin={RAIL_MIN}
            aria-valuemax={maxW}
            tabIndex={0}
            title={t('Arrastra para ensanchar · doble clic para restablecer')}
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            onDoubleClick={() => applyWidth(RAIL_DEFAULT, true)}
            onKeyDown={onGripKey}
          />
        </div>
      )}
    </>
  );
}
