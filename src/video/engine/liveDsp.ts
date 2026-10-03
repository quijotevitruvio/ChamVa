// DSP «en vivo» de la vista previa: envoltorios finos, por bloques de 128 muestras, de las
// MISMAS clases que usa la exportación (dsp.ts: ClipChain, TrackChain y MasterChain). No hay una segunda
// implementación: AudioWorklet (dsp.worklet.ts) solo reparte bloques a estas clases. Puro y
// sin globales de AudioWorklet para poder probarlo en Vitest (liveDsp.test.ts demuestra que
// el resultado no depende del tamaño de bloque y coincide con el camino de exportación).
import { eqKey } from '../audio/eq';
import { LoudnessMeter } from '../audio/loudness';
import { ClipChain, MasterChain, TrackChain, type ClipAudioFx, type MasterOptions, type TrackFx } from './dsp';

type Planar = Float32Array[];

/** Copia la entrada (mono se duplica; sin entrada = silencio) a la salida estéreo. Devuelve n. */
function loadStereo(input: Planar | undefined, output: Planar): number {
  const L = output[0];
  const R = output[1] ?? output[0];
  const n = L.length;
  const a = input?.[0];
  const b = input?.[1] ?? a;
  if (a) L.set(a.length === n ? a : a.subarray(0, n));
  else L.fill(0);
  if (R !== L) {
    if (b) R.set(b.length === n ? b : b.subarray(0, n));
    else R.fill(0);
  }
  return n;
}

const sameShape = (a: ClipAudioFx, b: ClipAudioFx) =>
  a.hp === b.hp && a.lp === b.lp && a.echo === b.echo && a.gate === b.gate && (a.denoise ?? 0) === (b.denoise ?? 0) && eqKey(a.eq) === eqKey(b.eq);

/** Cadena de un clip: paso alto → paso bajo → reducción de ruido → compuerta → ecualizador → volumen → eco → panorámica (idéntica a la exportación). */
export class LiveClipProcessor {
  private chain: ClipChain;
  private fx: ClipAudioFx;
  constructor(private sampleRate: number, fx: ClipAudioFx) {
    this.fx = { ...fx };
    this.chain = new ClipChain(this.fx, sampleRate);
  }
  /** Solo cambian niveles (volumen, dB, panorámica) → se conserva el estado; si cambian los filtros se reconstruye. */
  setFx(fx: ClipAudioFx) {
    if (sameShape(fx, this.fx)) {
      if (fx.volume !== this.fx.volume || fx.gainDb !== this.fx.gainDb || fx.pan !== this.fx.pan) this.chain.setLevels(fx.volume, fx.gainDb, fx.pan);
    } else this.chain = new ClipChain(fx, this.sampleRate);
    this.fx = { ...fx };
  }
  processBlock(inputs: Planar[], outputs: Planar[]) {
    const out = outputs[0];
    if (!out?.length) return;
    loadStereo(inputs[0], out);
    this.chain.process(out[0], out[1] ?? out[0]);
  }
}

/** Pista del mezclador en vivo: entrada 0 = suma de sus clips, entrada 1 = señal de control (suma de las pistas que disparan su ducking); salida 0 = pista procesada, salida 1 = toma de control. */
export class LiveTrackProcessor {
  private chain: TrackChain;
  private fx: TrackFx;
  private on = true;
  private peakL = 0;
  private peakR = 0;
  constructor(private sampleRate: number, fx: TrackFx) {
    this.fx = { ...fx };
    this.chain = new TrackChain(this.fx, sampleRate);
  }
  setFx(fx: TrackFx) {
    if (this.chain.needsRebuild(fx)) this.chain = new TrackChain(fx, this.sampleRate);
    else this.chain.setLevels(fx.gainDb, fx.pan);
    this.fx = { ...fx };
  }
  /** Silencio / solo: una pista inactiva no suena ni dispara el ducking de otras. */
  setActive(on: boolean) {
    this.on = on;
  }
  /** Picos desde la última lectura (lineal). */
  takePeaks(): { l: number; r: number; duckDb: number } {
    const o = { l: Math.max(this.peakL, this.chain.peakL), r: Math.max(this.peakR, this.chain.peakR), duckDb: this.chain.minDuckDb };
    this.chain.peakL = 0;
    this.chain.peakR = 0;
    this.peakL = 0;
    this.peakR = 0;
    return o;
  }
  processBlock(inputs: Planar[], outputs: Planar[]) {
    const out = outputs[0];
    const tap = outputs[1];
    if (!out?.length) return;
    if (!this.on) {
      for (const ch of out) ch.fill(0);
      if (tap) for (const ch of tap) ch.fill(0);
      return;
    }
    loadStereo(inputs[0], out);
    const key = inputs[1];
    const kL = key?.[0] ?? null;
    const kR = key?.[1] ?? kL;
    this.chain.process(out[0], out[1] ?? out[0], out[0].length, kL, kR, tap?.[0], tap?.[1] ?? tap?.[0]);
  }
}

export type MasterSettings = MasterOptions;

const sameMaster = (a: MasterSettings, b: MasterSettings) =>
  a.normalize === b.normalize && a.eq.low === b.eq.low && a.eq.mid === b.eq.mid && a.eq.high === b.eq.high && eqKey(a.eqBands) === eqKey(b.eqBands) && (a.ceilingDb ?? 0) === (b.ceilingDb ?? 0);

export interface MasterMeter {
  momentary: number;
  shortTerm: number;
  integrated: number;
  truePeak: number;
  peakIn: number;
  peakOut: number;
}

/** Cadena maestra: ecualizadores → compresor («Normalizar») → ganancia de sonoridad → limitador de pico real, con medidor de sonoridad. */
export class LiveMasterProcessor {
  private chain: MasterChain;
  private cfg: MasterSettings;
  private meter: LoudnessMeter;
  /** picos acumulados (para medir y para el banco) */
  peakIn = 0;
  peakOut = 0;
  constructor(private sampleRate: number, cfg: MasterSettings) {
    this.cfg = cfg;
    this.chain = new MasterChain(cfg.eq, cfg.normalize, sampleRate, cfg);
    this.meter = new LoudnessMeter(sampleRate);
  }
  /** Retardo (muestras) del limitador de pico real. */
  get latency(): number {
    return this.chain.latency;
  }
  setSettings(cfg: MasterSettings) {
    if (!sameMaster(cfg, this.cfg)) this.chain = new MasterChain(cfg.eq, cfg.normalize, this.sampleRate, cfg);
    else if ((cfg.gainDb ?? 0) !== (this.cfg.gainDb ?? 0)) this.chain.setGainDb(cfg.gainDb);
    this.cfg = cfg;
  }
  /** Reinicia las medidas de sonoridad (integrada, picos). */
  resetMeter() {
    this.meter = new LoudnessMeter(this.sampleRate);
  }
  readMeter(): MasterMeter {
    return { momentary: this.meter.momentary(), shortTerm: this.meter.shortTerm(), integrated: this.meter.integrated(), truePeak: this.meter.truePeakDb(), peakIn: this.peakIn, peakOut: this.peakOut };
  }
  processBlock(inputs: Planar[], outputs: Planar[]) {
    const out = outputs[0];
    if (!out?.length) return;
    loadStereo(inputs[0], out);
    this.chain.process(out[0], out[1] ?? out[0]);
    this.meter.process(out[0], out[1] ?? out[0]);
    const lim = this.chain.limiter;
    this.peakIn = lim.peakIn;
    this.peakOut = lim.peakOut;
  }
}

/** Mensajes que acepta el AudioWorkletNode (puerto). */
export type LiveMessage =
  | { type: 'fx'; fx: ClipAudioFx }
  | { type: 'master'; settings: MasterSettings }
  | { type: 'stats' }
  | { type: 'track'; fx: TrackFx }
  | { type: 'active'; on: boolean }
  | { type: 'meter'; on: boolean }
  | { type: 'reset' };
