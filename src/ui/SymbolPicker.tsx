import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import './texttools.css';

const SYMBOLS: { id: string; label: string; chars: string }[] = [
  { id: 'arrows', label: 'Flechas', chars: '← → ↑ ↓ ↔ ↕ ↖ ↗ ↘ ↙ ⇐ ⇒ ⇑ ⇓ ⇔ ➔ ➜ ➤ ➡ ⬅ ⬆ ⬇ ↩ ↪ ↻ ↺' },
  { id: 'math', label: 'Matemáticos', chars: '± × ÷ ≠ ≈ ≤ ≥ ∞ √ ∑ ∏ π ∆ ∫ ∂ ° ‰ ¼ ½ ¾ ² ³ µ Ω ≡ ∈ ∩ ∪' },
  { id: 'money', label: 'Monedas', chars: '$ € £ ¥ ¢ ₡ ₩ ₪ ₹ ₽ ₿ ₫ ₱ ₦ ₲ ₴ ₺ ₸ ฿ ¤' },
  { id: 'bullets', label: 'Viñetas', chars: '• ◦ ‣ ▪ ▫ ■ □ ● ○ ◆ ◇ ▶ ▷ ◀ ◁ ▲ △ ▼ ▽ – — ‥ … · ✓ ✔ ✗ ✘ ✚' },
  { id: 'stars', label: 'Estrellas', chars: '★ ☆ ✦ ✧ ✩ ✪ ✫ ✬ ✭ ✮ ✯ ✰ ❋ ✱ ✲ ✳ ❖ ❤ ♥ ♡ ♦ ♣ ♠ ☀ ☾ ☁ ☂ ♫ ♪' },
  { id: 'marks', label: 'Marcas', chars: '© ® ™ ℠ § ¶ † ‡ № ℗ ℃ ℉ ¿ ¡ « » “ ” ‘ ’ „ ‹ › ª º' },
];

// Popover con símbolos habituales. `onPick` recibe el carácter elegido.
// Los botones no roban el foco (mousedown evitado) para no perder el cursor del texto.
export function SymbolPicker({
  onPick,
  className = '',
  title,
  children,
}: {
  onPick: (sym: string) => void;
  className?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(SYMBOLS[0].id);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const current = SYMBOLS.find((c) => c.id === cat) ?? SYMBOLS[0];
  return (
    <span className="tt-sym" ref={ref}>
      <button
        type="button"
        className={className}
        title={title ?? t('Insertar símbolo')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        {children ?? 'Ω'}
      </button>
      {open && (
        <div className="tt-sym-pop" onMouseDown={(e) => e.preventDefault()}>
          <div className="tt-chips">
            {SYMBOLS.map((c) => (
              <button key={c.id} type="button" className={`tt-chip ${c.id === cat ? 'on' : ''}`} onClick={() => setCat(c.id)}>
                {t(c.label)}
              </button>
            ))}
          </div>
          <div className="tt-sym-grid">
            {current.chars.split(' ').map((ch) => (
              <button key={ch} type="button" className="tt-sym-cell" onClick={() => onPick(ch)}>
                {ch}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
