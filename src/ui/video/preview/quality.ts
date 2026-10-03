// Calidad de la vista previa: lado corto del lienzo (720 / 540 / 360 px) y selección automática.
// En «Auto» arranca en 720 y baja un escalón si el tiempo de trabajo por fotograma supera el
// presupuesto 1/fps; sube de nuevo solo tras un buen rato holgado (histéresis, para no oscilar).
export type QualityMode = 'auto' | 'high' | 'medium' | 'low';

export const QUALITY_MODES: { id: QualityMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'high', label: 'Alta (720p)' },
  { id: 'medium', label: 'Media (540p)' },
  { id: 'low', label: 'Baja (360p)' },
];

/** Lados cortos de mayor a menor calidad. */
export const QUALITY_LEVELS = [720, 540, 360] as const;
const FIXED: Record<Exclude<QualityMode, 'auto'>, number> = { high: 0, medium: 1, low: 2 };

export const isQualityMode = (s: unknown): s is QualityMode => s === 'auto' || s === 'high' || s === 'medium' || s === 'low';

export interface QualityOptions {
  fps: number;
  /** fotogramas medidos antes de decidir bajar */
  downWindow?: number;
  /** fotogramas holgados seguidos antes de subir */
  upWindow?: number;
  /** fracción del presupuesto por debajo de la cual se considera holgado */
  upRatio?: number;
  /** fotogramas mínimos entre un cambio y el siguiente */
  cooldown?: number;
}

export class QualityController {
  private _mode: QualityMode;
  private idx = 0;
  private sum = 0;
  private count = 0;
  private calm = 0;
  private since = Infinity;
  private o: Required<QualityOptions>;
  /** cuántas veces bajó sola (diagnóstico) */
  downs = 0;

  constructor(mode: QualityMode, opts: QualityOptions) {
    this._mode = mode;
    this.o = { downWindow: 12, upWindow: 150, upRatio: 0.4, cooldown: 90, ...opts };
    this.idx = mode === 'auto' ? 0 : FIXED[mode];
  }

  get mode() {
    return this._mode;
  }
  get level() {
    return this.idx;
  }
  /** lado corto actual en px */
  get shortSide(): number {
    return QUALITY_LEVELS[this.idx];
  }
  /** «vista previa reducida»: en Auto, ha bajado del máximo por falta de potencia */
  get reducedByAuto() {
    return this._mode === 'auto' && this.idx > 0;
  }
  /** presupuesto por fotograma (ms) */
  get budgetMs() {
    return 1000 / this.o.fps;
  }

  setMode(m: QualityMode) {
    this._mode = m;
    this.idx = m === 'auto' ? 0 : FIXED[m];
    this.reset();
  }

  setFps(fps: number) {
    this.o.fps = Math.max(1, fps);
    this.reset();
  }

  private reset() {
    this.sum = 0;
    this.count = 0;
    this.calm = 0;
    this.since = 0;
  }

  /** Registra el tiempo de trabajo (ms) de un fotograma. Devuelve true si cambió el nivel. */
  record(workMs: number): boolean {
    if (this._mode !== 'auto') return false;
    this.since++;
    const budget = this.budgetMs;
    this.sum += workMs;
    this.count++;
    this.calm = workMs < budget * this.o.upRatio ? this.calm + 1 : 0;
    if (this.count >= this.o.downWindow) {
      const avg = this.sum / this.count;
      this.sum = 0;
      this.count = 0;
      if (avg > budget && this.idx < QUALITY_LEVELS.length - 1) {
        this.idx++;
        this.downs++;
        this.since = 0;
        this.calm = 0;
        return true;
      }
    }
    if (this.calm >= this.o.upWindow && this.idx > 0 && this.since >= this.o.cooldown) {
      this.idx--;
      this.since = 0;
      this.calm = 0;
      this.sum = 0;
      this.count = 0;
      return true;
    }
    return false;
  }
}
