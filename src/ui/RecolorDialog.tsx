import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import type { Doc } from '../editor/core/types';
import { applyColorMap, collectColors, invertDoc, mapByLuminosity } from '../editor/core/recolor';
import './gradients2.css';

// «Recolorear diseño»: lista los colores distintos del diseño y deja cambiar
// cada uno (vista previa en vivo en el lienzo). También invierte claro↔oscuro y
// reasigna los colores a tu kit de marca por luminosidad. Aceptar = un solo
// paso de deshacer; Cancelar deja el diseño como estaba.

type Stage = 'none' | 'invert' | 'brand';

export function RecolorDialog({ onClose }: { onClose: () => void }) {
  const original = useRef<Doc>(useEditor.getState().doc).current;
  const brandColors = useEditor((s) => s.brandColors);
  const recolorDoc = useEditor((s) => s.recolorDoc);
  const recolorOtherPages = useEditor((s) => s.recolorOtherPages);
  const pageCount = useEditor((s) => s.pages.length);
  const [stage, setStage] = useState<Stage>('none');
  const [map, setMap] = useState<Record<string, string>>({});
  const [allPages, setAllPages] = useState(false);
  const accepted = useRef(false);

  // Operación global previa a los cambios color por color (sirve también para otras páginas).
  const stageFn = useMemo(
    () =>
      (d: Doc): Doc =>
        stage === 'invert'
          ? invertDoc(d)
          : stage === 'brand'
            ? applyColorMap(d, mapByLuminosity(collectColors(d).map((c) => c.color), brandColors))
            : d,
    [stage, brandColors],
  );
  const staged = useMemo(() => stageFn(original), [stageFn, original]);
  const colors = useMemo(() => collectColors(staged), [staged]);
  const preview = useMemo(() => applyColorMap(staged, map), [staged, map]);

  // Vista previa en vivo (sin historial) y restauración si se cancela.
  useEffect(() => {
    recolorDoc(preview, true);
  }, [preview, recolorDoc]);
  useEffect(
    () => () => {
      if (!accepted.current) recolorDoc(original, true);
    },
    [original, recolorDoc],
  );

  const changed = preview !== original && JSON.stringify(preview) !== JSON.stringify(original);
  const choose = (s: Stage) => {
    setStage(s);
    setMap({});
  };
  const accept = () => {
    accepted.current = true;
    recolorDoc(original, true); // el historial guarda el diseño original…
    recolorDoc(preview); // …y este es el único paso de deshacer
    if (allPages && pageCount > 1) recolorOtherPages((d) => applyColorMap(stageFn(d), map));
    onClose();
  };

  return (
    <div className="rc-overlay" onClick={onClose}>
      <div className="rc-card" role="dialog" aria-label="Recolorear diseño" onClick={(e) => e.stopPropagation()}>
        <h3>Recolorear diseño</h3>
        <p>
          Estos son los colores del diseño (fondo, formas, textos, degradados y sombras). Cambia uno y se sustituye en
          todas partes a la vez. Las fotos no se tocan.
        </p>

        <div className="rc-actions">
          <button className={'bx-btn' + (stage === 'invert' ? ' on' : '')} onClick={() => choose(stage === 'invert' ? 'none' : 'invert')} title="Fondos claros pasan a oscuros y al revés, conservando los tonos">
            {stage === 'invert' ? '✓ ' : ''}Invertir tema (claro↔oscuro)
          </button>
          <button
            className={'bx-btn' + (stage === 'brand' ? ' on' : '')}
            disabled={brandColors.length === 0}
            onClick={() => choose(stage === 'brand' ? 'none' : 'brand')}
            title={brandColors.length ? 'Reparte tus colores de marca según la luminosidad de cada color' : 'Añade colores a tu kit de marca primero'}
          >
            {stage === 'brand' ? '✓ ' : ''}Usar mis colores de marca
          </button>
          <button className="bx-btn" disabled={!Object.keys(map).length && stage === 'none'} onClick={() => choose('none')}>
            Restablecer
          </button>
        </div>

        <div className="rc-list">
          {colors.length === 0 && <p>Este diseño no tiene colores editables.</p>}
          {colors.map((c) => {
            const to = map[c.color] ?? c.color;
            return (
              <div className="rc-row" key={c.color}>
                <span className="rc-from" style={{ background: c.color }} title={c.color} />
                <span className="rc-arrow">→</span>
                <input
                  type="color"
                  value={to}
                  onChange={(e) => setMap((m) => ({ ...m, [c.color]: e.target.value }))}
                  aria-label={`Sustituir ${c.color}`}
                />
                <span className="rc-hex">
                  {c.color.toUpperCase()}
                  {to !== c.color ? ` → ${to.toUpperCase()}` : ''} · {c.count} {c.count === 1 ? 'uso' : 'usos'}
                </span>
              </div>
            );
          })}
        </div>

        {pageCount > 1 && (
          <label className="rc-row" title="Las demás páginas se recolorean igual; en ellas no se puede deshacer con Ctrl+Z">
            <input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} />
            <span>Aplicar también a las otras {pageCount - 1} páginas (no se deshace en ellas)</span>
          </label>
        )}

        <div className="rc-footer">
          <button className="bx-btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="bx-btn primary" disabled={!changed} onClick={accept}>
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
