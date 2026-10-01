import { describe, expect, it } from 'vitest';
import { crc32, dosDateTime, makeZip } from './zip';

const enc = new TextEncoder();

describe('crc32', () => {
  it('valores conocidos', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(enc.encode('a'))).toBe(0xe8b7be43);
  });
  it('se puede encadenar', () => {
    const a = enc.encode('1234');
    const b = enc.encode('56789');
    expect(crc32(b, crc32(a))).toBe(0xcbf43926);
  });
});

describe('dosDateTime', () => {
  it('codifica fecha y hora', () => {
    const { date, time } = dosDateTime(new Date(2024, 4, 17, 13, 45, 31));
    expect(date).toBe(((2024 - 1980) << 9) | (5 << 5) | 17);
    expect(time).toBe((13 << 11) | (45 << 5) | 15);
  });
  it('acota años fuera de rango', () => {
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
  });
});

// Lector mínimo: recorre el directorio central y valida contra las cabeceras locales.
function readZip(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOff = v.getUint32(eocd + 16, true);
  expect(cdOff + cdSize).toBe(eocd);
  const dec = new TextDecoder();
  const files: { name: string; data: Uint8Array; crc: number }[] = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const off = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    expect(method).toBe(0);
    expect(csize).toBe(usize);
    expect(v.getUint32(off, true)).toBe(0x04034b50);
    const lnlen = v.getUint16(off + 26, true);
    const lelen = v.getUint16(off + 28, true);
    expect(v.getUint32(off + 14, true)).toBe(crc);
    const start = off + 30 + lnlen + lelen;
    files.push({ name, data: buf.subarray(start, start + usize), crc });
    p += 46 + nlen;
  }
  expect(p).toBe(cdOff + cdSize);
  return files;
}

describe('makeZip', () => {
  it('un ZIP de 2 archivos se puede releer', () => {
    const a = enc.encode('hola mundo');
    const b = new Uint8Array([0, 1, 2, 3, 255, 254]);
    const zip = makeZip([
      { name: 'a.txt', data: a },
      { name: 'carpeta/ñandú.bin', data: b },
    ]);
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(['a.txt', 'carpeta/ñandú.bin']);
    expect(Array.from(files[0].data)).toEqual(Array.from(a));
    expect(Array.from(files[1].data)).toEqual(Array.from(b));
    expect(files[0].crc).toBe(crc32(a));
    expect(files[1].crc).toBe(crc32(b));
  });
  it('ZIP vacío válido', () => {
    const zip = makeZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });
});
