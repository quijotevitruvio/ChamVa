// V10: el demux anota las pistas que descarta por códec no compatible, para que
// la importación no abra «a medias» (p. ej. un MKV con AC-3 sin sonido) en silencio.
import { describe, expect, it } from 'vitest';
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { demux } from './index';

const AVCC = new Uint8Array([1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
const ASC = new Uint8Array([0x11, 0x90]);
const OPUS_HEAD = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]);

/** Sustituye la primera aparición de `from` (tras `after`, si se da) por `to` (misma longitud). */
function patch(buf: ArrayBuffer, from: string, to: string, after?: string): Blob {
  const b = new Uint8Array(buf.slice(0));
  const find = (s: string, start = 0) => {
    const c = [...s].map((x) => x.charCodeAt(0));
    for (let i = start; i <= b.length - c.length; i++) if (c.every((v, k) => b[i + k] === v)) return i;
    return -1;
  };
  const i = find(from, after ? find(after) : 0);
  expect(i).toBeGreaterThan(0);
  [...to].forEach((ch, k) => (b[i + k] = ch.charCodeAt(0)));
  return new Blob([b]);
}

describe('pistas descartadas', () => {
  it('WebM/MKV con un audio que no se sabe leer: video sí, audio anotado', async () => {
    const target = new WebmTarget();
    const mux = new WebmMuxer({ target, video: { codec: 'V_VP8', width: 320, height: 240, frameRate: 30 }, audio: { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 2 } });
    for (let i = 0; i < 30; i++) {
      mux.addVideoChunkRaw(new Uint8Array(100).fill(i), i === 0 ? 'key' : 'delta', Math.round((i / 30) * 1e6), i === 0 ? { decoderConfig: { codec: 'vp8', codedWidth: 320, codedHeight: 240 } } : undefined);
      mux.addAudioChunkRaw(new Uint8Array(20).fill(i), 'key', Math.round((i / 30) * 1e6), i === 0 ? { decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description: OPUS_HEAD } } : undefined);
    }
    mux.finalize();
    const ok = await demux(new Blob([target.buffer]));
    expect(ok.skipped).toBeUndefined();
    const d = await demux(patch(target.buffer, 'A_OPUS', 'A_AC3x'));
    expect(d.video?.codec).toBe('vp8');
    expect(d.audio).toBeUndefined();
    expect(d.skipped).toEqual(['audio:A_AC3x']);
  });

  it('MP4 con audio AC-3: anotado', async () => {
    const target = new Mp4Target();
    const mux = new Mp4Muxer({ target, video: { codec: 'avc', width: 640, height: 360 }, audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 }, fastStart: 'in-memory' });
    for (let i = 0; i < 30; i++) {
      mux.addVideoChunkRaw(new Uint8Array(100).fill(i), i === 0 ? 'key' : 'delta', Math.round((i / 30) * 1e6), Math.round(1e6 / 30), i === 0 ? { decoderConfig: { codec: 'avc1.640028', description: AVCC } } : undefined);
      mux.addAudioChunkRaw(new Uint8Array(20).fill(i), 'key', Math.round((i / 30) * 1e6), Math.round(1e6 / 30), i === 0 ? { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, description: ASC } } : undefined);
    }
    mux.finalize();
    const d = await demux(patch(target.buffer, 'mp4a', 'ac-3', 'stsd'));
    expect(d.video?.codec).toBe('avc1.640028');
    expect(d.audio).toBeUndefined();
    expect(d.skipped).toEqual(['audio:ac-3']);
  });
});
