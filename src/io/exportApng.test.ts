import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { buildAnimatedWebp, buildApng, webpImageChunks } from './exportApng';
import { crc32 } from './zip';

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
// PNG RGBA 8 bits de w×h de un color, con las IDAT partidas en dos para probar varios chunks.
function makePng(w: number, h: number, rgba: number[]): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgba, y * (w * 4 + 1) + 1 + x * 4);
  const z = new Uint8Array(deflateSync(raw));
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const half = Math.ceil(z.length / 2);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z.subarray(0, half)),
    chunk('IDAT', z.subarray(half)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function list(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  let p = 8;
  while (p < png.length) {
    const len = v.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    const crcOk = crc32(png.subarray(p + 4, p + 8 + len)) === v.getUint32(p + 8 + len);
    out.push({ type, data: png.subarray(p + 8, p + 8 + len), crcOk });
    p += 12 + len;
  }
  return out;
}

describe('APNG', () => {
  it('estructura: acTL, fcTL, IDAT del primero y fdAT de los demás, secuencia correlativa', () => {
    const f = [makePng(4, 3, [255, 0, 0, 255]), makePng(4, 3, [0, 255, 0, 255]), makePng(4, 3, [0, 0, 255, 255])];
    const apng = buildApng(f, [100, 200, 300], 0);
    const cs = list(apng);
    expect(cs.every((c) => c.crcOk)).toBe(true);
    expect(cs.map((c) => c.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'IDAT', 'fcTL', 'fdAT', 'fdAT', 'fcTL', 'fdAT', 'fdAT', 'IEND']);
    const actl = new DataView(cs[1].data.buffer, cs[1].data.byteOffset);
    expect(actl.getUint32(0)).toBe(3);
    expect(actl.getUint32(4)).toBe(0);
    const seqs: number[] = [];
    for (const c of cs) {
      if (c.type === 'fcTL' || c.type === 'fdAT') seqs.push(new DataView(c.data.buffer, c.data.byteOffset).getUint32(0));
    }
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const fctl = new DataView(cs[5].data.buffer, cs[5].data.byteOffset);
    expect(fctl.getUint32(4)).toBe(4);
    expect(fctl.getUint32(8)).toBe(3);
    expect(fctl.getUint16(20)).toBe(200);
    expect(fctl.getUint16(22)).toBe(1000);
  });
  it('rechaza tamaños distintos, no-PNG y lista vacía', () => {
    expect(() => buildApng([makePng(2, 2, [0, 0, 0, 255]), makePng(3, 2, [0, 0, 0, 255])], [100])).toThrow();
    expect(() => buildApng([new Uint8Array(20)], [100])).toThrow();
    expect(() => buildApng([], [])).toThrow();
  });
});

// WebP «simple» sintético: RIFF + chunk VP8L con cabecera mínima (tamaño en la cabecera de VP8L).
function fakeVp8l(w: number, h: number, alpha = false): Uint8Array {
  const body = new Uint8Array(8);
  body[0] = 0x2f;
  const bits = (w - 1) | ((h - 1) << 14) | ((alpha ? 1 : 0) << 28);
  new DataView(body.buffer).setUint32(1, bits >>> 0, true);
  const c = new Uint8Array(8 + body.length);
  c.set([0x56, 0x50, 0x38, 0x4c], 0);
  new DataView(c.buffer).setUint32(4, body.length, true);
  c.set(body, 8);
  const out = new Uint8Array(12 + c.length);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(out.buffer).setUint32(4, 4 + c.length, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set(c, 12);
  return out;
}

describe('WebP animado', () => {
  it('lee el tamaño de un VP8L', () => {
    const i = webpImageChunks(fakeVp8l(40, 30, true));
    expect([i.width, i.height, i.hasAlpha]).toEqual([40, 30, true]);
  });
  it('contenedor RIFF: VP8X con animación, ANIM y un ANMF por fotograma', () => {
    const out = buildAnimatedWebp([fakeVp8l(40, 30), fakeVp8l(40, 30)], [120, 250], 3);
    const tag = (o: number) => String.fromCharCode(...out.subarray(o, o + 4));
    const v = new DataView(out.buffer);
    expect(tag(0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(out.length - 8);
    expect(tag(8)).toBe('WEBP');
    expect(tag(12)).toBe('VP8X');
    expect(out[20] & 0x02).toBe(0x02); // bit de animación
    expect(out[24] | (out[25] << 8)).toBe(39); // ancho-1
    expect(tag(30)).toBe('ANIM');
    expect(v.getUint16(30 + 8 + 4, true)).toBe(3); // bucles
    // primer ANMF
    const a1 = 30 + 8 + 6;
    expect(tag(a1)).toBe('ANMF');
    const len1 = v.getUint32(a1 + 4, true);
    expect(out[a1 + 8 + 12] | (out[a1 + 8 + 13] << 8)).toBe(120); // duración
    expect(tag(a1 + 8 + 16)).toBe('VP8L');
    const a2 = a1 + 8 + len1 + (len1 & 1);
    expect(tag(a2)).toBe('ANMF');
    expect(out[a2 + 8 + 12] | (out[a2 + 8 + 13] << 8)).toBe(250);
  });
  it('rechaza tamaños distintos', () => {
    expect(() => buildAnimatedWebp([fakeVp8l(4, 4), fakeVp8l(5, 4)], [100])).toThrow();
  });
});
