import { useMemo, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { PURPOSES } from '../editor/core/purposes';
import { uniqueTargets, type TargetSize } from '../editor/core/libraryMeta';
import { toast } from './toast';
import { t } from '../i18n';
import './library.css';

interface Props {
  onClose: () => void;
}

const GROUPS = ['Redes sociales', 'Impresión', 'Trabajo'] as const;

// Redimensionar a varios formatos a la vez: desde la página actual crea una
// página nueva por cada formato marcado (mismas proporciones, recolocando las
// capas). Un solo Ctrl+Z revierte todo.
export function MultiResizeDialog({ onClose }: Props) {
  const doc = useEditor((s) => s.doc);
  const addResizedPages = useEditor((s) => s.addResizedPages);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const isCurrent = (p: { width: number; height: number }) => p.width === doc.width && p.height === doc.height;
  const selectable = PURPOSES.filter((p) => !isCurrent(p));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Los formatos con la misma medida (p. ej. Historia y Estado de WhatsApp) se crean una vez.
  const targets: TargetSize[] = useMemo(
    () =>
      uniqueTargets(
        PURPOSES.filter((p) => picked.has(p.id)).map((p) => ({ width: p.width, height: p.height, label: p.label })),
        doc,
      ),
    [picked, doc],
  );

  const create = () => {
    const n = addResizedPages(targets);
    if (n) toast(`${n} página(s) creadas en otros formatos. Ctrl+Z las deshace.`, 'success');
    onClose();
  };

  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card lib-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>{t('Redimensionar a varios formatos')}</h3>
        <p className="lib-hint" style={{ textAlign: 'left' }}>
          {t('Crea una página nueva por cada formato marcado, a partir de la página actual')} ({doc.width}×{doc.height}).
        </p>
        <div className="lib-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
          <button className="lib-btn" onClick={() => setPicked(new Set(selectable.map((p) => p.id)))}>
            {t('Marcar todos')}
          </button>
          <button className="lib-btn" onClick={() => setPicked(new Set())}>
            {t('Ninguno')}
          </button>
        </div>
        <div className="lib-sizes">
          {GROUPS.map((g) => (
            <div key={g}>
              <h5>{t(g)}</h5>
              {PURPOSES.filter((p) => p.group === g).map((p) => (
                <label key={p.id} style={isCurrent(p) ? { opacity: 0.5, cursor: 'default' } : undefined}>
                  <input
                    type="checkbox"
                    disabled={isCurrent(p)}
                    checked={picked.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  {p.icon} {p.label}
                  <small>{isCurrent(p) ? t('tamaño actual') : `${p.width} × ${p.height}`}</small>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="lib-actions">
          <button className="lib-btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button className="lib-btn" disabled={targets.length === 0} onClick={create}>
            {t('Crear')} {targets.length > 0 ? `${targets.length} ` : ''}
            {t('copias')}
          </button>
        </div>
      </div>
    </div>
  );
}
