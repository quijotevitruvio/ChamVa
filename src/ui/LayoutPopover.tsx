import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import './layoutaids.css';

// Campo numérico que confirma al salir del campo o con Enter (un solo paso de deshacer).
function NumField({
  label,
  value,
  min = 0,
  max = 99999,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (!isFinite(n) || draft.trim() === '') return setDraft(String(value));
    const v = Math.max(min, Math.min(max, Math.round(n * 10) / 10));
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <label className="lp-field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
    </label>
  );
}

// Popover «Maquetación»: márgenes, sangrado y columnas (solo editor, no se exportan).
export function LayoutPopover({ onClose, anchor }: { onClose: () => void; anchor: DOMRect | null }) {
  const doc = useEditor((s) => s.doc);
  const set = useEditor((s) => s.setLayoutAids);
  const showLayout = useEditor((s) => s.showLayout);
  const toggleLayout = useEditor((s) => s.toggleLayout);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-lp-btn]'))
        onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const m = doc.margins ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const setMargin = (k: keyof typeof m, v: number) => set({ margins: { ...m, [k]: v } });
  const cols = doc.columns;
  const style: React.CSSProperties = anchor
    ? { right: Math.max(8, window.innerWidth - anchor.right), bottom: window.innerHeight - anchor.top + 6 }
    : { right: 8, bottom: 56 };

  return (
    <div className="lp-pop" ref={ref} style={style} role="dialog" aria-label="Maquetación">
      <div className="lp-head">
        <h4>Maquetación</h4>
        <label className="lp-check">
          <input type="checkbox" checked={showLayout} onChange={toggleLayout} /> Mostrar
        </label>
      </div>
      <p className="lp-hint">
        Solo se ven en el editor; no salen en las exportaciones. Con el imán, las capas se pegan a estas líneas.
      </p>

      <h5>Márgenes (px)</h5>
      <div className="lp-grid">
        <NumField label="Arriba" value={m.top} onCommit={(v) => setMargin('top', v)} />
        <NumField label="Derecha" value={m.right} onCommit={(v) => setMargin('right', v)} />
        <NumField label="Abajo" value={m.bottom} onCommit={(v) => setMargin('bottom', v)} />
        <NumField label="Izquierda" value={m.left} onCommit={(v) => setMargin('left', v)} />
      </div>

      <h5>Sangrado (px)</h5>
      <div className="lp-grid">
        <NumField label="Fuera del lienzo" value={doc.bleed ?? 0} max={500} onCommit={(v) => set({ bleed: v || undefined })} />
      </div>

      <h5>Columnas</h5>
      <div className="lp-grid">
        <NumField
          label="Número (0 = sin)"
          value={cols?.count ?? 0}
          max={24}
          onCommit={(v) =>
            set({ columns: v >= 1 ? { count: Math.round(v), gutter: cols?.gutter ?? 20, margin: cols?.margin ?? m.left } : undefined })
          }
        />
        <NumField label="Medianil" value={cols?.gutter ?? 20} onCommit={(v) => cols && set({ columns: { ...cols, gutter: v } })} />
        <NumField label="Margen exterior" value={cols?.margin ?? 0} onCommit={(v) => cols && set({ columns: { ...cols, margin: v } })} />
      </div>

      <div className="lp-foot">
        <button
          className="lp-reset"
          onClick={() => set({ margins: undefined, bleed: undefined, columns: undefined })}
          disabled={!doc.margins && !doc.bleed && !doc.columns}
        >
          Quitar todo
        </button>
        <button className="lp-reset" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
