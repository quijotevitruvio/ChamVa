// Registro mínimo de importaciones HEIC en curso, para el botón Cancelar del indicador
// «Procesando…». Aparte de index.ts para no meter el decodificador en el bundle principal.
const active = new Set<() => void>();

export function registerHeicCancel(fn: () => void): () => void {
  active.add(fn);
  return () => active.delete(fn);
}

/** Cancela todas las importaciones HEIC en curso. */
export function cancelHeicImports() {
  for (const fn of [...active]) fn();
}
