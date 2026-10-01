// PWA instalable (solo la versión web): registro del service worker y aviso
// «Instalar ChamVa». En Tauri (escritorio/Android), en desarrollo o en
// protocolos que no son http(s) NO se registra nada y no hay errores.
import { isTauri } from './nativeSave';

// Evento no estándar de Chromium; se guarda para lanzarlo desde el menú.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export const canInstallPwa = () => deferred !== null;

export function onInstallAvailability(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  const ev = deferred;
  if (!ev) return false;
  deferred = null;
  notify();
  try {
    await ev.prompt();
    return (await ev.userChoice).outcome === 'accepted';
  } catch {
    return false;
  }
}

export function registerServiceWorker() {
  try {
    if (!import.meta.env.PROD) return;
    if (isTauri()) return;
    if (!/^https?:$/.test(location.protocol)) return;
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e as InstallPromptEvent;
      notify();
    });
    window.addEventListener('appinstalled', () => {
      deferred = null;
      notify();
    });

    const base = import.meta.env.BASE_URL; // '/' o '/app/'
    // Tras el primer render, para no competir con el arranque.
    const go = () =>
      navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch((err) => {
        console.warn('[PWA] no se pudo registrar el service worker', err);
      });
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  } catch (err) {
    console.warn('[PWA]', err);
  }
}
