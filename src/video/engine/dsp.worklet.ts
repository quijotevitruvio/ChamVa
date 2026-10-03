// Procesadores de AudioWorklet de la vista previa. Reparten bloques de 128 muestras a
// LiveClipProcessor / LiveMasterProcessor (liveDsp.ts → dsp.ts), el mismo código que mezcla
// la exportación. Se carga con `audioWorklet.addModule(url)` (ver previewAudio.ts).
import { LiveClipProcessor, LiveMasterProcessor, type LiveMessage } from './liveDsp';

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

class ChamvaMaster extends AudioWorkletProcessor {
  private dsp: LiveMasterProcessor;
  constructor(options: { processorOptions?: unknown }) {
    super(options);
    this.dsp = new LiveMasterProcessor(sampleRate, (options.processorOptions as { settings: ConstructorParameters<typeof LiveMasterProcessor>[1] }).settings);
    this.port.onmessage = (e: MessageEvent<LiveMessage>) => {
      if (e.data.type === 'master') this.dsp.setSettings(e.data.settings);
      else if (e.data.type === 'stats') this.port.postMessage({ peakIn: this.dsp.peakIn, peakOut: this.dsp.peakOut });
    };
  }
  process(inputs: Planar, outputs: Planar) {
    this.dsp.processBlock(inputs, outputs);
    return true;
  }
}

registerProcessor('chamva-clip', ChamvaClip);
registerProcessor('chamva-master', ChamvaMaster);
