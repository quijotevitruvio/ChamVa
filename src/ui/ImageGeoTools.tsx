import { lazy, Suspense, useState } from 'react';
import type { ImageLayer } from '../editor/core/types';
import { useBeforeAfter } from './BeforeAfterSlider';
import { t } from '../i18n';
import './imagegeo.css';

const PerspectiveEditor = lazy(() => import('./PerspectiveEditor').then((m) => ({ default: m.PerspectiveEditor })));
const StraightenTool = lazy(() => import('./StraightenTool').then((m) => ({ default: m.StraightenTool })));
const RedactEditor = lazy(() => import('./RedactEditor').then((m) => ({ default: m.RedactEditor })));
const MockupDialog = lazy(() => import('./MockupDialog').then((m) => ({ default: m.MockupDialog })));

type Tool = 'perspective' | 'straighten' | 'redact' | 'mockup' | null;

// Menú «Geometría» del panel de imagen: abre las herramientas de perspectiva, enderezar,
// censurar, comparador antes/después y mockups.
export function ImageGeoTools({ layer }: { layer: ImageLayer }) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>(null);
  const [frozen, setFrozen] = useState<ImageLayer>(layer); // la capa tal como estaba al abrir la herramienta
  const launch = (t: Tool) => {
    setFrozen(layer);
    setTool(t);
  };
  const openBA = useBeforeAfter((s) => s.open);
  const close = () => setTool(null);

  return (
    <div className="geo-menu">
      <button className="full" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        📐 {t('Geometría')} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="geo-list">
          <button onClick={() => launch('perspective')}>▱ {t('Corregir perspectiva')}</button>
          <button onClick={() => launch('straighten')}>⟲ {t('Enderezar horizonte')}</button>
          <button onClick={() => launch('redact')}>▦ {t('Censurar zona')}</button>
          <button onClick={() => openBA(layer.id)}>◐ {t('Comparar antes / después')}</button>
          <button onClick={() => launch('mockup')}>▭ {t('Mockup en perspectiva')}</button>
        </div>
      )}
      <Suspense fallback={null}>
        {tool === 'perspective' && <PerspectiveEditor layer={frozen} onClose={close} />}
        {tool === 'straighten' && <StraightenTool layer={frozen} onClose={close} />}
        {tool === 'redact' && <RedactEditor layer={frozen} onClose={close} />}
        {tool === 'mockup' && <MockupDialog layer={frozen} onClose={close} />}
      </Suspense>
    </div>
  );
}
