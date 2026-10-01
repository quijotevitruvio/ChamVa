import { useEffect, useRef, useState } from 'react';
import { useEditor } from './editor/state/store';
import { EditorCanvas, isTypingTarget } from './editor/canvas/EditorCanvas';
import { TRANSPARENT_BG, type Doc, type ImageLayer, type Layer } from './editor/core/types';
import { Icon } from './ui/Icon';
import { toast, Toaster } from './ui/toast';
import { idbGet, idbSet, requestPersistentStorage, setStorageErrorHandler } from './io/idb';
import { dehydrateDocs, rehydrateDocs, gcAssets } from './io/assets';
import { getStoredLicense, type LicenseInfo, type LicenseType } from './license';
import { loadImageFile } from './io/import';
import { addFontFromFile } from './editor/core/fonts';
import { exportDoc, downloadBlob, renderDocToCanvas, type ExportFormat } from './io/export';
import { exportDocToSvg } from './io/exportSvg';
import { exportPagesToGif } from './io/exportGif';
import { exportPagesToPdf } from './io/exportPdf';
import { exportAnimatedGif } from './io/exportAnim';
import { gifToMp4, prefetchFFmpeg } from './io/ffmpegConvert';
import { exportIco } from './io/exportIco';
import { saveProject, readProjectFile, parseProject } from './io/project';
import {
  removeImageBackground,
  upscaleImage,
  prefetchBgModel,
  prefetchUpscaleModel,
  type BgQuality,
  type EdgeMode,
} from './ai/worker-client';
import { BG_ENGINES } from './ai/bgcore';
import { loadOpenCV } from './ai/inpaint';
import { checkForUpdate, type UpdateInfo } from './updater';
import { isTauri } from './io/nativeSave';
import { t, useLang } from './i18n';
import {
  loadDesigns,
  upsertDesign,
  removeDesign,
  loadBackups,
  pushBackup,
  type SavedDesign,
  type Backup,
} from './io/designs';
import { needsProcessing, processImage } from './editor/core/imageProcessing';
import { FiltersPanel } from './ui/FiltersPanel';
import { MaskEditor } from './ui/MaskEditor';
import { VideoEditor } from './ui/VideoEditor';
import { Presentation } from './ui/Presentation';
import { BgPreview } from './ui/BgPreview';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { RailPanels } from './ui/RailPanels';
import { SettingsDialog, DonateDialog, RequestLicenseDialog } from './ui/LicenseDialogs';
import { HomeScreen } from './ui/HomeScreen';
import { ShortcutsDialog } from './ui/ShortcutsDialog';
import { SizeMenu } from './ui/SizeMenu';
import { DownloadMenu, type Fmt } from './ui/DownloadMenu';
import { ContextMenu, FloatToolbar } from './ui/SelectionMenus';
import { PageBar } from './ui/PageBar';
import { UpdateBanner } from './ui/UpdateBanner';
import { ChartEditor } from './ui/ChartEditor';
import type { ChartSpec, TableSpec } from './editor/core/charts';
import { DEFAULT_ADJUST } from './editor/core/types';
import './App.css';

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const EXPORT_LS = 'chamva.exportOpts';
const BG_ENGINE_LS = 'chamva.bgEngine';

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const textEditRef = useRef<HTMLTextAreaElement>(null);
  const clipLayer = useRef<Layer | null>(null);

  // ---- store ----
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const templates = useEditor((s) => s.templates);
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const addUpload = useEditor((s) => s.addUpload);
  const addTemplate = useEditor((s) => s.addTemplate);
  const applyTemplate = useEditor((s) => s.applyTemplate);
  const updateLayer = useEditor((s) => s.updateLayer);
  const addProcessedLayer = useEditor((s) => s.addProcessedLayer);
  const setBackground = useEditor((s) => s.setBackground);
  const replaceLayerImage = useEditor((s) => s.replaceLayerImage);
  const cropMode = useEditor((s) => s.cropMode);
  const cropRect = useEditor((s) => s.cropRect);
  const cancelCrop = useEditor((s) => s.cancelCrop);
  const cropAspect = useEditor((s) => s.cropAspect);
  const setCropAspect = useEditor((s) => s.setCropAspect);
  const pasteLayer = useEditor((s) => s.pasteLayer);
  const playAnimations = useEditor((s) => s.playAnimations);
  const addCustomFont = useEditor((s) => s.addCustomFont);
  const selRect = useEditor((s) => s.selRect);
  const pages = useEditor((s) => s.pages);
  const pageIndex = useEditor((s) => s.pageIndex);
  const newDesign = useEditor((s) => s.newDesign);
  const loadPages = useEditor((s) => s.loadPages);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const editingTextId = useEditor((s) => s.editingTextId);
  useLang(); // re-renderiza al cambiar el idioma

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;

  // ---- exportación (opciones recordadas) ----
  const savedExport = (() => {
    try {
      return JSON.parse(localStorage.getItem(EXPORT_LS) ?? '{}') as {
        format?: Fmt;
        scale?: number;
        quality?: number;
        scope?: 'page' | 'all';
      };
    } catch {
      return {};
    }
  })();
  const [format, setFormat] = useState<Fmt>(savedExport.format ?? 'png');
  const [scale, setScale] = useState(savedExport.scale ?? 1);
  const [quality, setQuality] = useState(savedExport.quality ?? 0.92);
  const [scope, setScope] = useState<'page' | 'all'>(savedExport.scope ?? 'page');
  const [showDownload, setShowDownload] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [customW, setCustomW] = useState(String(doc.width));
  const [customH, setCustomH] = useState(String(doc.height));
  const [busy, setBusy] = useState(false);

  // ---- diálogos / vistas ----
  const [showFilters, setShowFilters] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [showPresent, setShowPresent] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showDonate, setShowDonate] = useState<string | false>(false);
  const [showRequest, setShowRequest] = useState<LicenseType | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showMore, setShowMore] = useState(false);
  // Móvil: el panel de propiedades es una hoja inferior que se abre a demanda.
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!selectedId) setSheetOpen(false);
  }, [selectedId]);
  // Editor de gráficas/tablas: nueva (sin layerId) o reeditar una capa.
  const [chartDialog, setChartDialog] = useState<{
    mode: 'chart' | 'table';
    layerId?: string;
    initial: { chart?: ChartSpec; table?: TableSpec };
  } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [maskSession, setMaskSession] = useState<{
    layer: ImageLayer;
    onApply: (dataUrl: string) => void;
  } | null>(null);

  // ---- licencia ----
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  useEffect(() => {
    getStoredLicense().then(setLicense);
  }, []);

  // Aviso de apoyo estilo WinRAR: la app sigue completa. Sale como máximo una
  // vez al día (al abrir tras una semana de uso, o después de descargar).
  const maybeNag = (title: string) => {
    const KEY = 'chamva.donateShownAt';
    const last = Number(localStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    localStorage.setItem(KEY, String(Date.now()));
    setShowDonate(title);
  };
  useEffect(() => {
    const FIRST = 'chamva.firstUse';
    const first = Number(localStorage.getItem(FIRST) ?? 0);
    if (!first) localStorage.setItem(FIRST, String(Date.now()));
    const days = first ? Math.floor((Date.now() - first) / 86_400_000) : 0;
    if (days < 7) return;
    const id = setTimeout(async () => {
      if (!(await getStoredLicense())) maybeNag(`Llevas ${days} días usando ChamVa 💛`);
    }, 8000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- IA: quitar fondo / optimizar ----
  const [bgBusy, setBgBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState('');
  const [bgEdges, setBgEdges] = useState<EdgeMode>('auto');
  const [bgPreview, setBgPreview] = useState<{ target: ImageLayer; result: string } | null>(null);
  const [bgQuality, setBgQuality] = useState<BgQuality>(() => {
    const saved = localStorage.getItem(BG_ENGINE_LS) as BgQuality | null;
    return saved && BG_ENGINES.some((e) => e.id === saved) ? saved : 'modnet';
  });
  const chooseBgEngine = (q: BgQuality) => {
    setBgQuality(q);
    localStorage.setItem(BG_ENGINE_LS, q);
  };
  const [upBusy, setUpBusy] = useState(false);
  const [upMsg, setUpMsg] = useState('');
  const [offlineMsg, setOfflineMsg] = useState('');

  // ---- auto-actualizador ----
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updatePct, setUpdatePct] = useState<number | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  useEffect(() => {
    if (!isTauri()) return;
    const id = setTimeout(() => {
      checkForUpdate().then((u) => u && setUpdate(u)).catch(() => {});
    }, 4000);
    return () => clearTimeout(id);
  }, []);
  const installUpdate = async () => {
    if (!update) return;
    setUpdatePct(0);
    try {
      await update.install(setUpdatePct);
    } catch (e) {
      setUpdatePct(null);
      toast('No se pudo actualizar: ' + (e as Error).message, 'error');
    }
  };
  const manualCheckUpdate = async () => {
    setUpdateMsg('…');
    try {
      const u = await checkForUpdate();
      if (u) {
        setUpdate(u);
        setUpdateDismissed(false);
        setUpdateMsg(`${t('Nueva versión disponible')}: ${u.version}`);
      } else setUpdateMsg(t('Estás en la última versión'));
    } catch (e) {
      setUpdateMsg('✕ ' + (e as Error).message);
    }
  };

  // ---- galería de diseños y copias ----
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  useEffect(() => {
    if (showHome) loadDesigns().then(setDesigns);
  }, [showHome]);
  useEffect(() => {
    if (showSettings) loadBackups().then(setBackups);
  }, [showSettings]);

  const setSizeInputs = (d: Doc) => {
    setCustomW(String(d.width));
    setCustomH(String(d.height));
  };
  const openDesign = async (d: SavedDesign) => {
    const p = await rehydrateDocs(d.pages);
    loadPages(p, d.pageIndex);
    setSizeInputs(p[d.pageIndex] ?? p[0]);
    setShowHome(false);
  };
  const restoreBackup = async (b: Backup) => {
    loadPages(await rehydrateDocs(b.pages), b.pageIndex);
    setShowSettings(false);
    setShowHome(false);
    toast('Copia restaurada', 'success');
  };

  // ---- atajos globales ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const st = useEditor.getState();
      if (ctrl && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) st.ungroupSelected();
        else st.groupSelected();
      } else if (e.key === '?' || (e.key === 'F1' && !ctrl)) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      } else if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedId) st.duplicateLayer(selectedId);
      } else if (ctrl && e.key.toLowerCase() === 'c') {
        const l = st.doc.layers.find((x) => x.id === st.selectedId);
        if (l) clipLayer.current = l;
      } else if (ctrl && e.key.toLowerCase() === 'v') {
        if (clipLayer.current) {
          e.preventDefault();
          pasteLayer(clipLayer.current);
        }
      } else if (e.key === 'Escape') {
        if (st.cropMode) st.cancelCrop();
        else if (st.selectedId) st.selectLayer(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        // Las capas bloqueadas no se borran con la tecla (protege el fondo).
        const l = st.doc.layers.find((x) => x.id === selectedId);
        if (!l?.locked) st.removeSelected();
      } else if (e.key.startsWith('Arrow') && selectedId) {
        e.preventDefault();
        const l = st.doc.layers.find((x) => x.id === selectedId);
        if (l && !l.locked) {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          st.updateLayer(selectedId, { x: l.x + dx, y: l.y + dy });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, pasteLayer, selectedId]);

  // Cerrar el menú contextual al hacer clic fuera o desplazarse.
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  // ---- arranque: hidratar, almacenamiento persistente, GC de imágenes ----
  useEffect(() => {
    setStorageErrorHandler(() =>
      toast(
        'No se pudo guardar en el almacenamiento local (¿espacio lleno?). Guarda tu proyecto como archivo.',
        'error',
      ),
    );
    requestPersistentStorage();
    useEditor.getState().hydrate();
    const gc = setTimeout(() => {
      gcAssets().then((n) => n && console.info(`Imágenes huérfanas borradas: ${n}`));
    }, 30_000);
    return () => clearTimeout(gc);
  }, []);

  // ---- autoguardado ----
  const [autosaveReady, setAutosaveReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const saved = await idbGet<{ pages: Doc[]; index: number }>('autosave');
        if (saved?.pages?.length) loadPages(await rehydrateDocs(saved.pages), saved.index ?? 0);
      } catch {
        /* sin recuperación si falla */
      } finally {
        setAutosaveReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Las imágenes van por referencia (io/assets.ts): cada escritura pesa KB.
  // Galería y copias, que releen/reescriben listas, van cada 30 s como mucho.
  const lastGallery = useRef(0);
  useEffect(() => {
    if (!autosaveReady) return;
    const id = setTimeout(async () => {
      const st = useEditor.getState();
      const snapshot = st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p));
      const light = await dehydrateDocs(snapshot);
      idbSet('autosave', { pages: light, index: st.pageIndex });
      if (Date.now() - lastGallery.current < 30_000) return;
      lastGallery.current = Date.now();
      pushBackup(light, st.pageIndex);
      if (snapshot[0]?.layers.length || snapshot.length > 1) {
        try {
          const first = snapshot[0];
          const s = Math.min(1, 160 / Math.max(first.width, first.height));
          const thumb = (await renderDocToCanvas(first, s, '#ffffff')).toDataURL('image/jpeg', 0.6);
          upsertDesign({
            id: first.id,
            name: first.name || 'Diseño sin título',
            updatedAt: Date.now(),
            pageIndex: st.pageIndex,
            pages: light,
            thumb,
          });
        } catch {
          /* miniatura opcional */
        }
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [doc, pages, pageIndex, autosaveReady]);

  // App abierta con doble clic sobre un .chamva (solo Tauri).
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const opened = await invoke<[string, string] | null>('opened_file');
        if (!opened) return;
        const project = parseProject(opened[1]);
        loadPages(project.pages, project.pageIndex);
        setShowHome(false);
        toast(`Proyecto "${opened[0]}" abierto`, 'success');
      } catch {
        /* sin archivo inicial */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ---- acciones ----
  const onUploadFont = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const family = await addFontFromFile(file);
      addCustomFont(family);
      const sel = useEditor.getState().doc.layers.find((l) => l.id === useEditor.getState().selectedId);
      if (sel?.type === 'text') updateLayer(sel.id, { fontFamily: family });
      toast(`Fuente "${family}" lista`, 'success');
    } catch (e) {
      toast('No se pudo cargar la fuente: ' + (e as Error).message, 'error');
    }
  };

  const onPrepareOffline = async () => {
    const pct = (r: number) => (r > 0 ? ` ${Math.round(r * 100)}%` : '…');
    setOfflineMsg('Descargando quitafondos…');
    try {
      await prefetchBgModel((r) => setOfflineMsg(`Quitafondos${pct(r)}`), bgQuality);
      setOfflineMsg('Descargando optimizador…');
      await prefetchUpscaleModel((r) => setOfflineMsg(`Optimizador${pct(r)}`));
      setOfflineMsg('Cargando borrador mágico…');
      await loadOpenCV();
      setOfflineMsg('Descargando conversor de video…');
      await prefetchFFmpeg();
      setOfflineMsg('✓ Listo para usar sin internet');
      setTimeout(() => setOfflineMsg(''), 4000);
    } catch (e) {
      console.error(e);
      setOfflineMsg('✕ Error al descargar (revisa tu conexión)');
      setTimeout(() => setOfflineMsg(''), 4000);
    }
  };

  const doRemoveBg = async (
    target: Layer | null,
    edges: EdgeMode = bgEdges,
    engine: BgQuality = bgQuality,
  ) => {
    if (!target || target.type !== 'image') return;
    setBgBusy(true);
    setBgMsg('Preparando modelo…');
    try {
      // Lienzo transparente para ver el recorte — solo si el fondo era el blanco por defecto.
      const bg = useEditor.getState().doc.background;
      if (bg.type === 'solid' && /^#(fff|ffffff)$/i.test(bg.color)) setBackground(TRANSPARENT_BG);
      const out = await removeImageBackground(target.src, {
        quality: engine,
        edges,
        onProgress: (ratio, stage) => {
          const pct = Math.round(ratio * 100);
          setBgMsg(stage.startsWith('fetch') ? `Descargando modelo… ${pct}%` : `Procesando… ${pct}%`);
        },
      });
      setBgPreview({ target, result: out });
    } catch (e) {
      const err = e as Error;
      if (err.message === 'cancelado') {
        toast('Operación cancelada', 'info');
      } else if (err.name === 'GpuUnavailableError' && engine === 'birefnet') {
        toast('Tu equipo no soporta el motor BiRefNet (GPU). Usando MODNet.', 'info');
        chooseBgEngine('modnet');
        setBgBusy(false);
        setBgMsg('');
        return doRemoveBg(target, edges, 'modnet');
      } else {
        console.error(e);
        toast(
          /fetch|network|load/i.test(err.message)
            ? 'Necesitas internet la primera vez para descargar el modelo (o usa "Preparar offline" en Ajustes).'
            : 'No se pudo quitar el fondo: ' + err.message,
          'error',
        );
      }
    } finally {
      setBgBusy(false);
      setBgMsg('');
    }
  };
  const onRemoveBackground = () => doRemoveBg(selected);
  const onQuickRemoveBg = () => {
    const imageLayers = doc.layers.filter((l) => l.type === 'image');
    const target = selected?.type === 'image' ? selected : imageLayers.length === 1 ? imageLayers[0] : null;
    if (!target) {
      toast('Selecciona primero una imagen (haz clic sobre ella).', 'info');
      return;
    }
    doRemoveBg(target);
  };
  const useBgResult = () => {
    if (!bgPreview) return;
    addProcessedLayer(bgPreview.target.id, bgPreview.result, `${bgPreview.target.name} sin fondo`);
    setBgPreview(null);
    // Primera vez: explicar qué significa el cuadriculado.
    try {
      if (!localStorage.getItem('chamva.tipTransparent')) {
        localStorage.setItem('chamva.tipTransparent', '1');
        toast('Listo. El cuadriculado gris y blanco significa transparente: al descargar en PNG sale sin fondo.', 'success');
      }
    } catch {
      /* sin almacenamiento: sin consejo */
    }
  };
  const refineBgResult = () => {
    if (!bgPreview) return;
    const { target, result } = bgPreview;
    setBgPreview(null);
    setMaskSession({
      layer: { ...target, src: result, originalSrc: target.src },
      onApply: (dataUrl) => {
        addProcessedLayer(target.id, dataUrl, `${target.name} sin fondo`);
        setMaskSession(null);
      },
    });
  };
  const openMaskForSelected = () => {
    if (!selected || selected.type !== 'image') return;
    setMaskSession({
      layer: selected,
      onApply: (dataUrl) => {
        updateLayer(selected.id, { src: dataUrl });
        setMaskSession(null);
      },
    });
  };

  const onPortraitBlur = async (engine: BgQuality = bgQuality): Promise<void> => {
    const target = selected;
    if (!target || target.type !== 'image') return;
    setBgBusy(true);
    setBgMsg('Preparando modelo…');
    try {
      const out = await removeImageBackground(target.src, {
        quality: engine,
        edges: bgEdges,
        onProgress: (ratio, stage) => {
          const pct = Math.round(ratio * 100);
          setBgMsg(stage.startsWith('fetch') ? `Descargando modelo… ${pct}%` : `Procesando… ${pct}%`);
        },
      });
      const st = useEditor.getState();
      const blur = Math.max(6, Math.min(30, Math.round(Math.min(target.naturalWidth, target.naturalHeight) / 60)));
      st.beginBatch();
      st.updateLayer(target.id, { adjust: { ...DEFAULT_ADJUST, ...(target.adjust ?? {}), blur } });
      st.addProcessedLayer(target.id, out, `${target.name} (retrato)`, { keepSource: true });
      st.endBatch();
      toast('Fondo desenfocado: la persona queda nítida encima.', 'success');
    } catch (e) {
      const err = e as Error;
      if (err.message === 'cancelado') toast('Operación cancelada', 'info');
      else if (err.name === 'GpuUnavailableError' && engine === 'birefnet') {
        chooseBgEngine('modnet');
        setBgBusy(false);
        return onPortraitBlur('modnet');
      } else toast('No se pudo desenfocar el fondo: ' + err.message, 'error');
    } finally {
      setBgBusy(false);
      setBgMsg('');
    }
  };

  const onEditChart = (layerId: string) => {
    const l = useEditor.getState().doc.layers.find((x) => x.id === layerId);
    if (!l || l.type !== 'image' || (!l.chart && !l.table)) return;
    setChartDialog({ mode: l.chart ? 'chart' : 'table', layerId, initial: { chart: l.chart, table: l.table } });
  };

  const onUpscale = async () => {
    if (!selected || selected.type !== 'image') return;
    setUpBusy(true);
    setUpMsg('Preparando modelo…');
    try {
      const res = await upscaleImage(selected.src, (ratio, stage) => {
        const pct = Math.round(ratio * 100);
        setUpMsg(stage === 'fetch' ? `Descargando modelo… ${pct}%` : `Mejorando… ${pct}%`);
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
      if ((e as Error).message === 'cancelado') toast('Operación cancelada', 'info');
      else {
        console.error(e);
        toast('No se pudo optimizar: ' + (e as Error).message, 'error');
      }
    } finally {
      setUpBusy(false);
      setUpMsg('');
    }
  };

  const onApplyCrop = async () => {
    if (!selected || selected.type !== 'image' || !cropRect) return;
    const img = await loadImageElement(selected.src);
    const processed = needsProcessing(selected) ? processImage(img, selected) : img;
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
    canvas.getContext('2d')!.drawImage(processed, sx, sy, sw, sh, 0, 0, w, h);
    replaceLayerImage(selected.id, {
      src: canvas.toDataURL('image/png'),
      naturalWidth: w,
      naturalHeight: h,
      x: selected.x + sx * selected.scaleX,
      y: selected.y + sy * selected.scaleY,
    });
    cancelCrop();
  };

  const importFiles = async (files: FileList | File[] | null, addToCanvas: boolean) => {
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

  const baseName = (d: { name: string }) => (d.name || 'chamva').replace(/[^\w\-]+/g, '_');

  const onDownload = async () => {
    setBusy(true);
    setShowDownload(false);
    try {
      localStorage.setItem(EXPORT_LS, JSON.stringify({ format, scale, quality, scope }));
    } catch {
      /* noop */
    }
    try {
      const st = useEditor.getState();
      const allPages = st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p));
      if (format === 'gif') {
        downloadBlob(await exportPagesToGif(allPages, { maxSize: 800, delay: 800 }), `${baseName(allPages[0])}.gif`);
        return;
      }
      if (format === 'pdf') {
        const pdfPages = scope === 'all' ? allPages : [st.doc];
        downloadBlob(await exportPagesToPdf(pdfPages), `${baseName(pdfPages[0])}.pdf`);
        return;
      }
      if (format === 'anim') {
        downloadBlob(await exportAnimatedGif(st.doc), `${baseName(st.doc)}_anim.gif`);
        return;
      }
      if (format === 'anim-mp4') {
        downloadBlob(await gifToMp4(await exportAnimatedGif(st.doc)), `${baseName(st.doc)}_anim.mp4`);
        return;
      }
      if (format === 'ico') {
        downloadBlob(await exportIco(st.doc), `${baseName(st.doc)}.ico`);
        return;
      }
      const targets = scope === 'all' ? allPages : [st.doc];
      for (let i = 0; i < targets.length; i++) {
        const page = targets[i];
        let blob: Blob;
        let ext: string;
        if (format === 'svg') {
          blob = new Blob([await exportDocToSvg(page)], { type: 'image/svg+xml' });
          ext = 'svg';
        } else {
          blob = await exportDoc(page, { format: format as ExportFormat, quality, scale });
          ext = format === 'jpeg' ? 'jpg' : format;
        }
        const suffix = targets.length > 1 ? `_pag${i + 1}` : '';
        downloadBlob(blob, `${baseName(page)}${suffix}.${ext}`);
      }
    } catch (e) {
      console.error(e);
      toast('Error al descargar: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
      // La descarga nunca se bloquea. Sin licencia, el aviso de apoyo sale
      // como máximo una vez al día.
      if (!license) maybeNag('¡Tu archivo se descargó! 💛');
    }
  };

  const onCopyToClipboard = async () => {
    try {
      const blob = await exportDoc(doc, { format: 'png', scale: 1 });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setShowDownload(false);
      toast('Copiado al portapapeles', 'success');
    } catch (e) {
      toast('No se pudo copiar al portapapeles: ' + (e as Error).message, 'error');
    }
  };

  const onSaveTemplate = async () => {
    try {
      const s = Math.min(1, 220 / Math.max(doc.width, doc.height));
      const thumb = (await renderDocToCanvas(doc, s, '#ffffff')).toDataURL('image/jpeg', 0.6);
      const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tpl-${Date.now()}`;
      addTemplate({ id, name: doc.name || `Plantilla ${templates.length + 1}`, thumb, doc: JSON.parse(JSON.stringify(doc)) });
      toast('Plantilla guardada', 'success');
    } catch (e) {
      toast('No se pudo guardar la plantilla: ' + (e as Error).message, 'error');
    }
  };
  const onExportTemplates = () => {
    if (!templates.length) {
      toast('No tienes plantillas guardadas todavía.', 'info');
      return;
    }
    const blob = new Blob([JSON.stringify({ kind: 'chamva-templates', version: 1, templates })], {
      type: 'application/json',
    });
    downloadBlob(blob, 'mis-plantillas.chamva-templates.json');
  };
  const onImportTemplates = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = data?.kind === 'chamva-templates' ? data.templates : null;
      if (!Array.isArray(list)) throw new Error('archivo no reconocido');
      let added = 0;
      for (const tpl of list) {
        if (tpl?.doc && tpl?.thumb) {
          addTemplate({
            id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tpl-${Date.now()}-${added}`,
            name: tpl.name ?? 'Plantilla importada',
            thumb: tpl.thumb,
            doc: tpl.doc,
          });
          added++;
        }
      }
      toast(`${added} plantilla(s) importada(s)`, 'success');
    } catch (e) {
      toast('No se pudieron importar: ' + (e as Error).message, 'error');
    }
  };
  const onApplyTemplate = (d: Doc) => {
    applyTemplate(d);
    setSizeInputs(d);
  };

  const onExportLayer = async () => {
    if (!selected) return;
    const single = { ...doc, background: TRANSPARENT_BG, layers: [selected] };
    downloadBlob(await exportDoc(single, { format: 'png', scale: 1 }), `${baseName(doc)}_capa.png`);
  };

  const onSaveProject = () => {
    const st = useEditor.getState();
    saveProject(st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p)), st.pageIndex);
  };
  const onOpenProject = async (files: FileList | File[] | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const project = await readProjectFile(file);
      loadPages(project.pages, project.pageIndex);
      setSizeInputs(project.pages[project.pageIndex] ?? project.pages[0]);
    } catch (e) {
      toast('No se pudo abrir el proyecto: ' + (e as Error).message, 'error');
    }
  };

  const offlineBusy = !!offlineMsg && !offlineMsg.startsWith('✓') && !offlineMsg.startsWith('✕');

  return (
    <div className="app">
      {update && !updateDismissed && (
        <UpdateBanner update={update} pct={updatePct} onInstall={installUpdate} onDismiss={() => setUpdateDismissed(true)} />
      )}

      <header className="toolbar">
        <span className="brand" style={{ cursor: 'pointer' }} onClick={() => setShowHome(true)} title="Inicio">
          ChamVa
        </span>

        <div className="menu-wrap">
          <button className={showFileMenu ? 'active' : ''} onClick={() => setShowFileMenu((v) => !v)} title="Archivo">
            ☰ {t('Archivo')}
          </button>
          {showFileMenu && (
            <div className="dropdown">
              <button
                onClick={() => {
                  projectRef.current?.click();
                  setShowFileMenu(false);
                }}
              >
                📂 {t('Abrir proyecto')}
              </button>
              <button
                onClick={() => {
                  onSaveProject();
                  setShowFileMenu(false);
                }}
              >
                💾 {t('Guardar proyecto')}
              </button>
            </div>
          )}
        </div>

        <div className="menu-wrap">
          <button className={showSizeMenu ? 'active' : ''} onClick={() => setShowSizeMenu((v) => !v)} title="Tamaño del lienzo">
            📐 {doc.width}×{doc.height}
          </button>
          {showSizeMenu && (
            <SizeMenu
              customW={customW}
              customH={customH}
              setCustomW={setCustomW}
              setCustomH={setCustomH}
              onClose={() => setShowSizeMenu(false)}
            />
          )}
        </div>

        <div className="group">
          <button disabled={past.length === 0} onClick={undo} title="Ctrl+Z">
            ↩ {t('Deshacer')}
          </button>
          <button disabled={future.length === 0} onClick={redo} title="Ctrl+Y">
            ↪ {t('Rehacer')}
          </button>
        </div>

        <button className="cut-bg" onClick={onQuickRemoveBg} disabled={bgBusy} title="Quitar el fondo de la imagen y dejarlo transparente">
          {bgBusy ? `✂ ${bgMsg || '…'}` : `✂ ${t('Quitar fondo')}`}
        </button>
        <div className="menu-wrap">
          <button className={showMore ? 'active' : ''} onClick={() => setShowMore((v) => !v)} title="Más herramientas">
            ⋯ {t('Más')}
          </button>
          {showMore && (
            <div className="dropdown" onClick={() => setShowMore(false)}>
              <button onClick={() => setShowVideo(true)}>🎬 {t('Editor de video')}</button>
              <button onClick={playAnimations}>▶ {t('Previsualizar animaciones')}</button>
              <button onClick={() => setShowPresent(true)}>🖥 {t('Modo presentación')}</button>
              <button onClick={() => setShowShortcuts(true)}>⌨ {t('Atajos de teclado')}</button>
              <button onClick={() => setShowSettings(true)} disabled={offlineBusy}>
                ⬇ {t('Usar sin internet')}…
              </button>
            </div>
          )}
        </div>

        {/* Inputs ocultos: siempre montados para que los botones del riel funcionen */}
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
          accept=".chamva,.json,application/json"
          hidden
          onChange={(e) => {
            onOpenProject(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fontFileRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/*"
          hidden
          onChange={(e) => {
            onUploadFont(e.target.files);
            e.target.value = '';
          }}
        />

        <span className="spacer" />

        <div className="download-wrap">
          <button
            className="cut-bg"
            onClick={() => {
              // Lienzo transparente + JPG recordado → proponer PNG.
              if (!showDownload && format === 'jpeg' && doc.background.type === 'transparent') setFormat('png');
              setShowDownload((v) => !v);
            }}
            disabled={busy}
          >
            {busy ? (
              `… ${t('Descargando')}`
            ) : (
              <>
                <Icon name="download" size={16} /> {t('Descargar')}
              </>
            )}
          </button>
          {showDownload && (
            <DownloadMenu
              format={format}
              setFormat={setFormat}
              scale={scale}
              setScale={setScale}
              quality={quality}
              setQuality={setQuality}
              scope={scope}
              setScope={setScope}
              pageCount={pages.length}
              transparentCanvas={doc.background.type === 'transparent'}
              onDownload={onDownload}
              onCopy={onCopyToClipboard}
            />
          )}
        </div>

        <button className="settings-btn" onClick={() => setShowSettings(true)} title="Ajustes, licencia y versión">
          ⚙ {t('Ajustes')}
        </button>
      </header>

      <div
        className="body"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const upId = e.dataTransfer.getData('application/x-chamva-upload');
          if (upId) {
            const st = useEditor.getState();
            const up = st.uploads.find((u) => u.id === upId) ?? st.brandLogos.find((u) => u.id === upId);
            if (up) addImageLayer(up);
            return;
          }
          if (e.dataTransfer.files.length) {
            const files = Array.from(e.dataTransfer.files);
            const project = files.find((f) => /\.(chamva|json)$/i.test(f.name));
            if (project) {
              onOpenProject([project]);
              setShowHome(false);
              return;
            }
            importFiles(files, true);
          }
        }}
        onContextMenu={(e) => {
          if (!selected || showHome || showVideo) return;
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <RailPanels
          fileRef={fileRef}
          fontFileRef={fontFileRef}
          onOpenChart={(mode) => setChartDialog({ mode, initial: {} })}
          onSaveTemplate={onSaveTemplate}
          onExportTemplates={onExportTemplates}
          onImportTemplates={onImportTemplates}
          onApplyTemplate={onApplyTemplate}
        />

        {showFilters && selected && selected.type === 'image' && (
          <FiltersPanel layer={selected} onClose={() => setShowFilters(false)} />
        )}

        {cropMode && (
          <div className="crop-bar">
            <span>Ajusta el recuadro y aplica</span>
            <select value={cropAspect ?? ''} onChange={(e) => setCropAspect(e.target.value ? Number(e.target.value) : null)}>
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

        <PropertiesPanel
          bgBusy={bgBusy}
          bgMsg={bgMsg}
          bgQuality={bgQuality}
          chooseBgEngine={chooseBgEngine}
          bgEdges={bgEdges}
          setBgEdges={setBgEdges}
          onRemoveBackground={onRemoveBackground}
          onPortraitBlur={() => onPortraitBlur()}
          onEditChart={onEditChart}
          className={sheetOpen ? 'sheet-open' : ''}
          onCloseSheet={() => setSheetOpen(false)}
          upBusy={upBusy}
          upMsg={upMsg}
          onUpscale={onUpscale}
          onOpenMask={openMaskForSelected}
          onShowFilters={() => setShowFilters(true)}
          onExportLayer={onExportLayer}
          textEditRef={textEditRef}
          fontFileRef={fontFileRef}
        />
      </div>

      {/* Móvil: botón para abrir el panel de propiedades como hoja inferior */}
      {selected && !sheetOpen && !editingTextId && (
        <button className="mobile-edit-btn" onClick={() => setSheetOpen(true)}>
          ✏ {t('Editar')}
        </button>
      )}

      {ctxMenu && selected && <ContextMenu selected={selected} pos={ctxMenu} onClose={() => setCtxMenu(null)} />}

      {selRect && selected && !cropMode && !maskSession && !editingTextId && !sheetOpen && (
        <FloatToolbar
          selected={selected}
          rect={selRect}
          bgBusy={bgBusy}
          onRemoveBackground={onRemoveBackground}
          onShowFilters={() => setShowFilters(true)}
        />
      )}

      <PageBar onShowShortcuts={() => setShowShortcuts(true)} />

      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}

      {maskSession && (
        <MaskEditor layer={maskSession.layer} onApply={maskSession.onApply} onCancel={() => setMaskSession(null)} />
      )}

      {bgPreview && (
        <BgPreview
          original={bgPreview.target.src}
          result={bgPreview.result}
          edges={bgEdges}
          busy={bgBusy}
          engineLabel={BG_ENGINES.find((en) => en.id === bgQuality)?.label}
          onEdgesChange={(m) => {
            setBgEdges(m);
            doRemoveBg(bgPreview.target, m);
          }}
          onUse={useBgResult}
          onRefine={refineBgResult}
          onCancel={() => setBgPreview(null)}
        />
      )}

      {showVideo && <VideoEditor onClose={() => setShowVideo(false)} />}

      {showPresent && (
        <Presentation pages={pages.map((p, i) => (i === pageIndex ? doc : p))} start={pageIndex} onClose={() => setShowPresent(false)} />
      )}

      {showHome && (
        <HomeScreen
          designs={designs}
          hasLicense={!!license}
          onNewDesign={(size) => {
            newDesign(size);
            setCustomW(String(size.width));
            setCustomH(String(size.height));
            setShowHome(false);
          }}
          onContinue={() => {
            setShowVideo(false);
            setShowHome(false);
          }}
          onEditVideo={() => {
            setShowHome(false);
            setShowVideo(true);
          }}
          onOpenDesign={openDesign}
          onRemoveDesign={(id) => removeDesign(id).then(setDesigns)}
          onSettings={() => setShowSettings(true)}
        />
      )}

      {showDonate && !license && (
        <DonateDialog
          title={showDonate}
          onClose={() => setShowDonate(false)}
          onRequestLicense={(plan) => {
            setShowDonate(false);
            setShowRequest(plan);
          }}
        />
      )}

      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          license={license}
          setLicense={setLicense}
          onRequestLicense={(plan) => setShowRequest(plan ?? 'permanente')}
          updateMsg={updateMsg}
          onCheckUpdate={manualCheckUpdate}
          offlineMsg={offlineMsg}
          onPrepareOffline={onPrepareOffline}
          backups={backups}
          onRestoreBackup={restoreBackup}
        />
      )}

      {showRequest && <RequestLicenseDialog initialPlan={showRequest} onClose={() => setShowRequest(null)} />}

      {chartDialog && (
        <ChartEditor
          mode={chartDialog.mode}
          initial={chartDialog.initial}
          onCancel={() => setChartDialog(null)}
          onApply={(r) => {
            const id = chartDialog.layerId;
            if (id) {
              updateLayer(id, {
                src: r.src,
                naturalWidth: r.naturalWidth,
                naturalHeight: r.naturalHeight,
                chart: r.chart,
                table: r.table,
              });
            } else {
              addImageLayer({
                src: r.src,
                naturalWidth: r.naturalWidth,
                naturalHeight: r.naturalHeight,
                name: r.chart ? 'Gráfica' : 'Tabla',
                chart: r.chart,
                table: r.table,
              });
            }
            setChartDialog(null);
          }}
        />
      )}

      <Toaster />
    </div>
  );
}
