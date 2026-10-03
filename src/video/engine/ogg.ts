// Contenedor Ogg para Opus (RFC 3533 y RFC 7845), propio y sin dependencias: páginas con CRC-32 (polinomio
// 0x04C11DB7), cabecera OpusHead, comentarios OpusTags y paquetes de Opus que salen del AudioEncoder de WebCodecs.
// La posición de gránulo cuenta muestras a 48 kHz INCLUIDO el pre-salto; la última página recorta el relleno del codificador.

/** Pre-salto típico de libopus a 48 kHz (6,5 ms de anticipación). */
export const OPUS_PRESKIP = 312;

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

/** CRC-32 de Ogg (sin reflejar, inicio 0). */
export function oggCrc(data: Uint8Array): number {
  const t = crcTable();
  let crc = 0;
  for (let i = 0; i < data.length; i++) crc = ((crc << 8) ^ t[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

export function opusHead(channels: number, sampleRate: number, preSkip = OPUS_PRESKIP): Uint8Array {
  const h = new Uint8Array(19);
  const v = new DataView(h.buffer);
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // OpusHead
  h[8] = 1; // versión
  h[9] = channels;
  v.setUint16(10, preSkip, true);
  v.setUint32(12, sampleRate, true);
  v.setInt16(16, 0, true); // ganancia de salida
  h[18] = 0; // familia de canales 0 (mono/estéreo)
  return h;
}

export function opusTags(vendor = 'ChamVa'): Uint8Array {
  const enc = new TextEncoder().encode(vendor);
  const t = new Uint8Array(8 + 4 + enc.length + 4);
  const v = new DataView(t.buffer);
  t.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); // OpusTags
  v.setUint32(8, enc.length, true);
  t.set(enc, 12);
  v.setUint32(12 + enc.length, 0, true); // sin comentarios
  return t;
}

interface Pkt {
  data: Uint8Array;
  samples: number;
}

/** Escribe un flujo Ogg Opus. `write` recibe los bytes en orden (se concatenan tal cual). */
export class OggOpusWriter {
  private seq = 0;
  private granule = 0;
  private pending: Pkt[] = [];
  private segs = 0;
  private finished = false;
  readonly preSkip: number;

  constructor(private write: (bytes: Uint8Array) => void, channels = 2, sampleRate = 48000, preSkip = OPUS_PRESKIP, private serial = (Math.random() * 0xffffffff) >>> 0) {
    this.preSkip = preSkip;
    this.page([opusHead(channels, sampleRate, preSkip)], 0, 0x02); // BOS
    this.page([opusTags()], 0, 0);
  }

  private page(packets: Uint8Array[], granule: number, type: number) {
    const segTable: number[] = [];
    let size = 0;
    for (const p of packets) {
      let n = p.length;
      while (n >= 255) {
        segTable.push(255);
        n -= 255;
      }
      segTable.push(n);
      size += p.length;
    }
    const out = new Uint8Array(27 + segTable.length + size);
    const v = new DataView(out.buffer);
    out.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
    out[4] = 0;
    out[5] = type;
    // granule 64 bits (nunca pasa de 2^53)
    v.setUint32(6, granule >>> 0, true);
    v.setUint32(10, Math.floor(granule / 4294967296) >>> 0, true);
    v.setUint32(14, this.serial, true);
    v.setUint32(18, this.seq++, true);
    v.setUint32(22, 0, true);
    out[26] = segTable.length;
    out.set(segTable, 27);
    let o = 27 + segTable.length;
    for (const p of packets) {
      out.set(p, o);
      o += p.length;
    }
    v.setUint32(22, oggCrc(out), true);
    this.write(out);
  }

  /** Añade un paquete de Opus que dura `samples` muestras a 48 kHz (960 = 20 ms). */
  addPacket(data: Uint8Array, samples: number) {
    if (this.finished) return;
    const need = Math.floor(data.length / 255) + 1;
    if (this.segs + need > 255 || this.pending.length >= 32) this.flushPage(0);
    this.pending.push({ data: data.slice(), samples });
    this.segs += need;
  }

  private flushPage(type: number, granuleOverride?: number) {
    if (!this.pending.length) return;
    for (const p of this.pending) this.granule += p.samples;
    this.page(this.pending.map((p) => p.data), granuleOverride ?? this.granule + this.preSkip, type);
    this.pending = [];
    this.segs = 0;
  }

  /**
   * Cierra el flujo. `totalSamples` = muestras reales de audio (sin el relleno del codificador): fija la posición
   * de gránulo final para que el decodificador recorte el sobrante.
   */
  finish(totalSamples?: number) {
    if (this.finished) return;
    this.finished = true;
    if (!this.pending.length) {
      // sin paquetes pendientes: página vacía de fin de flujo
      this.page([], this.granule + this.preSkip, 0x04);
      return;
    }
    const full = this.granule + this.pending.reduce((a, p) => a + p.samples, 0) + this.preSkip;
    const end = totalSamples !== undefined ? Math.min(full, totalSamples + this.preSkip) : full;
    this.flushPage(0x04, end);
  }
}
