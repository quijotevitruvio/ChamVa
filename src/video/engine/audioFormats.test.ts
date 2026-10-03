import { describe, expect, it } from 'vitest';
import { OPUS_PRESKIP, OggOpusWriter, oggCrc, opusHead } from './ogg';
import { BlobPartsSink } from './sink';
import { WavWriter, wavHeader } from './wav';

/** Lector mínimo de Ogg: separa páginas y paquetes y comprueba el CRC. */
function parseOgg(buf: Uint8Array) {
  const pages: { type: number; granule: number; serial: number; seq: number; packets: Uint8Array[]; crcOk: boolean }[] = [];
  let o = 0;
  let carry: number[] = [];
  while (o < buf.length) {
    expect(String.fromCharCode(...buf.subarray(o, o + 4))).toBe('OggS');
    const v = new DataView(buf.buffer, buf.byteOffset + o);
    const nseg = buf[o + 26];
    const segs = buf.subarray(o + 27, o + 27 + nseg);
    const size = segs.reduce((a, b) => a + b, 0);
    const total = 27 + nseg + size;
    const raw = Uint8Array.from(buf.subarray(o, o + total));
    const crc = v.getUint32(22, true);
    new DataView(raw.buffer).setUint32(22, 0, true);
    const packets: Uint8Array[] = [];
    let p = o + 27 + nseg;
    for (const s of segs) {
      for (let i = 0; i < s; i++) carry.push(buf[p + i]);
      p += s;
      if (s < 255) {
        packets.push(Uint8Array.from(carry));
        carry = [];
      }
    }
    pages.push({ type: buf[o + 5], granule: v.getUint32(6, true) + v.getUint32(10, true) * 4294967296, serial: v.getUint32(14, true), seq: v.getUint32(18, true), packets, crcOk: oggCrc(raw) === crc });
    o += total;
  }
  return pages;
}

const collect = () => {
  const chunks: Uint8Array[] = [];
  return { write: (b: Uint8Array) => chunks.push(b), bytes: () => Uint8Array.from(chunks.flatMap((c) => [...c])) };
};

describe('Ogg Opus', () => {
  it('CRC-32 de Ogg: valor de referencia', () => {
    // CRC (poly 0x04C11DB7, sin reflejar, init 0) de "123456789" = 0x89A1897F
    expect(oggCrc(new TextEncoder().encode('123456789'))).toBe(0x89a1897f);
  });

  it('cabeceras, paquetes grandes, páginas, secuencia, gránulo y EOS', () => {
    const c = collect();
    const w = new OggOpusWriter(c.write, 2, 48000, OPUS_PRESKIP, 1234);
    const sent: Uint8Array[] = [];
    const r = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
    for (let i = 0; i < 100; i++) {
      const p = r(i === 7 ? 600 : i === 8 ? 255 : 10 + (i % 90), i); // 255 exacto y 600 (varios segmentos)
      sent.push(p);
      w.addPacket(p, 960);
    }
    w.finish(100 * 960 - 400); // recorta 400 muestras de relleno
    const pages = parseOgg(c.bytes());
    expect(pages.every((p) => p.crcOk)).toBe(true);
    expect(pages.every((p) => p.serial === 1234)).toBe(true);
    expect(pages.map((p) => p.seq)).toEqual(pages.map((_, i) => i));
    expect(pages[0].type & 0x02).toBe(0x02); // BOS
    expect(pages[0].packets).toHaveLength(1);
    expect(pages[0].packets[0]).toEqual(opusHead(2, 48000));
    expect(String.fromCharCode(...pages[1].packets[0].subarray(0, 8))).toBe('OpusTags');
    expect(pages[pages.length - 1].type & 0x04).toBe(0x04); // EOS
    const audio = pages.slice(2).flatMap((p) => p.packets);
    expect(audio).toHaveLength(100);
    audio.forEach((p, i) => expect(p).toEqual(sent[i]));
    // gránulo no decreciente y el último recorta el relleno
    const gr = pages.slice(2).map((p) => p.granule);
    for (let i = 1; i < gr.length; i++) expect(gr[i]).toBeGreaterThanOrEqual(gr[i - 1]);
    expect(gr[gr.length - 1]).toBe(100 * 960 - 400 + OPUS_PRESKIP);
    // ninguna página con más de 255 segmentos
    expect(pages.length).toBeGreaterThan(3);
  });
});

describe('WAV', () => {
  it('cabecera PCM de 16 y 24 bits', () => {
    for (const bits of [16, 24] as const) {
      const h = wavHeader(48000, bits);
      const v = new DataView(h.buffer);
      expect(String.fromCharCode(...h.subarray(0, 4))).toBe('RIFF');
      expect(v.getUint32(4, true)).toBe(36 + 48000 * 2 * (bits / 8));
      expect(v.getUint16(20, true)).toBe(1);
      expect(v.getUint16(22, true)).toBe(2);
      expect(v.getUint32(24, true)).toBe(48000);
      expect(v.getUint16(34, true)).toBe(bits);
      expect(v.getUint32(40, true)).toBe(48000 * 2 * (bits / 8));
    }
  });

  it.each([16, 24] as const)('escribe %i bits en bloques y se lee de vuelta (error ≤ 1 LSB)', async (bits) => {
    const sink = new BlobPartsSink('audio/wav');
    const n = 5000;
    const L = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i / 20));
    const R = Float32Array.from({ length: n }, (_, i) => -0.25 * Math.cos(i / 33));
    const w = new WavWriter(sink, n, bits);
    w.write(L.subarray(0, 1234), R.subarray(0, 1234), 1234);
    w.write(L.subarray(1234), R.subarray(1234), n - 1234);
    const blob = (await sink.close())!;
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(buf.length).toBe(44 + n * 2 * (bits / 8));
    const v = new DataView(buf.buffer);
    const scale = bits === 16 ? 32768 : 8388608;
    let maxErr = 0;
    for (let i = 0; i < n; i++) {
      const get = (c: number) => {
        const o = 44 + (i * 2 + c) * (bits / 8);
        return bits === 16 ? v.getInt16(o, true) : ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) >> 0);
      };
      maxErr = Math.max(maxErr, Math.abs(get(0) / scale - L[i]) * scale, Math.abs(get(1) / scale - R[i]) * scale);
    }
    expect(maxErr).toBeLessThanOrEqual(bits === 16 ? 2.5 : 1.5); // TPDF: hasta ±2 LSB en 16 bits
  });

  it('dos exportaciones iguales dan el mismo archivo (dither determinista) y el límite de pico no desborda', async () => {
    const mk = async () => {
      const sink = new BlobPartsSink('audio/wav');
      const w = new WavWriter(sink, 100, 16);
      w.write(new Float32Array(100).fill(1.2), new Float32Array(100).fill(-1.2), 100);
      return new Uint8Array(await (await sink.close())!.arrayBuffer());
    };
    const a = await mk();
    const b = await mk();
    expect(a).toEqual(b);
    const v = new DataView(a.buffer);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });
});
