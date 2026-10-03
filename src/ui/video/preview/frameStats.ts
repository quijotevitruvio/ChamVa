// Estadísticas de la vista previa: fps real, tiempo de trabajo por fotograma y fotogramas
// descartados (cuando el reloj avanza más de lo que se alcanza a pintar).
export class FrameStats {
  private stamps: number[] = [];
  private work: number[] = [];
  /** fotogramas pintados en total */
  presented = 0;
  /** fotogramas que no se llegaron a pintar (el audio manda: se salta al instante actual) */
  dropped = 0;
  private last = -1;

  constructor(private targetFps = 30) {}

  setTarget(fps: number) {
    this.targetFps = Math.max(1, fps);
  }

  /** `now` en ms (rAF), `workMs` lo que tardó componer ese fotograma. */
  onPresent(now: number, workMs: number) {
    this.presented++;
    if (this.last >= 0) {
      const period = 1000 / this.targetFps;
      const dt = now - this.last;
      if (dt > period * 1.5) this.dropped += Math.max(0, Math.round(dt / period) - 1);
    }
    this.last = now;
    this.stamps.push(now);
    this.work.push(workMs);
    if (this.stamps.length > 240) {
      this.stamps.shift();
      this.work.shift();
    }
  }

  /** Pausa/seek: el siguiente fotograma no cuenta como atraso. */
  resetGap() {
    this.last = -1;
  }

  /** fps real sobre la última ventana (ms) */
  fps(now: number, windowMs = 1000): number {
    let n = 0;
    for (let i = this.stamps.length - 1; i >= 0 && now - this.stamps[i] <= windowMs; i--) n++;
    return (n * 1000) / windowMs;
  }

  avgWorkMs(last = 30): number {
    const w = this.work.slice(-last);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0;
  }

  get droppedRatio() {
    const tot = this.presented + this.dropped;
    return tot ? this.dropped / tot : 0;
  }

  reset() {
    this.stamps = [];
    this.work = [];
    this.presented = 0;
    this.dropped = 0;
    this.last = -1;
  }
}
