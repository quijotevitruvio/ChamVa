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
    defaultPath: joinPath(getLastDir(), filename),
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
  });
  if (!path) return { status: 'cancelled' };
  await writeFile(path, bytes);
  setLastDir(dirOf(path));
  emitSaved(path);
  return { status: 'saved', path };
}

// ---- carpeta recordada y «Abrir carpeta» (solo app instalada) ----
const LAST_DIR_KEY = 'chamva.lastSaveDir';

export function dirOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '');
}
export function joinPath(dir: string | null, name: string): string {
  if (!dir) return name;
  return dir + (dir.includes('\\') ? '\\' : '/') + name;
}
export function getLastDir(): string | null {
  try {
    return localStorage.getItem(LAST_DIR_KEY);
  } catch {
    return null;
  }
}
function setLastDir(dir: string) {
  try {
    if (dir) localStorage.setItem(LAST_DIR_KEY, dir);
  } catch {
    /* noop */
  }
}

/** Para archivos escritos por trozos fuera de saveNative (exportación de video): recuerda la carpeta y avisa. */
export function rememberSaved(path: string) {
  setLastDir(dirOf(path));
  emitSaved(path);
}

// Aviso de «guardado» para que la interfaz ofrezca «Abrir carpeta».
const savedListeners = new Set<(path: string) => void>();
export function onSaved(fn: (path: string) => void): () => void {
  savedListeners.add(fn);
  return () => {
    savedListeners.delete(fn);
  };
}
function emitSaved(path: string) {
  savedListeners.forEach((f) => f(path));
}

// Muestra el archivo en el explorador del sistema (plugin opener, permiso opener:default).
export async function revealSaved(path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}
