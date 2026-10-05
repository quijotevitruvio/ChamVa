import { useTool } from '../editor/state/toolStore';
import { useEditor } from '../editor/state/store';
import { getShortcut, useShortcuts } from '../editor/core/shortcuts';
import { t } from '../i18n';
import { statusHints, toolStatus, zoomPercent } from './statusLogic';
import './statusbar.css';

// Barra de estado inferior, discreta: herramienta activa y su tecla · zoom · pistas cortas.
export function StatusBar() {
  const tool = useTool((s) => s.tool);
  const shape = useTool((s) => s.shape);
  const spaceHeld = useTool((s) => s.spaceHeld);
  const viewScale = useEditor((s) => s.viewScale);
  const selectionCount = useEditor((s) => s.selectedIds.length || (s.selectedId ? 1 : 0));
  useShortcuts();
  const ctx = { tool, shape, spaceHeld, selectionCount, key: getShortcut };
  const ts = toolStatus(ctx);
  const hints = statusHints(ctx);
  return (
    <div className="status-bar" role="status" aria-live="off" data-testid="status-bar">
      <span className="sb-tool" data-testid="sb-tool">
        {t('Herramienta')}: <strong>{t(ts.label)}</strong> <kbd>{ts.key}</kbd>
      </span>
      <span className="sb-zoom" data-testid="sb-zoom">
        {t('Zoom')} {zoomPercent(viewScale)}%
      </span>
      <span className="sb-hints" data-testid="sb-hints">
        {hints.map((h) => t(h)).join(' · ')}
      </span>
    </div>
  );
}
