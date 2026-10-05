// Teclas de fusión (Alt+Shift+↑/↓/letra): cada pulsación se ve al instante (vista previa)
// y las pulsaciones seguidas se funden en UN solo paso de deshacer.
import { useEditor } from './store';
import { commonBlend, nextBlend, type BlendMode } from '../core/blend';

const IDLE_MS = 700;
let pending: { ids: string[]; mode: BlendMode } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Ids de la selección actual (vacío si no hay nada seleccionado). */
function selectionIds(): string[] {
  const s = useEditor.getState();
  return s.selectedIds.length ? s.selectedIds : s.selectedId ? [s.selectedId] : [];
}

/** Confirma lo pendiente (un paso de deshacer). Se llama solo tras una pausa, y antes de deshacer/rehacer. */
export function flushBlendKey() {
  clearTimeout(timer);
  if (!pending) return;
  const p = pending;
  pending = null;
  useEditor.getState().setBlendMode(p.mode, p.ids);
}

/** Aplica una tecla de fusión: un modo concreto, o el siguiente/anterior de la lista. Devuelve false si no hay selección. */
export function applyBlendKey(target: BlendMode | 'next' | 'prev'): boolean {
  const st = useEditor.getState();
  if (!pending) {
    const ids = selectionIds();
    if (!ids.length) return false;
    const mixed = commonBlend(st.doc.layers.filter((l) => ids.includes(l.id)).map((l) => l.blendMode));
    pending = { ids, mode: mixed === 'mixed' ? 'normal' : mixed };
  }
  pending.mode = target === 'next' ? nextBlend(pending.mode, 1) : target === 'prev' ? nextBlend(pending.mode, -1) : target;
  st.previewBlendMode(pending.mode, pending.ids);
  clearTimeout(timer);
  timer = setTimeout(flushBlendKey, IDLE_MS);
  return true;
}

/** Solo pruebas. */
export function _resetBlendKeys() {
  clearTimeout(timer);
  pending = null;
}
