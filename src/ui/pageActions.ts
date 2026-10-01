import { useEditor } from '../editor/state/store';
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
