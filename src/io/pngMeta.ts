// Metadatos de texto escritos a mano en PNG (chunks iTXt) y JPG (EXIF mínimo + COM).
// Los canvas no incluyen metadatos (ni EXIF ni GPS), así que por defecto los
// archivos exportados salen limpios; esto solo se usa si el usuario lo pide.
import { crc32 } from './zip';

export interface MetaFields {
  title?: string;
  author?: string;
  description?: string;
  copyright?: string;
}

const enc = new TextEncoder();

export function hasMeta(m: MetaFields | undefined | null): boolean {
  return !!m && !!(m.title?.trim() || m.author?.trim() || m.description?.trim() || m.copyright?.trim());
}

// Palabras clave estándar de PNG (Latin-1).
const PNG_KEYS: [keyof MetaFields, string][] = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['description', 'Description'],
  ['copyright', 'Copyright'],
];

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Un chunk PNG: longitud + tipo + datos + CRC(tipo+datos).
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const td = concat([enc.encode(type), data]);
  return concat([u32(data.length), td, u32(crc32(td))]);
}

// iTXt sin comprimir, texto UTF-8: clave\0 flag(0) método(0) idioma\0 clave-traducida\0 texto
export function itxtChunk(keyword: string, text: string): Uint8Array {
  const data = concat([enc.encode(keyword), new Uint8Array([0, 0, 0, 0, 0]), enc.encode(text)]);
  return pngChunk('iTXt', data);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Inserta los metadatos justo después de IHDR. Si no es un PNG válido, lo devuelve igual.
export function addPngMeta(png: Uint8Array, meta: MetaFields): Uint8Array {
  if (!hasMeta(meta)) return png;
  for (let i = 0; i < 8; i++) if (png[i] !== PNG_SIG[i]) return png;
  const ihdrLen = new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(8, false);
  const afterIhdr = 8 + 12 + ihdrLen;
  const chunks: Uint8Array[] = [];
  for (const [k, key] of PNG_KEYS) {
    const v = meta[k]?.trim();
    if (v) chunks.push(itxtChunk(key, v));
  }
  return concat([png.subarray(0, afterIhdr), ...chunks, png.subarray(afterIhdr)]);
}

// Lectura mínima de los iTXt de un PNG (para pruebas y diagnóstico).
export function readPngText(png: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const dec = new TextDecoder();
  let p = 8;
  while (p + 12 <= png.length) {
    const len = v.getUint32(p, false);
    const type = dec.decode(png.subarray(p + 4, p + 8));
    if (type === 'iTXt') {
      const d = png.subarray(p + 8, p + 8 + len);
      const z = d.indexOf(0);
      const key = dec.decode(d.subarray(0, z));
      // tras la clave: flag, método, idioma\0, clave-traducida\0
      let q = z + 3;
      q = d.indexOf(0, q) + 1;
      q = d.indexOf(0, q) + 1;
      out[key] = dec.decode(d.subarray(q));
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}

// ---- JPG ----

// EXIF solo admite ASCII: se quitan los acentos y lo no representable.
export function ascii(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

// APP1 «Exif» mínimo (TIFF little-endian) con ImageDescription, Artist y Copyright.
export function buildExifApp1(meta: MetaFields): Uint8Array | null {
  const tags: [number, string][] = [];
  const desc = [meta.title, meta.description].filter((s) => s?.trim()).join(' - ');
  if (desc) tags.push([0x010e, ascii(desc)]);
  if (meta.author?.trim()) tags.push([0x013b, ascii(meta.author.trim())]);
  if (meta.copyright?.trim()) tags.push([0x8298, ascii(meta.copyright.trim())]);
  if (!tags.length) return null;
  tags.sort((a, b) => a[0] - b[0]);
  const n = tags.length;
  const ifdSize = 2 + n * 12 + 4;
  let dataOff = 8 + ifdSize; // desplazamiento TIFF de los valores largos
  const strings = tags.map(([, s]) => enc.encode(s + '\0'));
  const total =
    8 + ifdSize + strings.reduce((a, s) => a + (s.length > 4 ? s.length + (s.length & 1) : 0), 0);
  const tiff = new Uint8Array(total);
  const v = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49], 0); // «II» little-endian
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, n, true);
  tags.forEach(([tag], i) => {
    const e = 10 + i * 12;
    const s = strings[i];
    v.setUint16(e, tag, true);
    v.setUint16(e + 2, 2, true); // tipo ASCII
    v.setUint32(e + 4, s.length, true);
    if (s.length <= 4) {
      tiff.set(s, e + 8);
    } else {
      v.setUint32(e + 8, dataOff, true);
      tiff.set(s, dataOff);
      dataOff += s.length + (s.length & 1);
    }
  });
  v.setUint32(10 + n * 12, 0, true); // sin más IFD
  const body = concat([enc.encode('Exif\0\0'), tiff]);
  if (body.length + 2 > 0xffff) return null;
  const seg = new Uint8Array(4 + body.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  new DataView(seg.buffer).setUint16(2, body.length + 2, false);
  seg.set(body, 4);
  return seg;
}

// Segmento COM (comentario) con el texto completo en UTF-8.
export function buildComSegment(meta: MetaFields): Uint8Array | null {
  const lines: string[] = [];
  if (meta.title?.trim()) lines.push(`Título: ${meta.title.trim()}`);
  if (meta.author?.trim()) lines.push(`Autor: ${meta.author.trim()}`);
  if (meta.description?.trim()) lines.push(`Descripción: ${meta.description.trim()}`);
  if (meta.copyright?.trim()) lines.push(`Derechos: ${meta.copyright.trim()}`);
  if (!lines.length) return null;
  const text = enc.encode(lines.join('\n')).subarray(0, 60000);
  const seg = new Uint8Array(4 + text.length);
  seg[0] = 0xff;
  seg[1] = 0xfe;
  new DataView(seg.buffer).setUint16(2, text.length + 2, false);
  seg.set(text, 4);
  return seg;
}

// Inserta EXIF + COM tras el SOI (y tras un APP0/JFIF si lo hay).
export function addJpegMeta(jpg: Uint8Array, meta: MetaFields): Uint8Array {
  if (!hasMeta(meta) || jpg[0] !== 0xff || jpg[1] !== 0xd8) return jpg;
  let at = 2;
  if (jpg[2] === 0xff && jpg[3] === 0xe0) {
    at = 4 + new DataView(jpg.buffer, jpg.byteOffset, jpg.byteLength).getUint16(4, false);
  }
  const extra = [buildExifApp1(meta), buildComSegment(meta)].filter((x): x is Uint8Array => !!x);
  return concat([jpg.subarray(0, at), ...extra, jpg.subarray(at)]);
}
