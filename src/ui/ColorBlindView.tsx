import { useColorBlind } from './colorBlindStore';
import { COLORBLIND_LABELS, COLORBLIND_MATRICES, type ColorBlindKind } from '../editor/core/colorTools';
import './colortools2.css';

const FILTER_ID = 'chamva-colorblind';

// Se monta UNA vez (App.tsx): define el filtro SVG feColorMatrix y lo aplica al lienzo
// (.konvajs-content) mientras haya un tipo activo. No toca el diseño ni la exportación.
export function ColorBlindView() {
  const kind = useColorBlind((s) => s.kind);
  if (!kind) return null;
  const m = COLORBLIND_MATRICES[kind];
  const values = `${m[0]} ${m[1]} ${m[2]} 0 0  ${m[3]} ${m[4]} ${m[5]} 0 0  ${m[6]} ${m[7]} ${m[8]} 0 0  0 0 0 1 0`;
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
        <filter id={FILTER_ID} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={values} />
        </filter>
      </svg>
      <style>{`.canvas-area .konvajs-content,.canvas-area .page-still{filter:url(#${FILTER_ID})}`}</style>
      <div className="cb-badge" role="status">
        Vista: {COLORBLIND_LABELS[kind]}
        <button type="button" onClick={() => useColorBlind.getState().setKind(null)}>
          Salir
        </button>
      </div>
    </>
  );
}

// Selector de tipo para el panel de color (u otro sitio).
export function ColorBlindPicker() {
  const kind = useColorBlind((s) => s.kind);
  const setKind = useColorBlind((s) => s.setKind);
  const kinds = Object.keys(COLORBLIND_LABELS) as ColorBlindKind[];
  return (
    <div className="cb-picker">
      <div className="seg" role="group" aria-label="Simular daltonismo">
        <button className={kind === null ? 'on' : ''} onClick={() => setKind(null)}>
          Normal
        </button>
        {kinds.map((k) => (
          <button
            key={k}
            className={kind === k ? 'on' : ''}
            onClick={() => setKind(kind === k ? null : k)}
            title={COLORBLIND_LABELS[k]}
          >
            {COLORBLIND_LABELS[k].split(' ')[0]}
          </button>
        ))}
      </div>
      <p className="cp-empty">Solo cambia lo que ves en pantalla; el diseño y la exportación no se alteran.</p>
    </div>
  );
}
