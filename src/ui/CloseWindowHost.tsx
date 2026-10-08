import { useEffect, useRef, useState } from 'react';
import { flushSave } from '../io/autosave';
import { isTauri } from '../io/nativeSave';
import { getSaveStatus } from '../io/saveStatus';
import { CloseWindowDialog } from './CloseWindowDialog';
import { createCloseController, registerCloseGuard } from './windowClose';

// Un guardado fallido pierde cambios al cerrar la ventana.
registerCloseGuard(() => (getSaveStatus().state === 'error' ? 'Hay cambios que no se pudieron guardar en este equipo.' : null));

/**
 * Único punto de cierre de la ventana de escritorio. Escucha `onCloseRequested`, así que
 * Alt+F4, la barra de tareas, el menú del sistema y el ✕ propio (que llama a `close()`)
 * pasan por la misma confirmación. En web/PWA/Android no hace nada.
 */
export function CloseWindowHost() {
  const ctl = useRef<ReturnType<typeof createCloseController> | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let dead = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const w = getCurrentWindow();
        const c = createCloseController({ flush: flushSave, destroy: () => w.destroy() });
        const unsub = c.subscribe(() => setPending(c.getPending()));
        const un = await w.onCloseRequested((e) => c.request(e));
        if (dead) {
          un();
          unsub();
          return;
        }
        ctl.current = c;
        off = () => {
          un();
          unsub();
        };
      } catch {
        /* sin API de ventana: se queda el cierre nativo */
      }
    })();
    return () => {
      dead = true;
      off?.();
      ctl.current = null;
    };
  }, []);

  if (!pending) return null;
  return <CloseWindowDialog reasons={pending} onCancel={() => ctl.current?.cancel()} onForce={() => void ctl.current?.confirm()} />;
}
