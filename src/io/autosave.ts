// Autoguardado del diseño abierto (antes vivía como efecto en App.tsx).
//
// Ritmo (no cambiar sin pensarlo): cada cambio reinicia un retardo de 1,2 s y al
// vencer se escribe la clave `autosave`. Galería (`upsertDesign`), copias
// (`pushBackup`) y versión automática se actualizan como mucho cada 30 s.
// Las imágenes van por referencia (io/assets.ts): cada escritura pesa KB.
import type { Doc } from '../editor/core/types';
import { idbSet } from './idb';
import { dehydrateDocs } from './assets';
import { pushBackup, upsertDesign } from './designs';
import { maybeSaveAutoVersion } from './autoVersions';
import { renderDocToCanvas } from './export';
import { designTitle } from '../editor/state/designIdentity';
import { markError, markPending, markSaved, markSaving } from './saveStatus';

export const AUTOSAVE_DEBOUNCE_MS = 1200;
export const GALLERY_EVERY_MS = 30_000;

/** Parte mínima del store que usamos (se inyecta para no importar el store aquí). */
export interface AutosaveState {
  doc: Doc;
  pages: Doc[];
  pageIndex: number;
  designId: string;
  designName: string | null;
}
export interface AutosaveApi {
  getState: () => AutosaveState;
  subscribe: (fn: (s: AutosaveState, prev: AutosaveState) => void) => () => void;
}

let current: { schedule: () => void; flush: () => Promise<void> } | null = null;

/** Programa un guardado (con el retardo de siempre). No hace nada si no está activo. */
export const scheduleSave = () => current?.schedule();
/** Guarda ya (p. ej. antes de abrir otro diseño). Resuelve al terminar la escritura principal. */
export const flushSave = (): Promise<void> => current?.flush() ?? Promise.resolve();

/** Empieza a autoguardar. Devuelve la función que lo detiene. */
export function startAutosave(api: AutosaveApi): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let version = 0; // sube con cada cambio: un guardado solo marca «guardado» si nadie cambió nada mientras tanto
  let lastGallery = 0;

  const run = async () => {
    const mine = version;
    markSaving();
    try {
      const st = api.getState();
      const snapshot = st.pages.map((p, i) => (i === st.pageIndex ? st.doc : p));
      const light = await dehydrateDocs(snapshot);
      const designId = st.designId;
      const ownName = st.designName ?? undefined;
      const ok = await idbSet('autosave', {
        pages: light,
        index: st.pageIndex,
        designId,
        ...(ownName ? { designName: ownName } : {}),
      });
      if (!ok) markError();
      else if (version === mine) markSaved();
      else markPending();
      if (Date.now() - lastGallery < GALLERY_EVERY_MS) return;
      lastGallery = Date.now();
      pushBackup(light, st.pageIndex, { designId, designName: ownName });
      if (snapshot[0]?.layers.length || snapshot.length > 1) {
        try {
          const first = snapshot[0];
          const s = Math.min(1, 160 / Math.max(first.width, first.height));
          const thumb = (await renderDocToCanvas(first, s, '#ffffff')).toDataURL('image/jpeg', 0.6);
          upsertDesign({
            id: designId, // estable: reordenar o borrar la primera página no crea otro diseño
            name: designTitle(ownName, snapshot),
            ...(ownName ? { designName: ownName } : {}),
            updatedAt: Date.now(),
            pageIndex: st.pageIndex,
            pages: light,
            thumb,
          });
          maybeSaveAutoVersion(designId, light, st.pageIndex, thumb); // versión automática (cada ~10 min)
        } catch {
          /* miniatura opcional */
        }
      }
    } catch {
      markError();
    }
  };

  const schedule = () => {
    version++;
    markPending();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  const flush = async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    await run();
  };

  const unsub = api.subscribe((s, prev) => {
    if (s.doc !== prev.doc || s.pages !== prev.pages || s.pageIndex !== prev.pageIndex || s.designName !== prev.designName)
      schedule();
  });
  // Al ocultar la pestaña, si hay un cambio esperando, se guarda sin esperar al retardo.
  const onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && timer) void flush();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);

  const me = { schedule, flush };
  current = me;
  schedule(); // como el efecto de antes: la primera escritura llega 1,2 s tras arrancar

  return () => {
    unsub();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (current === me) current = null;
  };
}
