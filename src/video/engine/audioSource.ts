// Fuentes de audio para el mezclador: decodifican por trozos con AudioDecoder y
// entregan muestras remuestreadas (frecuencia del archivo → 48 kHz, y velocidad
// del clip) con interpolación lineal. En memoria solo queda una ventana corta.
import { BlobReader } from './byteReader';
import { type AudioTrackInfo, indexAtOrBefore } from './demux';
import type { PcmSource } from './mixer';

export async function audioDecoderConfig(track: AudioTrackInfo): Promise<AudioDecoderConfig | null> {
  if (typeof AudioDecoder === 'undefined') return null;
  const cfg: AudioDecoderConfig = {
    codec: track.codec,
    sampleRate: Math.round(track.sampleRate) || 48000,
    numberOfChannels: track.channels || 2,
    description: track.description,
  };
  try {
    if ((await AudioDecoder.isConfigSupported(cfg)).supported) return cfg;
  } catch {
    /* no */
  }
  return null;
}

/** Copia un AudioData a dos canales Float32 (convierte formatos enteros si hace falta). */
export function audioDataToStereo(ad: AudioData): [Float32Array, Float32Array] {
  const n = ad.numberOfFrames;
  const chs = ad.numberOfChannels;
  const read = (plane: number): Float32Array => {
    const out = new Float32Array(n);
    try {
      ad.copyTo(out, { planeIndex: plane, format: 'f32-planar' });
      return out;
    } catch {
      /* formato nativo */
    }
    const fmt = ad.format ?? 'f32';
    const interleaved = !fmt.endsWith('-planar');
    const bytes = ad.allocationSize({ planeIndex: interleaved ? 0 : plane });
    const buf = new ArrayBuffer(bytes);
    ad.copyTo(buf, { planeIndex: interleaved ? 0 : plane });
    const stride = interleaved ? chs : 1;
    const off = interleaved ? plane : 0;
    const base = fmt.replace('-planar', '');
    const src =
      base === 's16' ? new Int16Array(buf) : base === 's32' ? new Int32Array(buf) : base === 'u8' ? new Uint8Array(buf) : new Float32Array(buf);
    const scale = base === 's16' ? 1 / 32768 : base === 's32' ? 1 / 2147483648 : 1;
    for (let i = 0; i < n; i++) {
      const v = src[i * stride + off];
      out[i] = base === 'u8' ? (v - 128) / 128 : v * scale;
    }
    return out;
  };
  const L = read(0);
  const R = chs > 1 ? read(1) : L;
  return [L, R];
}

/** Ventana de PCM decodificado (tiempo del archivo) con lectura remuestreada. */
export class PcmWindow {
  private L = new Float32Array(0);
  private R = new Float32Array(0);
  private len = 0;
  start = 0; // s del archivo de la muestra 0
  rate = 0;
  get end(): number {
    return this.rate ? this.start + this.len / this.rate : this.start;
  }

  /** Añade datos en `ts` (s). Rellena huecos con silencio y recorta solapes grandes. */
  push(ts: number, rate: number, l: Float32Array, r: Float32Array) {
    if (!this.rate) {
      this.rate = rate;
      this.start = ts;
    }
    if (rate !== this.rate) {
      // Cambio de frecuencia a mitad de archivo: rarísimo; se remuestrea el trozo.
      const k = this.rate / rate;
      const n = Math.round(l.length * k);
      const nl = new Float32Array(n);
      const nr = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const j = Math.min(l.length - 1, Math.floor(i / k));
        nl[i] = l[j];
        nr[i] = r[j];
      }
      l = nl;
      r = nr;
    }
    let skip = 0;
    const drift = ts - this.end;
    if (drift > 0.04) this.append(new Float32Array(Math.round(drift * this.rate)), null);
    else if (drift < -0.04) skip = Math.min(l.length, Math.round(-drift * this.rate));
    if (skip < l.length) this.append(l.subarray(skip), r.subarray(skip));
  }

  private append(l: Float32Array, r: Float32Array | null) {
    const need = this.len + l.length;
    if (need > this.L.length) {
      const cap = Math.max(need, this.L.length * 2, 8192);
      const nl = new Float32Array(cap);
      const nr = new Float32Array(cap);
      nl.set(this.L.subarray(0, this.len));
      nr.set(this.R.subarray(0, this.len));
      this.L = nl;
      this.R = nr;
    }
    this.L.set(l, this.len);
    if (r) this.R.set(r, this.len);
    else this.R.fill(0, this.len, this.len + l.length);
    this.len += l.length;
  }

  /** Descarta lo anterior a t (s), dejando 4 muestras de margen para interpolar. */
  discardBefore(t: number) {
    if (!this.rate) return;
    const k = Math.floor((t - this.start) * this.rate) - 4;
    if (k <= 0) return;
    const n = Math.min(k, this.len);
    this.L.copyWithin(0, n, this.len);
    this.R.copyWithin(0, n, this.len);
    this.len -= n;
    this.start += n / this.rate;
  }

  /** Muestras en srcStart + i·step (interpolación lineal; 0 fuera de rango). */
  readInto(srcStart: number, step: number, n: number, outL: Float32Array, outR: Float32Array) {
    const { L, R, len, rate, start } = this;
    for (let i = 0; i < n; i++) {
      const x = (srcStart + i * step - start) * rate;
      const j = Math.floor(x);
      if (j < 0 || j >= len || !rate) {
        outL[i] = 0;
        outR[i] = 0;
        continue;
      }
      const f = x - j;
      const j1 = j + 1 < len ? j + 1 : j;
      outL[i] = L[j] + (L[j1] - L[j]) * f;
      outR[i] = R[j] + (R[j1] - R[j]) * f;
    }
  }
}

export class DecoderAudioSource implements PcmSource {
  private decoder: AudioDecoder;
  private reader: BlobReader;
  private win = new PcmWindow();
  private next: number;
  private flushed = false;
  private error: Error | null = null;
  private wake: (() => void) | null = null;

  constructor(private track: AudioTrackInfo, blob: Blob, config: AudioDecoderConfig, startTime: number) {
    this.reader = new BlobReader(blob, 2 << 20);
    this.decoder = new AudioDecoder({
      output: (ad) => {
        try {
          const [l, r] = audioDataToStereo(ad);
          this.win.push(ad.timestamp / 1e6, ad.sampleRate, l, r);
        } finally {
          ad.close();
        }
        this.poke();
      },
      error: (e) => {
        this.error = e instanceof Error ? e : new Error(String(e));
        this.poke();
      },
    });
    this.decoder.configure(config);
    // Pre-roll de 0,2 s (AAC/Opus necesitan unas tramas previas).
    this.next = indexAtOrBefore(track.samples, Math.max(0, startTime - 0.2));
  }

  private poke() {
    const w = this.wake;
    this.wake = null;
    w?.();
  }
  private waitEvent(ms = 100): Promise<void> {
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

  async read(srcStart: number, step: number, n: number, L: Float32Array, R: Float32Array): Promise<void> {
    const need = srcStart + step * n + 0.01;
    const s = this.track.samples;
    for (;;) {
      if (this.error) throw this.error;
      if (this.win.rate && this.win.end >= need) break;
      if (this.next < s.count) {
        if (this.decoder.decodeQueueSize < 16) {
          const i = this.next++;
          const data = await this.reader.read(s.offset[i], s.size[i]);
          this.decoder.decode(
            new EncodedAudioChunk({ type: 'key', timestamp: Math.round(s.pts[i] * 1e6), duration: s.dur[i] ? Math.round(s.dur[i] * 1e6) : undefined, data }),
          );
          continue;
        }
        await this.waitEvent();
        continue;
      }
      if (!this.flushed) {
        this.flushed = true;
        await this.decoder.flush().catch((e) => (this.error = e instanceof Error ? e : new Error(String(e))));
        continue;
      }
      break;
    }
    this.win.readInto(srcStart, step, n, L, R);
    this.win.discardBefore(srcStart + step * n);
  }

  close() {
    try {
      if (this.decoder.state !== 'closed') this.decoder.close();
    } catch {
      /* noop */
    }
  }
}

/** Respaldo: decodeAudioData del archivo entero (solo si el motor no sabe leerlo por trozos). */
export class BufferAudioSource implements PcmSource {
  private win = new PcmWindow();
  constructor(buffer: AudioBuffer) {
    const L = buffer.getChannelData(0);
    const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
    this.win.push(0, buffer.sampleRate, L, R);
  }
  async read(srcStart: number, step: number, n: number, L: Float32Array, R: Float32Array): Promise<void> {
    this.win.readInto(srcStart, step, n, L, R);
  }
  close() {}
}
