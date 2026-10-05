// Historial de pasos con nombre del editor de recorte (lógica pura).
// Guarda parches (diferencias de la región tocada), no imágenes: la memoria queda acotada
// por un máximo de pasos Y un máximo de bytes; al pasarse se descartan los pasos MÁS ANTIGUOS.

export interface HistoryEntry<P> {
  label: string;
  patch: P;
  bytes: number;
}

export interface HistoryLimits {
  maxSteps: number;
  maxBytes: number;
}

export const DEFAULT_LIMITS: HistoryLimits = { maxSteps: 80, maxBytes: 160 * 1024 * 1024 };

export class StepHistory<P> {
  entries: HistoryEntry<P>[] = [];
  /** Nº de pasos aplicados: 0 = estado inicial. */
  cursor = 0;
  /** Cuántos pasos antiguos se descartaron por el límite. */
  dropped = 0;
  private bytes = 0;

  constructor(private limits: HistoryLimits = DEFAULT_LIMITS) {}

  get canUndo(): boolean {
    return this.cursor > 0;
  }
  get canRedo(): boolean {
    return this.cursor < this.entries.length;
  }
  get totalBytes(): number {
    return this.bytes;
  }
  /** ¿Hay cambios respecto al estado con el que se abrió el editor? */
  get changed(): boolean {
    return this.cursor > 0 || this.dropped > 0;
  }

  /** Añade un paso; lo rehacible se descarta. */
  push(label: string, patch: P, bytes: number): void {
    for (const e of this.entries.splice(this.cursor)) this.bytes -= e.bytes;
    this.entries.push({ label, patch, bytes });
    this.bytes += bytes;
    this.cursor = this.entries.length;
    while (
      this.entries.length > 1 &&
      (this.entries.length > this.limits.maxSteps || this.bytes > this.limits.maxBytes)
    ) {
      const e = this.entries.shift()!;
      this.bytes -= e.bytes;
      this.cursor--;
      this.dropped++;
    }
  }

  undo(): HistoryEntry<P> | null {
    if (!this.canUndo) return null;
    this.cursor--;
    return this.entries[this.cursor];
  }

  redo(): HistoryEntry<P> | null {
    if (!this.canRedo) return null;
    return this.entries[this.cursor++];
  }

  /**
   * Salta al estado «tras `target` pasos» (0 = inicial). Devuelve los pasos a deshacer
   * (del más nuevo al más viejo) y a rehacer (del más viejo al más nuevo), en el orden de aplicación.
   */
  jump(target: number): { undo: HistoryEntry<P>[]; redo: HistoryEntry<P>[] } {
    const t = Math.max(0, Math.min(this.entries.length, Math.floor(target)));
    const undo: HistoryEntry<P>[] = [];
    const redo: HistoryEntry<P>[] = [];
    for (let i = this.cursor - 1; i >= t; i--) undo.push(this.entries[i]);
    for (let i = this.cursor; i < t; i++) redo.push(this.entries[i]);
    this.cursor = t;
    return { undo, redo };
  }

  labels(): string[] {
    return this.entries.map((e) => e.label);
  }
}
