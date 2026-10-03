import { describe, expect, it } from 'vitest';
import { ArrayBufferTarget, Muxer, StreamTarget } from 'mp4-muxer';
import { BlobPartsSink } from './sink';

async function bytes(b: Blob) {
  return new Uint8Array(await b.arrayBuffer());
}

describe('Blob por partes (escrituras posicionales)', () => {
  it('equivale a escribir en un array: anexos, huecos y sobrescrituras', async () => {
    const sink = new BlobPartsSink('application/octet-stream', 64); // sellar a menudo
    const ref = new Uint8Array(1000);
    let len = 0;
    const w = (pos: number, data: number[]) => {
      sink.write(Uint8Array.from(data), pos);
      ref.set(data, pos);
      len = Math.max(len, pos + data.length);
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 40; i++) w(len, Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => Math.floor(rnd() * 256)));
    // sobrescrituras que cruzan partes selladas y sueltas (como el parcheo de cabeceras)
    w(0, [9, 9, 9, 9]);
    w(60, Array.from({ length: 100 }, (_, k) => k));
    w(len - 3, [1, 2, 3, 4, 5, 6]);
    w(len + 10, [7]); // hueco → ceros
    const out = await bytes(await sink.close());
    expect(out.length).toBe(len);
    expect([...out]).toEqual([...ref.subarray(0, len)]);
  });

  it('un MP4 escrito por trozos es idéntico byte a byte al hecho en memoria', async () => {
    const make = (target: ArrayBufferTarget | StreamTarget) => {
      const mux = new Muxer({ target, video: { codec: 'avc', width: 320, height: 240 }, fastStart: false });
      for (let i = 0; i < 120; i++)
        mux.addVideoChunkRaw(
          Uint8Array.from({ length: 500 + (i % 7) * 100 }, (_, k) => (k * i) & 0xff),
          i % 30 ? 'delta' : 'key',
          Math.round((i * 1e6) / 30),
          Math.round(1e6 / 30),
          i === 0 ? { decoderConfig: { codec: 'avc1.42001f', description: new Uint8Array([1, 0x42, 0, 0x1f, 0xff, 0xe0, 0]) } } : undefined,
        );
      mux.finalize();
    };
    const mem = new ArrayBufferTarget();
    make(mem);
    const sink = new BlobPartsSink('video/mp4', 4096);
    let writes = 0;
    let backWrites = 0;
    let end = 0;
    make(
      new StreamTarget({
        onData: (d, p) => {
          writes++;
          if (p < end) backWrites++;
          end = Math.max(end, p + d.byteLength);
          sink.write(d, p);
        },
      }),
    );
    const out = await bytes(await sink.close());
    expect(writes).toBeGreaterThan(3); // de verdad por trozos
    expect(backWrites).toBeGreaterThan(0); // y con el parcheo de la cabecera mdat
    const ref = new Uint8Array(mem.buffer);
    expect(out.length).toBe(ref.length);
    // Solo pueden diferir las fechas de creación (mvhd/tkhd/mdhd) si cambia el segundo.
    let diff = 0;
    for (let i = 0; i < ref.length; i++) if (out[i] !== ref[i]) diff++;
    expect(diff).toBeLessThanOrEqual(24);
  });
});
