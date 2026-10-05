import { useEffect, useState } from 'react';
import { isTauri } from '../io/nativeSave';
import { getSaveStatus } from '../io/saveStatus';
import { t } from '../i18n';
import { CloseWindowDialog } from './CloseWindowDialog';
import { shouldShowWindowControls } from './titlebarLogic';
import { closeReasons, registerCloseGuard } from './windowClose';

// Un guardado fallido pierde cambios al cerrar la ventana.
registerCloseGuard(() => (getSaveStatus().state === 'error' ? 'Hay cambios que no se pudieron guardar en este equipo.' : null));

/**
 * Botones − ▢ ✕ propios, solo cuando la ventana nativa no tiene decoraciones
 * (Windows: `src-tauri/tauri.windows.conf.json`). En web, Android, macOS y Linux no se pinta nada.
 */
export function WindowControls() {
  const [custom, setCustom] = useState(false);
  const [maxed, setMaxed] = useState(false);
  const [ask, setAsk] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let dead = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const w = getCurrentWindow();
        if (!shouldShowWindowControls(true, await w.isDecorated())) return;
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
    if (act === 'close') {
      const reasons = closeReasons();
      if (reasons.length) return setAsk(reasons);
    }
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      await w[act]();
      // el icono sigue al estado real aunque el evento de redimensionado llegue tarde
      if (act === 'toggleMaximize') setMaxed(await w.isMaximized());
    } catch {
      /* ignorar */
    }
  };

  return (
    <div className="wc" role="group" aria-label={t('Controles de la ventana')}>
      <button type="button" className="wc-btn" onClick={() => void run('minimize')} aria-label={t('Minimizar')} title={t('Minimizar')}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button
        type="button"
        className="wc-btn"
        onClick={() => void run('toggleMaximize')}
        aria-label={maxed ? t('Restaurar') : t('Maximizar')}
        title={maxed ? t('Restaurar') : t('Maximizar')}
      >
        {maxed ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor"><rect x="0.5" y="2.5" width="7" height="7" /><path d="M2.5 2.5v-2h7v7h-2" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
        )}
      </button>
      <button type="button" className="wc-btn wc-close" onClick={() => void run('close')} aria-label={t('Cerrar ChamVa')} title={t('Cerrar ChamVa')}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      {ask && (
        <CloseWindowDialog
          reasons={ask}
          onCancel={() => setAsk(null)}
          onForce={() => {
            setAsk(null);
            void (async () => {
              try {
                const { getCurrentWindow } = await import('@tauri-apps/api/window');
                await getCurrentWindow().close();
              } catch {
                /* ignorar */
              }
            })();
          }}
        />
      )}
    </div>
  );
}
