// Lector ZIP mínimo, pareja de zip.ts. Solo abre ZIP «store» (método 0, sin
// compresión), que es lo que escribe makeZip. NO abre ZIP hechos por otros
// programas con deflate: da un error claro. Comprueba el CRC32 de cada archivo.
import { crc32 } from './zip';

export interface ZipFileEntry {
  name: string;
  data: Uint8Array;
}

// ¿Empieza por la firma de ZIP (local header o fin de directorio de un ZIP vacío)?
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

const dec = new TextDecoder('utf-8');

export function readZip(bytes: Uint8Array): ZipFileEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin del directorio central: se busca hacia atrás (puede llevar comentario).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('No es un ZIP válido');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ZipFileEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP dañado');
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (method !== 0) {
      throw new Error('Este ZIP está comprimido; ChamVa solo abre los ZIP que él mismo crea');
    }
    if (local + 30 > bytes.length || v.getUint32(local, true) !== 0x04034b50) throw new Error('ZIP dañado');
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + csize > bytes.length) throw new Error('ZIP truncado');
    const data = bytes.slice(start, start + csize);
    if (crc32(data) !== crc) throw new Error(`ZIP dañado (CRC de ${name})`);
    if (!name.endsWith('/')) out.push({ name, data });
  }
  return out;
}
