// Procesadores de AudioWorklet de la vista previa. Reparten bloques de 128 muestras a
// LiveClipProcessor / LiveTrackProcessor / LiveMasterProcessor (liveDsp.ts → dsp.ts), el mismo código que mezcla
// la exportación. Se carga con `audioWorklet.addModule(url)` (ver previewAudio.ts).
import { LiveClipProcessor, LiveMasterProcessor, LiveTrackProcessor, type LiveMessage } from './liveDsp';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(name: string, ctor: new (options: { processorOptions?: unknown }) => AudioWorkletProcessor): void;

type Planar = Float32Array[][];

class ChamvaClip extends AudioWorkletProcessor {
  private dsp: LiveClipProcessor;
  constructor(options: { processorOptions?: unknown }) {
    super(options);
    this.dsp = new LiveClipProcessor(sampleRate, (options.processorOptions as { fx: Parameters<LiveClipProcessor['setFx']>[0] }).fx);
    this.port.onmessage = (e: MessageEvent<LiveMessage>) => {
      if (e.data.type === 'fx') this.dsp.setFx(e.data.fx);
    };
  }
  process(inputs: Planar, outputs: Planar) {
    this.dsp.processBlock(inputs, outputs);
    return true;
  }
}

/** Pista: 2 entradas (clips, control de ducking) y 2 salidas (pista, toma de control). */
class ChamvaTrack extends AudioWorkletProcessor {
  private dsp: LiveTrackProcessor;
  private metering = false;
  private blocks = 0;
  constructor(options: { processorOptions?: unknown }) {
    super(options);
    this.dsp = new LiveTrackProcessor(sampleRate, (options.processorOptions as { fx: Parameters<LiveTrackProcessor['setFx']>[0] }).fx);
    this.port.onmessage = (e: MessageEvent<LiveMessage>) => {
      const m = e.data;
      if (m.type === 'track') this.dsp.setFx(m.fx);
      else if (m.type === 'active') this.dsp.setActive(m.on);
      else if (m.type === 'meter') this.metering = m.on;
    };
  }
  process(inputs: Planar, outputs: Planar) {
    this.dsp.processBlock(inputs, outputs);
    if (this.metering && ++this.blocks >= 12) {
      this.blocks = 0;
      this.port.postMessage({ type: 'peaks', ...this.dsp.takePeaks() });
    }
    return true;
  }
}

class ChamvaMaster extends AudioWorkletProcessor {
  private dsp: LiveMasterProcessor;
  private metering = false;
  private blocks = 0;
  constructor(options: { processorOptions?: unknown }) {
    super(options);
    this.dsp = new LiveMasterProcessor(sampleRate, (options.processorOptions as { settings: ConstructorParameters<typeof LiveMasterProcessor>[1] }).settings);
    this.port.onmessage = (e: MessageEvent<LiveMessage>) => {
      const m = e.data;
      if (m.type === 'master') this.dsp.setSettings(m.settings);
      else if (m.type === 'stats') this.port.postMessage({ type: 'stats', ...this.dsp.readMeter() });
      else if (m.type === 'meter') this.metering = m.on;
      else if (m.type === 'reset') this.dsp.resetMeter();
    };
  }
  process(inputs: Planar, outputs: Planar) {
    this.dsp.processBlock(inputs, outputs);
    if (this.metering && ++this.blocks >= 12) {
      this.blocks = 0;
      this.port.postMessage({ type: 'meter', ...this.dsp.readMeter() });
    }
    return true;
  }
}

registerProcessor('chamva-clip', ChamvaClip);
registerProcessor('chamva-track', ChamvaTrack);
registerProcessor('chamva-master', ChamvaMaster);
