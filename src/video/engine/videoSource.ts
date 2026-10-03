// Fuentes de fotogramas para la exportación.
//
// DecoderFrameSource: lee las muestras del archivo por trozos y las decodifica
// con VideoDecoder, avanzando hacia delante (sin «seek» por fotograma). Para cada
// instante devuelve el fotograma que se estaría viendo (el último con pts ≤ t), lo
// que respeta los videos de fotogramas variables de los móviles.
//
// ElementFrameSource: último recurso para archivos que no sabemos desmultiplexar o
// códecs que el decodificador no acepta: usa <video> con seek, pero espera a que
// el fotograma esté de verdad pintado (antes salía negro el primer fotograma).
import { BlobReader } from './byteReader';
import { type VideoTrackInfo, keyIndexBefore } from './demux';

export interface DrawableFrame {
  image: CanvasImageSource;
  width: number;
  height: number;
  rotation: number;
}

export interface FrameSource {
  /** Fotograma visible en el instante t (s del archivo). Válido hasta la siguiente llamada. */
  frameAt(t: number): Promise<DrawableFrame | null>;
  /** Último instante pedido (para decidir si se puede reutilizar en el tramo siguiente). */
  readonly lastTime: number;
  close(): void;
}

export async function videoDecoderConfig(track: VideoTrackInfo): Promise<VideoDecoderConfig | null> {
  if (typeof VideoDecoder === 'undefined') return null;
  const base: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth: track.codedWidth || undefined,
    codedHeight: track.codedHeight || undefined,
    description: track.description,
  };
  for (const hw of ['no-preference', 'prefer-software'] as const) {
    const cfg = { ...base, hardwareAcceleration: hw };
    try {
      if ((await VideoDecoder.isConfigSupported(cfg)).supported) return cfg;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

export class DecoderFrameSource implements FrameSource {
  private decoder: VideoDecoder;
  private reader: BlobReader;
  private frames: VideoFrame[] = []; // decodificados, ordenados por timestamp
  private next = 0; // siguiente muestra a enviar
  private flushed = false;
  private error: Error | null = null;
  private wake: (() => void) | null = null;
  private current: VideoFrame | null = null;
  lastTime = -Infinity;
  decodedCount = 0;

  constructor(private track: VideoTrackInfo, blob: Blob, private config: VideoDecoderConfig, startTime: number) {
    this.reader = new BlobReader(blob, 8 << 20);
    this.decoder = new VideoDecoder({
      output: (f) => {
        this.decodedCount++;
        // inserción ordenada (los decodificadores ya entregan en orden de presentación)
        let i = this.frames.length;
        while (i > 0 && this.frames[i - 1].timestamp > f.timestamp) i--;
        this.frames.splice(i, 0, f);
        this.poke();
      },
      error: (e) => {
        this.error = e instanceof Error ? e : new Error(String(e));
        this.poke();
      },
    });
    this.decoder.configure(config);
    this.decoder.addEventListener?.('dequeue', () => this.poke());
    this.next = keyIndexBefore(track.samples, startTime);
  }

  private poke() {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  private waitEvent(ms = 200): Promise<void> {
    return new Promise((res) => {
      const timer = setTimeout(() => {
        this.wake = null;
        res();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        res();
      };
    });
  }

  private async feedOne(): Promise<void> {
    const s = this.track.samples;
    const i = this.next++;
    const data = await this.reader.read(s.offset[i], s.size[i]);
    this.decoder.decode(
      new EncodedVideoChunk({
        type: s.key[i] ? 'key' : 'delta',
        timestamp: Math.round(s.pts[i] * 1e6),
        duration: s.dur[i] ? Math.round(s.dur[i] * 1e6) : undefined,
        data,
      }),
    );
  }

  /**
   * V8: reposiciona el decodificador en el fotograma clave anterior a `t` (bucles que vuelven al principio, rampas de velocidad
   * muy rápidas que saltan segundos de archivo): evita decodificar todo lo que hay en medio.
   */
  private reposition(t: number) {
    for (const f of this.frames) if (f !== this.current) f.close();
    this.frames = [];
    this.current?.close();
    this.current = null;
    try {
      this.decoder.reset();
      this.decoder.configure(this.config);
    } catch (e) {
      this.error = e instanceof Error ? e : new Error(String(e));
    }
    this.next = keyIndexBefore(this.track.samples, t);
    this.flushed = false;
    this.repositions++;
  }

  repositions = 0;

  async frameAt(t: number): Promise<DrawableFrame | null> {
    const s = this.track.samples;
    // V8: salto atrás (bucle) o salto adelante de más de 2 s (rampa muy rápida): se reposiciona en vez de decodificar de más
    if (this.lastTime !== -Infinity && (t < this.lastTime - 0.02 || (this.next < s.count && s.pts[this.next] < t - 2 && keyIndexBefore(s, t) > this.next))) this.reposition(t);
    this.lastTime = t;
    const tUs = Math.round(t * 1e6) + 500; // tolerancia de medio milisegundo
    // Decodificar hasta tener un fotograma posterior a t (o el final).
    for (;;) {
      if (this.error) throw this.error;
      // Se descartan los ya pasados para no acaparar fotogramas del decodificador.
      while (this.frames.length > 1 && this.frames[1].timestamp <= tUs) this.frames.shift()!.close();
      const last = this.frames[this.frames.length - 1];
      if (last && last.timestamp > tUs) break;
      if (this.next < s.count) {
        if (this.decoder.decodeQueueSize < 4 && this.frames.length < 6) {
          await this.feedOne();
          continue;
        }
        await this.waitEvent();
        continue;
      }
      if (!this.flushed) {
        this.flushed = true;
        await this.decoder.flush().catch((e) => {
          this.error = e instanceof Error ? e : new Error(String(e));
        });
        continue;
      }
      break; // fin del archivo: se queda el último fotograma
    }
    // Descartar los fotogramas ya pasados (se conserva el visible en t).
    while (this.frames.length > 1 && this.frames[1].timestamp <= tUs) this.frames.shift()!.close();
    const f = this.frames[0];
    if (!f) return this.current ? this.drawable(this.current) : null;
    if (this.current && this.current !== f) this.current.close();
    this.current = f;
    // El primero puede ser posterior a t (inicio del archivo): se usa igual, nunca negro.
    return this.drawable(f);
  }

  private drawable(f: VideoFrame): DrawableFrame {
    return { image: f, width: f.displayWidth, height: f.displayHeight, rotation: this.track.rotation };
  }

  close() {
    for (const f of this.frames) if (f !== this.current) f.close();
    this.frames = [];
    this.current?.close();
    this.current = null;
    try {
      if (this.decoder.state !== 'closed') this.decoder.close();
    } catch {
      /* noop */
    }
  }
}

/** Ruta de respaldo con <video>: seek y espera a que el fotograma esté presentado. */
export class ElementFrameSource implements FrameSource {
  private v: HTMLVideoElement;
  private ready: Promise<void>;
  lastTime = -Infinity;
  private first = true;

  constructor(url: string) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    this.v = v;
    this.ready = new Promise((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error('No se pudo cargar el video'));
    });
    v.src = url;
    v.load();
  }

  private presented(): Promise<void> {
    const v = this.v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    return new Promise((res) => {
      const timer = setTimeout(res, 300);
      if (v.requestVideoFrameCallback)
        v.requestVideoFrameCallback(() => {
          clearTimeout(timer);
          res();
        });
      else requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(timer), res())));
    });
  }

  async frameAt(t: number): Promise<DrawableFrame | null> {
    await this.ready;
    this.lastTime = t;
    const v = this.v;
    const target = Math.max(0, Math.min(t, (v.duration || t) - 0.001));
    if (this.first || Math.abs(v.currentTime - target) > 0.0005) {
      this.first = false;
      await new Promise<void>((res) => {
        const done = () => {
          v.removeEventListener('seeked', done);
          res();
        };
        v.addEventListener('seeked', done);
        v.currentTime = target;
      });
      await this.presented();
    }
    if (v.readyState < 2) await this.presented();
    if (!v.videoWidth) return null;
    return { image: v, width: v.videoWidth, height: v.videoHeight, rotation: 0 };
  }

  close() {
    this.v.removeAttribute('src');
    this.v.load();
  }
}
