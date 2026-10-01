import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../editor/state/store';
import { FONT_FAMILIES } from '../editor/core/types';
import {
  FONT_CATEGORIES,
  fontCategory,
  missingFonts,
  suggestSubstitute,
  type FontCategory,
} from '../editor/core/fontMeta';
import { toast } from './toast';
import { t } from '../i18n';
import './texttools.css';

// ---- favoritas y recientes (localStorage; sin él simplemente no se recuerdan) ----
const LS_FAV = 'chamva.fontFav';
const LS_RECENT = 'chamva.fontRecent';
const MAX_RECENT = 8;

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* sin almacenamiento */
  }
}

// Todas las fuentes que se pueden usar ahora mismo (empaquetadas + propias + de marca).
export function useAvailableFonts() {
  const customFonts = useEditor((s) => s.customFonts);
  const brandFonts = useEditor((s) => s.brandFonts);
  return useMemo(
    () => ({
      brandFonts,
      customFonts,
      all: [...new Set([...brandFonts, ...customFonts, ...FONT_FAMILIES])],
    }),
    [brandFonts, customFonts],
  );
}

type Filter = 'all' | 'fav' | 'recent' | 'brand' | 'mine' | FontCategory;

interface Row {
  family: string;
  tag?: string;
}

function FontPickerModal({
  value,
  sample,
  onPick,
  onClose,
}: {
  value: string;
  sample: string;
  onPick: (family: string) => void;
  onClose: () => void;
}) {
  const { brandFonts, customFonts, all } = useAvailableFonts();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [fav, setFav] = useState<string[]>(() => readList(LS_FAV));
  const [recent, setRecent] = useState<string[]>(() => readList(LS_RECENT));
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const text = (sample.replace(/\s+/g, ' ').trim() || 'Hola mundo').slice(0, 40);

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base: string[];
    switch (filter) {
      case 'fav':
        base = fav.filter((f) => all.includes(f));
        break;
      case 'recent':
        base = recent.filter((f) => all.includes(f));
        break;
      case 'brand':
        base = brandFonts;
        break;
      case 'mine':
        base = customFonts;
        break;
      case 'all':
        base = all;
        break;
      default:
        base = all.filter((f) => fontCategory(f) === filter);
    }
    return base
      .filter((f) => !q || f.toLowerCase().includes(q))
      .map((f) => ({
        family: f,
        tag: brandFonts.includes(f) ? 'Marca' : customFonts.includes(f) ? 'Mía' : undefined,
      }));
  }, [query, filter, fav, recent, all, brandFonts, customFonts]);

  useEffect(() => setActive(0), [query, filter]);
  useEffect(() => {
    (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (family: string) => {
    const next = [family, ...recent.filter((f) => f !== family)].slice(0, MAX_RECENT);
    setRecent(next);
    writeList(LS_RECENT, next);
    onPick(family);
    onClose();
  };
  const toggleFav = (family: string) => {
    const next = fav.includes(family) ? fav.filter((f) => f !== family) : [...fav, family];
    setFav(next);
    writeList(LS_FAV, next);
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) pick(rows[active].family);
    }
  };

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'fav', label: '★ Favoritas' },
    { id: 'recent', label: 'Recientes' },
    ...(brandFonts.length ? [{ id: 'brand' as Filter, label: 'Marca' }] : []),
    ...(customFonts.length ? [{ id: 'mine' as Filter, label: 'Mis fuentes' }] : []),
    ...FONT_CATEGORIES.map((c) => ({ id: c.id as Filter, label: c.label })),
  ];

  return createPortal(
    <div className="tt-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tt-modal tt-font" role="dialog" aria-label={t('Buscar fuente')} onKeyDown={onKey}>
        <div className="tt-head">
          <h3>{t('Fuentes')}</h3>
          <button className="tt-x" onClick={onClose} title={t('Cerrar')}>
            ✕
          </button>
        </div>
        <input
          ref={inputRef}
          className="tt-input"
          placeholder={t('Buscar fuente…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tt-chips">
          {filters.map((f) => (
            <button
              key={f.id}
              className={`tt-chip ${filter === f.id ? 'on' : ''}`}
              onClick={() => {
                setFilter(f.id);
                inputRef.current?.focus(); // las flechas deben seguir llegando al buscador
              }}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
        <ul className="tt-list" ref={listRef} role="listbox">
          {rows.length === 0 && (
            <li className="tt-empty">
              {filter === 'fav'
                ? t('Marca fuentes con la estrella para verlas aquí.')
                : filter === 'recent'
                  ? t('Aún no has usado ninguna fuente.')
                  : t('Ninguna fuente coincide.')}
            </li>
          )}
          {rows.map((r, i) => (
            <li
              key={r.family}
              role="option"
              aria-selected={r.family === value}
              className={`tt-row ${i === active ? 'active' : ''} ${r.family === value ? 'current' : ''}`}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => pick(r.family)}
            >
              <div className="tt-row-main">
                <span className="tt-row-name">
                  {r.family}
                  {r.tag && <em>{t(r.tag)}</em>}
                  <small>{t(FONT_CATEGORIES.find((c) => c.id === fontCategory(r.family))?.label ?? '')}</small>
                </span>
                <span className="tt-row-sample" style={{ fontFamily: `"${r.family}", sans-serif` }}>
                  {text}
                </span>
              </div>
              <button
                className={`tt-star ${fav.includes(r.family) ? 'on' : ''}`}
                title={fav.includes(r.family) ? t('Quitar de favoritas') : t('Añadir a favoritas')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFav(r.family);
                  inputRef.current?.focus();
                }}
              >
                {fav.includes(r.family) ? '★' : '☆'}
              </button>
            </li>
          ))}
        </ul>
        <p className="tt-hint">{t('↑ ↓ para moverte · Intro para elegir · Esc para cerrar')}</p>
      </div>
    </div>,
    document.body,
  );
}

// Botón del panel de texto: muestra la fuente actual y abre el buscador.
export function FontPicker({
  value,
  sample,
  onPick,
}: {
  value: string;
  sample: string;
  onPick: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="tt-fontbtn"
        title={t('Buscar y elegir fuente')}
        onClick={() => setOpen(true)}
        style={{ fontFamily: `"${value}", sans-serif` }}
      >
        <span>{value}</span>
        <span className="tt-caret">⌕</span>
      </button>
      {open && <FontPickerModal value={value} sample={sample} onPick={onPick} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---- fuente faltante ----

// Familias de TODAS las páginas que no existen (ni empaquetadas ni propias).
export function useMissingFontsInDoc(): string[] {
  const pages = useEditor((s) => s.pages);
  const doc = useEditor((s) => s.doc);
  const pageIndex = useEditor((s) => s.pageIndex);
  const { all } = useAvailableFonts();
  return useMemo(() => {
    const used: string[] = [];
    pages.forEach((p, i) => {
      const d = i === pageIndex ? doc : p;
      for (const l of d.layers) if (l.type === 'text') used.push(l.fontFamily);
    });
    return missingFonts(used, all);
  }, [pages, doc, pageIndex, all]);
}

// Avisa con un toast (una vez por fuente y sesión) al abrir algo con fuentes que no existen.
export function MissingFontWatcher() {
  const missing = useMissingFontsInDoc();
  const warned = useRef(new Set<string>());
  useEffect(() => {
    const fresh = missing.filter((f) => !warned.current.has(f.toLowerCase()));
    if (!fresh.length) return;
    // Las fuentes propias se cargan de forma asíncrona al arrancar: se espera un poco.
    const id = setTimeout(() => {
      fresh.forEach((f) => warned.current.add(f.toLowerCase()));
      toast(
        `${t('Falta la fuente')} ${fresh.slice(0, 3).join(', ')}${fresh.length > 3 ? '…' : ''}. ${t('Se usa una genérica: puedes sustituirla desde el panel de texto.')}`,
        'info',
      );
    }, 1500);
    return () => clearTimeout(id);
  }, [missing]);
  return null;
}

// Aviso dentro del panel de texto + botón «Sustituir por…».
export function MissingFontNotice({ layerId, family }: { layerId: string; family: string }) {
  const { all } = useAvailableFonts();
  const [open, setOpen] = useState(false);
  const missing = missingFonts([family], all).length > 0;
  if (!missing) return null;
  const apply = (to: string, everywhere: boolean) => {
    const st = useEditor.getState();
    st.beginBatch();
    try {
      if (everywhere) {
        st.doc.layers.forEach((l) => {
          if (l.type === 'text' && l.fontFamily === family) st.updateLayer(l.id, { fontFamily: to });
        });
      } else st.updateLayer(layerId, { fontFamily: to });
    } finally {
      st.endBatch();
    }
    toast(`${t('Fuente sustituida por')} ${to}`, 'success');
  };
  const guess = suggestSubstitute(family, all) ?? 'Arial';
  return (
    <div className="tt-missing">
      <p>
        {t('La fuente')} <b>{family}</b> {t('no está disponible; se dibuja con una genérica.')}
      </p>
      <div className="tt-missing-row">
        <button onClick={() => apply(guess, true)} title={t('Usa una fuente parecida')}>
          {t('Sustituir por')} {guess}
        </button>
        <button onClick={() => setOpen(true)}>{t('Sustituir por…')}</button>
      </div>
      {open && (
        <FontPickerModal value={guess} sample="" onPick={(f) => apply(f, true)} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
