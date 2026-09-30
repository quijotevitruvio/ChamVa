import { isTauri } from './nativeSave';

// Abre un enlace en el navegador del sistema. En la app instalada un
// <a target="_blank"> no sale del WebView, así que se usa el plugin opener.
export async function openExternal(url: string) {
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      /* cae al window.open */
    }
  }
  window.open(url, '_blank', 'noopener');
}

/** onClick para <a href>: abre fuera y evita la navegación del WebView. */
export const externalClick = (e: { preventDefault: () => void; currentTarget: { href: string } }) => {
  e.preventDefault();
  openExternal(e.currentTarget.href);
};
