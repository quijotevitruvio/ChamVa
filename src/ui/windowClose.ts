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

/* ---------- Controlador del cierre (cualquier origen: ✕ propio, Alt+F4, barra de tareas, sistema) ---------- */

export interface CloseEventLike {
  preventDefault: () => void;
}

export interface CloseControllerDeps {
  /** Motivos que exigen confirmación (por defecto, las guardas registradas). */
  reasons?: () => string[];
  /** Guarda lo pendiente; resuelve `false` si falló. Con tope de tiempo propio. */
  flush?: () => Promise<boolean>;
  /** Cierra la ventana SIN volver a emitir «close-requested» (destroy). */
  destroy: () => Promise<void> | void;
  /** Tope para el guardado previo al cierre, ms. */
  flushTimeoutMs?: number;
}

/**
 * Decide qué hacer ante una petición de cierre. Sin motivos: guarda y deja cerrar (el
 * llamante destruye la ventana al no haber `preventDefault`). Con motivos: cancela el cierre
 * y publica los motivos para el diálogo; «confirm» destruye la ventana directamente (sin
 * pasar otra vez por la petición, así no hay bucle) y «cancel» la mantiene.
 */
export function createCloseController(deps: CloseControllerDeps) {
  const getReasons = deps.reasons ?? closeReasons;
  const timeout = deps.flushTimeoutMs ?? 2000;
  let pending: string[] | null = null;
  let closing = false;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());

  const flushSafe = async () => {
    if (!deps.flush) return;
    try {
      await Promise.race([deps.flush(), new Promise<void>((r) => setTimeout(r, timeout))]);
    } catch {
      /* un guardado roto no impide decidir */
    }
  };

  return {
    /** Manejador de `onCloseRequested`. */
    async request(e: CloseEventLike): Promise<void> {
      if (closing) return; // ya se confirmó: que cierre
      if (pending) {
        // diálogo ya abierto (Alt+F4 repetido): no se duplica
        e.preventDefault();
        return;
      }
      // Se evita el cierre mientras se guarda y se decide: si no hace falta preguntar, se destruye después.
      e.preventDefault();
      await flushSafe();
      const reasons = getReasons();
      if (reasons.length) {
        pending = reasons;
        emit();
        return;
      }
      closing = true;
      await deps.destroy();
    },
    async confirm(): Promise<void> {
      pending = null;
      closing = true;
      emit();
      await flushSafe();
      await deps.destroy();
    },
    cancel(): void {
      pending = null;
      emit();
    },
    getPending: () => pending,
    subscribe(f: () => void): () => void {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}

export type CloseController = ReturnType<typeof createCloseController>;
