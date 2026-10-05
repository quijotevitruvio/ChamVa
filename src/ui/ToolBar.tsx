import { Icon, type IconName } from './Icon';
import { useTool } from '../editor/state/toolStore';
import { TOOL_DEFS, type ToolDef } from '../editor/state/toolLogic';
import { getShortcut, useShortcuts } from '../editor/core/shortcuts';
import { t } from '../i18n';
import './tools.css';

// Grupos con separador: selección/vista · crear · dibujo.
const GROUPS: ToolDef['id'][][] = [['select', 'hand', 'zoom'], ['text', 'shape'], ['brush', 'eraser']];

// Barra de herramientas flotante del lienzo (vertical a la izquierda; compacta y horizontal en móvil).
export function ToolBar() {
  const tool = useTool((s) => s.tool);
  const shape = useTool((s) => s.shape);
  const toggle = useTool((s) => s.toggle);
  useShortcuts(); // se repinta si el usuario cambia un atajo

  return (
    <div className="tool-bar" role="toolbar" aria-label={t('Herramientas del lienzo')} aria-orientation="vertical" data-testid="tool-bar">
      {GROUPS.map((ids, gi) => (
        <div key={gi} style={{ display: 'contents' }}>
          {gi > 0 && <span className="tool-sep" aria-hidden="true" />}
          {TOOL_DEFS.filter((d) => ids.includes(d.id)).map((d) => {
            const key = getShortcut(d.action) || d.key;
            const pressed = tool === d.id && (!d.shape || shape === d.shape);
            const label = t(d.label);
            return (
              <button
                key={d.action}
                type="button"
                aria-pressed={pressed}
                aria-label={`${label} (${key})`}
                title={`${label} (${key})`}
                data-tool={d.id}
                data-action={d.action}
                onClick={() => toggle(d.id, d.shape)}
              >
                <Icon name={d.icon as IconName} size={18} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
