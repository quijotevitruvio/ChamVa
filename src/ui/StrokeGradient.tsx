import { useEditor } from '../editor/state/store';
import type { ShapeLayer } from '../editor/core/types';
import { gradientFromColor, toHex6 } from '../editor/core/gradients';
import { GradientEditor } from './GradientEditor';
import './gradients2.css';

// «Degradado en el borde» de una forma: sustituye al color plano del borde en el
// lienzo, en PNG/JPG/WebP y en SVG. Se monta en la sección Borde de la forma.
export function StrokeGradient({ layer }: { layer: ShapeLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const on = !!layer.strokeGradient;
  return (
    <div className="sg">
      <label className="gx gx-check" title="El borde usa un degradado en vez de un color">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) =>
            updateLayer(layer.id, {
              strokeGradient: e.target.checked ? gradientFromColor(toHex6(layer.stroke)) : undefined,
            })
          }
        />
        <span>Degradado en el borde</span>
      </label>
      {on && layer.strokeGradient && (
        <>
          {layer.strokeWidth === 0 && <p className="rail-hint">Sube el grosor del borde para verlo.</p>}
          <GradientEditor value={layer.strokeGradient} onChange={(g) => updateLayer(layer.id, { strokeGradient: g })} />
        </>
      )}
    </div>
  );
}
