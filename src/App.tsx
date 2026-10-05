import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useEditor } from './editor/state/store';
import { isLayerLocked, exportablePages, exportableCount, ALL_HIDDEN_MSG } from './editor/core/pageOps';
import { EditorCanvas, isTypingTarget } from './editor/canvas/EditorCanvas';
import { TRANSPARENT_BG, type Doc, type ImageLayer, type Layer } from './editor/core/types';
import { Icon } from './ui/Icon';
import { toast, Toaster } from './ui/toast';
import { BatchShareHost, openBatchShare } from './ui/ExportQueuePanel';
import { TextToolsHost, openFindReplace } from './ui/FindReplace';
import { idbGet, requestPersistentStorage, setStorageErrorHandler } from './io/idb';
import { rehydrateDocs, gcAssets } from './io/assets';
import { getStoredLicense, type LicenseInfo, type LicenseType } from './license';
import { loadImageFile } from './io/import';
import { addFontFromFile } from './editor/core/fonts';
import { exportDoc, downloadBlob, renderDocToCanvas } from './io/export';
import { exportPagesToGif } from './io/exportGif';
import { exportPagesToPdf } from './io/exportPdf';
import { runImageExport, cancelExport } from './io/runExport';
import { runInQueue } from './io/exportQueue';
import { exportAnimatedGif } from './io/exportAnim';
import { exportDocAnimationVideo } from './video/exportActions';
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
import { actionForEvent, getShortcut, useShortcuts } from './editor/core/shortcuts';
import { useTool } from './editor/state/toolStore';
import { TOOL_DEFS, toolForAction } from './editor/state/toolLogic';
import { UiPrefs, getFocusMode, setFocusMode, toggleFocusMode } from './ui/UiScale';
import { TipLayer } from './ui/Tip';
import {
  loadDesigns,
  loadBackups,
  type SavedDesign,
  type Backup,
} from './io/designs';
import { needsProcessing, processImage } from './editor/core/imageProcessing';
import { preloadFxImages } from './editor/core/imageEffects';
import { FiltersPanel } from './ui/FiltersPanel';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { RailPanels } from './ui/RailPanels';
import { HomeScreen } from './ui/HomeScreen';
import { SnapshotsDialog } from './ui/SnapshotsDialog';
import { AutoVersionsDialog } from './ui/AutoVersionsDialog';
import { startAutosave, type AutosaveApi } from './io/autosave';
import { DesignNameField } from './ui/DesignNameField';
import { SaveIndicator } from './ui/SaveIndicator';
import './ui/topbar.css';
import { restoreUndoFor, startUndoPersistence, type UndoStoreApi } from './io/undoStore';
import { loadTabs } from './io/tabsStore';
import { readDesignMeta, type DesignMeta } from './editor/state/designIdentity';
import { isBlankSession, park } from './editor/state/sessions';
import { canAddTab, neighborTab, tabLabel } from './editor/state/tabsNav';
import { TabStrip } from './ui/TabStrip';
import { CloseTabDialog } from './ui/CloseTabDialog';
import { checkBackupReminder } from './io/backup';
import { SizeMenu } from './ui/SizeMenu';
import { sizeLabel } from './ui/sizeFieldsLogic';
import { DownloadMenu, type Fmt } from './ui/DownloadMenu';
import { ContextMenu, FloatToolbar } from './ui/SelectionMenus';
import { PageBar } from './ui/PageBar';
import { getStyleSource, setStyleSource } from './editor/core/styleClipboard';
import { UpdateBanner } from './ui/UpdateBanner';
import { CommandPalette, type Command } from './ui/CommandPalette';
import { HistoryPopover } from './ui/HistoryPopover';
import { Tour, shouldShowTour } from './ui/Tour';
import { ColorBlindView } from './ui/ColorBlindView';
import { setTheme } from './theme';
import { openExternal } from './io/openExternal';
import { AUTHOR, SUPPORT } from './branding';
import type { ChartSpec, TableSpec } from './editor/core/charts';
import { DEFAULT_ADJUST } from './editor/core/types';
import './App.css';
import './dropzone.css';
import './ui/perf.css';
import { TouchRuntime, TouchMenuItems } from './ui/TouchRuntime';
import { classifyPaste, classifyDrop, choosePasteSource, dataUrlToBlob } from './io/paste';
import { cancelAI } from './ai/worker-client';
import { canInstallPwa, onInstallAvailability, promptInstall } from './io/pwa';

// Carga diferida: módulos pesados que no se ven al arrancar (se bajan al abrirlos).
const MaskEditor = lazy(() => import('./ui/MaskEditor').then((m) => ({ default: m.MaskEditor })));
const VideoEditor = lazy(() => import('./ui/VideoEditor').then((m) => ({ default: m.VideoEditor })));
const Presentation = lazy(() => import('./ui/Presentation').then((m) => ({ default: m.Presentation })));
const BgPreview = lazy(() => import('./ui/BgPreview').then((m) => ({ default: m.BgPreview })));
const ChartEditor = lazy(() => import('./ui/ChartEditor').then((m) => ({ default: m.ChartEditor })));
const ShortcutsDialog = lazy(() => import('./ui/ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })));
const SettingsDialog = lazy(() => import('./ui/LicenseDialogs').then((m) => ({ default: m.SettingsDialog })));
const DonateDialog = lazy(() => import('./ui/LicenseDialogs').then((m) => ({ default: m.DonateDialog })));
const RequestLicenseDialog = lazy(() => import('./ui/LicenseDialogs').then((m) => ({ default: m.RequestLicenseDialog })));
const lazyFallback = <div className="lazy-fallback">Cargando…</div>;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// Enganche del store con el historial de deshacer persistente (io/undoStore.ts).
const UNDO_API: UndoStoreApi = {
  getState: () => useEditor.getState(),
  subscribe: (fn) => useEditor.subscribe(fn),
  restoreHistory: (past, id) => useEditor.getState().restoreHistory(past, id),
};
// Enganche del store con el autoguardado (io/autosave.ts).
const AUTOSAVE_API: AutosaveApi = {
  getState: () => useEditor.getState(),
  subscribe: (fn) => useEditor.subscribe(fn),
};
const EXPORT_LS = 'chamva.exportOpts';
const BG_ENGINE_LS = 'chamva.bgEngine';

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const textEditRef = useRef<HTMLTextAreaElement>(null);
  const clipLayer = useRef<Layer | null>(null);
  const leftAppSinceCopy = useRef(false); // salió de la ventana desde el último Ctrl+C interno

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
  useShortcuts(); // y al cambiar los atajos (paleta y tooltips)

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;

  // ---- exportación (opciones recordadas) ----
  const savedExport = (() => {
    try {
      return JSON.parse(localStorage.getItem(EXPORT_LS) ?? '{}') as {
        format?: Fmt;
        scale?: number;
        quality?: number;
        scope?: 'page' | 'all' | 'selection';
      };
    } catch {
      return {};
    }
  })();
  const [format, setFormat] = useState<Fmt>(savedExport.format ?? 'png');
  const [scale, setScale] = useState(savedExport.scale ?? 1);
  const [quality, setQuality] = useState(savedExport.quality ?? 0.92);
  const [scope, setScope] = useState<'page' | 'all' | 'selection'>(
    savedExport.scope === 'selection' ? 'page' : (savedExport.scope ?? 'page'),
  );
  const [showDownload, setShowDownload] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showAutoVersions, setShowAutoVersions] = useState(false);
  // Ctrl+Z también deshace operaciones de proyecto entero (varios formatos, restaurar versión).
  const canStructUndo = useEditor((s) => !!s.structUndo && s.doc === s.structUndo.docAfter && s.pageIndex === s.structUndo.pageIndexAfter);
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [customW, setCustomW] = useState(String(doc.width));
  const [customH, setCustomH] = useState(String(doc.height));
  const [busy, setBusy] = useState(false);

  // ---- diálogos / vistas ----
  const [showFilters, setShowFilters] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [showPresent, setShowPresent] = useState(false);
  // Las páginas ocultas no se presentan: si todas lo están, avisa en lugar de abrir una pantalla vacía.
  // Páginas que se presentan (sin las ocultas) y por cuál empieza: la actual, o la primera visible.
  const presentPages = exportablePages(pages.map((p, i) => (i === pageIndex ? doc : p)));
  const presentStart = Math.max(0, presentPages.findIndex((p) => p.id === doc.id));
  const startPresent = () => {
    if (!exportableCount(useEditor.getState())) toast(ALL_HIDDEN_MSG, 'info');
    else setShowPresent(true);
  };
  const [showHome, setShowHome] = useState(true);
  // Inicio abierto desde «+» / «Nuevo diseño»: lo que se cree o abra va a una pestaña NUEVA.
  const [homeTab, setHomeTab] = useState(false);
  // Cerrar pestaña que no se pudo guardar: diálogo «Cerrar de todos modos / Cancelar».
  const [closeAsk, setCloseAsk] = useState<{ id: string; name: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDonate, setShowDonate] = useState<string | false>(false);
  const [showRequest, setShowRequest] = useState<LicenseType | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showTour, setShowTour] = useState(false);
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
      if (!(await getStoredLicense())) maybeNag(`Llevas ${days} días usando ChamVa`);
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

  // Pestañas (store/sessions.ts): al cambiar de pestaña, lo que App tiene abierto sobre una
  // capa del diseño anterior (máscara, quitar fondo, gráfica, menú) se cierra; si no, al
  // aplicarlo caería en el diseño nuevo. Con una sola pestaña esto nunca se dispara.
  const activeTabId = useEditor((s) => s.activeTabId);
  const lastTabId = useRef(activeTabId);
  useEffect(() => {
    if (lastTabId.current === activeTabId) return;
    lastTabId.current = activeTabId;
    setMaskSession(null);
    setBgPreview(null);
    setChartDialog(null);
    setCtxMenu(null);
    const d = useEditor.getState().doc;
    setCustomW(String(d.width));
    setCustomH(String(d.height));
  }, [activeTabId]);

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
  // Diseño en blanco: en la pestaña activa si está vacía y el Inicio no vino de «+»; si no, en una nueva.
  const startBlankDesign = (size?: Parameters<typeof newDesign>[0]): boolean => {
    const st = useEditor.getState();
    if (homeTab || !isBlankSession(park(st))) {
      if (st.newTab(size) === null) {
        tabLimitToast();
        return false;
      }
    } else newDesign(size); // lleva unit/dpi opcionales
    return true;
  };
  const closeHome = () => {
    setShowHome(false);
    setHomeTab(false);
  };
  const openHome = (tab: boolean) => {
    setHomeTab(tab);
    setShowHome(true);
  };
  const tabLimitToast = () =>
    toast('Hay 8 pestañas abiertas. Cierra alguna para abrir otro diseño.', 'info');
  // Abre unas páginas en una pestaña: si el diseño ya está abierto solo se cambia a ella
  // (nunca dos pestañas con el mismo designId); `replaceIfOpen` además le pone ESTE contenido
  // (restaurar una copia o abrir un archivo). Devuelve false si no se abrió (límite de pestañas).
  const openInTab = (pgs: Doc[], index: number, meta: DesignMeta, replaceIfOpen = false): boolean => {
    const r = useEditor.getState().openDesignInTab(pgs, index, meta);
    if (r.status === 'limit') {
      tabLimitToast();
      return false;
    }
    if (r.status === 'invalid') return false;
    if (r.status === 'opened' || r.status === 'reused') void restoreUndoFor(UNDO_API); // deshacer que sobrevive
    else if (replaceIfOpen) useEditor.getState().loadPages(pgs, index, meta);
    return true;
  };
  const openDesign = async (d: SavedDesign) => {
    const p = await rehydrateDocs(d.pages);
    // Se abre con SU id (no el de la primera página): reordenar no lo duplica.
    if (!openInTab(p, d.pageIndex, { designId: d.id, name: d.designName })) return;
    const cur = useEditor.getState().doc;
    setSizeInputs(cur);
    closeHome();
  };
  const restoreBackup = async (b: Backup) => {
    if (!openInTab(await rehydrateDocs(b.pages), b.pageIndex, readDesignMeta(b), true)) return;
    setShowSettings(false);
    closeHome();
    toast('Copia restaurada', 'success');
  };

  const requestCloseTab = async (id: string) => {
    const st = useEditor.getState();
    const was = st.tabs.length;
    const name =
      id === st.activeTabId ? tabLabel(st.designName, st.pages[0]?.name) : tabLabel(st.parked[id]?.designName, st.parked[id]?.pages[0]?.name);
    const ok = await st.closeTab(id);
    if (!ok) setCloseAsk({ id, name });
    else if (was === 1) openHome(false); // era la última: queda un diseño en blanco y se muestra Inicio
  };
  const forceCloseTab = async () => {
    const ask = closeAsk;
    setCloseAsk(null);
    if (!ask) return;
    const was = useEditor.getState().tabs.length;
    await useEditor.getState().closeTab(ask.id, { force: true });
    if (was === 1) openHome(false);
  };
  const newTabHome = () => {
    if (!canAddTab(useEditor.getState().tabs.length)) return tabLimitToast();
    openHome(true);
  };

  // Recorrido de bienvenida: solo la primera vez, ya dentro del editor.
  useEffect(() => {
    if (showHome || !shouldShowTour()) return;
    const id = setTimeout(() => setShowTour(true), 1200);
    return () => clearTimeout(id);
  }, [showHome]);

  // ---- atajos globales ----
  const newTabHomeRef = useRef(() => {});
  const requestCloseTabRef = useRef(async (_id: string) => {});
  newTabHomeRef.current = newTabHome;
  requestCloseTabRef.current = requestCloseTab;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+F: buscar y reemplazar texto (también desde un campo de texto).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openFindReplace();
        return;
      }
      if (isTypingTarget(e.target)) return;
      const st = useEditor.getState();
      // Ctrl+Alt+V: pegar solo el formato de la capa copiada (fuera del registro: no es personalizable).
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const src = getStyleSource();
        if (src) st.pasteStyle(src);
        else toast('Copia primero una capa (Ctrl+C) para pegar su formato.', 'info');
        return;
      }
      // Atajos personalizables: el registro (editor/core/shortcuts.ts) dice qué acción es.
      const act = actionForEvent(e);
      if (act === 'palette') {
        e.preventDefault();
        setShowPalette((v) => !v);
      } else if (act === 'newTab') {
        e.preventDefault();
        newTabHomeRef.current();
      } else if (act === 'closeTab') {
        e.preventDefault();
        void requestCloseTabRef.current(st.activeTabId);
      } else if (act === 'nextTab' || act === 'prevTab') {
        e.preventDefault();
        const to = neighborTab(st.tabs, st.activeTabId, act === 'nextTab' ? 1 : -1);
        if (to) st.switchTab(to);
      } else if (act && toolForAction(act)) {
        // Herramientas del lienzo (V, H, Z, T, R, O, L, B, E). El editor de video tiene las suyas.
        if (document.querySelector('.vx-root')) return;
        e.preventDefault();
        const tl = toolForAction(act)!;
        useTool.getState().toggle(tl.tool, tl.shape);
      } else if (act === 'pageView') {
        e.preventDefault();
        st.togglePageView();
      } else if (act === 'focus') {
        e.preventDefault();
        toggleFocusMode();
      } else if (act === 'group') {
        e.preventDefault();
        st.groupSelected();
      } else if (act === 'ungroup') {
        e.preventDefault();
        st.ungroupSelected();
      } else if (act === 'shortcuts') {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      } else if (act === 'undo') {
        e.preventDefault();
        undo();
      } else if (act === 'redo') {
        e.preventDefault();
        redo();
      } else if (act === 'duplicate') {
        e.preventDefault();
        if (selectedId) st.duplicateLayer(selectedId);
      } else if (act === 'copy') {
        const l = st.doc.layers.find((x) => x.id === st.selectedId);
        if (l) {
          clipLayer.current = l;
          setStyleSource(l);
          leftAppSinceCopy.current = false;
        }
      } else if (act === 'paste') {
        // El pegado (capa interna, imagen o texto del portapapeles) lo decide el
        // evento 'paste' (más abajo): aquí NO se cancela para que el navegador lo emita.
      } else if (e.key === 'Escape') {
        if (getFocusMode()) setFocusMode(false);
        else if (st.cropMode) st.cancelCrop();
        else if (useTool.getState().tool !== 'select') useTool.getState().escape(); // Esc: de vuelta al puntero
        else if (st.selectedId) st.selectLayer(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        // Las capas bloqueadas no se borran con la tecla (protege el fondo).
        const l = st.doc.layers.find((x) => x.id === selectedId);
        if (!l || !isLayerLocked(st.doc, l)) st.removeSelected();
      } else if (e.key.startsWith('Arrow') && selectedId) {
        e.preventDefault();
        const l = st.doc.layers.find((x) => x.id === selectedId);
        if (l && !isLayerLocked(st.doc, l)) {
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
        // Pestañas guardadas (P8). Sin índice `tabs` (primer arranque con P8, o nada que
        // leer) se recupera `autosave` como siempre: esa es la migración, y no borra nada.
        const restored = await loadTabs().catch(() => null);
        if (restored && useEditor.getState().restoreTabs(restored.tabs, restored.activeId)) {
          if (restored.dropped.length)
            toast(
              restored.dropped.length === 1
                ? 'Una pestaña guardada estaba dañada y no se pudo abrir. Las demás se recuperaron.'
                : `${restored.dropped.length} pestañas guardadas estaban dañadas y no se pudieron abrir. Las demás se recuperaron.`,
              'error',
            );
          await restoreUndoFor(UNDO_API); // deshacer de la activa; las demás, al activarlas
        } else {
          // designId/designName solo existen desde v0.6: sin ellos, la identidad de siempre.
          const saved = await idbGet<{ pages: Doc[]; index: number; designId?: string; designName?: string }>('autosave');
          if (saved?.pages?.length) {
            loadPages(await rehydrateDocs(saved.pages), saved.index ?? 0, readDesignMeta(saved));
            await restoreUndoFor(UNDO_API); // recupera los últimos pasos de deshacer
          }
        }
      } catch {
        /* sin recuperación si falla */
      } finally {
        setAutosaveReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Historial de deshacer persistente y aviso de copia de seguridad (cada 30 días).
  useEffect(() => {
    if (!autosaveReady) return;
    const stop = startUndoPersistence(UNDO_API);
    const id = setTimeout(() => checkBackupReminder((m) => toast(m, 'info')), 20_000);
    return () => {
      stop();
      clearTimeout(id);
    };
  }, [autosaveReady]);

  // Pestaña recuperada del disco que se activa por primera vez: llega sin historial en
  // memoria; se recupera su deshacer guardado (`undo:<designId>`), como al abrir un diseño.
  useEffect(() => {
    if (!autosaveReady) return;
    return useEditor.subscribe((s, prev) => {
      if (s.activeTabId !== prev.activeTabId && s.past.length === 0) void restoreUndoFor(UNDO_API);
    });
  }, [autosaveReady]);

  // Autoguardado (io/autosave.ts): 1,2 s tras el último cambio; galería y copias cada 30 s.
  useEffect(() => {
    if (!autosaveReady) return;
    return startAutosave(AUTOSAVE_API);
  }, [autosaveReady]);

  // App abierta con doble clic sobre un .chamva (solo Tauri).
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const opened = await invoke<[string, string] | null>('opened_file');
        if (!opened) return;
        const project = parseProject(opened[1]);
        if (!openInTab(project.pages, project.pageIndex, readDesignMeta(project), true)) return;
        closeHome();
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

  const offlineCancelled = useRef(false);
  // Botón «Cancelar» de la barra de tareas: aborta IA/descarga de modelos en curso.
  const cancelHeavyTask = () => {
    offlineCancelled.current = true;
    cancelAI();
  };
  const onPrepareOffline = async () => {
    const pct = (r: number) => (r > 0 ? ` ${Math.round(r * 100)}%` : '…');
    const stop = () => {
      if (offlineCancelled.current) throw new Error('cancelado');
    };
    offlineCancelled.current = false;
    setOfflineMsg('Descargando quitafondos…');
    try {
      await prefetchBgModel((r) => setOfflineMsg(`Quitafondos${pct(r)}`), bgQuality);
      stop();
      setOfflineMsg('Descargando optimizador…');
      await prefetchUpscaleModel((r) => setOfflineMsg(`Optimizador${pct(r)}`));
      stop();
      setOfflineMsg('Cargando borrador mágico…');
      await loadOpenCV();
      stop();
      setOfflineMsg('✓ Listo para usar sin internet');
      setTimeout(() => setOfflineMsg(''), 4000);
    } catch (e) {
      if ((e as Error).message === 'cancelado') {
        setOfflineMsg('✕ Descarga cancelada');
        setTimeout(() => setOfflineMsg(''), 3000);
        return;
      }
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
    await preloadFxImages(selected.adjust);
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

  // «Editar una foto» desde el inicio: diseño nuevo con el lienzo del tamaño de la foto.
  const startFromPhoto = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const img = await loadImageFile(file);
      if (!startBlankDesign()) return; // límite de pestañas: ya se avisó
      useEditor.getState().newDesignFromImage(img);
      useEditor.getState().setZoom(1);
      const d = useEditor.getState().doc;
      setCustomW(String(d.width));
      setCustomH(String(d.height));
      setShowVideo(false);
      closeHome();
      if (Math.max(img.naturalWidth, img.naturalHeight) > 8000)
        toast('La foto es muy grande: el lienzo se ajustó a 8000 px', 'info');
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir esa foto.', 'error');
    }
  };
  const startFromPhotoRef = useRef(startFromPhoto);
  startFromPhotoRef.current = startFromPhoto;

  // Arrastrar imágenes a CUALQUIER parte de la ventana: se añaden al diseño y a
  // la galería. Las zonas con su propio destino (lienzo/marcos) cortan el evento antes.
  const [dragFiles, setDragFiles] = useState(false);
  const importFilesRef = useRef(importFiles);
  importFilesRef.current = importFiles;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragFiles(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragFiles(false);
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragFiles(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      const imgs = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (imgs.length && showHomeRef.current) startFromPhotoRef.current(imgs[0]);
      else if (imgs.length) importFilesRef.current(imgs, true);
      else toast('Solo se pueden soltar imágenes aquí.', 'info');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  // Pegar (Ctrl+V) y arrastrar desde fuera de la app. Prioridad: si hay una capa copiada
  // dentro del editor y el usuario no ha salido de la ventana desde entonces, gana la
  // capa; si salió (pudo copiar algo fuera) gana el portapapeles del sistema; si este no
  // trae nada utilizable, se pega la capa interna. El `drop` de archivos ya lo cubre el
  // efecto anterior: aquí solo los arrastres SIN archivos (imagen desde otra pestaña).
  const showHomeRef = useRef(showHome);
  showHomeRef.current = showHome;
  useEffect(() => {
    const importBlob = async (blob: Blob, name: string) => {
      const type = blob.type.startsWith('image/') ? blob.type : 'image/png';
      const ext = type.split('/')[1]?.split('+')[0] || 'png';
      await importFilesRef.current([new File([blob], `${name}.${ext}`, { type })], true);
    };
    const onBlur = () => {
      leftAppSinceCopy.current = true;
    };
    const onPaste = async (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || showHomeRef.current) return;
      const cd = e.clipboardData;
      const files = Array.from(cd?.files ?? []).filter((f) => f.type.startsWith('image/'));
      const external = classifyPaste({
        imageTypes: files.map((f) => f.type),
        text: cd?.getData('text/plain') ?? '',
        html: cd?.getData('text/html') ?? '',
      });
      const source = choosePasteSource({
        hasInternal: !!clipLayer.current,
        leftAppSinceCopy: leftAppSinceCopy.current,
        external: external.kind,
      });
      if (source === 'none') return;
      e.preventDefault();
      if (source === 'internal') {
        useEditor.getState().pasteLayer(clipLayer.current!);
        return;
      }
      try {
        if (external.kind === 'image') await importFilesRef.current(files, true);
        else if (external.kind === 'svg')
          await importBlob(new Blob([external.svg], { type: 'image/svg+xml' }), 'pegado');
        else if (external.kind === 'data-image') {
          const blob = dataUrlToBlob(external.url);
          if (blob) await importBlob(blob, 'pegado');
        } else if (external.kind === 'text') {
          const text = external.text.length > 2000 ? external.text.slice(0, 2000) : external.text;
          useEditor.getState().addTextLayer({ text, fontSize: text.length > 120 ? 28 : 48, bold: false });
        }
      } catch (err) {
        console.error(err);
        toast('No se pudo pegar el contenido del portapapeles.', 'error');
      }
    };
    const dropTypes = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []);
    const isExternalImageDrag = (e: DragEvent) => {
      const ty = dropTypes(e);
      return !ty.includes('Files') && !ty.includes('application/x-chamva-upload') && (ty.includes('text/uri-list') || ty.includes('text/html'));
    };
    const onDragOver = (e: DragEvent) => {
      if (showHomeRef.current || isTypingTarget(e.target) || !isExternalImageDrag(e)) return;
      e.preventDefault(); // sin esto el navegador abriría la imagen y saldría de la app
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = async (e: DragEvent) => {
      if (e.defaultPrevented || showHomeRef.current || isTypingTarget(e.target) || !isExternalImageDrag(e)) return;
      e.preventDefault();
      const r = classifyDrop({
        uriList: e.dataTransfer?.getData('text/uri-list') ?? '',
        html: e.dataTransfer?.getData('text/html') ?? '',
      });
      if (r.kind === 'none') return;
      if (r.kind === 'remote') {
        toast('Esa imagen viene de internet: guarda el archivo en tu equipo y arrástralo desde ahí.', 'info');
        return;
      }
      try {
        const blob = r.url.startsWith('data:') ? dataUrlToBlob(r.url) : await (await fetch(r.url)).blob();
        if (!blob) throw new Error('imagen no válida');
        await importBlob(blob, 'arrastrada');
      } catch (err) {
        console.error(err);
        toast('No se pudo leer la imagen arrastrada: guarda el archivo y arrástralo desde tu equipo.', 'error');
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // «Instalar ChamVa» (PWA): solo aparece si el navegador lo ofrece.
  const [canInstall, setCanInstall] = useState(canInstallPwa());
  useEffect(() => onInstallAvailability(() => setCanInstall(canInstallPwa())), []);

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
      const synced = st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p));
      // Las páginas ocultas no entran en «todas», GIF ni PDF; «esta página» sí (acción explícita).
      const allPages = exportablePages(synced);
      const usesAll = format === 'gif' || (scope === 'all' && !['anim', 'anim-mp4', 'ico'].includes(format));
      if (usesAll && !allPages.length) {
        toast(ALL_HIDDEN_MSG, 'info');
        return;
      }
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
        // Mismo motor que el editor de video (WebCodecs): sin GIF intermedio ni ffmpeg.
        await exportDocAnimationVideo(st.doc, `${baseName(st.doc)}_anim`);
        return;
      }
      if (format === 'ico') {
        downloadBlob(await exportIco(st.doc), `${baseName(st.doc)}.ico`);
        return;
      }
      // Imágenes (PNG/JPG/WebP/AVIF/SVG): selección, varios tamaños, ZIP, marca de agua…
      if (scope === 'all' && allPages.length > 1) {
        // Varias páginas (ZIP): pasa por la cola y se puede cancelar desde el panel «Exportaciones».
        await runInQueue(`Exportar ${allPages.length} páginas (${format.toUpperCase()})`, async (ctx) => {
          ctx.onCancel(cancelExport);
          await runImageExport({ format, scale, quality, scope });
        });
        return;
      }
      await runImageExport({ format, scale, quality, scope });
    } catch (e) {
      console.error(e);
      toast('Error al descargar: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
      // La descarga nunca se bloquea. Sin licencia, el aviso de apoyo sale
      // como máximo una vez al día.
      if (!license) maybeNag('Tu archivo se descargó');
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
    saveProject(st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p)), st.pageIndex, {
      designId: st.designId,
      designName: st.designName,
    });
  };
  const onSavePortable = async () => {
    const st = useEditor.getState();
    try {
      const { savePortableProject } = await import('./io/portableProject');
      await savePortableProject(st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p)), st.pageIndex, {
        designId: st.designId,
        designName: st.designName,
      });
    } catch (e) {
      toast('No se pudo guardar el proyecto portátil: ' + (e as Error).message, 'error');
    }
  };
  const onOpenProject = async (files: FileList | File[] | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const project = await readProjectFile(file);
      if (!openInTab(project.pages, project.pageIndex, readDesignMeta(project), true)) return;
      setSizeInputs(useEditor.getState().doc);
    } catch (e) {
      toast('No se pudo abrir el proyecto: ' + (e as Error).message, 'error');
    }
  };

  // Ajustes de imagen desde la paleta: sobre la imagen seleccionada (null = quitar todos).
  const adjustSelected = (patch: Partial<typeof DEFAULT_ADJUST> | null) => {
    if (!selected || selected.type !== 'image') {
      toast('Selecciona primero una imagen (haz clic sobre ella).', 'info');
      return;
    }
    updateLayer(selected.id, { adjust: patch ? { ...DEFAULT_ADJUST, ...(selected.adjust ?? {}), ...patch } : { ...DEFAULT_ADJUST } });
  };

  // Comandos de la paleta (Ctrl+K). Un solo sitio: lo que hay aquí se puede buscar.
  const commands: Command[] = (() => {
    const st = useEditor.getState();
    const c = (
      group: string,
      id: string,
      label: string,
      run: () => void,
      extra: Partial<Command> = {},
    ): Command => ({ id, group, label, run, ...extra });
    const shape = (kind: Parameters<typeof st.addShapeLayer>[0], label: string, kw: string) =>
      c('Insertar', `shape-${kind}`, label, () => st.addShapeLayer(kind), { keywords: kw });
    return [
      c('Archivo', 'download', 'Descargar…', () => setShowDownload(true), { keywords: 'exportar guardar imagen png jpg pdf svg gif' }),
      c('Archivo', 'copy', 'Copiar al portapapeles', onCopyToClipboard, { keywords: 'imagen' }),
      c('Archivo', 'save-project', 'Guardar proyecto', onSaveProject, { keywords: 'archivo chamva' }),
      c('Archivo', 'save-portable', 'Guardar proyecto portátil', onSavePortable, { keywords: 'archivo chamva zip imágenes mover equipo' }),
      c('Archivo', 'batch-share', 'Lote y compartir…', openBatchShare, { keywords: 'convertir imágenes por lote compartir informe recursos apng webp presentación html' }),
      c('Archivo', 'open-project', 'Abrir proyecto', () => projectRef.current?.click(), { keywords: 'archivo chamva' }),
      c('Archivo', 'snapshots', 'Versiones del diseño…', () => setShowSnapshots(true), { keywords: 'instantaneas guardar version restaurar historial' }),
      c('Archivo', 'auto-versions', 'Versiones automáticas…', () => setShowAutoVersions(true), { keywords: 'autoguardado copias recuperar restaurar historial tiempo' }),
      c('Archivo', 'save-template', 'Guardar como plantilla', onSaveTemplate, { keywords: 'plantillas reutilizar' }),
      ...(showVideo ? [c('Video', 'video-autosubs', 'Subtítulos automáticos (transcribir voz)…', () => window.dispatchEvent(new CustomEvent('chamva:video-autosubs')), { shortcut: 'T', keywords: 'transcribir whisper voz ia subtitular subtitulos automaticos dictado' })] : []),
      c('Archivo', 'home', 'Ir al inicio', () => openHome(false), { keywords: 'nuevo diseño tamaño pantalla principal' }),
      c('Editar', 'undo', 'Deshacer', undo, { shortcut: getShortcut('undo') }),
      c('Editar', 'redo', 'Rehacer', redo, { shortcut: getShortcut('redo') }),
      c('Editar', 'history', 'Historial de cambios', () => setShowHistory(true), { keywords: 'deshacer pasos volver' }),
      c('Editar', 'duplicate', 'Duplicar elemento', () => selectedId && st.duplicateLayer(selectedId), { shortcut: getShortcut('duplicate'), keywords: 'copiar clonar' }),
      c('Editar', 'delete', 'Borrar elemento', () => st.removeSelected(), { shortcut: 'Supr', keywords: 'eliminar quitar' }),
      c('Editar', 'group', 'Agrupar', () => st.groupSelected(), { shortcut: getShortcut('group') }),
      c('Editar', 'ungroup', 'Desagrupar', () => st.ungroupSelected(), { shortcut: getShortcut('ungroup') }),
      c('Insertar', 'text', 'Añadir texto', () => st.addTextLayer(), { keywords: 'titulo letra escribir' }),
      shape('rect', 'Añadir rectángulo', 'cuadro caja forma'),
      shape('ellipse', 'Añadir círculo', 'elipse forma'),
      shape('triangle', 'Añadir triángulo', 'forma'),
      shape('star', 'Añadir estrella', 'forma'),
      shape('line', 'Añadir línea', 'forma recta'),
      shape('arrow', 'Añadir flecha', 'forma'),
      c('Insertar', 'add-page', 'Añadir página', () => st.addPage(), { keywords: 'diapositiva hoja' }),
      c('Imagen', 'remove-bg', 'Quitar fondo de la imagen', onQuickRemoveBg, { keywords: 'recortar transparente ia' }),
      c('Imagen', 'adj-invert', 'Invertir colores de la imagen', () => adjustSelected({ invert: !(selected?.type === 'image' && selected.adjust?.invert) }), { keywords: 'negativo' }),
      c('Imagen', 'adj-bw', 'Imagen en blanco y negro', () => adjustSelected({ grayscale: 100 }), { keywords: 'gris monocromo' }),
      c('Imagen', 'adj-sepia', 'Imagen en sepia', () => adjustSelected({ sepia: 100 }), { keywords: 'antiguo vintage' }),
      c('Imagen', 'adj-sharp', 'Dar nitidez a la imagen', () => adjustSelected({ sharpen: 60 }), { keywords: 'enfocar detalle' }),
      c('Imagen', 'adj-reset', 'Quitar los ajustes de la imagen', () => adjustSelected(null), { keywords: 'restablecer original' }),
      c('Imagen', 'bg-transparent', 'Hacer transparente el fondo del lienzo', () => setBackground({ type: 'transparent' }), { keywords: 'sin fondo cuadriculado' }),
      c('Imagen', 'bg-white', 'Fondo blanco', () => setBackground({ type: 'solid', color: '#ffffff' })),
      c('Imagen', 'bg-black', 'Fondo negro', () => setBackground({ type: 'solid', color: '#000000' })),
      c('Ver', 'rulers', 'Mostrar u ocultar reglas', () => st.toggleRulers(), { keywords: 'medidas pixeles' }),
      c('Ver', 'pageview', 'Páginas apiladas (todas una bajo otra)', () => st.togglePageView(), { shortcut: getShortcut('pageView'), keywords: 'paginas vertical scroll continuo modo' }),
      c('Ver', 'grid', 'Mostrar u ocultar cuadrícula', () => st.toggleGrid(), { keywords: 'rejilla' }),
      c('Ver', 'guides', 'Mostrar u ocultar guías', () => st.toggleGuides(), { keywords: 'lineas' }),
      c('Ver', 'snap', 'Activar o desactivar imán a la cuadrícula', () => st.toggleSnapToGrid(), { keywords: 'ajustar alinear' }),
      c('Ver', 'zoom-in', 'Acercar', () => st.setZoom(st.zoom * 1.2), { keywords: 'zoom aumentar' }),
      c('Ver', 'zoom-out', 'Alejar', () => st.setZoom(st.zoom / 1.2), { keywords: 'zoom reducir' }),
      c('Ver', 'zoom-fit', 'Ajustar zoom a la ventana', () => st.setZoom(1), { keywords: 'zoom encajar' }),
      c('Ver', 'focus', 'Modo concentración', toggleFocusMode, { shortcut: getShortcut('focus'), keywords: 'ocultar paneles barras solo lienzo zen' }),
      c('Ver', 'present', 'Modo presentación', startPresent, { keywords: 'pantalla completa diapositivas' }),
      c('Ver', 'theme-light', 'Tema claro', () => setTheme('light'), { keywords: 'apariencia color' }),
      c('Ver', 'theme-dark', 'Tema oscuro', () => setTheme('dark'), { keywords: 'apariencia color' }),
      c('Ver', 'theme-contrast', 'Tema de alto contraste', () => setTheme('contrast'), { keywords: 'apariencia color accesibilidad blanco negro' }),
      c('Ver', 'theme-system', 'Tema del sistema', () => setTheme('system'), { keywords: 'apariencia automatico' }),
      c('Herramientas', 'video', 'Abrir el editor de video', () => setShowVideo(true), { keywords: 'audio clip' }),
      c('Herramientas', 'preview-anim', 'Previsualizar animaciones', playAnimations),
      ...TOOL_DEFS.map((d) =>
        c('Herramientas', `tool-${d.action}`, `Herramienta: ${d.label.toLowerCase()}`, () => useTool.getState().toggle(d.id, d.shape), {
          shortcut: getShortcut(d.action),
          keywords: 'cursor puntero seleccionar mano mover zoom lupa texto forma rectangulo elipse linea pincel borrador',
        }),
      ),
      c('Ayuda', 'shortcuts', 'Atajos de teclado', () => setShowShortcuts(true), { shortcut: getShortcut('shortcuts') }),
      c('Ayuda', 'settings', 'Ajustes y licencia', () => setShowSettings(true), { keywords: 'idioma tema actualizaciones donantes' }),
      c('Ayuda', 'tour', 'Ver el recorrido de bienvenida', () => setShowTour(true), { keywords: 'tutorial guia ayuda' }),
      c('Ayuda', 'star', 'Dale una estrella en GitHub', () => openExternal(AUTHOR.repo), { keywords: 'apoyar calificar' }),
      c('Ayuda', 'sponsors', 'Apoyar en GitHub Sponsors', () => openExternal(SUPPORT.sponsors), { keywords: 'donar donacion' }),
      c('Ayuda', 'paypal', 'Invítame un café (PayPal)', () => openExternal(AUTHOR.paypal), { keywords: 'donar donacion' }),
    ];
  })();

  const offlineBusy = !!offlineMsg && !offlineMsg.startsWith('✓') && !offlineMsg.startsWith('✕');

  return (
    <div className="app">
      {update && !updateDismissed && (
        <UpdateBanner update={update} pct={updatePct} onInstall={installUpdate} onDismiss={() => setUpdateDismissed(true)} />
      )}

      <TabStrip onNew={newTabHome} onClose={(id) => void requestCloseTab(id)} onHome={() => openHome(false)} />

      <header className="toolbar">
        <DesignNameField />
        <SaveIndicator />

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
              <button
                onClick={() => {
                  onSavePortable();
                  setShowFileMenu(false);
                }}
                title={t('Un solo archivo con el diseño y todas sus imágenes')}
              >
                📦 {t('Guardar proyecto portátil')}
              </button>
              <button
                onClick={() => {
                  onSaveTemplate();
                  setShowFileMenu(false);
                }}
                title="Guarda esta página como plantilla reutilizable (pestaña Plantillas)"
              >
                ◫ {t('Guardar como plantilla')}
              </button>
              <button
                onClick={() => {
                  setShowSnapshots(true);
                  setShowFileMenu(false);
                }}
                title="Guarda versiones con nombre de todo el proyecto y vuelve a ellas cuando quieras"
              >
                🕘 {t('Versiones…')}
              </button>
              <button
                onClick={() => {
                  setShowAutoVersions(true);
                  setShowFileMenu(false);
                }}
                title="Copias automáticas del diseño (cada 10 min mientras editas) para volver atrás tras un fallo"
              >
                ⏱ {t('Versiones automáticas…')}
              </button>
            </div>
          )}
        </div>

        <div className="menu-wrap">
          <button
            className={`resize-btn${showSizeMenu ? ' active' : ''}`}
            onClick={() => setShowSizeMenu((v) => !v)}
            title={`Redimensionar el lienzo (${sizeLabel(doc)})`}
            aria-label="Redimensionar"
          >
            ⤢ <span className="resize-label">{t('Redimensionar')}</span>
            <span className="resize-dim">{sizeLabel(doc)}</span>
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
          <button disabled={past.length === 0 && !canStructUndo} onClick={undo} title="Ctrl+Z">
            ↩ {t('Deshacer')}
          </button>
          <button disabled={future.length === 0} onClick={redo} title="Ctrl+Y">
            ↪ {t('Rehacer')}
          </button>
          <span className="menu-wrap">
            <button
              className={showHistory ? 'active' : ''}
              onClick={() => setShowHistory((v) => !v)}
              title="Historial de cambios: vuelve a cualquier paso"
              aria-label="Historial de cambios"
            >
              ⏱
            </button>
            {showHistory && (
              <div className="history-pop">
                <HistoryPopover onClose={() => setShowHistory(false)} />
              </div>
            )}
          </span>
        </div>

        <button onClick={() => setShowPalette(true)} title="Buscar cualquier acción (Ctrl+K)" className="palette-btn">
          ⌕ {t('Buscar')}
        </button>

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
              <button onClick={startPresent}>🖥 {t('Modo presentación')}</button>
              <button onClick={() => setShowShortcuts(true)}>⌨ {t('Atajos de teclado')}</button>
              <button onClick={() => setShowSettings(true)} disabled={offlineBusy}>
                ⬇ {t('Usar sin internet')}…
              </button>
              {canInstall && (
                <button onClick={() => void promptInstall()}>⤓ {t('Instalar ChamVa')}</button>
              )}
              <TouchMenuItems />
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

        <button className="share-btn" onClick={openBatchShare} title="Enviar a otras apps o exportar varios formatos/tamaños a la vez" aria-label="Compartir…">
          ⇪ <span className="share-label">{t('Compartir')}…</span>
        </button>

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
              pageCount={exportableCount({ pages, doc, pageIndex })}
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
          onOpenDesign={openDesign}
          onGoHome={() => openHome(true)}
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
      <TouchRuntime />

      <Suspense fallback={lazyFallback}>
        {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      </Suspense>

      <Suspense fallback={lazyFallback}>
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
        <Presentation pages={presentPages} start={presentStart} onClose={() => setShowPresent(false)} />
      )}
      </Suspense>

      <UiPrefs />
      <TipLayer />
      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} commands={commands} />
      {showTour && !showHome && <Tour onDone={() => setShowTour(false)} />}

      {dragFiles && !showHome && (
        <div className="drop-hint" aria-hidden="true">
          <span>Suelta la imagen para añadirla al diseño</span>
        </div>
      )}
      {dragFiles && showHome && (
        <div className="drop-hint" aria-hidden="true">
          <span>{t('Suelta la foto para editarla')}</span>
        </div>
      )}

      {closeAsk && <CloseTabDialog name={closeAsk.name} onForce={() => void forceCloseTab()} onCancel={() => setCloseAsk(null)} />}
      {showSnapshots && <SnapshotsDialog onClose={() => setShowSnapshots(false)} />}
      {showAutoVersions && <AutoVersionsDialog onClose={() => setShowAutoVersions(false)} />}

      {showHome && (
        <HomeScreen
          designs={designs}
          hasLicense={!!license}
          mode={homeTab ? 'tab' : 'replace'}
          onCancelTab={closeHome}
          onNewDesign={(size) => {
            if (!startBlankDesign(size)) return; // límite de pestañas: ya se avisó
            setCustomW(String(size.width));
            setCustomH(String(size.height));
            closeHome();
          }}
          onEditPhoto={startFromPhoto}
          onContinue={() => {
            setShowVideo(false);
            closeHome();
          }}
          onEditVideo={() => {
            closeHome();
            setShowVideo(true);
          }}
          onOpenDesign={openDesign}
          onDesignsChange={setDesigns}
          onSettings={() => setShowSettings(true)}
        />
      )}

      <Suspense fallback={lazyFallback}>
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

      <TextToolsHost />
      </Suspense>

      {(bgBusy || upBusy || offlineBusy) && (
        <div className="task-bar" role="status">
          <span>{offlineBusy ? offlineMsg : bgBusy ? bgMsg : upMsg}</span>
          <button onClick={cancelHeavyTask}>✕ {t('Cancelar')}</button>
        </div>
      )}

      <Toaster />
      <ColorBlindView />
      <BatchShareHost />
    </div>
  );
}
