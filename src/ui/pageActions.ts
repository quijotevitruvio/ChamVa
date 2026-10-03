import { useEditor } from '../editor/state/store';
import type { Doc } from '../editor/core/types';
import { clearMasterRefs, setIsMaster, setMasterId } from '../editor/core/master';

// Acciones de página maestra compartidas por la barra de páginas y el clasificador.
// En la página actual se usa editDoc (un paso de deshacer); en las demás, editPages.

export function setPageMaster(pageId: string, value: boolean) {
  const st = useEditor.getState();
  if (st.doc.id === pageId) st.editDoc((d) => setIsMaster(d, value));
  else
    st.editPages((pages, currentId) => ({
      pages: pages.map((p) => (p.id === pageId ? setIsMaster(p, value) : p)),
      currentId,
    }));
  // Una página que deja de ser maestra libera a las que la usaban.
  if (!value) useEditor.getState().editPages((pages, currentId) => ({ pages: clearMasterRefs(pages, pageId), currentId }));
}

export function setPageMasterId(pageId: string, masterId: string | undefined) {
  const st = useEditor.getState();
  if (st.doc.id === pageId) st.editDoc((d) => setMasterId(d, masterId));
  else
    st.editPages((pages, currentId) => ({
      pages: pages.map((p) => (p.id === pageId ? setMasterId(p, masterId) : p)),
      currentId,
    }));
}

// Edita una página cualquiera: la actual con editDoc (un paso de deshacer), las demás con editPages.
export function patchPage(pageId: string, fn: (d: Doc) => Doc) {
  const st = useEditor.getState();
  if (st.doc.id === pageId) st.editDoc(fn);
  else
    st.editPages((pages, currentId) => ({
      pages: pages.map((p) => (p.id === pageId ? fn(p) : p)),
      currentId,
    }));
}

// Los campos opcionales se QUITAN (no se dejan en false/'') para que el proyecto quede idéntico al antiguo.
export function setPageTitle(pageId: string, title: string) {
  const v = title.trim().slice(0, 120);
  patchPage(pageId, (d) => {
    const { title: _t, ...rest } = d;
    return v ? { ...rest, title: v } : rest;
  });
}

export function setPageHidden(pageId: string, hidden: boolean) {
  patchPage(pageId, (d) => {
    const { hidden: _h, ...rest } = d;
    return hidden ? { ...rest, hidden: true } : rest;
  });
}

export function setPageLocked(pageId: string, locked: boolean) {
  patchPage(pageId, (d) => {
    const { locked: _l, ...rest } = d;
    return locked ? { ...rest, locked: true } : rest;
  });
}
