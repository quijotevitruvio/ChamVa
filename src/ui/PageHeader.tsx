import { useEffect, useState } from 'react';
import type { Doc } from '../editor/core/types';
import { useEditor } from '../editor/state/store';
import { setPageHidden, setPageLocked, setPageTitle } from './pageActions';
import { t } from '../i18n';
import './pagestack.css';

// Cabecera de una página del modo apilado: «Página N · título» y sus acciones.
export function PageHeader({ doc, index, count }: { doc: Doc; index: number; count: number }) {
  const reorderPages = useEditor((s) => s.reorderPages);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const [title, setTitle] = useState(doc.title ?? '');
  useEffect(() => setTitle(doc.title ?? ''), [doc.title]);

  const commit = () => {
    if (title.trim() !== (doc.title ?? '')) setPageTitle(doc.id, title);
  };

  return (
    <div className="ps-head">
      <span className="ps-num">
        {t('Página')} {index + 1}
      </span>
      <input
        className="ps-title"
        value={title}
        maxLength={120}
        placeholder={t('Agregar título de página')}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setTitle(doc.title ?? '');
            e.currentTarget.blur();
          }
          e.stopPropagation(); // los atajos del editor no deben actuar al escribir
        }}
      />
      {doc.hidden && <span className="ps-flag">{t('Oculta')}</span>}
      <span className="ps-actions">
        <button disabled={index === 0} onClick={() => reorderPages(index, index - 1)} title={t('Subir página')}>
          ↑
        </button>
        <button disabled={index === count - 1} onClick={() => reorderPages(index, index + 1)} title={t('Bajar página')}>
          ↓
        </button>
        <button
          className={doc.hidden ? 'on' : ''}
          aria-pressed={!!doc.hidden}
          onClick={() => setPageHidden(doc.id, !doc.hidden)}
          title={doc.hidden ? t('Mostrar página') : t('Ocultar página (no se exporta ni se presenta)')}
        >
          {doc.hidden ? '◌' : '◉'}
        </button>
        <button
          className={doc.locked ? 'on' : ''}
          aria-pressed={!!doc.locked}
          onClick={() => setPageLocked(doc.id, !doc.locked)}
          title={doc.locked ? t('Desbloquear página') : t('Bloquear página')}
        >
          {doc.locked ? '🔒' : '🔓'}
        </button>
        <button onClick={() => duplicatePage(index)} title={t('Duplicar página')}>
          ⧉
        </button>
        <button disabled={count <= 1} onClick={() => deletePage(index)} title={t('Borrar página')}>
          ✕
        </button>
      </span>
    </div>
  );
}
