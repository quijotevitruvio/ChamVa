import { describe, expect, it } from 'vitest';
import { dpiToPpm, fileDpi, readJpegDpi, readPngDpi, setJpegDpi, setPngDpi } from './imageDpi';
import { addPngMeta, pngChunk, readPngText } from './pngMeta';
import { crc32 } from './zip';

function tinyPng(extra: Uint8Array[] = []): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 1, false);
  dv.setUint32(4, 1, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01]);
  const parts = [sig, pngChunk('IHDR', ihdr), ...extra, pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunkTypes(png: Uint8Array): string[] {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  let p = 8;
  while (p < png.length) {
    const len = v.getUint32(p, false);
    const td = png.subarray(p + 4, p + 8 + len);
    expect(v.getUint32(p + 8 + len, false)).toBe(crc32(td)); // CRC válido
    types.push(new TextDecoder().decode(png.subarray(p + 4, p + 8)));
    p += 12 + len;
  }
  expect(p).toBe(png.length);
  return types;
}

// JPEG mínimo: SOI, (JFIF opcional), DQT de relleno, SOS+datos, EOI.
function tinyJpeg(jfif: 'none' | 'units0' = 'units0'): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (jfif === 'units0') parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
  parts.push(0xff, 0xdb, 0x00, 0x04, 0x00, 0x08); // DQT mínimo
  parts.push(0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33); // SOS + «datos»
  parts.push(0xff, 0xd9);
  return new Uint8Array(parts);
}

describe('DPI en PNG (pHYs)', () => {
  it('300 dpi → 11811 píxeles/metro y vuelve a leerse como 300', () => {
    const out = setPngDpi(tinyPng(), 300);
    const r = readPngDpi(out)!;
    expect(r.ppmX).toBe(11811);
    expect(r.ppmY).toBe(11811);
    expect(r.x).toBe(300);
    expect(dpiToPpm(300)).toBe(11811);
    expect(dpiToPpm(72)).toBe(2835);
  });

  it('el chunk queda justo tras IHDR, antes de IDAT, con CRC válido y unidad = metro', () => {
    const out = setPngDpi(tinyPng(), 300);
    expect(chunkTypes(out)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    // bytes exactos del chunk: longitud 9, «pHYs», 11811, 11811, unidad 1
    const at = 8 + 25;
    expect(Array.from(out.subarray(at, at + 8))).toEqual([0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73]);
    expect(Array.from(out.subarray(at + 8, at + 17))).toEqual([0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1]);
  });

  it('reemplaza un pHYs previo y no duplica', () => {
    const old = pngChunk('pHYs', new Uint8Array([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])); // 72 dpi
    const src = tinyPng([old]);
    expect(readPngDpi(src)!.x).toBe(72);
    const out = setPngDpi(src, 150);
    expect(chunkTypes(out).filter((t) => t === 'pHYs').length).toBe(1);
    expect(readPngDpi(out)!.x).toBe(150);
  });

  it('convive con los metadatos de texto', () => {
    const out = setPngDpi(addPngMeta(tinyPng(), { title: 'Cartel' }), 300);
    expect(readPngText(out).Title).toBe('Cartel');
    expect(readPngDpi(out)!.x).toBe(300);
    expect(chunkTypes(out)).toContain('iTXt');
  });

  it('no toca lo que no es PNG, y un PNG sin pHYs se lee como null', () => {
    const junk = new Uint8Array([1, 2, 3, 4]);
    expect(setPngDpi(junk, 300)).toBe(junk);
    expect(readPngDpi(tinyPng())).toBeNull();
  });
});

describe('DPI en JPG (JFIF + EXIF)', () => {
  it('reescribe el JFIF (unidad = pulgada) y añade EXIF con el mismo valor', () => {
    const out = setJpegDpi(tinyJpeg(), 300);
    const r = readJpegDpi(out);
    expect(r.jfif).toEqual({ units: 1, x: 300, y: 300 });
    expect(r.exif).toEqual({ x: 300, y: 300, unit: 2 });
    // sigue siendo un JPEG: SOI al principio, EOI al final y los datos intactos
    expect(Array.from(out.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(out.subarray(out.length - 2))).toEqual([0xff, 0xd9]);
    const body = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x08, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9];
    expect(Array.from(out.subarray(out.length - body.length))).toEqual(body);
  });

  it('crea el JFIF si el archivo no lo tenía', () => {
    const out = setJpegDpi(tinyJpeg('none'), 150);
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe0);
    expect(readJpegDpi(out).jfif).toEqual({ units: 1, x: 150, y: 150 });
  });

  it('es idempotente: aplicar dos veces deja un solo JFIF y un solo EXIF', () => {
    const out = setJpegDpi(setJpegDpi(tinyJpeg(), 72), 300);
    const text = new TextDecoder('latin1').decode(out);
    expect(text.split('JFIF').length - 1).toBe(1);
    expect(text.split('Exif').length - 1).toBe(1);
    expect(readJpegDpi(out).jfif!.x).toBe(300);
  });

  it('con metadatos de texto: EXIF único con descripción y resolución', () => {
    const out = setJpegDpi(tinyJpeg(), 300, { title: 'Cartel', author: 'Ana' });
    const text = new TextDecoder('latin1').decode(out);
    expect(text).toContain('Cartel');
    expect(text.split('Exif').length - 1).toBe(1);
    expect(readJpegDpi(out).exif!.x).toBe(300);
  });

  it('dpi no entero (72 × 1,5 = 108) y no-JPEG', () => {
    expect(readJpegDpi(setJpegDpi(tinyJpeg(), 108)).jfif!.x).toBe(108);
    const junk = new Uint8Array([9, 9]);
    expect(setJpegDpi(junk, 300)).toBe(junk);
  });
});

describe('dpi del archivo = dpi del documento × escala', () => {
  it('conserva el tamaño físico al exportar a otra escala', () => {
    expect(fileDpi(300, 1)).toBe(300);
    expect(fileDpi(150, 2)).toBe(300);
    expect(fileDpi(96, 0.5)).toBe(48);
  });
  it('sin dpi válido en el documento no se escribe nada', () => {
    expect(fileDpi(undefined, 1)).toBeUndefined();
    expect(fileDpi(5, 1)).toBeUndefined(); // fuera de rango
    expect(fileDpi('300', 1)).toBeUndefined();
  });
});
