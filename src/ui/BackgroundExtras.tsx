import { useState } from 'react';
import { useEditor } from '../editor/state/store';
import { DEFAULT_GRAIN, normalizeGrain } from '../editor/core/grain';
import { RecolorDialog } from './RecolorDialog';
import './gradients2.css';

// Extras del panel de fondo: grano (sobre color, degradado o patrón) y el botón
// «Recolorear diseño».
export function BackgroundExtras() {
  const bg = useEditor((s) => s.doc.background);
  const setBackground = useEditor((s) => s.setBackground);
  const beginBatch = useEditor((s) => s.beginBatch);
  const endBatch = useEditor((s) => s.endBatch);
  const [open, setOpen] = useState(false);
  const live = { onPointerDown: beginBatch, onPointerUp: endBatch, onBlur: endBatch };
  const grain = bg.type !== 'transparent' ? bg.grain : undefined;
  const setGrain = (g: { amount?: number; size?: number } | null) => {
    if (bg.type === 'transparent') return;
    const { grain: _old, ...rest } = bg;
    setBackground(g ? ({ ...rest, grain: normalizeGrain({ ...(grain ?? DEFAULT_GRAIN), ...g }) } as typeof bg) : (rest as typeof bg));
  };

  return (
    <section className="cp-sec">
      <h4>Grano y recolor</h4>
      <div className="bx">
        {bg.type === 'transparent' ? (
          <p className="rail-hint">Elige un color, degradado o patrón de fondo para añadirle grano.</p>
        ) : (
          <>
            <label className="gx-check" title="Textura de grano fina sobre el fondo, igual en el lienzo y al exportar">
              <input type="checkbox" checked={!!grain} onChange={(e) => setGrain(e.target.checked ? {} : null)} />
              <span>Grano en el fondo</span>
            </label>
            {grain && (
              <>
                <label>
                  <span>Cantidad</span>
                  <input type="range" min={1} max={100} value={grain.amount} onChange={(e) => setGrain({ amount: Number(e.target.value) })} {...live} />
                  <span className="ge-val">{grain.amount}</span>
                </label>
                <label>
                  <span>Tamaño</span>
                  <input type="range" min={1} max={6} step={0.5} value={grain.size} onChange={(e) => setGrain({ size: Number(e.target.value) })} {...live} />
                  <span className="ge-val">{grain.size}</span>
                </label>
              </>
            )}
          </>
        )}
        <button className="bx-btn" onClick={() => setOpen(true)} title="Cambia un color en todo el diseño, invierte claro/oscuro o usa tus colores de marca">
          Recolorear diseño…
        </button>
      </div>
      {open && <RecolorDialog onClose={() => setOpen(false)} />}
    </section>
  );
}
