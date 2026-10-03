import { memo } from 'react';
import type { Doc } from '../core/types';
import { PageHeader } from '../../ui/PageHeader';
import { PageStill } from './PageStill';
import { PageStage } from './PageStage';
import type { CanvasBridge } from './CanvasViewport';
import { pageBox } from './stackLayout';
import { useEditor } from '../state/store';
import { t } from '../../i18n';

// Una tarjeta de la pila: cabecera + (página activa = Stage real | inactiva =
// imagen si está cerca de la pantalla | hueco con su tamaño) + «+» debajo.
export const PageCard = memo(function PageCard({
  doc,
  index,
  count,
  active,
  near,
  scale,
  bridge,
  onActivate,
}: {
  doc: Doc;
  index: number;
  count: number;
  active: boolean;
  near: boolean;
  scale: number;
  bridge: CanvasBridge;
  onActivate: (i: number) => void;
}) {
  const addPage = useEditor((s) => s.addPage);
  const { w, h } = pageBox(doc, scale);
  const transparent = doc.background.type === 'transparent';
  return (
    <>
      <section
        className={`ps-card${active ? ' active' : ''}${doc.hidden ? ' is-hidden' : ''}`}
        data-page-index={index}
        data-page-id={doc.id}
        style={{ minWidth: 340 }}
      >
        <PageHeader doc={doc} index={index} count={count} />
        {active ? (
          <PageStage doc={doc} scale={scale} bridge={bridge} />
        ) : (
          <div
            className={`ps-slot${transparent ? ' ps-checker' : ''}`}
            style={{ width: w, height: h }}
            onPointerDown={() => onActivate(index)}
            title={t('Clic para editar esta página')}
          >
            {near && <PageStill doc={doc} scale={scale} />}
          </div>
        )}
      </section>
      <button className="ps-add" onClick={() => addPage(index)} title={t('Agregar página debajo')}>
        ＋
      </button>
    </>
  );
});
