// WAV (RIFF PCM) de 16 o 24 bits, estéreo, escrito en streaming: la cabecera se conoce de antemano porque la
// duración de la mezcla es fija. En 16 bits se aplica dither triangular (TPDF) de ±1 LSB, con un generador
// determinista para que dos exportaciones iguales den el mismo archivo.
import type { ByteSink } from './sink';

export type WavBits = 16 | 24;

/** Tamaño máximo de los datos de un WAV clásico (RIFF usa 32 bits). */
export const WAV_MAX_DATA = 0xffffffff - 36;

export function wavHeader(frames: number, bits: WavBits, sampleRate = 48000, channels = 2): Uint8Array {
  const bytes = bits / 8;
  const data = frames * channels * bytes;
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) h[o + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bytes, true);
  v.setUint16(32, channels * bytes, true);
  v.setUint16(34, bits, true);
  tag(36, 'data');
  v.setUint32(40, data, true);
  return h;
}

/** Escritor en streaming: `write(L, R, n)` en bloques; al final `bytesWritten` coincide con la cabecera. */
export class WavWriter {
  private pos = 44;
  private seed = 0x9e3779b9;
  private frames = 0;

  constructor(private sink: ByteSink, totalFrames: number, readonly bits: WavBits, sampleRate = 48000) {
    sink.write(wavHeader(totalFrames, bits, sampleRate), 0);
  }

  private rnd(): number {
    // xorshift32 → [0, 1)
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  write(L: Float32Array, R: Float32Array, n: number) {
    const bytes = this.bits / 8;
    const out = new Uint8Array(n * 2 * bytes);
    const v = new DataView(out.buffer);
    let o = 0;
    const scale = this.bits === 16 ? 32767 : 8388607;
    const lo = this.bits === 16 ? -32768 : -8388608;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) {
        let x = (c === 0 ? L[i] : R[i]) * scale;
        if (this.bits === 16) x += this.rnd() - this.rnd(); // TPDF
        let q = Math.round(x);
        if (q > scale) q = scale;
        else if (q < lo) q = lo;
        if (this.bits === 16) {
          v.setInt16(o, q, true);
          o += 2;
        } else {
          v.setUint8(o, q & 0xff);
          v.setUint8(o + 1, (q >> 8) & 0xff);
          v.setUint8(o + 2, (q >> 16) & 0xff);
          o += 3;
        }
      }
    }
    this.sink.write(out, this.pos);
    this.pos += out.byteLength;
    this.frames += n;
  }

  get written(): number {
    return this.frames;
  }
}
