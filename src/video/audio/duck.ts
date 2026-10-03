// Ducking automático (sidechain): la pista de música baja `db` dB mientras suena voz en otras pistas.
// Detector de envolvente (ataque rápido / relajación lenta) sobre la mezcla mono de la señal de
// control; por encima del umbral se activa y se mantiene `hold` s tras la última voz (sin bombeo
// entre palabras); la ganancia se suaviza con `attack` y `release`.
import { fromDb } from './loudness';

export interface DuckSpec {
  on: boolean;
  /** cuántos dB baja la pista (0..40) */
  db: number;
  /** umbral de la señal de control, dBFS (−60..−5) */
  thr: number;
  /** ms que tarda en bajar */
  attack: number;
  /** ms que tarda en volver */
  release: number;
  /** ms que se mantiene bajada tras acabar la voz */
  hold: number;
  /** ids de pistas que la activan; sin definir = todas las demás */
  by?: string[];
}

export const DEFAULT_DUCK: DuckSpec = { on: false, db: 12, thr: -38, attack: 30, release: 400, hold: 250 };

export class DuckEnvelope {
  private det = 0; // envolvente del detector (lineal)
  private gain = 1;
  private holdLeft = 0;
  private readonly aDet: number;
  private readonly rDet: number;
  private readonly aGain: number;
  private readonly rGain: number;
  private readonly thr: number;
  private readonly target: number;
  private readonly holdSamples: number;
  private minGain = 1;
  /** reducción de ganancia mínima alcanzada (dB, ≤ 0) */
  get minGainDb(): number {
    return 20 * Math.log10(Math.max(this.minGain, 1e-6));
  }

  constructor(spec: DuckSpec, sampleRate: number) {
    const k = (ms: number) => Math.exp(-1 / Math.max(1, (ms / 1000) * sampleRate));
    this.aDet = k(2);
    this.rDet = k(40);
    this.aGain = k(Math.max(1, spec.attack));
    this.rGain = k(Math.max(1, spec.release));
    this.thr = fromDb(spec.thr);
    this.target = fromDb(-Math.abs(spec.db));
    this.holdSamples = Math.round((Math.max(0, spec.hold) / 1000) * sampleRate);
  }

  /**
   * Multiplica L/R por la ganancia de ducking calculada con la señal de control (kL, kR), que puede ser
   * `null` (sin voz: la ganancia vuelve a 1).
   */
  process(L: Float32Array, R: Float32Array, kL: Float32Array | null, kR: Float32Array | null, n = L.length) {
    for (let i = 0; i < n; i++) {
      const key = kL && kR ? Math.abs(kL[i] + kR[i]) * 0.5 : 0;
      this.det = key > this.det ? this.aDet * this.det + (1 - this.aDet) * key : this.rDet * this.det + (1 - this.rDet) * key;
      if (this.det > this.thr) this.holdLeft = this.holdSamples;
      else if (this.holdLeft > 0) this.holdLeft--;
      const active = this.det > this.thr || this.holdLeft > 0;
      const tgt = active ? this.target : 1;
      const c = tgt < this.gain ? this.aGain : this.rGain;
      this.gain = c * this.gain + (1 - c) * tgt;
      if (this.gain < this.minGain) this.minGain = this.gain;
      L[i] *= this.gain;
      R[i] *= this.gain;
    }
  }

  get currentGain(): number {
    return this.gain;
  }
}
