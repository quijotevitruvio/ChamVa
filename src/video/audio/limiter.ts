// Limitador de pico real (true peak) con anticipación. Detecta con el mismo sobremuestreo ×4 que el
// medidor (TruePeakDetector), calcula la ganancia necesaria por muestra, toma el mínimo de las
// últimas `lookahead` muestras (así la bajada empieza ANTES de la cresta), la relaja despacio y la
// suaviza con una media móvil de `lookahead` muestras. Esa composición garantiza G[j] ≤ necesaria[j]
// en cada muestra: el pico real de la salida queda por debajo del techo.
//
// Latencia fija de `latency` muestras: la salida n corresponde a la entrada n − latency. El mezclador
// de la exportación la compensa (lee `latency` muestras por delante); la vista previa la deja (≈ 2,5 ms).
import { TruePeakDetector, fromDb } from './loudness';

const RING = 512; // potencia de 2 ≥ lookahead + retardo del detector + holgura
const MASK = RING - 1;

export class TruePeakLimiter {
  readonly lookahead: number;
  readonly latency: number;
  readonly ceiling: number;
  private detL = new TruePeakDetector();
  private detR = new TruePeakDetector();
  private xL = new Float32Array(RING);
  private xR = new Float32Array(RING);
  private req = new Float32Array(RING).fill(1); // ganancia necesaria
  private rel = new Float32Array(RING).fill(1); // tras mínimo y relajación
  private n = 0; // muestras recibidas
  private relPrev = 1;
  private sum = 0; // suma de `rel` en la ventana
  private readonly k: number;
  peakIn = 0;
  peakOut = 0;
  /** muestras en las que la ganancia fue menor que 1 */
  reduced = 0;
  /** menor ganancia aplicada (lineal) */
  minGain = 1;

  /**
   * @param ceilingDb techo del pico real (dBTP)
   * @param lookahead muestras de anticipación (≈ 2,5 ms a 48 kHz)
   * @param release s de relajación
   */
  constructor(sampleRate: number, ceilingDb = -1.3, lookahead = 120, release = 0.12) {
    this.ceiling = fromDb(ceilingDb);
    this.lookahead = Math.max(2, Math.min(lookahead, 300));
    this.latency = this.lookahead + TruePeakDetector.TAPS - 2;
    this.k = 1 - Math.exp(-1 / (release * sampleRate));
    this.sum = this.lookahead; // ventana inicial llena de unos
  }

  process(L: Float32Array, R: Float32Array, n = L.length) {
    const D = this.lookahead;
    const TAPS = TruePeakDetector.TAPS;
    const lat = this.latency;
    const c = this.ceiling;
    for (let i = 0; i < n; i++) {
      let l = L[i];
      let r = R[i];
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > this.peakIn) this.peakIn = al;
      if (ar > this.peakIn) this.peakIn = ar;
      const idx = this.n;
      this.xL[idx & MASK] = l;
      this.xR[idx & MASK] = r;
      // pico real del instante idx − DELAY
      const tp = Math.max(this.detL.push(l), this.detR.push(r));
      const m = idx - TruePeakDetector.DELAY;
      let rq = 1;
      if (m >= 0 && tp > c) rq = c / tp;
      // la ganancia necesaria se asocia al instante m
      const mi = m & MASK;
      this.req[mi] = m >= 0 ? rq : 1;
      // La salida j usa ganancias de j..j+D−1; cada ganancia debe cubrir los picos de los intervalos que usan su muestra
      // (el interpolador mira TAPS/2 atrás y TAPS/2 − 1 delante): mínimo de la necesidad en [m − D − TAPS + 2, m].
      let mn = 1;
      for (let j = 0; j < D + TAPS - 1; j++) {
        const v = this.req[(m - j) & MASK];
        if (m - j >= 0 && v < mn) mn = v;
      }
      const q = m - (TAPS / 2 - 1); // índice de ganancia
      const qi = q & MASK;
      // relajación: baja al instante, sube despacio
      const rl = Math.min(mn, this.relPrev + (1 - this.relPrev) * this.k);
      this.relPrev = rl;
      const old = this.rel[(q - D) & MASK];
      this.rel[qi] = rl;
      this.sum += rl - (q - D >= 0 ? old : 1);
      // ganancia de salida del instante j = q − D + 1 (media de rel[j .. q])
      const g = Math.min(1, this.sum / D);
      const j = idx - lat;
      let ol = 0;
      let or = 0;
      if (j >= 0) {
        ol = this.xL[j & MASK] * g;
        or = this.xR[j & MASK] * g;
        // seguro final: nunca por encima del techo en muestra
        if (ol > c) ol = c;
        else if (ol < -c) ol = -c;
        if (or > c) or = c;
        else if (or < -c) or = -c;
        if (g < 1) this.reduced++;
        if (g < this.minGain) this.minGain = g;
      }
      const po = Math.max(ol < 0 ? -ol : ol, or < 0 ? -or : or);
      if (po > this.peakOut) this.peakOut = po;
      L[i] = ol;
      R[i] = or;
      this.n++;
    }
  }
}
