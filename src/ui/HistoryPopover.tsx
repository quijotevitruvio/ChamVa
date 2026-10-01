import { useEffect, useMemo, useRef } from 'react';
import { useEditor } from '../editor/state/store';
import { buildHistory } from '../editor/state/historyLogic';
import './overlays.css';

const MAX_VISIBLE = 50;

export function HistoryPopover({ onClose }: { onClose: () => void }) {
  const past = useEditor((s) => s.past);
  const doc = useEditor((s) => s.doc);
  const future = useEditor((s) => s.future);
  const jump = useEditor((s) => s.jumpToHistory);
  const curRef = useRef<HTMLButtonElement>(null);

  // más reciente arriba; ventana de ~50 alrededor del paso actual
  const items = useMemo(() => {
    const all = buildHistory(past, doc, future);
    const cur = past.length;
    const start = Math.max(0, Math.min(all.length - MAX_VISIBLE, cur - Math.floor(MAX_VISIBLE / 2)));
    return all.slice(start, start + MAX_VISIBLE).reverse();
  }, [past, doc, future]);

  useEffect(() => {
    curRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [past.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="hist" role="dialog" aria-label="Historial de cambios">
      <div className="hist-head">
        <span>Historial</span>
        <button className="hist-close" onClick={onClose} aria-label="Cerrar historial">
          ×
        </button>
      </div>
      {items.length <= 1 ? (
        <div className="hist-empty">Aún no hay cambios</div>
      ) : (
        <ul className="hist-list">
          {items.map((it) => (
            <li key={it.index}>
              <button
                ref={it.current ? curRef : undefined}
                className={`hist-item${it.current ? ' is-current' : ''}${it.future ? ' is-future' : ''}`}
                aria-current={it.current ? 'step' : undefined}
                onClick={() => jump(it.index)}
              >
                <span className="hist-num">{it.index}</span>
                <span>{it.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
