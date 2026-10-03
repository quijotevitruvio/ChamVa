// DSP «en vivo» de la vista previa: envoltorios finos, por bloques de 128 muestras, de las
// MISMAS clases que usa la exportación (dsp.ts: ClipChain y MasterChain). No hay una segunda
// implementación: AudioWorklet (dsp.worklet.ts) solo reparte bloques a estas clases. Puro y
// sin globales de AudioWorklet para poder probarlo en Vitest (liveDsp.test.ts demuestra que
// el resultado no depende del tamaño de bloque y coincide con el camino de exportación).
import { ClipChain, MasterChain, type ClipAudioFx } from './dsp';

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

const sameShape = (a: ClipAudioFx, b: ClipAudioFx) => a.hp === b.hp && a.lp === b.lp && a.echo === b.echo && a.gate === b.gate;

/** Cadena de un clip: paso alto → paso bajo → compuerta → volumen → eco (idéntica a la exportación). */
export class LiveClipProcessor {
  private chain: ClipChain;
  private fx: ClipAudioFx;
  constructor(private sampleRate: number, fx: ClipAudioFx) {
    this.fx = { ...fx };
    this.chain = new ClipChain(this.fx, sampleRate);
  }
  /** Solo el volumen cambia → se conserva el estado; si cambian los filtros se reconstruye. */
  setFx(fx: ClipAudioFx) {
    if (sameShape(fx, this.fx)) {
      if (fx.volume !== this.fx.volume) this.chain.setVolume(fx.volume);
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

export interface MasterSettings {
  eq: { low: number; mid: number; high: number };
  normalize: boolean;
}

/** Cadena maestra: ecualizador → compresor («Normalizar») → limitador a −1 dBFS. */
export class LiveMasterProcessor {
  private chain: MasterChain;
  private cfg: MasterSettings;
  /** picos acumulados (para medir y para el banco) */
  peakIn = 0;
  peakOut = 0;
  constructor(private sampleRate: number, cfg: MasterSettings) {
    this.cfg = cfg;
    this.chain = new MasterChain(cfg.eq, cfg.normalize, sampleRate);
  }
  setSettings(cfg: MasterSettings) {
    const same = cfg.normalize === this.cfg.normalize && cfg.eq.low === this.cfg.eq.low && cfg.eq.mid === this.cfg.eq.mid && cfg.eq.high === this.cfg.eq.high;
    if (same) return;
    this.cfg = cfg;
    this.chain = new MasterChain(cfg.eq, cfg.normalize, this.sampleRate);
  }
  processBlock(inputs: Planar[], outputs: Planar[]) {
    const out = outputs[0];
    if (!out?.length) return;
    loadStereo(inputs[0], out);
    this.chain.process(out[0], out[1] ?? out[0]);
    const lim = this.chain.limiter;
    this.peakIn = lim.peakIn;
    this.peakOut = lim.peakOut;
  }
}

/** Mensajes que acepta el AudioWorkletNode (puerto). */
export type LiveMessage = { type: 'fx'; fx: ClipAudioFx } | { type: 'master'; settings: MasterSettings } | { type: 'stats' };
