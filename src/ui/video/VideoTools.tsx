import { create } from 'zustand';
import { Icon, type IconName } from '../Icon';
import { VIDEO_TOOLS, type VideoTool } from '../../editor/state/toolLogic';
import { t } from '../../i18n';

// Herramienta activa de la línea de tiempo (solo interfaz, no se guarda).
export const useVideoTool = create<{ tool: VideoTool; setTool: (t: VideoTool) => void }>((set) => ({
  tool: 'select',
  setTool: (tool) => set({ tool }),
}));

// Barra mínima de la línea de tiempo: puntero (V), cuchilla (C), mano (H) y zoom (Z).
// No usa teclas del editor de video (S dividir, T subtítulos, L reproducir, F ajustar, I/O marcas, J/K).
export function VideoToolBar() {
  const tool = useVideoTool((s) => s.tool);
  const setTool = useVideoTool((s) => s.setTool);
  const hint: Record<VideoTool, string> = {
    select: 'Seleccionar y mover clips',
    razor: 'Cuchilla: clic en un clip para cortarlo en ese punto (se pega al cabezal)',
    hand: 'Mano: arrastra para desplazar la línea de tiempo',
    zoom: 'Zoom: clic acerca, Alt+clic aleja, arrastra un tramo para ampliarlo',
  };
  return (
    <div className="vx-tl-tools" role="toolbar" aria-label={t('Herramientas de la línea de tiempo')} data-testid="vx-tools">
      {VIDEO_TOOLS.map((d) => (
        <button
          key={d.id}
          type="button"
          aria-pressed={tool === d.id}
          aria-label={`${t(d.label)} (${d.key})`}
          title={`${t(d.label)} (${d.key}): ${t(hint[d.id])}`}
          data-vtool={d.id}
          onClick={() => setTool(d.id)}
        >
          <Icon name={d.icon as IconName} size={15} />
          <span className="vx-hide-sm">{t(d.label)}</span>
        </button>
      ))}
    </div>
  );
}
