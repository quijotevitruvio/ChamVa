// Animaciones ligeras para web: APNG y WebP animado.
// No recomprimen nada: reciben los fotogramas ya codificados por el navegador
// (canvas.toBlob) y solo reorganizan sus chunks dentro del contenedor animado.
//   APNG  → PNG con chunks acTL / fcTL / fdAT (CRC de zip.ts, el mismo de PNG).
//   WebP  → RIFF «WEBP» con VP8X + ANIM + un ANMF por fotograma.
// Todos los fotogramas deben tener el mismo tamaño.
import { crc32 } from './zip';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Chunk {
  type: string;
  data: Uint8Array;
}

function readPngChunks(png: Uint8Array): Chunk[] {
  for (let i = 0; i < 8; i++) if (png[i] !== PNG_SIG[i]) throw new Error('Un fotograma no es PNG');
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  let p = 8;
  while (p + 12 <= png.length) {
    const len = v.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    out.push({ type, data: png.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// Une fotogramas PNG en un APNG. `delaysMs`: un retardo por fotograma (o uno solo para todos).
// loops = 0 → infinito.
export function buildApng(frames: Uint8Array[], delaysMs: number[], loops = 0): Uint8Array {
  if (!frames.length) throw new Error('No hay fotogramas');
  const parsed = frames.map(readPngChunks);
  const ihdr0 = parsed[0].find((c) => c.type === 'IHDR')!.data;
  const w = new DataView(ihdr0.buffer, ihdr0.byteOffset).getUint32(0);
  const h = new DataView(ihdr0.buffer, ihdr0.byteOffset).getUint32(4);
  const parts: Uint8Array[] = [new Uint8Array(PNG_SIG), pngChunk('IHDR', ihdr0)];
  // Paleta y transparencia del primer fotograma (si la hubiera).
  for (const c of parsed[0]) if (c.type === 'PLTE' || c.type === 'tRNS') parts.push(pngChunk(c.type, c.data));
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length);
  new DataView(actl.buffer).setUint32(4, loops);
  parts.push(pngChunk('acTL', actl));

  let seq = 0;
  parsed.forEach((chunks, i) => {
    const ihdr = chunks.find((c) => c.type === 'IHDR')!.data;
    if (ihdr.length !== ihdr0.length || ihdr.some((b, k) => b !== ihdr0[k])) {
      throw new Error('Todos los fotogramas deben tener el mismo tamaño y formato');
    }
    const fctl = new Uint8Array(26);
    const v = new DataView(fctl.buffer);
    v.setUint32(0, seq++);
    v.setUint32(4, w);
    v.setUint32(8, h);
    // x e y = 0
    v.setUint16(20, Math.max(1, Math.min(65535, Math.round(delaysMs[i] ?? delaysMs[delaysMs.length - 1] ?? 100))));
    v.setUint16(22, 1000);
    fctl[24] = 0; // dispose: ninguno
    fctl[25] = 0; // blend: sobrescribir (el fotograma ya lleva su propio fondo/alfa)
    parts.push(pngChunk('fcTL', fctl));
    for (const c of chunks) {
      if (c.type !== 'IDAT') continue;
      if (i === 0) parts.push(pngChunk('IDAT', c.data));
      else {
        const d = new Uint8Array(4 + c.data.length);
        new DataView(d.buffer).setUint32(0, seq++);
        d.set(c.data, 4);
        parts.push(pngChunk('fdAT', d));
      }
    }
  });
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

// ---------- WebP animado ----------

function fourcc(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  out.set(fourcc(type), 0);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}
function u24(v: DataView, o: number, n: number) {
  v.setUint8(o, n & 0xff);
  v.setUint8(o + 1, (n >> 8) & 0xff);
  v.setUint8(o + 2, (n >> 16) & 0xff);
}

// Chunks de imagen de un WebP (VP8 / VP8L / ALPH…), sin la cabecera VP8X ni metadatos.
export function webpImageChunks(webp: Uint8Array): { chunks: Uint8Array; width: number; height: number; hasAlpha: boolean } {
  const tag = (o: number) => String.fromCharCode(webp[o], webp[o + 1], webp[o + 2], webp[o + 3]);
  if (webp.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') throw new Error('Un fotograma no es WebP');
  const v = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const keep: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  let p = 12;
  while (p + 8 <= webp.length) {
    const type = tag(p);
    const len = v.getUint32(p + 4, true);
    const end = p + 8 + len + (len & 1);
    const body = webp.subarray(p + 8, p + 8 + len);
    if (type === 'VP8X') {
      hasAlpha = (body[0] & 0x10) !== 0;
      width = 1 + (body[4] | (body[5] << 8) | (body[6] << 16));
      height = 1 + (body[7] | (body[8] << 8) | (body[9] << 16));
    } else if (type === 'ALPH') {
      hasAlpha = true;
      keep.push(webp.subarray(p, Math.min(end, webp.length)));
    } else if (type === 'VP8 ' || type === 'VP8L') {
      keep.push(webp.subarray(p, Math.min(end, webp.length)));
      if (!width) {
        if (type === 'VP8L') {
          const b = body[1] | (body[2] << 8) | (body[3] << 16) | (body[4] << 24);
          width = (b & 0x3fff) + 1;
          height = ((b >> 14) & 0x3fff) + 1;
          if ((body[4] >> 4) & 1) hasAlpha = true;
        } else {
          width = (body[6] | (body[7] << 8)) & 0x3fff;
          height = (body[8] | (body[9] << 8)) & 0x3fff;
        }
      }
    }
    p = end;
  }
  if (!keep.length) throw new Error('El WebP no tiene datos de imagen');
  return { chunks: concat(keep), width, height, hasAlpha };
}

export function buildAnimatedWebp(frames: Uint8Array[], delaysMs: number[], loops = 0): Uint8Array {
  if (!frames.length) throw new Error('No hay fotogramas');
  const infos = frames.map(webpImageChunks);
  const { width, height } = infos[0];
  if (!width || !height) throw new Error('No se pudo leer el tamaño del WebP');
  let alpha = false;
  const anmf: Uint8Array[] = [];
  infos.forEach((f, i) => {
    if (f.width !== width || f.height !== height) throw new Error('Todos los fotogramas deben tener el mismo tamaño');
    alpha ||= f.hasAlpha;
    const head = new Uint8Array(16);
    const v = new DataView(head.buffer);
    // x, y = 0 (bytes 0..5); ancho-1, alto-1, duración
    u24(v, 6, width - 1);
    u24(v, 9, height - 1);
    u24(v, 12, Math.max(1, Math.min(0xffffff, Math.round(delaysMs[i] ?? delaysMs[delaysMs.length - 1] ?? 100))));
    head[15] = 0x02; // flags: bit 1 = no mezclar con el fotograma anterior
    anmf.push(riffChunk('ANMF', concat([head, f.chunks])));
  });
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02 | (alpha ? 0x10 : 0); // animación (+ alfa)
  u24(new DataView(vp8x.buffer), 4, width - 1);
  u24(new DataView(vp8x.buffer), 7, height - 1);
  const anim = new Uint8Array(6); // color de fondo 0 (transparente) + bucles
  new DataView(anim.buffer).setUint16(4, loops, true);
  const body = concat([fourcc('WEBP'), riffChunk('VP8X', vp8x), riffChunk('ANIM', anim), ...anmf]);
  const out = new Uint8Array(8 + body.length);
  out.set(fourcc('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}
