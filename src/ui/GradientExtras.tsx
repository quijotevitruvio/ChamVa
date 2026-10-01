import type { Gradient } from '../editor/core/types';
import './gradients2.css';

// Extras del degradado: centro del cónico y «Suavizar (dither)» contra las bandas.
export function GradientExtras({ value, onChange }: { value: Gradient; onChange: (g: Gradient) => void }) {
  const conic = value.kind === 'conic';
  const pct = (n: number | undefined) => Math.round((n ?? 0.5) * 100);
  return (
    <div className="gx">
      {conic && (
        <>
          <label title="Posición horizontal del centro">
            <span>Centro X</span>
            <input type="range" min={0} max={100} value={pct(value.cx)} onChange={(e) => onChange({ ...value, cx: Number(e.target.value) / 100 })} />
            <span className="ge-val">{pct(value.cx)}%</span>
          </label>
          <label title="Posición vertical del centro">
            <span>Centro Y</span>
            <input type="range" min={0} max={100} value={pct(value.cy)} onChange={(e) => onChange({ ...value, cy: Number(e.target.value) / 100 })} />
            <span className="ge-val">{pct(value.cy)}%</span>
          </label>
        </>
      )}
      <label className="gx-check" title="Añade un ruido casi invisible para que los degradados largos no muestren escalones (lienzo e imagen exportada)">
        <input type="checkbox" checked={!!value.dither} onChange={(e) => onChange({ ...value, dither: e.target.checked || undefined })} />
        <span>Suavizar (dither)</span>
      </label>
    </div>
  );
}
