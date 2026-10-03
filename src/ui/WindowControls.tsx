import { useEffect, useState } from 'react';
import { isTauri } from '../io/nativeSave';

/**
 * Botones − ▢ ✕ propios, solo cuando la ventana nativa no tiene decoraciones
 * (Windows: `src-tauri/tauri.windows.conf.json`). En web, Android, macOS y Linux no se pinta nada.
 */
export function WindowControls() {
  const [custom, setCustom] = useState(false);
  const [maxed, setMaxed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let dead = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const w = getCurrentWindow();
        if (await w.isDecorated()) return;
        if (dead) return;
        setCustom(true);
        document.documentElement.classList.add('custom-titlebar');
        setMaxed(await w.isMaximized());
        off = await w.onResized(async () => {
          try {
            setMaxed(await w.isMaximized());
          } catch {
            /* ignorar */
          }
        });
      } catch {
        /* sin API de ventana: se queda la franja sin botones */
      }
    })();
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  if (!custom) return null;

  const run = async (act: 'minimize' | 'toggleMaximize' | 'close') => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow()[act]();
    } catch {
      /* ignorar */
    }
  };

  return (
    <div className="wc" role="group" aria-label="Controles de la ventana">
      <button type="button" className="wc-btn" onClick={() => void run('minimize')} aria-label="Minimizar" title="Minimizar">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button
        type="button"
        className="wc-btn"
        onClick={() => void run('toggleMaximize')}
        aria-label={maxed ? 'Restaurar' : 'Maximizar'}
        title={maxed ? 'Restaurar' : 'Maximizar'}
      >
        {maxed ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor"><rect x="0.5" y="2.5" width="7" height="7" /><path d="M2.5 2.5v-2h7v7h-2" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
        )}
      </button>
      <button type="button" className="wc-btn wc-close" onClick={() => void run('close')} aria-label="Cerrar ventana" title="Cerrar">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  );
}
