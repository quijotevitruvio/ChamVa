import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/state/store';
import { t } from '../i18n';
import { toast } from './toast';
import { formatBytes, memLevel, readMemory } from './MemoryMeter';
import {
  applyTouchClasses,
  detectTablet,
  setLeftHanded,
  setSaveMode,
  setTabletMode,
  useLeftHanded,
  useSaveMode,
  useTabletMode,
} from './tabletMode';
import './touch.css';

// Páginas con el documento actual (el de `pages` puede ir un paso por detrás).
function usePagesNow() {
  const pages = useEditor((s) => s.pages);
  const doc = useEditor((s) => s.doc);
  const idx = useEditor((s) => s.pageIndex);
  return pages.map((p, i) => (i === idx ? doc : p));
}

// Se monta una vez en App: aplica las clases de <html> (tablet, zurdo, ahorro),
// vigila la memoria y ofrece los tiradores de los
// paneles en modo tablet.
export function TouchRuntime() {
  const tablet = useTabletMode();
  const saving = useSaveMode();
  const pages = usePagesNow();
  const warned = useRef(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(() => {
    applyTouchClasses();
  }, []);

  // Vigilar la memoria: un aviso (una vez por sesión) si pasa del umbral.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (warned.current || saving) return;
      const m = readMemory(pagesRef.current);
      if (memLevel(m) === 'alto') {
        warned.current = true;
        toast(
          `${t('Memoria alta')} (${formatBytes(m.bytes)}). ${t('Activa el «Modo ahorro» en ⋯ Más para ir más fluido.')}`,
        );
      }
    }, 8000);
    return () => window.clearInterval(id);
  }, [saving]);

  // Tiradores de paneles (solo modo tablet): ocultan/muestran los paneles laterales.
  const [hideLeft, setHideLeft] = useState(false);
  const [hideRight, setHideRight] = useState(false);
  useEffect(() => {
    const c = document.documentElement.classList;
    c.toggle('collapse-left', tablet && hideLeft);
    c.toggle('collapse-right', tablet && hideRight);
  }, [tablet, hideLeft, hideRight]);

  return (
    <>
      {tablet && (
        <>
          <button
            className="tab-handle left"
            onClick={() => setHideLeft((v) => !v)}
            title={hideLeft ? 'Mostrar el panel de la izquierda' : 'Ocultar el panel de la izquierda'}
          >
            {hideLeft ? '›' : '‹'}
          </button>
          <button
            className="tab-handle right"
            onClick={() => setHideRight((v) => !v)}
            title={hideRight ? 'Mostrar el panel de propiedades' : 'Ocultar el panel de propiedades'}
          >
            {hideRight ? '‹' : '›'}
          </button>
        </>
      )}
    </>
  );
}

// Entradas del menú ⋯ Más: modo tablet, zurdo, ahorro y medidor de memoria.
export function TouchMenuItems() {
  const tablet = useTabletMode();
  const lefty = useLeftHanded();
  const saving = useSaveMode();
  const pages = usePagesNow();
  const mem = readMemory(pages);
  const keep = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation(); // el menú se queda abierto para ver el cambio
    fn();
  };
  return (
    <>
      <button onClick={keep(() => setTabletMode(!tablet))} title="Botones y paneles más grandes para tocar con el dedo">
        ▭ {t('Modo tablet')}: {tablet ? t('sí') : t('no')}
        {!tablet && detectTablet() ? ` (${t('recomendado')})` : ''}
      </button>
      <button onClick={keep(() => setLeftHanded(!lefty))} title="En móvil apaisado, los paneles pasan al lado izquierdo">
        ✋ {t('Modo zurdo')}: {lefty ? t('sí') : t('no')}
      </button>
      <button
        onClick={keep(() => setSaveMode(!saving))}
        title="Baja la resolución del lienzo y quita sombras mientras editas (la exportación no cambia)"
      >
        ⚡ {t('Modo ahorro')}: {saving ? t('sí') : t('no')}
      </button>
      <div className={`mem-line${memLevel(mem) === 'alto' ? ' high' : ''}`} title={mem.source === 'medida' ? 'Memoria de la página' : 'Estimación por imágenes del proyecto'}>
        {t('Memoria')}: {formatBytes(mem.bytes)} ({mem.source})
      </div>
    </>
  );
}
