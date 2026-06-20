import { useEffect, useRef, useState } from 'react';
import type { ImageLayer } from '../editor/core/types';
import {
  FILTER_CATEGORIES,
  applyOverlayDuotone,
  cssFor,
  type FilterDef,
} from '../editor/core/filters';
import { useEditor } from '../editor/state/store';

const THUMB = 88;

function Thumb({
  base,
  def,
  selected,
  onClick,
}: {
  base: HTMLImageElement | null;
  def: FilterDef;
  selected: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!base) return;
    const c = ref.current!;
    c.width = THUMB;
    c.height = THUMB;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, THUMB, THUMB);
    // "cover": recortar centrado para llenar el cuadro.
    const s = Math.max(THUMB / base.naturalWidth, THUMB / base.naturalHeight);
    const dw = base.naturalWidth * s;
    const dh = base.naturalHeight * s;
    ctx.filter = cssFor(def);
    ctx.drawImage(base, (THUMB - dw) / 2, (THUMB - dh) / 2, dw, dh);
    ctx.filter = 'none';
    applyOverlayDuotone(ctx, THUMB, THUMB, def);
  }, [base, def]);

  return (
    <button
      className={`fp-thumb ${selected ? 'sel' : ''}`}
      onClick={onClick}
      title={def.label}
    >
      <canvas ref={ref} width={THUMB} height={THUMB} />
      <span>{def.label}</span>
    </button>
  );
}

export function FiltersPanel({
  layer,
  onClose,
}: {
  layer: ImageLayer;
  onClose: () => void;
}) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const [base, setBase] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setBase(img);
    img.src = layer.src;
  }, [layer.src]);

  return (
    <div className="filters-panel">
      <div className="cp-head">
        <h3>Filtros</h3>
        <button className="cp-x" onClick={onClose}>
          ✕
        </button>
      </div>

      {FILTER_CATEGORIES.map((cat) => (
        <section className="fp-sec" key={cat.name}>
          <h4>{cat.name}</h4>
          <div className="fp-grid">
            {cat.filters.map((def) => (
              <Thumb
                key={def.id}
                base={base}
                def={def}
                selected={(layer.filter || 'none') === def.id}
                onClick={() => updateLayer(layer.id, { filter: def.id })}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
