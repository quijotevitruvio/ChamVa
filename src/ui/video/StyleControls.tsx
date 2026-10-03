import { useId } from 'react';
import { FONT_FAMILIES } from '../../editor/core/types';
import type { TitleStyle } from '../../video/model';
import { parseColor, withAlpha } from '../../video/title/style';
import { Field } from './Field';

interface Props {
  style: TitleStyle;
  /** cambio parcial; `group` agrupa los pasos de deshacer de un mismo deslizador */
  onChange: (patch: Partial<TitleStyle>, group: string) => void;
  disabled?: boolean;
}

function ColorRow({ label, value, onChange, disabled, alpha }: { label: string; value: string; onChange: (css: string) => void; disabled?: boolean; alpha?: boolean }) {
  const id = useId();
  const p = parseColor(value) ?? { hex: '#000000', a: 1 };
  return (
    <div className="vx-field wide">
      <label htmlFor={id}>{label}</label>
      {alpha ? (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={p.a}
          disabled={disabled}
          aria-label={`${label}: opacidad`}
          onChange={(e) => onChange(withAlpha(p.hex, Number(e.target.value)))}
        />
      ) : (
        <span />
      )}
      <input id={id} type="color" aria-label={label} value={p.hex} disabled={disabled} onChange={(e) => onChange(withAlpha(e.target.value, alpha ? p.a : 1))} />
    </div>
  );
}

/** Controles de estilo de un título o de los subtítulos: fuente, tamaño, color, contorno, sombra, caja, alineación… */
export function StyleControls({ style: s, onChange, disabled }: Props) {
  const fontId = useId();
  const alignId = useId();
  const families = FONT_FAMILIES.includes(s.fontFamily) ? [...FONT_FAMILIES] : [s.fontFamily, ...FONT_FAMILIES];
  const up = (patch: Partial<TitleStyle>, g: string) => onChange(patch, g);
  const box = s.textEffect === 'background';
  return (
    <>
      <div className="vx-field wide">
        <label htmlFor={fontId}>Fuente</label>
        <select id={fontId} value={s.fontFamily} disabled={disabled} onChange={(e) => up({ fontFamily: e.target.value }, 'font')} style={{ fontFamily: `"${s.fontFamily}"` }}>
          {families.map((f) => (
            <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
              {f}
            </option>
          ))}
        </select>
        <span className="vx-togs">
          <button type="button" className={s.bold ? 'on' : ''} aria-pressed={s.bold} aria-label="Negrita" title="Negrita" disabled={disabled} onClick={() => up({ bold: !s.bold }, 'bold')}><b>N</b></button>
          <button type="button" className={s.italic ? 'on' : ''} aria-pressed={s.italic} aria-label="Cursiva" title="Cursiva" disabled={disabled} onClick={() => up({ italic: !s.italic }, 'italic')}><i>K</i></button>
        </span>
      </div>
      <Field label="Tamaño" value={s.fontSize} min={16} max={300} step={1} unit=" px" disabled={disabled} onChange={(v) => up({ fontSize: v }, 'fs')} />
      <ColorRow label="Color" value={s.fill} disabled={disabled} onChange={(c) => up({ fill: c }, 'fill')} />
      <div className="vx-field wide">
        <label htmlFor={alignId}>Alineación</label>
        <select id={alignId} value={s.align} disabled={disabled} onChange={(e) => up({ align: e.target.value as TitleStyle['align'] }, 'align')}>
          <option value="left">Izquierda</option>
          <option value="center">Centro</option>
          <option value="right">Derecha</option>
        </select>
        <span className="vx-togs">
          <button type="button" className={s.textTransform === 'upper' ? 'on' : ''} aria-pressed={s.textTransform === 'upper'} aria-label="Todo en mayúsculas" title="MAYÚSCULAS" disabled={disabled} onClick={() => up({ textTransform: s.textTransform === 'upper' ? 'none' : 'upper' }, 'tt')}>Aa</button>
        </span>
      </div>
      <Field label="Espaciado" value={s.letterSpacing} min={-5} max={40} step={0.5} unit=" px" digits={1} disabled={disabled} onChange={(v) => up({ letterSpacing: v }, 'ls')} />
      <Field label="Interlineado" value={s.lineHeight} min={0.8} max={2} step={0.05} scale={100} unit=" %" disabled={disabled} onChange={(v) => up({ lineHeight: v }, 'lh')} />
      <Field label="Ancho máx." value={s.maxWidth ?? 0.9} min={0.3} max={1} step={0.02} scale={100} unit=" %" disabled={disabled} onChange={(v) => up({ maxWidth: v }, 'mw')} />
      <h4>Contorno, sombra y caja</h4>
      <Field label="Contorno" value={s.strokeWidth} min={0} max={30} step={1} unit=" px" disabled={disabled} onChange={(v) => up({ strokeWidth: v }, 'sw')} />
      {s.strokeWidth > 0 && <ColorRow label="Color del contorno" value={s.strokeColor} disabled={disabled} onChange={(c) => up({ strokeColor: c }, 'sc')} />}
      <label className="vx-check">
        <input type="checkbox" checked={s.shadow} disabled={disabled} onChange={(e) => up({ shadow: e.target.checked, ...(e.target.checked && s.shadowBlur === 0 && s.shadowY === 0 ? { shadowBlur: 10, shadowY: 4 } : {}) }, 'sh')} /> Sombra
      </label>
      {s.shadow && (
        <>
          <ColorRow label="Color de la sombra" value={s.shadowColor} alpha disabled={disabled} onChange={(c) => up({ shadowColor: c }, 'shc')} />
          <Field label="Desenfoque" value={s.shadowBlur} min={0} max={60} step={1} unit=" px" disabled={disabled} onChange={(v) => up({ shadowBlur: v }, 'shb')} />
        </>
      )}
      <label className="vx-check">
        <input type="checkbox" checked={box} disabled={disabled} onChange={(e) => up(e.target.checked ? { textEffect: 'background', effectColor: s.effectColor ?? 'rgba(0,0,0,0.65)' } : { textEffect: 'none' }, 'box')} /> Caja detrás del texto
      </label>
      {box && <ColorRow label="Color de la caja" value={s.effectColor ?? 'rgba(0,0,0,0.65)'} alpha disabled={disabled} onChange={(c) => up({ effectColor: c }, 'boxc')} />}
    </>
  );
}
