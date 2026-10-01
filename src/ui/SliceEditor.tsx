import { useRef } from 'react';
import { t } from '../i18n';
import { sliceRects } from '../io/exportPackages';
import './exportmore.css';

interface Props {
  src: string; // vista previa (data URL)
  width: number; // tamaño real del diseño en px
  height: number;
  xs: number[]; // líneas verticales (px del diseño)
  ys: number[]; // líneas horizontales (px del diseño)
  onChange: (xs: number[], ys: number[]) => void;
}

// Vista previa con una rejilla editable: las líneas se arrastran, doble clic
// borra una línea y un clic en el hueco de la regla (arriba/izquierda) añade otra.
export function SliceEditor({ src, width, height, xs, ys, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);

  const startDrag = (axis: 'x' | 'y', index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const v =
        axis === 'x'
          ? ((ev.clientX - r.left) / r.width) * width
          : ((ev.clientY - r.top) / r.height) * height;
      const max = axis === 'x' ? width : height;
      const val = Math.round(Math.min(max - 1, Math.max(1, v)));
      if (axis === 'x') onChange(xs.map((n, i) => (i === index ? val : n)), ys);
      else onChange(xs, ys.map((n, i) => (i === index ? val : n)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const remove = (axis: 'x' | 'y', index: number) => () => {
    if (axis === 'x') onChange(xs.filter((_, i) => i !== index), ys);
    else onChange(xs, ys.filter((_, i) => i !== index));
  };

  const addAt = (axis: 'x' | 'y') => (e: React.MouseEvent) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (axis === 'x') {
      const v = Math.round(((e.clientX - r.left) / r.width) * width);
      if (v > 0 && v < width) onChange([...xs, v], ys);
    } else {
      const v = Math.round(((e.clientY - r.top) / r.height) * height);
      if (v > 0 && v < height) onChange(xs, [...ys, v]);
    }
  };

  const count = sliceRects(width, height, xs, ys).length;

  return (
    <div className="sl-wrap">
      <div className="sl-stage">
        <div className="sl-ruler-x" onClick={addAt('x')} title={t('Clic para añadir una línea vertical')} />
        <div className="sl-ruler-y" onClick={addAt('y')} title={t('Clic para añadir una línea horizontal')} />
        <div className="sl-box" ref={box}>
          <img src={src} alt="" draggable={false} />
          {xs.map((x, i) => (
            <div
              key={`x${i}`}
              className="sl-line sl-v"
              style={{ left: `${(x / width) * 100}%` }}
              onPointerDown={startDrag('x', i)}
              onDoubleClick={remove('x', i)}
              title={`${Math.round(x)} px · ${t('doble clic para borrar')}`}
            />
          ))}
          {ys.map((y, i) => (
            <div
              key={`y${i}`}
              className="sl-line sl-h"
              style={{ top: `${(y / height) * 100}%` }}
              onPointerDown={startDrag('y', i)}
              onDoubleClick={remove('y', i)}
              title={`${Math.round(y)} px · ${t('doble clic para borrar')}`}
            />
          ))}
        </div>
      </div>
      <p className="dl-hint">
        {count} {count === 1 ? t('rebanada') : t('rebanadas')} · {t('Arrastra las líneas; doble clic las borra.')}
      </p>
    </div>
  );
}
