import { useMemo } from 'react';
import { useEditor } from '../editor/state/store';
import { toHex6 } from '../editor/core/gradients';
import { DEFAULT_PATTERN, PATTERN_KINDS, normalizePattern, svgPatternDef } from '../editor/core/patterns';
import type { PatternSpec } from '../editor/core/types';
import './layoutaids.css';

// Miniatura de un patrón como imagen de fondo CSS (mismo SVG que la exportación).
function previewUrl(spec: PatternSpec): string {
  const s = Math.max(6, Math.min(spec.size, 18));
  // Escala la baldosa a ~18 px para que se vea el motivo entero en la miniatura.
  const f = s / spec.size;
  const sp = { ...spec, size: s, thickness: Math.max(0.6, spec.thickness * f) };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><defs>${svgPatternDef('p', sp)}</defs><rect width="${s}" height="${s}" fill="url(#p)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Selector de patrón de fondo (puntos, líneas, cuadrícula, diagonales, zigzag,
// cuadros, olas) con dos colores, tamaño y grosor. Se monta en el panel de colores.
export function PatternPicker() {
  const bg = useEditor((s) => s.doc.background);
  const setBackground = useEditor((s) => s.setBackground);
  const beginBatch = useEditor((s) => s.beginBatch);
  const endBatch = useEditor((s) => s.endBatch);
  const current = bg.type === 'pattern' ? bg.pattern : null;
  const spec = current ?? DEFAULT_PATTERN;
  const apply = (patch: Partial<PatternSpec>) => setBackground({ type: 'pattern', pattern: normalizePattern({ ...spec, ...patch }) });
  const thumbs = useMemo(
    () => PATTERN_KINDS.map((k) => previewUrl({ ...spec, kind: k.kind, size: 16, thickness: Math.min(spec.thickness, 3) })),
    [spec.color1, spec.color2, spec.thickness], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Las ediciones continuas (deslizador / selector de color) cuentan como un solo paso de deshacer.
  const live = { onPointerDown: beginBatch, onPointerUp: endBatch, onBlur: endBatch };

  return (
    <section className="cp-sec">
      <h4>Patrones de fondo</h4>
      <div className="pp-grid">
        {PATTERN_KINDS.map((k, i) => (
          <button
            key={k.kind}
            className={`pp-kind${current?.kind === k.kind ? ' sel' : ''}`}
            style={{ backgroundImage: thumbs[i] }}
            title={k.label}
            aria-label={k.label}
            onClick={() => apply({ kind: k.kind })}
          />
        ))}
      </div>
      {current && (
        <>
          <label className="pp-ctl">
            <span>Color 1</span>
            <input type="color" value={toHex6(current.color1)} onChange={(e) => apply({ color1: e.target.value })} {...live} />
            <span>Color 2</span>
            <input type="color" value={toHex6(current.color2)} onChange={(e) => apply({ color2: e.target.value })} {...live} />
          </label>
          <label className="pp-ctl">
            <span>Tamaño</span>
            <input type="range" min={6} max={160} step={1} value={current.size} onChange={(e) => apply({ size: Number(e.target.value) })} {...live} />
            <b>{Math.round(current.size)}</b>
          </label>
          <label className="pp-ctl">
            <span>Grosor</span>
            <input
              type="range"
              min={0.5}
              max={Math.max(1, Math.min(40, current.size / 2))}
              step={0.5}
              value={current.thickness}
              onChange={(e) => apply({ thickness: Number(e.target.value) })}
              {...live}
            />
            <b>{current.thickness}</b>
          </label>
        </>
      )}
    </section>
  );
}
