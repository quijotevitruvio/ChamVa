import { useState } from 'react';
import { useEditor } from '../editor/state/store';
import { adjustForContrast, contrastLevels } from '../editor/core/colorTools';
import { toHex6 } from '../editor/core/gradients';
import './colortools2.css';

// Color de fondo de la página como #rrggbb (degradado → primera parada; transparente → blanco).
export function usePageBgHex(): string {
  const bg = useEditor((s) => s.doc.background);
  if (bg.type === 'solid') return toHex6(bg.color);
  if (bg.type === 'gradient') return toHex6(bg.gradient.stops[0]?.color ?? '#ffffff');
  return '#ffffff';
}

// Color del texto de la capa seleccionada (o null si no hay texto seleccionado).
export function useSelectedTextHex(): string | null {
  return useEditor((s) => {
    const l = s.doc.layers.find((x) => x.id === s.selectedId);
    return l && l.type === 'text' ? toHex6(l.fill) : null;
  });
}

// Insignia reutilizable: ratio y aprobado/suspenso AA. `bg` por defecto = fondo de la página.
// Pensada para colocarla junto al color del texto en las propiedades.
export function ContrastBadge({ fg, bg, large }: { fg: string; bg?: string; large?: boolean }) {
  const pageBg = usePageBgHex();
  const b = bg ?? pageBg;
  const lv = contrastLevels(toHex6(fg), toHex6(b));
  const ok = large ? lv.aaLarge : lv.aaNormal;
  return (
    <span
      className={`cc-badge ${ok ? '' : 'bad'}`}
      title={`Contraste ${lv.ratio.toFixed(2)}:1 — ${ok ? 'cumple' : 'no cumple'} WCAG AA para texto ${large ? 'grande' : 'normal'}`}
    >
      {lv.ratio.toFixed(1)}:1 {ok ? 'AA' : 'bajo'}
    </span>
  );
}

// Comprobador completo del panel de color: dos colores, ratio, AA/AAA y ajuste automático.
export function ContrastChecker({ onApplyBg }: { onApplyBg?: (hex: string) => void }) {
  const pageBg = usePageBgHex();
  const textColor = useSelectedTextHex();
  // null = usar el valor por defecto (texto de la capa / fondo de la página).
  const [fgOver, setFgOver] = useState<string | null>(null);
  const [bgOver, setBgOver] = useState<string | null>(null);
  const [target, setTarget] = useState<4.5 | 7 | 3>(4.5);
  const setFill = useEditor((s) => s.updateLayer);
  const selectedId = useEditor((s) => s.selectedId);

  const fg = fgOver ?? textColor ?? '#000000';
  const bg = bgOver ?? pageBg;
  const lv = contrastLevels(fg, bg);
  const fixed = lv.ratio >= target ? null : adjustForContrast(fg, bg, target);

  const yes = (v: boolean) => <span className={v ? 'ok' : 'no'}>{v ? 'Cumple' : 'No'}</span>;

  return (
    <div className="cc">
      <div className="cc-pair">
        <label>
          Texto
          <input type="color" value={fg} onChange={(e) => setFgOver(e.target.value)} />
        </label>
        <label>
          Fondo
          <input type="color" value={bg} onChange={(e) => setBgOver(e.target.value)} />
        </label>
        {(fgOver || bgOver) && (
          <button
            className="cp-mini"
            type="button"
            onClick={() => {
              setFgOver(null);
              setBgOver(null);
            }}
          >
            Restablecer
          </button>
        )}
      </div>
      {!fgOver && !textColor && <p className="cp-empty">Selecciona un texto para usar su color, o elige uno arriba.</p>}
      <div className="cc-sample" style={{ background: bg, color: fg }}>
        <span className="cc-ratio">{lv.ratio.toFixed(2)}:1</span>
        Texto de ejemplo
      </div>
      <div className="cc-grid">
        <span />
        <span>Normal</span>
        <span>Grande</span>
        <span>AA</span>
        {yes(lv.aaNormal)}
        {yes(lv.aaLarge)}
        <span>AAA</span>
        {yes(lv.aaaNormal)}
        {yes(lv.aaaLarge)}
      </div>
      <div className="cc-fix">
        <span>Objetivo</span>
        <div className="seg" role="group" aria-label="Nivel objetivo">
          <button className={target === 3 ? 'on' : ''} onClick={() => setTarget(3)} title="AA texto grande">
            3
          </button>
          <button className={target === 4.5 ? 'on' : ''} onClick={() => setTarget(4.5)} title="AA normal / AAA grande">
            4.5
          </button>
          <button className={target === 7 ? 'on' : ''} onClick={() => setTarget(7)} title="AAA normal">
            7
          </button>
        </div>
        {fixed ? (
          <>
            <span className="cp-swatch" style={{ background: fixed }} title={fixed} />
            <button
              className="cp-mini"
              type="button"
              onClick={() => setFgOver(fixed)}
              title="Probar el color de texto ajustado"
            >
              Ajustar texto
            </button>
            {textColor && selectedId && fgOver === fixed && (
              <button
                className="cp-mini"
                type="button"
                onClick={() => setFill(selectedId, { fill: fixed } as never)}
                title="Aplicar este color al texto seleccionado"
              >
                Aplicar al texto
              </button>
            )}
            {onApplyBg && (
              <button
                className="cp-mini"
                type="button"
                onClick={() => onApplyBg(adjustForContrast(bg, fg, target))}
                title="En vez del texto, ajustar el fondo"
              >
                Ajustar fondo
              </button>
            )}
          </>
        ) : (
          <span className="cp-empty">Ya cumple.</span>
        )}
      </div>
    </div>
  );
}
