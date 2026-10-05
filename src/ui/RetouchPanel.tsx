import { useEditor } from '../editor/state/store';
import { useTool } from '../editor/state/toolStore';
import { isRetouchTool, hasRetouch } from '../editor/core/retouch';
import { clearRetouch, useRetouchOpts } from '../editor/state/retouchSession';
import { setShowBefore } from '../editor/core/retouchLive';
import { currentSel } from '../editor/state/pixelOps';
import { t } from '../i18n';
import './maskpanel.css';

function Slider({ label, min, max, step = 1, value, onChange }: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="mp-slider">
      <span>{t(label)}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={t(label)} />
      <span className="mp-val">{Math.round(value * 100) / 100}</span>
    </label>
  );
}

const TITLES: Record<string, string> = {
  clone: 'Clonar',
  heal: 'Curar',
  spot: 'Eliminar mancha',
  dodge: 'Esquivar (aclarar)',
  burn: 'Quemar (oscurecer)',
  blur: 'Desenfocar',
  sharpen: 'Enfocar',
  smudge: 'Dedo',
};

/** Opciones de las herramientas de retoque de píxeles (clonar, curar, mancha, esquivar/quemar, desenfocar…). */
export function RetouchPanel() {
  const tool = useTool((s) => s.tool);
  const { o, set } = useRetouchOpts();
  const layer = useEditor((s) => {
    const l = s.doc.layers.find((x) => x.id === s.selectedId);
    return l && l.type === 'image' ? l : null;
  });
  const hasSel = useEditor((s) => !!s.pixelSel);
  if (!isRetouchTool(tool)) return null;
  const retouched = !!layer && hasRetouch(layer);
  const brushy = tool !== 'spot';
  return (
    <div className="sel-panel" data-testid="retouch-panel">
      <h4>{t(TITLES[tool])}</h4>
      {!layer && <p className="rail-sub">{t('Haz clic sobre una foto del diseño: el retoque se guarda en esa capa sin tocar el original.')}</p>}
      <Slider label="Tamaño" min={1} max={600} value={o.size} onChange={(v) => set({ size: v })} />
      {tool !== 'spot' && <Slider label="Dureza" min={0} max={1} step={0.01} value={o.hardness} onChange={(v) => set({ hardness: v })} />}
      {brushy && <Slider label={tool === 'clone' || tool === 'heal' ? 'Opacidad' : 'Fuerza'} min={0.05} max={1} step={0.01} value={o.opacity} onChange={(v) => set({ opacity: v })} />}
      {(tool === 'clone' || tool === 'heal') && (
        <>
          {tool === 'heal' && (
            <div className="mp-grid" role="group" aria-label={t('Modo de curar')}>
              <button aria-pressed={o.healMode === 'brush'} onClick={() => set({ healMode: 'brush' })}>
                {t('Pincel')}
              </button>
              <button aria-pressed={o.healMode === 'patch'} onClick={() => set({ healMode: 'patch' })} title={t('Selecciona con el lazo o la varita y arrastra la selección sobre una zona limpia')}>
                {t('Parche')}
              </button>
            </div>
          )}
          {!(tool === 'heal' && o.healMode === 'patch') && (
            <>
              <label className="mp-check">
                <input type="checkbox" checked={o.aligned} onChange={(e) => set({ aligned: e.target.checked })} /> {t('Origen alineado')}
              </label>
              <p className="rail-sub">{t('Alt+clic fija el origen. Con «alineado» el origen sigue al pincel; si no, cada trazo vuelve a empezar de él.')}</p>
            </>
          )}
          <label className="mp-check">
            <input type="checkbox" checked={o.sampleAll} onChange={(e) => set({ sampleAll: e.target.checked })} /> {t('Muestrear todas las capas (no solo la actual)')}
          </label>
          {tool === 'heal' && o.healMode === 'patch' && !hasSel && <p className="rail-sub">{t('Primero selecciona la zona a corregir (lazo o varita).')}</p>}
        </>
      )}
      {tool === 'spot' && <p className="rail-sub">{t('Haz clic sobre la mota o el grano; el tamaño debe cubrirlo un poco.')}</p>}
      {(tool === 'dodge' || tool === 'burn') && (
        <>
          <div className="mp-grid" role="group" aria-label={t('Rango')}>
            {(['shadows', 'midtones', 'highlights'] as const).map((r) => (
              <button key={r} aria-pressed={o.range === r} onClick={() => set({ range: r })}>
                {t(r === 'shadows' ? 'Sombras' : r === 'midtones' ? 'Medios' : 'Luces')}
              </button>
            ))}
          </div>
          <Slider label="Exposición" min={0.05} max={1} step={0.01} value={o.exposure} onChange={(v) => set({ exposure: v })} />
          <p className="rail-sub">{t('Alt alterna entre esquivar y quemar.')}</p>
        </>
      )}
      {hasSel && currentSel() && <p className="rail-sub">{t('Hay una selección de píxeles: el efecto se limita a ella.')}</p>}
      <div className="mp-grid">
        <button
          onPointerDown={() => setShowBefore(true)}
          onPointerUp={() => setShowBefore(false)}
          onPointerLeave={() => setShowBefore(false)}
          disabled={!retouched}
          title={t('Mantén pulsado para ver la imagen sin retoque (o la tecla \)')}
          data-testid="retouch-before"
        >
          {t('Antes / después')}
        </button>
        <button onClick={() => layer && void clearRetouch(layer.id)} disabled={!retouched} data-testid="retouch-clear">
          {t('Quitar retoque')}
        </button>
      </div>
      <p className="rail-sub">{t('Ctrl+Z deshace un trazo. [ y ] cambian el tamaño.')}</p>
    </div>
  );
}
