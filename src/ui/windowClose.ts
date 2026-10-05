/**
 * Guardas del cierre de la ventana (botón ✕ de la franja propia).
 * Cada parte de la app que tenga algo que perder registra una función que devuelve el
 * motivo (texto) o null; si hay alguno, se pide confirmación antes de cerrar.
 */
export type CloseGuard = () => string | null;

const guards = new Set<CloseGuard>();

export function registerCloseGuard(g: CloseGuard): () => void {
  guards.add(g);
  return () => {
    guards.delete(g);
  };
}

export function closeReasons(): string[] {
  const out: string[] = [];
  for (const g of guards) {
    try {
      const r = g();
      if (r) out.push(r);
    } catch {
      /* una guarda rota no impide cerrar */
    }
  }
  return out;
}
