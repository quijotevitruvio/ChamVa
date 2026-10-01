import { describe, expect, it } from 'vitest';
import { addJpegMeta, addPngMeta, buildExifApp1, readPngText, pngChunk } from './pngMeta';
import { crc32 } from './zip';

// PNG mínimo válido de 1×1 (RGBA transparente).
function tinyPng(): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 1, false);
  dv.setUint32(4, 1, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01]);
  const parts = [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('addPngMeta', () => {
  it('inserta iTXt tras IHDR y se puede releer', () => {
    const src = tinyPng();
    const out = addPngMeta(src, {
      title: 'Cartel de verano',
      author: 'Andrés Valencia',
      copyright: '© 2026',
    });
    expect(out.length).toBeGreaterThan(src.length);
    const txt = readPngText(out);
    expect(txt.Title).toBe('Cartel de verano');
    expect(txt.Author).toBe('Andrés Valencia');
    expect(txt.Copyright).toBe('© 2026');
    expect(txt.Description).toBeUndefined();
  });

  it('la estructura de chunks sigue siendo válida (longitud y CRC)', () => {
    const out = addPngMeta(tinyPng(), { title: 'Hola', description: 'Descripción larga ñ' });
    const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const types: string[] = [];
    let p = 8;
    while (p < out.length) {
      const len = v.getUint32(p, false);
      const typeAndData = out.subarray(p + 4, p + 8 + len);
      expect(v.getUint32(p + 8 + len, false)).toBe(crc32(typeAndData));
      types.push(new TextDecoder().decode(out.subarray(p + 4, p + 8)));
      p += 12 + len;
    }
    expect(p).toBe(out.length);
    expect(types).toEqual(['IHDR', 'iTXt', 'iTXt', 'IDAT', 'IEND']);
  });

  it('sin metadatos o sin firma PNG devuelve lo mismo', () => {
    const src = tinyPng();
    expect(addPngMeta(src, {})).toBe(src);
    const junk = new Uint8Array([1, 2, 3]);
    expect(addPngMeta(junk, { title: 'x' })).toBe(junk);
  });
});

describe('JPG', () => {
  it('EXIF mínimo bien formado', () => {
    const seg = buildExifApp1({ author: 'Ana López', copyright: 'Mío' })!;
    expect(seg[0]).toBe(0xff);
    expect(seg[1]).toBe(0xe1);
    const len = new DataView(seg.buffer).getUint16(2, false);
    expect(len).toBe(seg.length - 2);
    expect(new TextDecoder().decode(seg.subarray(4, 8))).toBe('Exif');
    const text = new TextDecoder().decode(seg);
    expect(text).toContain('Ana Lopez');
  });
  it('se inserta tras el APP0/JFIF', () => {
    const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9]);
    const out = addJpegMeta(jfif, { title: 'T' });
    expect(Array.from(out.subarray(0, 8))).toEqual(Array.from(jfif.subarray(0, 8)));
    expect(out[8]).toBe(0xff);
    expect(out[9]).toBe(0xe1);
    expect(out.subarray(out.length - 2)).toEqual(new Uint8Array([0xff, 0xd9]));
  });
});
