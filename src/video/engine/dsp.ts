// Procesado de audio en bloques (puro, sin Web Audio): permite mezclar la
// exportación en streaming —sin tener todo el audio en memoria como hacía
// OfflineAudioContext— y probar cada pieza con números en Vitest.
//
// Las piezas imitan los nodos que usa la vista previa del editor (BiquadFilter
// con la semántica de Web Audio, compuerta, eco y compresor) para que lo que se
// oye al previsualizar sea lo que sale; y al final siempre va un limitador
// (V7: de pico real, −1 dBTP). Este mismo código corre en la exportación (mixer.ts)
// y en la vista previa en vivo (liveDsp.ts → AudioWorklet).
import { Biquad } from '../audio/biquad';
import { DuckEnvelope, type DuckSpec } from '../audio/duck';
import { SpectralDenoiser } from '../audio/denoise';
import { ParametricEq, type EqBand } from '../audio/eq';
import { TruePeakLimiter } from '../audio/limiter';
import { fromDb } from '../audio/loudness';
import { applyPan } from '../audio/pan';

export { Biquad, type BiquadType } from '../audio/biquad';

export const LIMIT_CEILING = Math.pow(10, -1 / 20); // −1 dBFS ≈ 0,891
/**
 * Techo del pico real del limitador final. El archivo debe quedar por debajo de −1 dBTP (BS.1770 / EBU R128) DESPUÉS del códec:
 * el medidor propio lee hasta 0,3 dB de menos cerca de Nyquist y al decodificar AAC el pico sube ~0,3 dB (−1,3 → −0,99 medido)
 * y Opus hasta ~0,7 dB con material limitado (−1,7 → −1,04). Con −2,2 dBTP, medido en el archivo decodificado: Opus −1,30, AAC −2,06 y WAV −1,9.
 * Es UN solo techo para vista previa y exportación (con dos, el sonido limitado de la vista previa no sería el de la exportación).
 */
export const TRUE_PEAK_CEILING_DB = -2.2;
/** Techo de las exportaciones con códec con pérdida: el mismo que la vista previa (ver TRUE_PEAK_CEILING_DB). */
export const TRUE_PEAK_LOSSY_CEILING_DB = TRUE_PEAK_CEILING_DB;

/**
 * Compuerta de ruido como la de la vista previa: mide el RMS (mono) de los
 * últimos 1024 muestras; por encima de 0,025 abre (1), por debajo cierra (0,02),
 * con transición exponencial de 50 ms (setTargetAtTime).
 */
export class NoiseGate {
  static readonly THRESHOLD = 0.025;
  static readonly CLOSED = 0.02;
  private win = new Float32Array(1024);
  private wpos = 0;
  private sumSq = 0;
  private gain = 1;
  private target = 1;
  private sinceEval = 0;
  private readonly k: number;

  constructor(sampleRate: number) {
    this.k = 1 - Math.exp(-1 / (0.05 * sampleRate));
  }

  process(L: Float32Array, R: Float32Array, n = L.length) {
    const win = this.win;
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5;
      const old = win[this.wpos];
      this.sumSq += m * m - old * old;
      win[this.wpos] = m;
      this.wpos = (this.wpos + 1) & 1023;
      if (++this.sinceEval >= 128) {
        this.sinceEval = 0;
        const rms = Math.sqrt(Math.max(0, this.sumSq) / 1024);
        this.target = rms > NoiseGate.THRESHOLD ? 1 : NoiseGate.CLOSED;
      }
      this.gain += (this.target - this.gain) * this.k;
      L[i] *= this.gain;
      R[i] *= this.gain;
    }
  }
}

/** Eco: retardo de 0,28 s con realimentación 0,35 (mismo grafo que la exportación anterior). */
export class Echo {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private pos = 0;
  constructor(sampleRate: number, private amount: number, delay = 0.28, private feedback = 0.35) {
    const d = Math.max(1, Math.round(delay * sampleRate));
    this.bufL = new Float32Array(d);
    this.bufR = new Float32Array(d);
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    const d = this.bufL.length;
    for (let i = 0; i < n; i++) {
      const outL = this.bufL[this.pos];
      const outR = this.bufR[this.pos];
      // entrada de la línea = eco·x + realimentación·salida
      this.bufL[this.pos] = L[i] * this.amount + outL * this.feedback;
      this.bufR[this.pos] = R[i] * this.amount + outR * this.feedback;
      L[i] += outL;
      R[i] += outR;
      this.pos = this.pos + 1 === d ? 0 : this.pos + 1;
    }
  }
}

/**
 * Compresor con rodilla suave (umbral −24 dB, 4:1, rodilla 30 dB, ataque 3 ms,
 * relajación 250 ms) y ganancia de compensación automática como la de
 * DynamicsCompressorNode: (1 / curva(0 dBFS))^0,6. Es el «Normalizar» del editor.
 */
export class Compressor {
  private env = 0; // reducción de ganancia actual (dB, ≤ 0)
  private readonly att: number;
  private readonly rel: number;
  private readonly makeup: number;
  constructor(sampleRate: number, private threshold = -24, private ratio = 4, private knee = 30) {
    this.att = Math.exp(-1 / (0.003 * sampleRate));
    this.rel = Math.exp(-1 / (0.25 * sampleRate));
    const full = this.curve(0); // dB de salida para 0 dBFS de entrada
    this.makeup = Math.pow(1 / Math.pow(10, full / 20), 0.6);
  }
  curve(xDb: number): number {
    const { threshold: T, ratio: R, knee: K } = this;
    if (xDb < T - K / 2) return xDb;
    if (xDb > T + K / 2) return T + (xDb - T) / R;
    const d = xDb - T + K / 2;
    return xDb + ((1 / R - 1) * d * d) / (2 * K);
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    for (let i = 0; i < n; i++) {
      const peak = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      const xDb = peak > 1e-9 ? 20 * Math.log10(peak) : -180;
      const gr = this.curve(xDb) - xDb; // ≤ 0
      const coef = gr < this.env ? this.att : this.rel;
      this.env = coef * this.env + (1 - coef) * gr;
      const g = Math.pow(10, this.env / 20) * this.makeup;
      L[i] *= g;
      R[i] *= g;
    }
  }
}

/**
 * Limitador de pico de muestra sin latencia (el de V1–V6): si una muestra superaría el techo, la ganancia
 * baja al instante justo lo necesario y se recupera en ~100 ms. Se conserva para pruebas y para quien no
 * necesite la anticipación; la cadena maestra usa ahora el de pico real (`TruePeakLimiter`).
 */
export class Limiter {
  private gain = 1;
  private readonly k: number;
  peakIn = 0;
  peakOut = 0;
  reduced = 0; // muestras en las que actuó
  constructor(sampleRate: number, readonly ceiling = LIMIT_CEILING, release = 0.1) {
    this.k = 1 - Math.exp(-1 / (release * sampleRate));
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    const c = this.ceiling;
    for (let i = 0; i < n; i++) {
      let l = L[i];
      let r = R[i];
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;
      const peak = Math.max(Math.abs(l), Math.abs(r));
      if (peak > this.peakIn) this.peakIn = peak;
      const need = peak > c ? c / peak : 1;
      let g = this.gain + (1 - this.gain) * this.k;
      if (need < g) {
        g = need;
        this.reduced++;
      }
      this.gain = g;
      l *= g;
      r *= g;
      // Seguro final contra errores de redondeo.
      if (l > c) l = c;
      else if (l < -c) l = -c;
      if (r > c) r = c;
      else if (r < -c) r = -c;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > this.peakOut) this.peakOut = p;
      L[i] = l;
      R[i] = r;
    }
  }
}

/** Parámetros de audio de un clip (los del efecto «Voz», el volumen y, desde V7, panorámica, ganancia en dB, ecualizador y reducción de ruido). */
export interface ClipAudioFx {
  volume: number;
  hp: number;
  lp: number;
  echo: number;
  gate: boolean;
  /** V7: −1..1, ley de potencia constante (sin definir = centro) */
  pan?: number;
  /** V7: ganancia fija en dB, se suma al volumen */
  gainDb?: number;
  /** V7: ecualizador paramétrico */
  eq?: EqBand[];
  /** V7: intensidad de la reducción de ruido, 0..1 */
  denoise?: number;
}

/** Segundos que sigue sonando la cadena de un clip tras su final (cola del eco y vaciado del reductor de ruido). */
export function fxTail(fx: Pick<ClipAudioFx, 'echo' | 'denoise'>, sampleRate = 48000): number {
  return Math.max(fx.echo > 0 ? 2 : 0, fx.denoise && fx.denoise > 0 ? SpectralDenoiser.LATENCY / sampleRate + 0.02 : 0);
}

/**
 * Cadena por clip, en el mismo orden que la vista previa:
 * paso alto → paso bajo → reducción de ruido → compuerta → ecualizador → volumen·ganancia → (+eco) → panorámica.
 */
export class ClipChain {
  private hp: Biquad;
  private lp: Biquad;
  private denoise: SpectralDenoiser | null;
  private gate: NoiseGate | null;
  private eq: ParametricEq | null;
  private echo: Echo | null;
  private gainLin: number;
  private pan: number;
  constructor(private fx: ClipAudioFx, private sampleRate: number) {
    this.hp = new Biquad('highpass', fx.hp, sampleRate);
    this.lp = new Biquad('lowpass', fx.lp, sampleRate);
    this.denoise = fx.denoise && fx.denoise > 0 ? new SpectralDenoiser(fx.denoise, sampleRate) : null;
    this.gate = fx.gate ? new NoiseGate(sampleRate) : null;
    const eq = fx.eq?.length ? new ParametricEq(fx.eq, sampleRate) : null;
    this.eq = eq && eq.active ? eq : null;
    this.echo = fx.echo > 0 ? new Echo(sampleRate, fx.echo) : null;
    this.gainLin = fx.volume * (fx.gainDb ? fromDb(fx.gainDb) : 1);
    this.pan = fx.pan ?? 0;
  }
  /** Cambia solo el volumen sin perder el estado de la cadena (filtros, compuerta, eco). */
  setVolume(v: number) {
    this.fx = { ...this.fx, volume: v };
    this.gainLin = v * (this.fx.gainDb ? fromDb(this.fx.gainDb) : 1);
  }
  /** Cambia volumen, ganancia en dB y panorámica sin perder el estado. */
  setLevels(volume: number, gainDb: number | undefined, pan: number | undefined) {
    this.fx = { ...this.fx, volume, gainDb, pan };
    this.gainLin = volume * (gainDb ? fromDb(gainDb) : 1);
    this.pan = pan ?? 0;
  }
  /** Muestras de retardo de la salida respecto a la entrada (reductor de ruido). */
  get latency(): number {
    return this.denoise ? SpectralDenoiser.LATENCY : 0;
  }
  /** Segundos de cola que siguen sonando tras el final del clip (eco, reductor de ruido). */
  get tail(): number {
    return fxTail(this.fx, this.sampleRate);
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    this.hp.process(L, 0, n);
    this.hp.process(R, 1, n);
    this.lp.process(L, 0, n);
    this.lp.process(R, 1, n);
    this.denoise?.process(L, R, n);
    this.gate?.process(L, R, n);
    this.eq?.process(L, R, n);
    const v = this.gainLin;
    if (v !== 1)
      for (let i = 0; i < n; i++) {
        L[i] *= v;
        R[i] *= v;
      }
    this.echo?.process(L, R, n);
    if (this.pan) applyPan(L, R, this.pan, n);
  }
}

/** Mezclador de una pista (V7): ecualizador, volumen en dB, ducking por sidechain y panorámica. */
export interface TrackFx {
  gainDb?: number;
  pan?: number;
  eq?: EqBand[];
  duck?: DuckSpec;
}

/** ¿La pista necesita procesado (si no, su bus se suma sin tocar)? */
export const trackHasFx = (fx: TrackFx | undefined): boolean => !!fx && (!!fx.gainDb || !!fx.pan || !!fx.eq?.length || !!fx.duck?.on);

/**
 * Cadena de pista: ecualizador → volumen (dB) → [toma de la señal de control, antes de ducking y panorámica]
 * → ducking (con la señal de control de otras pistas) → panorámica.
 */
export class TrackChain {
  private eq: ParametricEq | null;
  private gain: number;
  private pan: number;
  private duck: DuckEnvelope | null;
  private duckKey: string;
  /** picos del bloque procesado (lineal), para el medidor */
  peakL = 0;
  peakR = 0;
  constructor(private fx: TrackFx, sampleRate: number) {
    const eq = fx.eq?.length ? new ParametricEq(fx.eq, sampleRate) : null;
    this.eq = eq && eq.active ? eq : null;
    this.gain = fx.gainDb ? fromDb(fx.gainDb) : 1;
    this.pan = fx.pan ?? 0;
    this.duck = fx.duck?.on ? new DuckEnvelope(fx.duck, sampleRate) : null;
    this.duckKey = duckSig(fx.duck);
  }
  get ducking(): boolean {
    return !!this.duck;
  }
  /** Menor ganancia de ducking alcanzada (dB, ≤ 0). */
  get minDuckDb(): number {
    return this.duck ? this.duck.minGainDb : 0;
  }
  /** Cambia volumen y panorámica sin reconstruir (los filtros y el ducking conservan su estado). */
  setLevels(gainDb: number | undefined, pan: number | undefined) {
    this.gain = gainDb ? fromDb(gainDb) : 1;
    this.pan = pan ?? 0;
  }
  /** ¿Este cambio de ajustes exige reconstruir la cadena (EQ o ducking distintos)? */
  needsRebuild(fx: TrackFx): boolean {
    return eqSig(fx.eq) !== eqSig(this.fx.eq) || duckSig(fx.duck) !== this.duckKey;
  }
  /**
   * Procesa el bus en el sitio. `tapL/tapR` (opcional) reciben la señal tras ecualizador y volumen, antes de
   * ducking y panorámica: es la que usan como control las pistas que hacen ducking. `keyL/keyR` es la suma de
   * las señales de control de las pistas que disparan el ducking de ESTA pista (o null = ninguna).
   */
  process(L: Float32Array, R: Float32Array, n: number, keyL: Float32Array | null, keyR: Float32Array | null, tapL?: Float32Array | null, tapR?: Float32Array | null) {
    this.eq?.process(L, R, n);
    const g = this.gain;
    if (g !== 1)
      for (let i = 0; i < n; i++) {
        L[i] *= g;
        R[i] *= g;
      }
    if (tapL && tapR) {
      tapL.set(L.subarray(0, n));
      tapR.set(R.subarray(0, n));
    }
    this.duck?.process(L, R, keyL, keyR, n);
    if (this.pan) applyPan(L, R, this.pan, n);
    let pl = 0;
    let pr = 0;
    for (let i = 0; i < n; i++) {
      const a = L[i] < 0 ? -L[i] : L[i];
      const b = R[i] < 0 ? -R[i] : R[i];
      if (a > pl) pl = a;
      if (b > pr) pr = b;
    }
    if (pl > this.peakL) this.peakL = pl;
    if (pr > this.peakR) this.peakR = pr;
  }
}

const eqSig = (bands: readonly EqBand[] | undefined) => (bands?.length ? JSON.stringify(bands) : '');
const duckSig = (d: DuckSpec | undefined) => (d?.on ? `${d.db}|${d.thr}|${d.attack}|${d.release}|${d.hold}` : '');

/** Ajustes de la cadena maestra. */
export interface MasterOptions {
  eq: { low: number; mid: number; high: number };
  normalize: boolean;
  /** V7: ecualizador paramétrico maestro */
  eqBands?: EqBand[];
  /** V7: ganancia de normalización de sonoridad (dB), antes del limitador */
  gainDb?: number;
  /** V7: techo del pico real (dBTP) */
  ceilingDb?: number;
}

/**
 * Cadena maestra: ecualizador de 3 bandas → ecualizador paramétrico → compresor (si «Normalizar») →
 * [`onPre`: medida previa a la ganancia] → ganancia de sonoridad → limitador de pico real (−1 dBTP).
 * El limitador tiene `latency` muestras de retardo (ver TruePeakLimiter).
 */
export class MasterChain {
  private eq: Biquad[];
  private peq: ParametricEq | null;
  private comp: Compressor | null;
  private gain: number;
  readonly limiter: TruePeakLimiter;
  /** gancho de medida: ve la señal justo antes de la ganancia de sonoridad y el limitador */
  onPre: ((L: Float32Array, R: Float32Array, n: number) => void) | null = null;
  constructor(eq: { low: number; mid: number; high: number }, normalize: boolean, sampleRate: number, opts: Pick<MasterOptions, 'eqBands' | 'gainDb' | 'ceilingDb'> = {}) {
    this.eq = [
      new Biquad('peaking', 120, sampleRate, { q: 1, gainDb: eq.low }),
      new Biquad('peaking', 1000, sampleRate, { q: 1, gainDb: eq.mid }),
      new Biquad('peaking', 6000, sampleRate, { q: 1, gainDb: eq.high }),
    ];
    const peq = opts.eqBands?.length ? new ParametricEq(opts.eqBands, sampleRate) : null;
    this.peq = peq && peq.active ? peq : null;
    this.comp = normalize ? new Compressor(sampleRate) : null;
    this.gain = opts.gainDb ? fromDb(opts.gainDb) : 1;
    this.limiter = new TruePeakLimiter(sampleRate, opts.ceilingDb ?? TRUE_PEAK_CEILING_DB);
  }
  get latency(): number {
    return this.limiter.latency;
  }
  /** Cambia solo la ganancia de sonoridad (no reconstruye nada). */
  setGainDb(db: number | undefined) {
    this.gain = db ? fromDb(db) : 1;
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    for (const b of this.eq) {
      b.process(L, 0, n);
      b.process(R, 1, n);
    }
    this.peq?.process(L, R, n);
    this.comp?.process(L, R, n);
    this.onPre?.(L, R, n);
    const g = this.gain;
    if (g !== 1)
      for (let i = 0; i < n; i++) {
        L[i] *= g;
        R[i] *= g;
      }
    this.limiter.process(L, R, n);
  }
}
