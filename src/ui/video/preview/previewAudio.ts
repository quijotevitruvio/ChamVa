// Grafo de audio de la vista previa: cada fuente (elemento <video>/<audio>) pasa por
//   ganancia de fundido → AudioWorklet «chamva-clip» (ClipChain de dsp.ts)
//   → AudioWorklet «chamva-track» de SU pista (TrackChain: ecualizador, dB, ducking, panorámica)
//   → AudioWorklet «chamva-master» (MasterChain de dsp.ts: EQ, compresor, ganancia de sonoridad, limitador de pico real) → salida.
// El ducking usa una segunda salida (toma de control) de las pistas de voz conectada a la 2.ª entrada de la pista que baja.
// Todos los procesadores ejecutan EXACTAMENTE el código de la exportación (liveDsp.ts → dsp.ts); aquí solo se cablea.
// Sirve para un AudioContext en vivo y para un OfflineAudioContext (pruebas).
import { eqKey } from '../../../video/audio/eq';
import type { ClipAudioFx, TrackFx } from '../../../video/engine/dsp';
import type { LiveMessage, MasterMeter, MasterSettings } from '../../../video/engine/liveDsp';
import workletUrl from '../../../video/engine/dsp.worklet.ts?worker&url';

export const PREVIEW_SAMPLE_RATE = 48000;

export interface TrackPeaks {
  l: number;
  r: number;
  duckDb: number;
}

/** Estado de una pista para el grafo (viene de `resolveTrackPlan`). */
export interface TrackState {
  fx: TrackFx;
  active: boolean;
  key: string[];
}

const clipFxKey = (fx: ClipAudioFx) => `${fx.volume}|${fx.hp}|${fx.lp}|${fx.echo}|${fx.gate ? 1 : 0}|${fx.pan ?? 0}|${fx.gainDb ?? 0}|${fx.denoise ?? 0}|${eqKey(fx.eq)}`;

export class ClipStrip {
  private fxKey = '';
  constructor(
    private graph: PreviewAudioGraph,
    readonly source: AudioNode,
    readonly fade: GainNode,
    readonly node: AudioNode,
    private port: MessagePort | null,
  ) {}

  /** Parámetros del clip (filtros, compuerta, eco, volumen, panorámica, EQ, ruido). Solo envía mensaje si cambian. */
  setFx(fx: ClipAudioFx) {
    const key = clipFxKey(fx);
    if (key === this.fxKey) return;
    this.fxKey = key;
    const msg: LiveMessage = { type: 'fx', fx: { ...fx, gate: !!fx.gate } };
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

interface TrackNode {
  node: AudioWorkletNode;
  fx: TrackFx;
  active: boolean;
  /** pistas de control ya conectadas a la 2.ª entrada */
  routes: Set<string>;
}

export class PreviewAudioGraph {
  private master: AudioWorkletNode | null = null;
  private fallbackMix: GainNode | null = null;
  private strips = new Set<ClipStrip>();
  private tracks = new Map<string, TrackNode>();
  private statsWaiters: ((s: MasterMeter) => void)[] = [];
  private metering = false;
  /** medidor continuo de la maestra y de las pistas (solo mientras el mezclador está abierto) */
  onMasterMeter: ((m: MasterMeter) => void) | null = null;
  onTrackPeaks: ((id: string, p: TrackPeaks) => void) | null = null;
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
      m.port.onmessage = (e: MessageEvent<{ type?: string } & MasterMeter>) => {
        if (e.data.type === 'meter') this.onMasterMeter?.(e.data);
        else this.statsWaiters.splice(0).forEach((f) => f(e.data));
      };
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

  /** Nodo de la pista (se crea al primer uso). Sin worklets, undefined. */
  private trackNode(id: string, fx?: TrackFx): TrackNode | undefined {
    if (!this.workletOk || !this.master) return undefined;
    let t = this.tracks.get(id);
    if (t) return t;
    const node = new AudioWorkletNode(this.ctx, 'chamva-track', {
      numberOfInputs: 2,
      numberOfOutputs: 2,
      outputChannelCount: [2, 2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { fx: fx ?? {} },
    });
    node.connect(this.master, 0, 0);
    node.port.onmessage = (e: MessageEvent<{ type?: string } & TrackPeaks>) => {
      if (e.data.type === 'peaks') this.onTrackPeaks?.(id, e.data);
    };
    if (this.metering) node.port.postMessage({ type: 'meter', on: true } satisfies LiveMessage);
    t = { node, fx: fx ?? {}, active: true, routes: new Set() };
    this.tracks.set(id, t);
    return t;
  }

  private get mixIn(): AudioNode {
    return this.master ?? this.fallbackMix!;
  }

  /**
   * Pone al día las pistas: ajustes (ecualizador, dB, panorámica, ducking), silencio/solo y las rutas de control
   * del ducking. Los nodos que ya existen conservan su estado salvo que cambie el EQ o el ducking.
   */
  setTracks(plan: Map<string, TrackState>) {
    if (!this.workletOk) return;
    for (const [id, st] of plan) {
      const t = this.trackNode(id, st.fx);
      if (!t) continue;
      if (JSON.stringify(t.fx) !== JSON.stringify(st.fx)) {
        t.fx = st.fx;
        t.node.port.postMessage({ type: 'track', fx: st.fx } satisfies LiveMessage);
      }
      if (t.active !== st.active) {
        t.active = st.active;
        t.node.port.postMessage({ type: 'active', on: st.active } satisfies LiveMessage);
      }
    }
    // rutas de control: salida 1 de cada pista de control → entrada 1 de la pista que baja
    for (const [id, t] of this.tracks) {
      const want = new Set(plan.get(id)?.fx.duck?.on ? plan.get(id)!.key : []);
      for (const k of [...t.routes])
        if (!want.has(k)) {
          const src = this.tracks.get(k);
          try {
            src?.node.disconnect(t.node, 1, 1);
          } catch {
            /* ya desconectada */
          }
          t.routes.delete(k);
        }
      for (const k of want) {
        if (t.routes.has(k)) continue;
        const src = this.trackNode(k, plan.get(k)?.fx);
        if (!src) continue;
        src.node.connect(t.node, 1, 1);
        t.routes.add(k);
      }
    }
  }

  /** Conecta una fuente (MediaElementSource, BufferSource…) a su propia cadena de clip y al bus de su pista. */
  addSource(source: AudioNode, fx: ClipAudioFx, trackId?: string): ClipStrip {
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
        processorOptions: { fx: { ...fx, gate: !!fx.gate } },
      });
      fade.connect(w);
      const bus = trackId ? this.trackNode(trackId) : undefined;
      if (bus) w.connect(bus.node, 0, 0);
      else w.connect(this.mixIn);
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

  /** Activa o apaga el flujo continuo de medidas (maestra y pistas). */
  setMetering(on: boolean) {
    this.metering = on;
    const msg: LiveMessage = { type: 'meter', on };
    this.master?.port.postMessage(msg);
    for (const t of this.tracks.values()) t.node.port.postMessage(msg);
  }

  /** Reinicia la sonoridad integrada y los picos del medidor. */
  resetMeter() {
    const msg: LiveMessage = { type: 'reset' };
    this.master?.port.postMessage(msg);
  }

  /** Medidas de la maestra (picos del limitador y sonoridad), para comprobar que suena igual que la exportación. */
  stats(): Promise<MasterMeter> {
    if (!this.master) return Promise.resolve({ momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, truePeak: -Infinity, peakIn: 0, peakOut: 0 });
    return new Promise((res) => {
      this.statsWaiters.push(res);
      const msg: LiveMessage = { type: 'stats' };
      this.master!.port.postMessage(msg);
    });
  }

  dispose() {
    for (const s of [...this.strips]) s.dispose();
    try {
      for (const t of this.tracks.values()) {
        t.node.port.onmessage = null;
        t.node.disconnect();
      }
      this.master?.disconnect();
      this.fallbackMix?.disconnect();
      this.out.disconnect();
    } catch {
      /* noop */
    }
    this.tracks.clear();
    if (this.master) this.master.port.onmessage = null;
    this.master?.port.close();
    this.master = null;
  }
}
