import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ACTIONS, canonical, getShortcut, parseCombo, useShortcuts } from '../editor/core/shortcuts';
import './a11y.css';

// Tooltips propios (planos) con nombre + descripción + atajo efectivo.
// Un único componente delegado (<TipLayer/>, montado una vez en App) lee los
// atributos de los botones por eventos:
//   data-tip="Nombre"  data-tip-desc="Descripción corta"  data-tip-action="id"
//   data-tip-keys="Ctrl+Z"   (o, sin cambiar nada, el `title` de siempre)
// Los `title` existentes se mueven a `data-tip-t` y a aria-label/aria-description,
// así no sale el tooltip nativo y los lectores de pantalla conservan el texto.

const DELAY = 500;

/** Envoltorio opcional: <Tip name desc action>…</Tip> marca a sus hijos. */
export function Tip({
  name,
  desc,
  action,
  keys,
  children,
}: {
  name: string;
  desc?: string;
  action?: string;
  keys?: string;
  children: ReactNode;
}) {
  return (
    <span
      className="tip-wrap"
      data-tip={name}
      data-tip-desc={desc}
      data-tip-action={action}
      data-tip-keys={keys}
    >
      {children}
    </span>
  );
}

const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const cleanName = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').trim().slice(0, 40);

function isComboLike(s: string): boolean {
  const parts = s.split(/\s*\/\s*/);
  return parts.every((p) => {
    const c = parseCombo(p);
    if (!c) return false;
    return /\+/.test(p) || /^(Supr|Esc|F\d{1,2}|\?|Espacio)$/i.test(p.trim());
  });
}

/** Sustituye un atajo de fábrica por el efectivo (o lo quita si está desactivado). */
function effective(combo: string): string {
  return combo
    .split(/\s*\/\s*/)
    .map((p) => {
      const c = canonical(p);
      const a = ACTIONS.find((x) => canonical(x.def) === c);
      return a ? getShortcut(a.id) : p;
    })
    .filter(Boolean)
    .join(' / ');
}

export interface TipData {
  name: string;
  desc: string;
  keys: string;
}

/** Interpreta los atributos de un elemento (y su title guardado). */
export function readTip(el: HTMLElement): TipData | null {
  const explicit = el.getAttribute('data-tip');
  const title = el.getAttribute('data-tip-t') ?? el.getAttribute('title') ?? '';
  let name = explicit ?? '';
  let desc = el.getAttribute('data-tip-desc') ?? '';
  let keys = el.getAttribute('data-tip-keys') ?? '';
  const act = el.getAttribute('data-tip-action');
  if (act) keys = getShortcut(act);

  if (!explicit && title) {
    const m = title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    let main = title;
    if (m && isComboLike(m[2])) {
      main = m[1];
      keys = m[2];
    } else if (isComboLike(title)) {
      main = '';
      keys = title;
    }
    const label = cleanName(textOf(el));
    if (label && main && main.toLowerCase() !== label.toLowerCase()) {
      name = label;
      desc = main;
    } else if (label) {
      name = label;
    } else if (main) {
      const i = main.indexOf(':');
      if (i > 0 && i < 40) {
        name = main.slice(0, i);
        desc = main.slice(i + 1).trim();
      } else name = main;
    }
    if (keys) keys = effective(keys);
  } else if (keys && !act) {
    keys = effective(keys);
  }
  if (!name && !desc) return null;
  return { name: name || desc, desc: name ? desc : '', keys };
}

/** Mueve el title nativo a data-tip-t y lo conserva para accesibilidad. */
function migrate(el: Element) {
  const title = el.getAttribute('title');
  if (!title) return;
  el.setAttribute('data-tip-t', title);
  el.removeAttribute('title');
  if (!textOf(el)) {
    if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) el.setAttribute('aria-label', title);
  } else if (!el.getAttribute('aria-description')) {
    el.setAttribute('aria-description', title);
  }
}

const hostOf = (t: EventTarget | null): HTMLElement | null => {
  const el = t instanceof Element ? (t.closest('[data-tip],[title],[data-tip-t]') as HTMLElement | null) : null;
  return el && !el.closest('.tip-layer') ? el : null;
};

export function TipLayer() {
  useShortcuts(); // los atajos efectivos se leen al mostrar; re-render por si cambian
  const [tip, setTip] = useState<(TipData & { x: number; y: number; above: boolean }) | null>(null);
  const timer = useRef<number>(0);
  const box = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      window.clearTimeout(timer.current);
      migrate(el);
      if (current.current === el) return;
      current.current = el;
      setTip(null);
      timer.current = window.setTimeout(() => {
        if (!el.isConnected) return;
        const d = readTip(el);
        if (!d) return;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 90 > window.innerHeight;
        setTip({ ...d, x: r.left + r.width / 2, y: above ? r.top : r.bottom, above });
      }, delay);
    };
    const onOver = (e: MouseEvent) => {
      const el = hostOf(e.target);
      if (!el) return hide();
      if (el !== current.current) show(el, DELAY);
    };
    const onOut = (e: MouseEvent) => {
      const el = hostOf(e.target);
      if (el && !el.contains(e.relatedTarget as Node | null)) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = hostOf(e.target);
      if (!el) return;
      migrate(el);
      // Solo con teclado: con ratón ya sale por hover.
      if (el.matches(':focus-visible')) show(el, 300);
    };
    // Migra los title de todo el árbol (y de lo que se vaya montando).
    const sweep = (root: ParentNode) => root.querySelectorAll('[title]').forEach(migrate);
    sweep(document);
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => sweep(document));
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(timer.current);
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // Ajusta a los bordes de la ventana una vez medido.
  useLayoutEffect(() => {
    const b = box.current;
    if (!tip || !b) return;
    const w = b.offsetWidth;
    const left = Math.min(Math.max(8, tip.x - w / 2), window.innerWidth - w - 8);
    b.style.left = left + 'px';
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      className={`tip-layer${tip.above ? ' above' : ''}`}
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      <div className="tip-head">
        <b>{tip.name}</b>
        {tip.keys &&
          tip.keys.split(/\s*\/\s*/).map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
      </div>
      {tip.desc && <div className="tip-desc">{tip.desc}</div>}
    </div>
  );
}
