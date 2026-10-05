import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from '../io/export';
import { clearMasterRefs, masterRevision } from '../editor/core/master';
import { deleteIndices, duplicateIndices, moveIndicesTo, reorderOne } from '../editor/core/pageOps';
import { setPageMaster, setPageTitle, setPageHidden, setPageLocked } from './pageActions';
import { t } from '../i18n';
import './organize.css';
import './pagefields.css';
import { CloseButton } from './Modal';
import { useDismiss } from './useDismiss';

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Miniatura grande; se rehace solo cuando cambian las capas (por identidad) o su maestra.
function SorterThumb({ doc, master }: { doc: Doc; master?: Doc }) {
  const ref = useRef<HTMLImageElement>(null);
  const sig = `${masterRevision(doc)}-${master ? masterRevision(master) : 0}-${doc.masterId ?? ''}`;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const scale = Math.min(1, 220 / Math.max(doc.width, doc.height));
      try {
        const canvas = await renderDocToCanvas(doc, scale, '#ffffff');
        if (!cancelled && ref.current) ref.current.src = canvas.toDataURL('image/jpeg', 0.7);
      } catch {
        /* sin miniatura */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return <img ref={ref} alt="" draggable={false} />;
}

// Clasificador de páginas: cuadrícula grande con todas las páginas.
// Arrastra para reordenar; selecciona varias (casilla o Ctrl/Mayús+clic) para
// duplicar, borrar o moverlas al principio/final. Doble clic abre la página.
export function PageSorter({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose });
  const doc = useEditor((s) => s.doc);
  const storePages = useEditor((s) => s.pages);
  const pageIndex = useEditor((s) => s.pageIndex);
  const editPages = useEditor((s) => s.editPages);
  const switchPage = useEditor((s) => s.switchPage);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const pages = storePages.map((p, i) => (i === pageIndex ? doc : p));
  const selIdx = pages.map((p, i) => (sel.has(p.id) ? i : -1)).filter((i) => i >= 0);
  const oneSel = selIdx.length === 1 ? pages[selIdx[0]] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string, additive: boolean) =>
    setSel((s) => {
      const n = new Set(additive ? s : []);
      if (s.has(id) && (additive || s.size === 1)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Aplica una operación y deja seleccionadas las mismas páginas (por id).
  const run = (op: (pages: Doc[], selected: number[]) => Doc[]) =>
    editPages((ps, currentId) => {
      const idx = ps.map((p, i) => (sel.has(p.id) ? i : -1)).filter((i) => i >= 0);
      const next = op(ps, idx);
      if (next === ps) return { pages: ps, currentId };
      const stillThere = next.some((p) => p.id === currentId);
      let cur = currentId;
      if (!stillThere) {
        const old = ps.findIndex((p) => p.id === currentId);
        cur = next[Math.min(Math.max(old, 0), next.length - 1)].id;
      }
      // Si se borró una maestra, las páginas que la usaban quedan libres.
      let out = next;
      for (const p of ps) if (p.isMaster && !next.some((q) => q.id === p.id)) out = clearMasterRefs(out, p.id);
      return { pages: out, currentId: cur };
    });

  const dropOn = (to: number) => {
    const from = dragFrom;
    setDragFrom(null);
    setOver(null);
    if (from === null || from === to) return;
    editPages((ps, currentId) => ({ pages: reorderOne(ps, from, to), currentId }));
  };

  return (
    <div className="ps-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ps-dialog" ref={cardRef} role="dialog" aria-modal="true" aria-label={t('Clasificador de páginas')}>
        <div className="ps-head">
          <h3>
            {t('Clasificador de páginas')} · {pages.length}
          </h3>
          <button disabled={!selIdx.length} onClick={() => run((ps, s) => moveIndicesTo(ps, s, 'start'))}>
            ⇤ {t('Al principio')}
          </button>
          <button disabled={!selIdx.length} onClick={() => run((ps, s) => moveIndicesTo(ps, s, 'end'))}>
            ⇥ {t('Al final')}
          </button>
          <button disabled={!selIdx.length} onClick={() => run((ps, s) => duplicateIndices(ps, s, uid))}>
            ⧉ {t('Duplicar')}
          </button>
          <button
            disabled={!oneSel}
            title={t('Marca esta página como maestra: sus capas aparecen detrás de las páginas que la usen')}
            onClick={() => oneSel && setPageMaster(oneSel.id, !oneSel.isMaster)}
          >
            {oneSel?.isMaster ? t('Quitar maestra') : t('Hacer maestra')}
          </button>
          <button
            className="danger"
            disabled={!selIdx.length || selIdx.length >= pages.length}
            onClick={() => {
              run((ps, s) => deleteIndices(ps, s));
              setSel(new Set());
            }}
          >
            🗑 {t('Borrar')}
          </button>
          <button onClick={() => setSel(sel.size === pages.length ? new Set() : new Set(pages.map((p) => p.id)))}>
            {sel.size === pages.length ? t('Ninguna') : t('Todas')}
          </button>
          <button className="primary" onClick={onClose}>
            {t('Listo')}
          </button>
          <CloseButton onClick={onClose} />
        </div>
        <div className="ps-grid">
          {pages.map((p, i) => (
            <div
              key={p.id}
              className={`ps-card${sel.has(p.id) ? ' sel' : ''}${i === pageIndex ? ' cur' : ''}${p.hidden ? ' page-hidden' : ''}${over === i && dragFrom !== null && dragFrom !== i ? ' drop' : ''}`}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = 'move';
                try {
                  e.dataTransfer.setData('text/plain', String(i));
                } catch {
                  /* no crítico */
                }
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (over !== i) setOver(i);
              }}
              onDrop={() => dropOn(i)}
              onClick={(e) => toggle(p.id, e.ctrlKey || e.metaKey || e.shiftKey)}
              onDoubleClick={() => {
                switchPage(i);
                onClose();
              }}
              title={t('Arrastra para reordenar · doble clic para abrir')}
            >
              <div className="ps-thumb">
                <SorterThumb doc={p} master={p.masterId ? pages.find((q) => q.id === p.masterId) : undefined} />
              </div>
              <div className="ps-label">
                <input
                  type="checkbox"
                  checked={sel.has(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(p.id, true)}
                  aria-label={`${t('Seleccionar')} ${i + 1}`}
                />
                <span>
                  {i + 1}. {p.name}
                </span>
                {p.isMaster && <small>{t('Maestra')}</small>}
              </div>
              <input
                key={p.title ?? ''}
                className="ps-title"
                defaultValue={p.title ?? ''}
                placeholder={t('Agregar título de página')}
                maxLength={120}
                draggable={false}
                aria-label={`${t('Título de la página')} ${i + 1}`}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  if (e.currentTarget.value.trim() !== (p.title ?? '')) setPageTitle(p.id, e.currentTarget.value);
                }}
              />
              <div className="ps-flags">
                <span
                  role="button"
                  tabIndex={0}
                  title={p.hidden ? t('Mostrar página') : t('Ocultar página (no se exporta ni se presenta)')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPageHidden(p.id, !p.hidden);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {p.hidden ? t('Oculta') : t('Visible')}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  title={p.locked ? t('Desbloquear página') : t('Bloquear página')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPageLocked(p.id, !p.locked);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {p.locked ? '🔒' : '🔓'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="ps-foot">
          {selIdx.length
            ? `${selIdx.length} ${t('seleccionadas')}`
            : t('Clic para seleccionar (Ctrl o Mayús para varias), arrastra para reordenar y doble clic para abrir.')}
        </div>
      </div>
    </div>
  );
}
