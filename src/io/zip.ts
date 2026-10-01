// Escritor ZIP mínimo y sin dependencias: método «store» (sin compresión, los
// PNG/JPG/WebP ya vienen comprimidos), CRC32 y fecha/hora DOS. Nombres en UTF-8.
// Límites: sin ZIP64 (hasta 65 535 archivos y 4 GB en total).

export interface ZipEntry {
  name: string; // ruta dentro del ZIP, con «/» como separador
  data: Uint8Array;
  date?: Date;
}

let TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (TABLE) return TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  TABLE = t;
  return t;
}

// CRC32 (IEEE 802.3), el mismo de ZIP y PNG. `seed` permite encadenar trozos.
export function crc32(bytes: Uint8Array, seed = 0): number {
  const t = crcTable();
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fecha y hora en formato MS-DOS (año 1980-2107, segundos de 2 en 2).
export function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

const enc = new TextEncoder();

export function makeZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new Error('Demasiados archivos para un ZIP');
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();

  for (const e of entries) {
    const name = enc.encode(e.name.replace(/\\/g, '/'));
    const { date, time } = dosDateTime(e.date ?? now);
    const crc = crc32(e.data);
    const size = e.data.length;
    if (size > 0xffffffff || offset > 0xffffffff) throw new Error('El ZIP supera los 4 GB');

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // versión necesaria
    lv.setUint16(6, 0x0800, true); // bit 11: nombre en UTF-8
    lv.setUint16(8, 0, true); // método 0 = store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // versión de creación
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    // 30 extra, 32 comentario, 34 disco, 36 attr. internos, 38 attr. externos = 0
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    chunks.push(local, e.data);
    central.push(cd);
    offset += local.length + size;
  }

  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export async function blobToBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

export function zipToBlob(entries: ZipEntry[]): Blob {
  return new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' });
}
