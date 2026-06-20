import { useEffect, useRef, useState } from 'react';
import { useEditor } from './editor/state/store';
import { EditorCanvas } from './editor/canvas/EditorCanvas';
import {
  CANVAS_PRESETS,
  DEFAULT_ADJUST,
  FONT_FAMILIES,
  TEXT_PRESETS,
  TRANSPARENT_BG,
  SHAPE_OPTIONS,
  type Doc,
} from './editor/core/types';
import { ANIMATIONS } from './editor/core/animations';
import { PRESET_TEMPLATES } from './editor/core/presetTemplates';
import { TemplateThumb } from './ui/TemplateThumb';
import { PageThumb } from './ui/PageThumb';
import { Icon } from './ui/Icon';
import { idbGet, idbSet } from './io/idb';
import { AUTHOR } from './branding';
import {
  activateLicense,
  getStoredLicense,
  clearLicense,
  type LicenseInfo,
} from './license';
import { loadImageFile } from './io/import';
import { addFontFromFile } from './editor/core/fonts';
import {
  exportDoc,
  downloadBlob,
  renderDocToCanvas,
  type ExportFormat,
} from './io/export';
import { exportDocToSvg } from './io/exportSvg';
import { exportPagesToGif } from './io/exportGif';
import { exportPagesToPdf } from './io/exportPdf';
import { exportAnimatedGif } from './io/exportAnim';
import { gifToMp4 } from './io/ffmpegConvert';
import { exportIco } from './io/exportIco';
import { searchIcons, iconPreviewUrl, fetchIconAsImage } from './io/iconify';
import QRCode from 'qrcode';
import { saveProject, readProjectFile } from './io/project';
import {
  removeImageBackground,
  prefetchBgModel,
  type BgQuality,
} from './ai/background-removal';
import { upscaleImage, prefetchUpscaleModel } from './ai/upscale';
import { loadOpenCV } from './ai/inpaint';
import { ColorPanel } from './ui/ColorPanel';
import { FiltersPanel } from './ui/FiltersPanel';
import { MaskEditor } from './ui/MaskEditor';
import { VideoEditor } from './ui/VideoEditor';
import { Presentation } from './ui/Presentation';
import {
  needsProcessing,
  processImage,
} from './editor/core/imageProcessing';
import './App.css';

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);
  const dragUploadId = useRef<string | null>(null);
  const clipLayer = useRef<import('./editor/core/types').Layer | null>(null);

  const BLEND_MODES = [
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
  ] as const;
  const textEditRef = useRef<HTMLTextAreaElement>(null);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const textEditNonce = useEditor((s) => s.textEditNonce);

  const onUploadFont = async (files: FileList | null, layerId?: string) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const family = await addFontFromFile(file);
      addCustomFont(family);
      if (layerId) updateLayer(layerId, { fontFamily: family });
    } catch (e) {
      alert('No se pudo cargar la fuente: ' + (e as Error).message);
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

  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const uploads = useEditor((s) => s.uploads);
  const addUpload = useEditor((s) => s.addUpload);
  const removeUpload = useEditor((s) => s.removeUpload);
  const templates = useEditor((s) => s.templates);
  const addTemplate = useEditor((s) => s.addTemplate);
  const removeTemplate = useEditor((s) => s.removeTemplate);
  const applyTemplate = useEditor((s) => s.applyTemplate);
  const addTextLayer = useEditor((s) => s.addTextLayer);
  const addShapeLayer = useEditor((s) => s.addShapeLayer);
  const reorderLayers = useEditor((s) => s.reorderLayers);
  const setCanvasSize = useEditor((s) => s.setCanvasSize);
  const removeLayer = useEditor((s) => s.removeLayer);
  const selectLayer = useEditor((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const updateLayerLive = useEditor((s) => s.updateLayerLive);
  const checkpoint = useEditor((s) => s.checkpoint);
  const addProcessedLayer = useEditor((s) => s.addProcessedLayer);
  const setBackground = useEditor((s) => s.setBackground);
  const replaceLayerImage = useEditor((s) => s.replaceLayerImage);
  const moveLayer = useEditor((s) => s.moveLayer);
  const alignLayer = useEditor((s) => s.alignLayer);
  const alignSelected = useEditor((s) => s.alignSelected);
  const distributeSelected = useEditor((s) => s.distributeSelected);
  const selectedIds = useEditor((s) => s.selectedIds);
  const cropMode = useEditor((s) => s.cropMode);
  const cropRect = useEditor((s) => s.cropRect);
  const beginCrop = useEditor((s) => s.beginCrop);
  const cancelCrop = useEditor((s) => s.cancelCrop);
  const cropAspect = useEditor((s) => s.cropAspect);
  const setCropAspect = useEditor((s) => s.setCropAspect);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const pasteLayer = useEditor((s) => s.pasteLayer);
  const requestTextEdit = useEditor((s) => s.requestTextEdit);
  const playAnimations = useEditor((s) => s.playAnimations);
  const customFonts = useEditor((s) => s.customFonts);
  const addCustomFont = useEditor((s) => s.addCustomFont);
  const brandColors = useEditor((s) => s.brandColors);
  const recentColors = useEditor((s) => s.recentColors);
  const selRect = useEditor((s) => s.selRect);
  const pages = useEditor((s) => s.pages);
  const pageIndex = useEditor((s) => s.pageIndex);
  const addPage = useEditor((s) => s.addPage);
  const addResizedPage = useEditor((s) => s.addResizedPage);
  const switchPage = useEditor((s) => s.switchPage);
  const deletePage = useEditor((s) => s.deletePage);
  const reorderPages = useEditor((s) => s.reorderPages);
  const loadPages = useEditor((s) => s.loadPages);
  const [dragPage, setDragPage] = useState<number | null>(null);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const viewScale = useEditor((s) => s.viewScale);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  const [format, setFormat] = useState<
    ExportFormat | 'svg' | 'gif' | 'pdf' | 'anim' | 'anim-mp4' | 'ico'
  >('png');
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState(0.92);
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const [showDownload, setShowDownload] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [customW, setCustomW] = useState(String(doc.width));
  const [customH, setCustomH] = useState(String(doc.height));
  const [busy, setBusy] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState('');
  const [bgQuality, setBgQuality] = useState<BgQuality>('maxima');
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [iconQuery, setIconQuery] = useState('');
  const [iconResults, setIconResults] = useState<string[]>([]);
  const [iconBusy, setIconBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

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
  const [qrText, setQrText] = useState('https://');
  const addQR = async () => {
    if (!qrText.trim()) return;
    try {
      const src = await QRCode.toDataURL(qrText, { width: 512, margin: 1 });
      addImageLayer({ src, naturalWidth: 512, naturalHeight: 512, name: 'QR' });
    } catch (e) {
      alert('No se pudo generar el QR: ' + (e as Error).message);
    }
  };
  const [showMask, setShowMask] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [showPresent, setShowPresent] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const [upBusy, setUpBusy] = useState(false);
  // Licencia + apoyo/donaciones
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [licenseInput, setLicenseInput] = useState('');
  const [licenseMsg, setLicenseMsg] = useState('');
  const [showDonate, setShowDonate] = useState(false);
  useEffect(() => {
    getStoredLicense().then(setLicense);
  }, []);
  const onActivateLicense = async () => {
    const info = await activateLicense(licenseInput);
    if (info) {
      setLicense(info);
      setLicenseMsg('');
      setLicenseInput('');
    } else {
      setLicenseMsg('Clave inválida o caducada.');
    }
  };
  const requestLicense = () => {
    window.open(AUTHOR.paypal, '_blank');
    window.open(
      `mailto:${AUTHOR.email}?subject=${encodeURIComponent(
        'Clave de licencia ChamVa (1 año)',
      )}&body=${encodeURIComponent(
        'Hola, acabo de donar por PayPal. Mi nombre/comprobante es: ',
      )}`,
      '_blank',
    );
  };
  const [upMsg, setUpMsg] = useState('');
  const [offlineMsg, setOfflineMsg] = useState('');

  const onPrepareOffline = async () => {
    setOfflineMsg('Descargando quitafondos…');
    try {
      await prefetchBgModel();
      setOfflineMsg('Descargando optimizador…');
      await prefetchUpscaleModel();
      setOfflineMsg('Descargando borrador mágico…');
      await loadOpenCV();
      setOfflineMsg('✓ Listo para usar sin internet');
      setTimeout(() => setOfflineMsg(''), 4000);
    } catch (e) {
      console.error(e);
      setOfflineMsg('✕ Error al descargar (revisa tu conexión)');
      setTimeout(() => setOfflineMsg(''), 4000);
    }
  };

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;

  // --- quitar fondo (IA local) ---
  const doRemoveBg = async (target: typeof selected) => {
    if (!target || target.type !== 'image') return;
    setBgBusy(true);
    setBgMsg('Preparando modelo…');
    try {
      // Dejar el lienzo transparente para que se vea el recorte.
      setBackground(TRANSPARENT_BG);
      const out = await removeImageBackground(target.src, {
        quality: bgQuality,
        refine: true,
        onProgress: (ratio, stage) => {
          const pct = Math.round(ratio * 100);
          setBgMsg(
            stage.startsWith('fetch')
              ? `Descargando modelo… ${pct}%`
              : `Procesando… ${pct}%`,
          );
        },
      });
      addProcessedLayer(target.id, out, `${target.name} sin fondo`);
    } catch (e) {
      console.error(e);
      alert('No se pudo quitar el fondo: ' + (e as Error).message);
    } finally {
      setBgBusy(false);
      setBgMsg('');
    }
  };

  const onRemoveBackground = () => doRemoveBg(selected);

  // Botón fácil de la barra: usa la imagen seleccionada o la única que haya.
  const imageLayers = doc.layers.filter((l) => l.type === 'image');
  const quickBgTarget =
    selected?.type === 'image'
      ? selected
      : imageLayers.length === 1
        ? imageLayers[0]
        : null;
  const onQuickRemoveBg = () => {
    if (!quickBgTarget) {
      alert('Selecciona primero una imagen (haz clic sobre ella).');
      return;
    }
    doRemoveBg(quickBgTarget);
  };

  // --- optimizar / upscale (IA local) ---
  const onUpscale = async () => {
    if (!selected || selected.type !== 'image') return;
    setUpBusy(true);
    setUpMsg('Preparando modelo…');
    try {
      const res = await upscaleImage(selected.src, (ratio, stage) => {
        const pct = Math.round(ratio * 100);
        setUpMsg(
          stage === 'fetch'
            ? `Descargando modelo… ${pct}%`
            : `Mejorando… ${pct}%`,
        );
      });
      // Mantener el tamaño visible: subir resolución, reducir escala en proporción.
      updateLayer(selected.id, {
        src: res.dataUrl,
        originalSrc: undefined,
        naturalWidth: res.width,
        naturalHeight: res.height,
        scaleX: (selected.scaleX * selected.naturalWidth) / res.width,
        scaleY: (selected.scaleY * selected.naturalHeight) / res.height,
      });
    } catch (e) {
      console.error(e);
      alert('No se pudo optimizar: ' + (e as Error).message);
    } finally {
      setUpBusy(false);
      setUpMsg('');
    }
  };

  // --- aplicar recorte ---
  const onApplyCrop = async () => {
    if (!selected || selected.type !== 'image' || !cropRect) return;
    const img = await loadImageElement(selected.src);
    const processed = needsProcessing(selected)
      ? processImage(img, selected)
      : img;

    // Rectángulo de recorte (coords del lienzo) → píxeles de la imagen fuente.
    let sx = (cropRect.x - selected.x) / selected.scaleX;
    let sy = (cropRect.y - selected.y) / selected.scaleY;
    let sw = cropRect.width / selected.scaleX;
    let sh = cropRect.height / selected.scaleY;
    sx = clamp(sx, 0, selected.naturalWidth);
    sy = clamp(sy, 0, selected.naturalHeight);
    sw = clamp(sw, 1, selected.naturalWidth - sx);
    sh = clamp(sh, 1, selected.naturalHeight - sy);

    const w = Math.round(sw);
    const h = Math.round(sh);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(processed, sx, sy, sw, sh, 0, 0, w, h);

    replaceLayerImage(selected.id, {
      src: canvas.toDataURL('image/png'),
      naturalWidth: w,
      naturalHeight: h,
      x: selected.x + sx * selected.scaleX,
      y: selected.y + sy * selected.scaleY,
    });
    cancelCrop();
  };

  // --- subir imágenes ---
  // Sube imágenes a la galería "Subidos" (y opcionalmente al lienzo).
  const importFiles = async (
    files: FileList | File[] | null,
    addToCanvas: boolean,
  ) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const img = await loadImageFile(file);
        const id =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `up-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        addUpload({ id, ...img });
        if (addToCanvas) addImageLayer(img);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // --- descargar (PNG/JPG/WebP/SVG/GIF, esta página o todas) ---
  const baseName = (d: { name: string }) =>
    (d.name || 'chamva').replace(/[^\w\-]+/g, '_');

  const onDownload = async () => {
    setBusy(true);
    setShowDownload(false);
    try {
      const st = useEditor.getState();
      const allPages = st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p));

      if (format === 'gif') {
        const blob = await exportPagesToGif(allPages, { maxSize: 800, delay: 800 });
        downloadBlob(blob, `${baseName(allPages[0])}.gif`);
        return;
      }

      if (format === 'pdf') {
        const pdfPages = scope === 'all' ? allPages : [st.doc];
        const blob = await exportPagesToPdf(pdfPages);
        downloadBlob(blob, `${baseName(pdfPages[0])}.pdf`);
        return;
      }

      if (format === 'anim') {
        const blob = await exportAnimatedGif(st.doc);
        downloadBlob(blob, `${baseName(st.doc)}_anim.gif`);
        return;
      }

      if (format === 'anim-mp4') {
        const gif = await exportAnimatedGif(st.doc);
        const mp4 = await gifToMp4(gif);
        downloadBlob(mp4, `${baseName(st.doc)}_anim.mp4`);
        return;
      }

      if (format === 'ico') {
        const blob = await exportIco(st.doc);
        downloadBlob(blob, `${baseName(st.doc)}.ico`);
        return;
      }

      const targets = scope === 'all' ? allPages : [st.doc];
      for (let i = 0; i < targets.length; i++) {
        const page = targets[i];
        let blob: Blob;
        let ext: string;
        if (format === 'svg') {
          blob = new Blob([await exportDocToSvg(page)], {
            type: 'image/svg+xml',
          });
          ext = 'svg';
        } else {
          blob = await exportDoc(page, {
            format: format as ExportFormat,
            quality,
            scale,
          });
          ext = format === 'jpeg' ? 'jpg' : format;
        }
        const suffix = targets.length > 1 ? `_pag${i + 1}` : '';
        downloadBlob(blob, `${baseName(page)}${suffix}.${ext}`);
      }
    } catch (e) {
      console.error(e);
      alert('Error al descargar: ' + (e as Error).message);
    } finally {
      setBusy(false);
      if (!license) setShowDonate(true);
    }
  };

  const onCopyToClipboard = async () => {
    try {
      const blob = await exportDoc(doc, { format: 'png', scale: 1 });
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      setShowDownload(false);
    } catch (e) {
      alert('No se pudo copiar al portapapeles: ' + (e as Error).message);
    }
  };

  const onSaveTemplate = async () => {
    try {
      const scale = Math.min(1, 220 / Math.max(doc.width, doc.height));
      const thumb = (await renderDocToCanvas(doc, scale, '#ffffff')).toDataURL(
        'image/jpeg',
        0.6,
      );
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `tpl-${Date.now()}`;
      addTemplate({
        id,
        name: doc.name || `Plantilla ${templates.length + 1}`,
        thumb,
        doc: JSON.parse(JSON.stringify(doc)),
      });
    } catch (e) {
      alert('No se pudo guardar la plantilla: ' + (e as Error).message);
    }
  };

  const onExportLayer = async () => {
    if (!selected) return;
    const single = { ...doc, background: TRANSPARENT_BG, layers: [selected] };
    const blob = await exportDoc(single, { format: 'png', scale: 1 });
    downloadBlob(blob, `${baseName(doc)}_capa.png`);
  };

  // --- proyecto (multipágina) ---
  const onSaveProject = () => {
    const st = useEditor.getState();
    const allPages = st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p));
    saveProject(allPages, st.pageIndex);
  };

  const onOpenProject = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const project = await readProjectFile(file);
      loadPages(project.pages, project.pageIndex);
      const first = project.pages[project.pageIndex] ?? project.pages[0];
      setCustomW(String(first.width));
      setCustomH(String(first.height));
    } catch (e) {
      alert('No se pudo abrir el proyecto: ' + (e as Error).message);
    }
  };

  // --- atajos de teclado ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedId) useEditor.getState().duplicateLayer(selectedId);
      } else if (ctrl && e.key.toLowerCase() === 'c') {
        const st = useEditor.getState();
        const l = st.doc.layers.find((x) => x.id === st.selectedId);
        if (l) clipLayer.current = l;
      } else if (ctrl && e.key.toLowerCase() === 'v') {
        if (clipLayer.current) {
          e.preventDefault();
          pasteLayer(clipLayer.current);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        useEditor.getState().removeSelected();
      } else if (e.key.startsWith('Arrow') && selectedId) {
        e.preventDefault();
        const st = useEditor.getState();
        const l = st.doc.layers.find((x) => x.id === selectedId);
        if (l) {
          const step = e.shiftKey ? 10 : 1;
          const dx =
            e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy =
            e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          st.updateLayer(selectedId, { x: l.x + dx, y: l.y + dy });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, removeLayer, pasteLayer, selectedId]);

  // Cargar subidos/plantillas guardados (IndexedDB) al iniciar.
  useEffect(() => {
    useEditor.getState().hydrate();
  }, []);

  // Autoguardado: restaurar el último diseño al iniciar y guardar al editar.
  const [autosaveReady, setAutosaveReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const saved = await idbGet<{ pages: Doc[]; index: number }>('autosave');
        if (saved?.pages?.length) {
          loadPages(saved.pages, saved.index ?? 0);
        }
      } catch {
        /* sin recuperación si falla */
      } finally {
        setAutosaveReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autosaveReady) return;
    const id = setTimeout(() => {
      const st = useEditor.getState();
      const snapshot = st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p));
      idbSet('autosave', { pages: snapshot, index: st.pageIndex });
    }, 1200);
    return () => clearTimeout(id);
  }, [doc, pages, pageIndex, autosaveReady]);

  // Doble clic en un texto del lienzo → enfocar el editor de texto del panel.
  useEffect(() => {
    if (textEditNonce > 0) {
      textEditRef.current?.focus();
      textEditRef.current?.select();
    }
  }, [textEditNonce]);

  const applyCustomSize = () => {
    const w = Math.max(1, Math.round(Number(customW) || doc.width));
    const h = Math.max(1, Math.round(Number(customH) || doc.height));
    setCanvasSize(w, h);
  };

  return (
    <div className="app">
      <header className="toolbar">
        <span
          className="brand"
          style={{ cursor: 'pointer' }}
          onClick={() => setShowHome(true)}
          title="Inicio"
        >
          ChamVa
        </span>

        <div className="menu-wrap">
          <button
            className={showFileMenu ? 'active' : ''}
            onClick={() => setShowFileMenu((v) => !v)}
            title="Archivo"
          >
            ☰ Archivo
          </button>
          {showFileMenu && (
            <div className="dropdown">
              <button
                onClick={() => {
                  projectRef.current?.click();
                  setShowFileMenu(false);
                }}
              >
                📂 Abrir proyecto
              </button>
              <button
                onClick={() => {
                  onSaveProject();
                  setShowFileMenu(false);
                }}
              >
                💾 Guardar proyecto
              </button>
            </div>
          )}
        </div>

        <div className="menu-wrap">
          <button
            className={showSizeMenu ? 'active' : ''}
            onClick={() => setShowSizeMenu((v) => !v)}
            title="Tamaño del lienzo"
          >
            📐 {doc.width}×{doc.height}
          </button>
          {showSizeMenu && (
            <div className="dropdown size-menu">
              <label className="dl-row">
                Tamaño
                <select
                  value={
                    CANVAS_PRESETS.some(
                      (p) => p.width === doc.width && p.height === doc.height,
                    )
                      ? `${doc.width}x${doc.height}`
                      : 'custom'
                  }
                  onChange={(e) => {
                    const p = CANVAS_PRESETS.find(
                      (x) => `${x.width}x${x.height}` === e.target.value,
                    );
                    if (p) {
                      setCanvasSize(p.width, p.height);
                      setCustomW(String(p.width));
                      setCustomH(String(p.height));
                    }
                  }}
                >
                  {CANVAS_PRESETS.map((p) => (
                    <option key={p.label} value={`${p.width}x${p.height}`}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Personalizado…</option>
                </select>
              </label>
              <label className="dl-row">
                Medida
                <span className="custom-size">
                  <input
                    type="number"
                    value={customW}
                    onChange={(e) => setCustomW(e.target.value)}
                  />
                  ×
                  <input
                    type="number"
                    value={customH}
                    onChange={(e) => setCustomH(e.target.value)}
                  />
                </span>
              </label>
              <button
                className="primary dl-go"
                onClick={() => {
                  applyCustomSize();
                  setShowSizeMenu(false);
                }}
              >
                Aplicar
              </button>

              <div className="dl-row" style={{ marginTop: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  Magic Resize (copia en otro tamaño)
                </span>
              </div>
              {CANVAS_PRESETS.map((p) => (
                <button
                  key={'mr' + p.label}
                  className="dropdown-item"
                  onClick={() => {
                    addResizedPage(p.width, p.height);
                    setShowSizeMenu(false);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text)',
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  ✨ {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="group">
          <button disabled={past.length === 0} onClick={undo} title="Ctrl+Z">
            ↩ Deshacer
          </button>
          <button disabled={future.length === 0} onClick={redo} title="Ctrl+Y">
            ↪ Rehacer
          </button>
        </div>

        <button
          className="cut-bg"
          onClick={onQuickRemoveBg}
          disabled={bgBusy}
          title="Quitar el fondo de la imagen y dejarlo transparente"
        >
          {bgBusy ? `✂ ${bgMsg || '…'}` : '✂ Quitar fondo'}
        </button>

        <button
          onClick={onPrepareOffline}
          disabled={!!offlineMsg && !offlineMsg.startsWith('✓') && !offlineMsg.startsWith('✕')}
          title="Descarga los modelos de IA para usarlos sin internet"
        >
          {offlineMsg || '⬇ Preparar offline'}
        </button>

        <button onClick={playAnimations} title="Previsualizar animaciones">
          ▶ Animar
        </button>

        <button onClick={() => setShowPresent(true)} title="Modo presentación">
          ▶ Presentar
        </button>

        <button onClick={() => setShowVideo(true)} title="Editor de video y audio">
          🎬 Video
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            importFiles(e.target.files, true);
            e.target.value = '';
          }}
        />
        <input
          ref={projectRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            onOpenProject(e.target.files);
            e.target.value = '';
          }}
        />

        <span className="spacer" />

        <div className="download-wrap">
          <button
            className="cut-bg"
            onClick={() => setShowDownload((v) => !v)}
            disabled={busy}
          >
            {busy ? '… Descargando' : '⬇ Descargar'}
          </button>
          {showDownload && (
            <div className="download-menu">
              <label className="dl-row">
                Formato
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                >
                  <option value="png">PNG (transparente)</option>
                  <option value="jpeg">JPG</option>
                  <option value="webp">WebP</option>
                  <option value="avif">AVIF</option>
                  <option value="svg">SVG (vector)</option>
                  <option value="ico">ICO (icono)</option>
                  <option value="pdf">PDF</option>
                  <option value="gif">GIF (páginas)</option>
                  <option value="anim">GIF (animación)</option>
                  <option value="anim-mp4">MP4 (animación)</option>
                </select>
              </label>

              {(format === 'png' ||
                format === 'jpeg' ||
                format === 'webp' ||
                format === 'avif') && (
                <>
                  <label className="dl-row">
                    Tamaño
                    <select
                      value={scale}
                      onChange={(e) => setScale(Number(e.target.value))}
                    >
                      <option value={1}>@1x</option>
                      <option value={2}>@2x</option>
                      <option value={3}>@3x</option>
                    </select>
                  </label>
                  {format !== 'png' && (
                    <label className="dl-row">
                      Calidad
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.01}
                        value={quality}
                        onChange={(e) => setQuality(Number(e.target.value))}
                      />
                    </label>
                  )}
                </>
              )}

              {format !== 'gif' &&
                format !== 'anim' &&
                format !== 'anim-mp4' &&
                format !== 'ico' && (
                <label className="dl-row">
                  Páginas
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as 'page' | 'all')}
                  >
                    <option value="page">Esta página</option>
                    <option value="all">Todas ({pages.length})</option>
                  </select>
                </label>
              )}
              {format === 'gif' && (
                <p className="dl-hint">
                  El GIF anima todas las páginas ({pages.length}).
                </p>
              )}
              {format === 'anim' && (
                <p className="dl-hint">
                  GIF con las animaciones de entrada de esta página.
                </p>
              )}

              <button className="primary dl-go" onClick={onDownload}>
                ⬇ Descargar {format.toUpperCase()}
              </button>
              <button className="dl-go" onClick={onCopyToClipboard}>
                📋 Copiar al portapapeles
              </button>
            </div>
          )}
        </div>
      </header>

      <div
        className="body"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragUploadId.current) {
            const up = uploads.find((u) => u.id === dragUploadId.current);
            dragUploadId.current = null;
            if (up) addImageLayer(up);
            return;
          }
          if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files, true);
        }}
      >
        <nav className="rail">
          {([
            { id: 'subir', icon: 'upload', label: 'Subir' },
            { id: 'texto', icon: 'text', label: 'Texto' },
            { id: 'elementos', icon: 'shapes', label: 'Elementos' },
            { id: 'fondo', icon: 'palette', label: 'Fondo' },
            { id: 'plantillas', icon: 'templates', label: 'Plantillas' },
            { id: 'capas', icon: 'layers', label: 'Capas' },
            { id: 'marca', icon: 'star', label: 'Marca' },
          ] as const).map((t) => (
            <button
              key={t.id}
              className={activeTab === t.id ? 'active' : ''}
              onClick={() => setActiveTab(activeTab === t.id ? null : t.id)}
            >
              <span className="rail-ico">
                <Icon name={t.icon} size={22} />
              </span>
              <span className="rail-lbl">{t.label}</span>
            </button>
          ))}
        </nav>

        {activeTab && (
          <div className="rail-panel">
            {activeTab === 'subir' && (
              <>
                <div className="rail-head">
                  <h3>Subir</h3>
                  <button className="cp-x" onClick={() => setActiveTab(null)}>
                    ✕
                  </button>
                </div>
                <button className="rail-big" onClick={() => fileRef.current?.click()}>
                  📁 Subir imagen
                </button>
                <button
                  className="rail-big"
                  onClick={() => fontFileRef.current?.click()}
                >
                  🔤 Subir fuente
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
                <div className="rail-head">
                  <h3>Texto</h3>
                  <button className="cp-x" onClick={() => setActiveTab(null)}>
                    ✕
                  </button>
                </div>
                <button className="rail-big" onClick={() => addTextLayer()}>
                  ＋ Caja de texto
                </button>
                {TEXT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className="rail-item"
                    style={{ fontWeight: p.bold ? 500 : 400 }}
                    onClick={() =>
                      addTextLayer({
                        text: p.text,
                        fontSize: p.fontSize,
                        bold: p.bold,
                      })
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </>
            )}

            {activeTab === 'elementos' && (
              <>
                <div className="rail-head">
                  <h3>Elementos</h3>
                  <button className="cp-x" onClick={() => setActiveTab(null)}>
                    ✕
                  </button>
                </div>
                <div className="rail-shapes">
                  {SHAPE_OPTIONS.map((s) => (
                    <button
                      key={s.kind}
                      onClick={() => addShapeLayer(s.kind)}
                      title={s.label}
                    >
                      {s.icon}
                    </button>
                  ))}
                </div>

                <h4 className="rail-sub">Buscar iconos</h4>
                <div className="font-row">
                  <input
                    type="text"
                    placeholder='Ej: flecha, corazón…'
                    value={iconQuery}
                    onChange={(e) => setIconQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && doIconSearch()}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'var(--panel-2)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '7px 9px',
                      fontSize: 13,
                    }}
                  />
                  <button className="font-upload" onClick={doIconSearch}>
                    🔍
                  </button>
                </div>
                {iconBusy && <p className="rail-hint">Buscando…</p>}
                <div className="icon-grid">
                  {iconResults.map((name) => (
                    <button
                      key={name}
                      className="icon-cell"
                      title={name}
                      onClick={() => addIcon(name)}
                    >
                      <img src={iconPreviewUrl(name, 40)} alt={name} />
                    </button>
                  ))}
                </div>

                <h4 className="rail-sub">Código QR</h4>
                <div className="font-row">
                  <input
                    type="text"
                    placeholder="URL o texto"
                    value={qrText}
                    onChange={(e) => setQrText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addQR()}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'var(--panel-2)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '7px 9px',
                      fontSize: 13,
                    }}
                  />
                  <button className="font-upload" onClick={addQR}>
                    ▦
                  </button>
                </div>
              </>
            )}

            {activeTab === 'fondo' && (
              <ColorPanel embedded onClose={() => setActiveTab(null)} />
            )}

            {activeTab === 'plantillas' && (
              <>
                <div className="rail-head">
                  <h3>Plantillas</h3>
                  <button className="cp-x" onClick={() => setActiveTab(null)}>
                    ✕
                  </button>
                </div>
                <button className="rail-big" onClick={onSaveTemplate}>
                  💾 Guardar diseño actual
                </button>

                <h4 className="rail-sub">Prediseñadas</h4>
                <div className="uploads-grid">
                  {PRESET_TEMPLATES.map((t) => (
                    <TemplateThumb
                      key={t.id}
                      doc={t}
                      label={t.name}
                      onClick={() => {
                        applyTemplate(t);
                        setCustomW(String(t.width));
                        setCustomH(String(t.height));
                      }}
                    />
                  ))}
                </div>

                <h4 className="rail-sub">Mis plantillas</h4>
                {templates.length === 0 && (
                  <p className="rail-hint">
                    Guarda un diseño y reutilízalo cuando quieras.
                  </p>
                )}
                <div className="uploads-grid">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      className="upload-thumb"
                      onClick={() => applyTemplate(t.doc)}
                      title={`Aplicar "${t.name}"`}
                    >
                      <img src={t.thumb} alt={t.name} />
                      <button
                        className="upload-del"
                        title="Quitar plantilla"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTemplate(t.id);
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
                <div className="rail-head">
                  <h3>Capas</h3>
                  <button className="cp-x" onClick={() => setActiveTab(null)}>
                    ✕
                  </button>
                </div>
                {doc.layers.length === 0 && (
                  <p className="rail-hint">Aún no hay capas.</p>
                )}
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
                      <span className="ico">
                        {l.type === 'image'
                          ? '🖼'
                          : l.type === 'text'
                            ? '🅣'
                            : '◻'}
                      </span>
                      <span className="name">
                        {l.type === 'text' ? l.text || 'Texto' : l.name}
                      </span>
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
                <div className="rail-head">
                  <h3>Kit de Marca</h3>
                  <button className="cp-x" onClick={() => setActiveTab(null)}>
                    ✕
                  </button>
                </div>
                <p className="rail-hint">
                  Guarda colores desde el panel <b>Fondo</b> (+ Añadir). Aquí los
                  reutilizas como fondo.
                </p>
                {brandColors.length > 0 && (
                  <>
                    <h4 className="rail-sub">Mis colores</h4>
                    <div className="rail-swatches">
                      {brandColors.map((c) => (
                        <button
                          key={c}
                          style={{ background: c }}
                          title={c}
                          onClick={() =>
                            setBackground({ type: 'solid', color: c })
                          }
                        />
                      ))}
                    </div>
                  </>
                )}
                {recentColors.length > 0 && (
                  <>
                    <h4 className="rail-sub">Recientes</h4>
                    <div className="rail-swatches">
                      {recentColors.map((c) => (
                        <button
                          key={c}
                          style={{ background: c }}
                          title={c}
                          onClick={() =>
                            setBackground({ type: 'solid', color: c })
                          }
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {showFilters && selected && selected.type === 'image' && (
          <FiltersPanel
            layer={selected}
            onClose={() => setShowFilters(false)}
          />
        )}

        {cropMode && (
          <div className="crop-bar">
            <span>Ajusta el recuadro y aplica</span>
            <select
              value={cropAspect ?? ''}
              onChange={(e) =>
                setCropAspect(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Libre</option>
              <option value={1}>1:1</option>
              <option value={4 / 3}>4:3</option>
              <option value={3 / 4}>3:4</option>
              <option value={16 / 9}>16:9</option>
              <option value={9 / 16}>9:16</option>
              <option value={3 / 2}>3:2</option>
              <option value={2 / 3}>2:3</option>
            </select>
            <button className="primary" onClick={onApplyCrop}>
              ✓ Aplicar recorte
            </button>
            <button onClick={cancelCrop}>✕ Cancelar</button>
          </div>
        )}

        <EditorCanvas />

        <aside className="panel">
          {!selected && (
            <p className="empty">
              Selecciona un elemento para editarlo, o usa el panel de la
              izquierda para añadir.
            </p>
          )}
          {selected && (
            <section className="props">
              <h3>Propiedades</h3>

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
                      <button onClick={() => distributeSelected('h')}>
                        Distribuir H
                      </button>
                      <button onClick={() => distributeSelected('v')}>
                        Distribuir V
                      </button>
                    </div>
                  )}
                </>
              )}

              {selected.type === 'image' && (
                <>
                  <div className="bg-quality">
                    <button
                      className="magic full"
                      onClick={onRemoveBackground}
                      disabled={bgBusy}
                    >
                      {bgBusy ? '✂ …' : '✂ Quitar fondo (IA)'}
                    </button>
                    <select
                      value={bgQuality}
                      disabled={bgBusy}
                      onChange={(e) =>
                        setBgQuality(e.target.value as BgQuality)
                      }
                      title="Calidad del recorte"
                    >
                      <option value="maxima">Máxima (tipo Canva)</option>
                      <option value="alta">Alta</option>
                      <option value="rapido">Rápido</option>
                    </select>
                  </div>
                  {bgBusy && <p className="bgmsg">{bgMsg}</p>}

                  <div className="row">
                    <button
                      onClick={() =>
                        updateLayer(selected.id, { flipX: !selected.flipX })
                      }
                    >
                      ↔ Voltear H
                    </button>
                    <button
                      onClick={() =>
                        updateLayer(selected.id, { flipY: !selected.flipY })
                      }
                    >
                      ↕ Voltear V
                    </button>
                  </div>

                  <button
                    className="full"
                    onClick={beginCrop}
                    disabled={cropMode}
                  >
                    ⛶ Recortar
                  </button>

                  <button
                    className="magic full"
                    onClick={() => setShowMask(true)}
                  >
                    🪄 Borrador / Pincel
                  </button>

                  <button
                    className="magic full"
                    onClick={onUpscale}
                    disabled={upBusy}
                  >
                    {upBusy ? '🔍 …' : '🔍 Optimizar (HD ×2)'}
                  </button>
                  {upBusy && <p className="bgmsg">{upMsg}</p>}

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
                      onChange={(e) =>
                        updateLayerLive(selected.id, { text: e.target.value })
                      }
                    />
                  </label>
                  <label className="prop">
                    Fuente
                    <div className="font-row">
                      <select
                        value={selected.fontFamily}
                        onChange={(e) =>
                          updateLayer(selected.id, {
                            fontFamily: e.target.value,
                          })
                        }
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
                      <input
                        ref={fontFileRef}
                        type="file"
                        accept=".ttf,.otf,.woff,.woff2,font/*"
                        hidden
                        onChange={(e) => {
                          onUploadFont(e.target.files, selected.id);
                          e.target.value = '';
                        }}
                      />
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
                      onChange={(e) =>
                        updateLayer(selected.id, { fill: e.target.value })
                      }
                      title="Color"
                    />
                    <button
                      className={selected.bold ? 'active' : ''}
                      onClick={() =>
                        updateLayer(selected.id, { bold: !selected.bold })
                      }
                      title="Negrita"
                    >
                      <b>B</b>
                    </button>
                    <button
                      className={selected.italic ? 'active' : ''}
                      onClick={() =>
                        updateLayer(selected.id, { italic: !selected.italic })
                      }
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
                        onClick={() =>
                          updateLayer(selected.id, { textTransform: mode })
                        }
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
                        updateLayerLive(selected.id, {
                          letterSpacing: Number(e.target.value),
                        })
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
                        updateLayerLive(selected.id, {
                          lineHeight: Number(e.target.value),
                        })
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
                      onChange={(e) =>
                        updateLayerLive(selected.id, {
                          curve: Number(e.target.value),
                        })
                      }
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
                    <button
                      onClick={() =>
                        updateLayer(selected.id, { shadow: false })
                      }
                    >
                      Sin efecto
                    </button>
                  </div>

                  <label className="prop">
                    Lista
                    <select
                      value={selected.listStyle ?? 'none'}
                      onChange={(e) =>
                        updateLayer(selected.id, {
                          listStyle: e.target.value as
                            | 'none'
                            | 'bullet'
                            | 'number',
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
                          textEffect: e.target.value as
                            | 'none'
                            | 'echo'
                            | 'background',
                          effectColor:
                            selected.effectColor ??
                            (e.target.value === 'background'
                              ? '#000000'
                              : selected.fill),
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
                      <span style={{ fontSize: 13, flex: 1 }}>
                        Color del efecto
                      </span>
                      <input
                        type="color"
                        value={selected.effectColor ?? '#000000'}
                        onChange={(e) =>
                          updateLayer(selected.id, {
                            effectColor: e.target.value,
                          })
                        }
                        title="Color del eco / fondo"
                      />
                    </div>
                  )}

                  <div className="row text-row">
                    <span style={{ fontSize: 13, flex: 1 }}>Contorno</span>
                    <input
                      type="color"
                      value={selected.strokeColor}
                      onChange={(e) =>
                        updateLayer(selected.id, { strokeColor: e.target.value })
                      }
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
                        updateLayerLive(selected.id, {
                          strokeWidth: Number(e.target.value),
                        })
                      }
                    />
                  </label>

                  <div className="row text-row">
                    <button
                      className={selected.shadow ? 'active' : ''}
                      style={{ flex: 1 }}
                      onClick={() =>
                        updateLayer(selected.id, { shadow: !selected.shadow })
                      }
                    >
                      Sombra {selected.shadow ? '✓' : ''}
                    </button>
                    <input
                      type="color"
                      value={selected.shadowColor}
                      onChange={(e) =>
                        updateLayer(selected.id, { shadowColor: e.target.value })
                      }
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
                          updateLayerLive(selected.id, {
                            shadowBlur: Number(e.target.value),
                          })
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
                        onChange={(e) =>
                          updateLayer(selected.id, { fill: e.target.value })
                        }
                      />
                    </label>
                    <label className="shape-color">
                      Borde
                      <input
                        type="color"
                        value={selected.stroke}
                        onChange={(e) =>
                          updateLayer(selected.id, { stroke: e.target.value })
                        }
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
                        updateLayerLive(selected.id, {
                          strokeWidth: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  {selected.shape === 'rect' && (
                    <label className="prop">
                      Esquinas: {Math.round(selected.cornerRadius)}
                      <input
                        type="range"
                        min={0}
                        max={Math.round(
                          Math.min(selected.width, selected.height) / 2,
                        )}
                        step={1}
                        value={selected.cornerRadius}
                        onPointerDown={checkpoint}
                        onChange={(e) =>
                          updateLayerLive(selected.id, {
                            cornerRadius: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  )}
                </>
              )}

              <label className="prop">
                Opacidad
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selected.opacity}
                  onPointerDown={checkpoint}
                  onChange={(e) =>
                    updateLayerLive(selected.id, {
                      opacity: Number(e.target.value),
                    })
                  }
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
                  onChange={(e) =>
                    updateLayer(selected.id, { anim: e.target.value })
                  }
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
                  onChange={(e) =>
                    updateLayer(selected.id, { animOut: e.target.value })
                  }
                >
                  {ANIMATIONS.map((an) => (
                    <option key={an.id} value={an.id}>
                      {an.label}
                    </option>
                  ))}
                </select>
              </label>
              {((selected.anim ?? 'none') !== 'none' ||
                (selected.animOut ?? 'none') !== 'none') && (
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
                      updateLayerLive(selected.id, {
                        animDuration: Number(e.target.value),
                      })
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
                      onClick={() =>
                        updateLayer(selected.id, { shadow: !selected.shadow })
                      }
                    >
                      Sombra {selected.shadow ? '✓' : ''}
                    </button>
                    <input
                      type="color"
                      value={selected.shadowColor}
                      onChange={(e) =>
                        updateLayer(selected.id, { shadowColor: e.target.value })
                      }
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
                          updateLayerLive(selected.id, {
                            shadowBlur: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  )}
                </>
              )}

              {selected.type === 'image' && (
                <>
                  <label className="prop">
                    Brillo
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      value={selected.adjust?.brightness ?? 1}
                      onPointerDown={checkpoint}
                      onChange={(e) =>
                        updateLayerLive(selected.id, {
                          adjust: {
                            ...(selected.adjust ?? DEFAULT_ADJUST),
                            brightness: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="prop">
                    Contraste
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      value={selected.adjust?.contrast ?? 1}
                      onPointerDown={checkpoint}
                      onChange={(e) =>
                        updateLayerLive(selected.id, {
                          adjust: {
                            ...(selected.adjust ?? DEFAULT_ADJUST),
                            contrast: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="prop">
                    Saturación
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      value={selected.adjust?.saturate ?? 1}
                      onPointerDown={checkpoint}
                      onChange={(e) =>
                        updateLayerLive(selected.id, {
                          adjust: {
                            ...(selected.adjust ?? DEFAULT_ADJUST),
                            saturate: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>

                  <button
                    className="magic full"
                    onClick={() => setShowFilters(true)}
                  >
                    🎨 Filtros y Duotono
                  </button>

                  <label className="prop">
                    Recortar a forma
                    <select
                      value={selected.maskShape ?? ''}
                      onChange={(e) =>
                        updateLayer(selected.id, {
                          maskShape: (e.target.value || undefined) as
                            | typeof selected.maskShape,
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
                <button onClick={() => moveLayer(selected.id, 'up')}>
                  ⬆ Subir
                </button>
                <button onClick={() => moveLayer(selected.id, 'down')}>
                  ⬇ Bajar
                </button>
              </div>
              <div className="row">
                <button
                  onClick={() =>
                    updateLayer(selected.id, { locked: !selected.locked })
                  }
                >
                  {selected.locked ? '🔓 Desbloquear' : '🔒 Bloquear'}
                </button>
                <button onClick={() => duplicateLayer(selected.id)}>
                  ⧉ Duplicar
                </button>
              </div>
              <button className="full" onClick={onExportLayer}>
                ⬇ Exportar esta capa (PNG)
              </button>
              <button
                className="danger full"
                onClick={() => removeLayer(selected.id)}
              >
                🗑 Borrar capa
              </button>
            </section>
          )}
        </aside>
      </div>

      {/* Barra flotante contextual sobre la selección */}
      {selRect && selected && !cropMode && !showMask && (
        <div
          className="float-toolbar"
          style={{
            left: selRect.left + selRect.width / 2,
            top: Math.max(8, selRect.top - 48),
          }}
        >
          {selected.type === 'image' && (
            <>
              <button onClick={onRemoveBackground} disabled={bgBusy} title="Quitar fondo">
                ✂
              </button>
              <button onClick={() => setShowFilters(true)} title="Filtros">
                🎨
              </button>
              <button onClick={beginCrop} title="Recortar">
                ⛶
              </button>
              <button
                onClick={() => updateLayer(selected.id, { flipX: !selected.flipX })}
                title="Voltear"
              >
                ↔
              </button>
            </>
          )}
          {selected.type === 'text' && (
            <button onClick={() => requestTextEdit(selected.id)} title="Editar texto">
              ✎
            </button>
          )}
          <button onClick={() => duplicateLayer(selected.id)} title="Duplicar">
            ⧉
          </button>
          <button onClick={() => moveLayer(selected.id, 'up')} title="Subir">
            ⬆
          </button>
          <button onClick={() => moveLayer(selected.id, 'down')} title="Bajar">
            ⬇
          </button>
          <button
            className="danger"
            onClick={() => removeLayer(selected.id)}
            title="Borrar"
          >
            🗑
          </button>
        </div>
      )}

      {/* Barra de páginas */}
      <footer className="page-bar">
        {pages.map((p, i) => (
          <button
            key={p.id}
            className={`page-tab ${i === pageIndex ? 'sel' : ''} ${
              dragPage !== null && dragPage !== i ? 'drop-target' : ''
            }`}
            onClick={() => switchPage(i)}
            title={`Página ${i + 1} (arrastra para reordenar)`}
            draggable
            onDragStart={() => setDragPage(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragPage !== null) reorderPages(dragPage, i);
              setDragPage(null);
            }}
            onDragEnd={() => setDragPage(null)}
          >
            <PageThumb doc={i === pageIndex ? doc : p} />
            <span className="page-num">{i + 1}</span>
            {pages.length > 1 && (
              <span
                className="page-del"
                onClick={(e) => {
                  e.stopPropagation();
                  deletePage(i);
                }}
              >
                ✕
              </span>
            )}
          </button>
        ))}
        <button className="page-add" onClick={addPage}>
          + Agregar página
        </button>

        <span className="spacer" />

        <div className="zoom-controls">
          <button onClick={() => setZoom(zoom * 0.9)} title="Alejar">
            −
          </button>
          <button
            className="zoom-pct"
            onClick={() => setZoom(1)}
            title="Ajustar"
          >
            {Math.round(viewScale * 100)}%
          </button>
          <button onClick={() => setZoom(zoom * 1.1)} title="Acercar">
            ＋
          </button>
        </div>
      </footer>

      {showMask && selected && selected.type === 'image' && (
        <MaskEditor
          layer={selected}
          onApply={(dataUrl) => {
            updateLayer(selected.id, { src: dataUrl });
            setShowMask(false);
          }}
          onCancel={() => setShowMask(false)}
        />
      )}

      {showVideo && <VideoEditor onClose={() => setShowVideo(false)} />}

      {showPresent && (
        <Presentation
          pages={pages.map((p, i) => (i === pageIndex ? doc : p))}
          start={pageIndex}
          onClose={() => setShowPresent(false)}
        />
      )}

      {showHome && (
        <div className="home-overlay">
          <div className="home-brand">ChamVa</div>
          <p className="home-sub">¿Qué quieres editar hoy?</p>
          <div className="home-cards">
            <button
              className="home-card"
              onClick={() => {
                setShowVideo(false);
                setShowHome(false);
              }}
            >
              <span className="home-ico">
                <Icon name="image" size={48} />
              </span>
              <span className="home-title">Editar imágenes</span>
              <span className="home-desc">
                Diseños, fotos, texto, formas, quitar fondo…
              </span>
            </button>
            <button
              className="home-card"
              onClick={() => {
                setShowHome(false);
                setShowVideo(true);
              }}
            >
              <span className="home-ico">
                <Icon name="video" size={48} />
              </span>
              <span className="home-title">Editar video</span>
              <span className="home-desc">
                Recortar, audio, efectos de voz, exportar MP4…
              </span>
            </button>
          </div>

          {license ? (
            /* Donante: sello bonito + crédito de autor, sin pedir dinero. */
            <div className="support-box supporter">
              <div className="supporter-badge">★ Donante</div>
              <p className="supporter-name">¡Gracias, {license.name}! 💛</p>
              <p className="support-desc">
                Tu apoyo mantiene vivo ChamVa. Licencia válida hasta{' '}
                {new Date(license.exp * 1000).toLocaleDateString()}.
              </p>
              <p className="author-credit">
                Hecho con cariño por {AUTHOR.name} · © {new Date().getFullYear()}
              </p>
              <button
                className="link-btn dim"
                onClick={() => {
                  clearLicense();
                  setLicense(null);
                }}
              >
                Quitar licencia
              </button>
            </div>
          ) : (
            <div className="support-box">
              <p className="support-title">Apoya ChamVa</p>
              <p className="support-desc">
                Es gratis y sin restricciones. Si te sirve, considera donar y
                obtén una licencia de apoyo (sin avisos).
              </p>
              <div className="support-links">
                <a href={AUTHOR.paypal} target="_blank" rel="noreferrer">
                  💳 Donar (PayPal)
                </a>
                <a href={AUTHOR.github} target="_blank" rel="noreferrer">
                  🐙 GitHub
                </a>
                <a href={AUTHOR.linkedin} target="_blank" rel="noreferrer">
                  💼 LinkedIn
                </a>
              </div>
              <div className="support-license">
                <button className="link-btn" onClick={requestLicense}>
                  🔑 Solicitar clave de licencia (1 año)
                </button>
                <div className="license-activate">
                  <input
                    type="text"
                    placeholder="Pega tu clave de licencia…"
                    value={licenseInput}
                    onChange={(e) => setLicenseInput(e.target.value)}
                  />
                  <button onClick={onActivateLicense}>Activar</button>
                </div>
                {licenseMsg && <p className="license-msg">{licenseMsg}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {showDonate && !license && (
        <div className="donate-overlay" onClick={() => setShowDonate(false)}>
          <div className="donate-card" onClick={(e) => e.stopPropagation()}>
            <button
              className="donate-close"
              onClick={() => setShowDonate(false)}
            >
              ✕
            </button>
            <h3>¡Tu archivo se descargó! 💛</h3>
            <p>
              ChamVa es gratis y sin marcas de agua. Si te ayuda, apóyame con una
              donación o consigue una licencia de apoyo (1 año).
            </p>
            <div className="support-links">
              <a href={AUTHOR.paypal} target="_blank" rel="noreferrer">
                💳 Donar (PayPal)
              </a>
              <a href={AUTHOR.github} target="_blank" rel="noreferrer">
                🐙 GitHub
              </a>
              <a href={AUTHOR.linkedin} target="_blank" rel="noreferrer">
                💼 LinkedIn
              </a>
            </div>
            <button className="link-btn" onClick={requestLicense}>
              🔑 Solicitar clave de licencia (1 año)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
