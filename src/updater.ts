// Auto-actualizador (solo app instalada de escritorio). Consulta latest.json
// del último release de GitHub; si hay versión nueva, la descarga, la instala
// y reinicia la app. Firmado con la clave del updater (minisign).
import { isTauri } from './io/nativeSave';

export interface UpdateInfo {
  version: string;
  notes?: string;
  install: (onProgress: (ratio: number) => void) => Promise<void>;
}

const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent);

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri() || isMobile()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? undefined,
    install: async (onProgress) => {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') {
          done += ev.data.chunkLength;
          onProgress(total ? Math.min(0.99, done / total) : 0);
        } else if (ev.event === 'Finished') onProgress(1);
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}
