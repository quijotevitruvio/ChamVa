// Grafo de audio de la vista previa: cada fuente (elemento <video>/<audio>) pasa por
//   ganancia de fundido → AudioWorklet «chamva-clip» (ClipChain de dsp.ts) → mezcla
//   → AudioWorklet «chamva-master» (MasterChain de dsp.ts: EQ, compresor, limitador) → salida.
// Los dos procesadores ejecutan EXACTAMENTE el código de la exportación (liveDsp.ts → dsp.ts);
// aquí solo se cablea. Sirve para un AudioContext en vivo y para un OfflineAudioContext (pruebas).
import type { ClipAudioFx } from '../../../video/engine/dsp';
import type { LiveMessage, MasterSettings } from '../../../video/engine/liveDsp';
import workletUrl from '../../../video/engine/dsp.worklet.ts?worker&url';

export const PREVIEW_SAMPLE_RATE = 48000;

export class ClipStrip {
  private fxKey = '';
  constructor(
    private graph: PreviewAudioGraph,
    readonly source: AudioNode,
    readonly fade: GainNode,
    readonly node: AudioNode,
    private port: MessagePort | null,
  ) {}

  /** Parámetros del clip (filtros, compuerta, eco, volumen). Solo envía mensaje si cambian. */
  setFx(fx: ClipAudioFx) {
    const key = `${fx.volume}|${fx.hp}|${fx.lp}|${fx.echo}|${fx.gate ? 1 : 0}`;
    if (key === this.fxKey) return;
    this.fxKey = key;
    const msg: LiveMessage = { type: 'fx', fx: { volume: fx.volume, hp: fx.hp, lp: fx.lp, echo: fx.echo, gate: !!fx.gate } };
    this.port?.postMessage(msg);
  }

  /** Ganancia de fundido (0..1), suavizada ~5 ms para que no haya chasquidos. */
  setFade(g: number) {
    const ctx = this.graph.ctx;
    const v = Math.max(0, g);
    if (this.fade.gain.value === v) return;
    this.fade.gain.setTargetAtTime(v, ctx.currentTime, 0.004);
  }

  dispose() {
    for (const n of [this.source, this.fade, this.node])
      try {
        n.disconnect();
      } catch {
        /* ya desconectado */
      }
    if (this.port) this.port.onmessage = null;
    this.port?.close();
    this.graph.forget(this);
  }
}

export class PreviewAudioGraph {
  private master: AudioWorkletNode | null = null;
  private fallbackMix: GainNode | null = null;
  private strips = new Set<ClipStrip>();
  private statsWaiters: ((s: { peakIn: number; peakOut: number }) => void)[] = [];
  /** true cuando los AudioWorklet están cargados; false → sin procesado (solo suma) */
  workletOk = false;
  isReady = false;
  readonly ready: Promise<void>;
  /** salida de la mezcla ya procesada (para grabar la vista previa o medirla) */
  readonly out: GainNode;

  constructor(readonly ctx: BaseAudioContext, private settings: MasterSettings, destination: AudioNode | null = ctx.destination) {
    this.out = ctx.createGain();
    if (destination) this.out.connect(destination);
    this.ready = this.init();
  }

  private async init() {
    try {
      await this.ctx.audioWorklet.addModule(workletUrl);
      const m = new AudioWorkletNode(this.ctx, 'chamva-master', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { settings: this.settings },
      });
      m.port.onmessage = (e: MessageEvent<{ peakIn: number; peakOut: number }>) => this.statsWaiters.splice(0).forEach((f) => f(e.data));
      m.connect(this.out);
      this.master = m;
      this.workletOk = true;
    } catch (e) {
      console.warn('[video] AudioWorklet no disponible: la vista previa suena sin filtros ni limitador.', e);
      this.fallbackMix = this.ctx.createGain();
      this.fallbackMix.connect(this.out);
    }
    this.isReady = true;
  }

  private get mixIn(): AudioNode {
    return this.master ?? this.fallbackMix!;
  }

  /** Conecta una fuente (MediaElementSource, BufferSource…) a su propia cadena de clip. */
  addSource(source: AudioNode, fx: ClipAudioFx): ClipStrip {
    const ctx = this.ctx;
    const fade = ctx.createGain();
    fade.gain.value = 0;
    source.connect(fade);
    let node: AudioNode = fade;
    let port: MessagePort | null = null;
    if (this.workletOk) {
      const w = new AudioWorkletNode(ctx, 'chamva-clip', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { fx: { volume: fx.volume, hp: fx.hp, lp: fx.lp, echo: fx.echo, gate: !!fx.gate } },
      });
      fade.connect(w);
      w.connect(this.mixIn);
      node = w;
      port = w.port;
    } else {
      const g = ctx.createGain();
      g.gain.value = fx.volume;
      fade.connect(g);
      g.connect(this.mixIn);
      node = g;
    }
    const s = new ClipStrip(this, source, fade, node, port);
    this.strips.add(s);
    return s;
  }

  forget(s: ClipStrip) {
    this.strips.delete(s);
  }

  get stripCount() {
    return this.strips.size;
  }

  setMaster(settings: MasterSettings) {
    this.settings = settings;
    const msg: LiveMessage = { type: 'master', settings };
    this.master?.port.postMessage(msg);
  }

  /** Picos de entrada/salida del limitador (para comprobar que suena igual que la exportación). */
  stats(): Promise<{ peakIn: number; peakOut: number }> {
    if (!this.master) return Promise.resolve({ peakIn: 0, peakOut: 0 });
    return new Promise((res) => {
      this.statsWaiters.push(res);
      const msg: LiveMessage = { type: 'stats' };
      this.master!.port.postMessage(msg);
    });
  }

  dispose() {
    for (const s of [...this.strips]) s.dispose();
    try {
      this.master?.disconnect();
      this.fallbackMix?.disconnect();
      this.out.disconnect();
    } catch {
      /* noop */
    }
    if (this.master) this.master.port.onmessage = null;
    this.master?.port.close();
    this.master = null;
  }
}
