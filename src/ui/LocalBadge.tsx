import { useEffect, useState } from 'react';
import { t, useLang } from '../i18n';
import './a11y.css';

// Insignia «todo local»: ChamVa procesa en tu dispositivo. Solo cambia a
// «Descargando modelo…» cuando el módulo de IA avisa (evento global
// `chamva:net`, emitido en ai/worker-client.ts) de una descarga de modelo.
// Limitación: las descargas de OpenCV/FFmpeg/iconos no emiten el aviso.
export function LocalBadge({ full = false }: { full?: boolean }) {
  useLang();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let off = 0;
    const onNet = (e: Event) => {
      const d = !!(e as CustomEvent<{ downloading: boolean }>).detail?.downloading;
      setDown(d);
      window.clearTimeout(off);
      // Si el aviso se corta (error, cancelación), vuelve solo al estado normal.
      if (d) off = window.setTimeout(() => setDown(false), 6000);
    };
    const on = () => setOnline(true);
    const out = () => setOnline(false);
    window.addEventListener('chamva:net', onNet);
    window.addEventListener('online', on);
    window.addEventListener('offline', out);
    return () => {
      window.clearTimeout(off);
      window.removeEventListener('chamva:net', onNet);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', out);
    };
  }, []);

  const tip = t(
    'Tu diseño nunca sale de este dispositivo. Solo se usa internet para descargar modelos de IA, iconos y actualizaciones, y solo cuando tú lo pides.',
  );
  const label = down
    ? t('Descargando modelo…')
    : full
      ? `${t('Procesado en tu dispositivo')}${online ? '' : ' · ' + t('sin conexión')}`
      : t('Todo local');
  return (
    <span className={`local-badge${down ? ' busy' : ''}`} title={tip} role="status">
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
