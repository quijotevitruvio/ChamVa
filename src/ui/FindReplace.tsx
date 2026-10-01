import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { findMatches, replaceInText } from '../editor/core/textSearch';
import type { Layer } from '../editor/core/types';
import { MissingFontWatcher } from './FontPicker';
import { toast } from './toast';
import { t } from '../i18n';
import './texttools.css';

export const FIND_EVENT = 'chamva:find';
// Abre el diálogo (lo usan Ctrl+F y el botón del panel de texto).
export const openFindReplace = () => window.dispatchEvent(new Event(FIND_EVENT));

interface Hit {
  page: number;
  layerId: string;
  start: number;
  end: number;
  index: number; // n.º de coincidencia dentro de su capa
}

function FindReplaceDialog({ onClose }: { onClose: () => void }) {
  const pages = useEditor((s) => s.pages);
  const doc = useEditor((s) => s.doc);
  const pageIndex = useEditor((s) => s.pageIndex);
  const [query, setQuery] = useState('');
  const [repl, setRepl] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [allPages, setAllPages] = useState(false);
  const [cur, setCur] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const opts = useMemo(() => ({ matchCase, wholeWord }), [matchCase, wholeWord]);

  // Documentos a recorrer: la página actual (siempre al día) o todas.
  const docs = useMemo(() => {
    const synced = pages.map((p, i) => (i === pageIndex ? doc : p));
    return allPages ? synced.map((d, i) => ({ d, i })) : [{ d: doc, i: pageIndex }];
  }, [pages, doc, pageIndex, allPages]);

  const hits: Hit[] = useMemo(() => {
    const out: Hit[] = [];
    for (const { d, i } of docs)
      for (const l of d.layers) {
        if (l.type !== 'text') continue;
        findMatches(l.text, query, opts).forEach((m, index) =>
          out.push({ page: i, layerId: l.id, start: m.start, end: m.end, index }),
        );
      }
    return out;
  }, [docs, query, opts]);

  useEffect(() => setCur(0), [query, matchCase, wholeWord, allPages]);
  const idx = hits.length ? Math.min(cur, hits.length - 1) : -1;

  const goTo = (i: number) => {
    const h = hits[i];
    if (!h) return;
    const st = useEditor.getState();
    if (h.page !== st.pageIndex) st.switchPage(h.page);
    useEditor.getState().selectLayer(h.layerId);
    // Deja marcada la coincidencia: B / I / U y el color del panel se aplican a ella.
    useEditor.getState().setTextSel({ id: h.layerId, start: h.start, end: h.end });
  };
  const step = (dir: 1 | -1) => {
    if (!hits.length) return;
    const n = (idx + dir + hits.length) % hits.length;
    setCur(n);
    goTo(n);
  };

  // Aplica a una capa (de cualquier página) el resultado de reemplazar.
  const run = (only: { hit: Hit } | null) => {
    if (!query || !hits.length) return;
    const st = useEditor.getState();
    const here: { id: string; patch: Partial<Layer> }[] = [];
    const other: { page: number; id: string; patch: Partial<Layer> }[] = [];
    let total = 0;
    const targets = only ? [only.hit.page] : docs.map((x) => x.i);
    for (const { d, i } of docs) {
      if (!targets.includes(i)) continue;
      for (const l of d.layers) {
        if (l.type !== 'text') continue;
        const r = replaceInText(l.text, l.spans, query, repl, opts, only ? (only.hit.layerId === l.id ? only.hit.index : -1) : undefined);
        if (!r.count) continue;
        total += r.count;
        const patch = { text: r.text, spans: r.spans } as Partial<Layer>;
        if (i === st.pageIndex) here.push({ id: l.id, patch });
        else other.push({ page: i, id: l.id, patch });
      }
    }
    if (!total) return;
    st.beginBatch(); // un solo paso de deshacer
    try {
      here.forEach((e) => st.updateLayer(e.id, e.patch));
    } finally {
      st.endBatch();
    }
    if (other.length) st.patchOtherPages(other);
    if (!only) {
      toast(
        `${total} ${total === 1 ? t('reemplazo') : t('reemplazos')}${other.length ? ' · ' + t('en otras páginas no se puede deshacer') : ''}`,
        'success',
      );
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  return (
    <div className="tt-find" role="dialog" aria-label={t('Buscar y reemplazar')} onKeyDown={onKey}>
      <div className="tt-head">
        <h3>{t('Buscar y reemplazar')}</h3>
        <button className="tt-x" onClick={onClose} title={t('Cerrar')}>
          ✕
        </button>
      </div>
      <input
        ref={inputRef}
        className="tt-input"
        placeholder={t('Buscar…')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <input
        className="tt-input"
        placeholder={t('Reemplazar por…')}
        value={repl}
        onChange={(e) => setRepl(e.target.value)}
      />
      <div className="tt-opts">
        <label>
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
          {t('Mayúsculas')}
        </label>
        <label>
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
          {t('Palabra completa')}
        </label>
        <label>
          <input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} />
          {t('Todas las páginas')}
        </label>
      </div>
      <p className="tt-count">
        {!query
          ? t('Escribe lo que buscas.')
          : hits.length
            ? `${idx + 1} ${t('de')} ${hits.length}`
            : t('Sin resultados')}
      </p>
      <div className="tt-btns">
        <button onClick={() => step(-1)} disabled={!hits.length}>
          ‹ {t('Anterior')}
        </button>
        <button onClick={() => step(1)} disabled={!hits.length}>
          {t('Siguiente')} ›
        </button>
        <button onClick={() => idx >= 0 && run({ hit: hits[idx] })} disabled={!hits.length}>
          {t('Reemplazar')}
        </button>
        <button onClick={() => run(null)} disabled={!hits.length}>
          {t('Reemplazar todo')}
        </button>
      </div>
    </div>
  );
}

// Se monta una vez en App: diálogo de buscar/reemplazar + aviso de fuentes faltantes.
export function TextToolsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(FIND_EVENT, on);
    return () => window.removeEventListener(FIND_EVENT, on);
  }, []);
  return (
    <>
      <MissingFontWatcher />
      {open && <FindReplaceDialog onClose={() => setOpen(false)} />}
    </>
  );
}
