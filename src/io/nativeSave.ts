// Guardado nativo dentro de la app instalada (Tauri).
// El truco web de <a download> con blob: no funciona en WKWebView (macOS) ni en
// el WebView de Android, así que ahí escribimos el archivo con los plugins
// dialog (Guardar como…) y fs. En el navegador se sigue usando el <a download>.

export const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent);

export type SaveResult =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' };

export async function saveNative(
  blob: Blob,
  filename: string,
): Promise<SaveResult> {
  const { writeFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (isMobile()) {
    // Sin diálogo de guardado en móvil: va a Descargas/ChamVa/.
    await mkdir('ChamVa', {
      baseDir: BaseDirectory.Download,
      recursive: true,
    }).catch(() => {});
    await writeFile(`ChamVa/${filename}`, bytes, {
      baseDir: BaseDirectory.Download,
    });
    return { status: 'saved', path: `Descargas/ChamVa/${filename}` };
  }

  const { save } = await import('@tauri-apps/plugin-dialog');
  const ext = filename.includes('.') ? filename.split('.').pop()! : '';
  const path = await save({
    defaultPath: filename,
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
  });
  if (!path) return { status: 'cancelled' };
  await writeFile(path, bytes);
  return { status: 'saved', path };
}
