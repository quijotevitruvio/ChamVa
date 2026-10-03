// Desmultiplexor MP4/MOV mínimo (ISO BMFF): lee solo la caja `moov` y construye
// la tabla de muestras; los datos (`mdat`) se leen después muestra a muestra.
// Soporta moov al principio o al final, cajas de 64 bits, co64, ctts (B-frames),
// listas de edición (elst, desfase de inicio de los móviles y del AAC) y la
// matriz de rotación de tkhd. No soporta MP4 fragmentado (moof): se informa.
import { BlobReader } from '../byteReader';
import {
  type AudioTrackInfo,
  type DemuxedFile,
  type SampleTable,
  type VideoTrackInfo,
  UnsupportedMediaError,
  aacCodecFromAsc,
  av1CodecFromAv1C,
  avcCodecFromAvcC,
  hevcCodecFromHvcC,
} from './types';

interface Box {
  type: string;
  start: number; // inicio del contenido (tras la cabecera), relativo al buffer
  end: number;
}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const i32 = (b: Uint8Array, o: number) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 4294967296 + u32(b, o + 4);
const i64 = (b: Uint8Array, o: number) => {
  const hi = i32(b, o);
  return hi * 4294967296 + u32(b, o + 4);
};
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Lista las cajas hijas dentro de [start, end). */
export function childBoxes(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p);
    const type = fourcc(b, p + 4);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) break;
      size = u64(b, p + 8);
      header = 16;
    } else if (size === 0) size = end - p;
    if (size < header || p + size > end) break;
    out.push({ type, start: p + header, end: p + size });
    p += size;
  }
  return out;
}

const find = (boxes: Box[], type: string) => boxes.find((x) => x.type === type);

/** Busca la caja moov en el nivel superior leyendo solo cabeceras. */
async function readMoov(r: BlobReader): Promise<{ moov: Uint8Array; fragmented: boolean }> {
  let pos = 0;
  let sawMoof = false;
  while (pos + 8 <= r.size) {
    const h = await r.read(pos, 16);
    if (h.length < 8) break;
    let size = u32(h, 0);
    const type = fourcc(h, 4);
    let header = 8;
    if (size === 1) {
      size = u64(h, 8);
      header = 16;
    } else if (size === 0) size = r.size - pos;
    if (size < header) throw new UnsupportedMediaError('MP4 dañado (caja de tamaño inválido)');
    if (type === 'moof') sawMoof = true;
    if (type === 'moov') {
      const moov = (await r.read(pos + header, size - header)).slice();
      return { moov, fragmented: sawMoof };
    }
    pos += size;
  }
  throw new UnsupportedMediaError('MP4 sin caja moov (archivo incompleto o fragmentado)');
}

export async function demuxMp4(blob: Blob): Promise<DemuxedFile> {
  const r = new BlobReader(blob, 1 << 20);
  const { moov } = await readMoov(r);
  const top = childBoxes(moov, 0, moov.length);
  const mvhd = find(top, 'mvhd');
  let movieTimescale = 1000;
  let movieDuration = 0;
  if (mvhd) {
    const v = moov[mvhd.start];
    movieTimescale = u32(moov, mvhd.start + (v === 1 ? 20 : 12)) || 1000;
    movieDuration = v === 1 ? u64(moov, mvhd.start + 24) : u32(moov, mvhd.start + 16);
  }
  const fragmented = !!find(top, 'mvex');
  let video: VideoTrackInfo | undefined;
  let audio: AudioTrackInfo | undefined;
  for (const trak of top.filter((x) => x.type === 'trak')) {
    const t = parseTrak(moov, trak, movieTimescale);
    if (!t) continue;
    if (t.kind === 'video' && !video && t.samples.count) video = t;
    if (t.kind === 'audio' && !audio && t.samples.count) audio = t;
  }
  if (!video && !audio) {
    if (fragmented) throw new UnsupportedMediaError('MP4 fragmentado: no compatible todavía con el motor rápido');
    throw new UnsupportedMediaError('MP4 sin pistas de video ni audio reconocibles');
  }
  let duration = movieDuration / movieTimescale;
  const lastEnd = (s?: SampleTable) => {
    if (!s || !s.count) return 0;
    let m = 0;
    for (let i = 0; i < s.count; i++) m = Math.max(m, s.pts[i] + s.dur[i]);
    return m;
  };
  if (!(duration > 0)) duration = Math.max(lastEnd(video?.samples), lastEnd(audio?.samples));
  return { container: 'mp4', duration, video, audio };
}

function parseTrak(b: Uint8Array, trak: Box, movieTimescale: number): VideoTrackInfo | AudioTrackInfo | null {
  const kids = childBoxes(b, trak.start, trak.end);
  const tkhd = find(kids, 'tkhd');
  const mdia = find(kids, 'mdia');
  if (!mdia) return null;
  const mk = childBoxes(b, mdia.start, mdia.end);
  const mdhd = find(mk, 'mdhd');
  const hdlr = find(mk, 'hdlr');
  const minf = find(mk, 'minf');
  if (!mdhd || !hdlr || !minf) return null;
  const handler = fourcc(b, hdlr.start + 8);
  if (handler !== 'vide' && handler !== 'soun') return null;
  const mv = b[mdhd.start];
  const timescale = u32(b, mdhd.start + (mv === 1 ? 20 : 12)) || 1;
  const stbl = find(childBoxes(b, minf.start, minf.end), 'stbl');
  if (!stbl) return null;
  const st = childBoxes(b, stbl.start, stbl.end);

  // --- lista de edición: desfase de presentación ---
  let mediaTime = 0;
  let emptyOffset = 0; // s (escala de la película)
  const edts = find(kids, 'edts');
  if (edts) {
    const elst = find(childBoxes(b, edts.start, edts.end), 'elst');
    if (elst) {
      const v = b[elst.start];
      const n = u32(b, elst.start + 4);
      let p = elst.start + 8;
      for (let i = 0; i < n; i++) {
        const segDur = v === 1 ? u64(b, p) : u32(b, p);
        const mt = v === 1 ? i64(b, p + 8) : i32(b, p + 4);
        p += v === 1 ? 20 : 12;
        if (mt === -1) {
          emptyOffset += segDur / movieTimescale;
          continue;
        }
        mediaTime = mt;
        break;
      }
    }
  }

  const samples = buildSamples(b, st, timescale, mediaTime, emptyOffset);
  const stsd = find(st, 'stsd');
  if (!stsd) return null;
  const entries = childBoxes(b, stsd.start + 8, stsd.end);
  const entry = entries[0];
  if (!entry) return null;

  if (handler === 'vide') {
    const width = u16(b, entry.start + 24);
    const height = u16(b, entry.start + 26);
    const ch = childBoxes(b, entry.start + 78, entry.end);
    let codec = '';
    let description: Uint8Array | undefined;
    const avcC = find(ch, 'avcC');
    const hvcC = find(ch, 'hvcC');
    const vpcC = find(ch, 'vpcC');
    const av1C = find(ch, 'av1C');
    if ((entry.type === 'avc1' || entry.type === 'avc3') && avcC) {
      description = b.slice(avcC.start, avcC.end);
      codec = avcCodecFromAvcC(description);
    } else if ((entry.type === 'hvc1' || entry.type === 'hev1') && hvcC) {
      description = b.slice(hvcC.start, hvcC.end);
      codec = hevcCodecFromHvcC(description, entry.type);
    } else if (entry.type === 'vp09' && vpcC) {
      const p = vpcC.start + 4;
      const prof = b[p];
      const lvl = b[p + 1];
      const depth = b[p + 2] >> 4;
      codec = `vp09.${String(prof).padStart(2, '0')}.${String(lvl).padStart(2, '0')}.${String(depth || 8).padStart(2, '0')}`;
    } else if (entry.type === 'av01' && av1C) {
      description = b.slice(av1C.start, av1C.end);
      codec = av1CodecFromAv1C(description);
    } else if (entry.type === 'vp08') {
      codec = 'vp8';
    } else return null;
    let rotation: 0 | 90 | 180 | 270 = 0;
    if (tkhd) {
      const v = b[tkhd.start];
      const m = tkhd.start + (v === 1 ? 52 : 40);
      const a = i32(b, m) / 65536;
      const bb = i32(b, m + 4) / 65536;
      const deg = ((Math.round((Math.atan2(bb, a) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;
      rotation = deg as 0 | 90 | 180 | 270;
    }
    return { kind: 'video', codec, description, codedWidth: width, codedHeight: height, rotation, samples };
  }

  // --- audio ---
  const ver = u16(b, entry.start + 8);
  let channels = u16(b, entry.start + 16);
  let sampleRate = u32(b, entry.start + 24) / 65536;
  let childStart = entry.start + 28;
  if (ver === 1) childStart += 16;
  else if (ver === 2) {
    childStart += 36;
    // QuickTime v2: frecuencia en coma flotante de 64 bits y canales en 32 bits
    const dv = new DataView(b.buffer, b.byteOffset + entry.start + 32, 8);
    sampleRate = dv.getFloat64(0);
    channels = u32(b, entry.start + 40);
  }
  let ch = childBoxes(b, childStart, entry.end);
  const wave = find(ch, 'wave');
  if (wave) ch = ch.concat(childBoxes(b, wave.start, wave.end));
  let codec = '';
  let description: Uint8Array | undefined;
  if (entry.type === 'mp4a') {
    const esds = find(ch, 'esds');
    const info = esds ? parseEsds(b.subarray(esds.start + 4, esds.end)) : null;
    if (info && (info.oti === 0x69 || info.oti === 0x6b)) codec = 'mp3';
    else {
      description = info?.asc;
      codec = aacCodecFromAsc(description);
    }
  } else if (entry.type === 'Opus') {
    const dOps = find(ch, 'dOps');
    if (!dOps) return null;
    description = opusHeadFromDOps(b.subarray(dOps.start, dOps.end));
    codec = 'opus';
    sampleRate = 48000;
  } else if (entry.type === '.mp3') {
    codec = 'mp3';
  } else if (entry.type === 'fLaC') {
    codec = 'flac';
  } else return null;
  return { kind: 'audio', codec, description, sampleRate: sampleRate || 48000, channels: channels || 2, samples };
}

function buildSamples(b: Uint8Array, st: Box[], timescale: number, mediaTime: number, emptyOffset: number): SampleTable {
  const stsz = find(st, 'stsz');
  const stz2 = find(st, 'stz2');
  let count = 0;
  let sizes: Uint32Array;
  if (stsz) {
    const fixed = u32(b, stsz.start + 4);
    count = u32(b, stsz.start + 8);
    sizes = new Uint32Array(count);
    if (fixed) sizes.fill(fixed);
    else for (let i = 0; i < count; i++) sizes[i] = u32(b, stsz.start + 12 + i * 4);
  } else if (stz2) {
    const field = b[stz2.start + 7];
    count = u32(b, stz2.start + 8);
    sizes = new Uint32Array(count);
    const p = stz2.start + 12;
    for (let i = 0; i < count; i++) {
      if (field === 16) sizes[i] = u16(b, p + i * 2);
      else if (field === 8) sizes[i] = b[p + i];
      else sizes[i] = (b[p + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15;
    }
  } else sizes = new Uint32Array(0);

  const table: SampleTable = {
    count,
    offset: new Float64Array(count),
    size: sizes,
    pts: new Float64Array(count),
    dur: new Float64Array(count),
    key: new Uint8Array(count),
  };
  if (!count) return table;

  // Tiempos de decodificación (stts)
  const dts = new Float64Array(count);
  const stts = find(st, 'stts');
  if (stts) {
    const n = u32(b, stts.start + 4);
    let i = 0;
    let t = 0;
    for (let e = 0; e < n && i < count; e++) {
      const c = u32(b, stts.start + 8 + e * 8);
      const d = u32(b, stts.start + 12 + e * 8);
      for (let k = 0; k < c && i < count; k++, i++) {
        dts[i] = t;
        table.dur[i] = d / timescale;
        t += d;
      }
    }
  }
  // Desfase de composición (ctts)
  const cts = Float64Array.from(dts);
  const ctts = find(st, 'ctts');
  if (ctts) {
    const v = b[ctts.start];
    const n = u32(b, ctts.start + 4);
    let i = 0;
    for (let e = 0; e < n && i < count; e++) {
      const c = u32(b, ctts.start + 8 + e * 8);
      const off = v === 1 ? i32(b, ctts.start + 12 + e * 8) : u32(b, ctts.start + 12 + e * 8);
      for (let k = 0; k < c && i < count; k++, i++) cts[i] += off;
    }
  }
  for (let i = 0; i < count; i++) table.pts[i] = (cts[i] - mediaTime) / timescale + emptyOffset;

  // Muestras clave (stss); sin stss, todas lo son
  const stss = find(st, 'stss');
  if (stss) {
    const n = u32(b, stss.start + 4);
    for (let e = 0; e < n; e++) {
      const idx = u32(b, stss.start + 8 + e * 4) - 1;
      if (idx >= 0 && idx < count) table.key[idx] = 1;
    }
  } else table.key.fill(1);

  // Posiciones: stsc + stco/co64
  const stsc = find(st, 'stsc');
  const stco = find(st, 'stco');
  const co64 = find(st, 'co64');
  const chunkCount = stco ? u32(b, stco.start + 4) : co64 ? u32(b, co64.start + 4) : 0;
  const chunkOffset = (c: number) => (stco ? u32(b, stco.start + 8 + c * 4) : u64(b, co64!.start + 8 + c * 8));
  if (stsc && chunkCount) {
    const n = u32(b, stsc.start + 4);
    const rows: { first: number; per: number }[] = [];
    for (let e = 0; e < n; e++) rows.push({ first: u32(b, stsc.start + 8 + e * 12) - 1, per: u32(b, stsc.start + 12 + e * 12) });
    let s = 0;
    for (let r = 0; r < rows.length && s < count; r++) {
      const lastChunk = r + 1 < rows.length ? rows[r + 1].first : chunkCount;
      for (let c = rows[r].first; c < lastChunk && s < count; c++) {
        let off = chunkOffset(c);
        for (let k = 0; k < rows[r].per && s < count; k++, s++) {
          table.offset[s] = off;
          off += sizes[s];
        }
      }
    }
  }
  return table;
}

function readDescLen(b: Uint8Array, p: number): { len: number; p: number } {
  let len = 0;
  for (let i = 0; i < 4; i++) {
    const c = b[p++];
    len = (len << 7) | (c & 0x7f);
    if (!(c & 0x80)) break;
  }
  return { len, p };
}

/** Lee el ES_Descriptor: tipo de objeto y AudioSpecificConfig. */
export function parseEsds(b: Uint8Array): { oti: number; asc?: Uint8Array } | null {
  let p = 0;
  if (b[p++] !== 0x03) return null;
  let r = readDescLen(b, p);
  p = r.p + 2; // ES_ID
  const flags = b[p++];
  if (flags & 0x80) p += 2;
  if (flags & 0x40) p += 1 + b[p];
  if (flags & 0x20) p += 2;
  if (b[p++] !== 0x04) return null;
  r = readDescLen(b, p);
  p = r.p;
  const oti = b[p];
  p += 13;
  if (b[p] !== 0x05) return { oti };
  r = readDescLen(b, p + 1);
  return { oti, asc: b.slice(r.p, r.p + r.len) };
}

/** Convierte la caja dOps (Opus en MP4, big-endian) en la cabecera OpusHead que pide WebCodecs. */
export function opusHeadFromDOps(d: Uint8Array): Uint8Array {
  const channels = d[1];
  const preSkip = u16(d, 2);
  const rate = u32(d, 4);
  const gain = (d[8] << 8) | d[9];
  const family = d[10];
  const extra = family ? d.subarray(11) : new Uint8Array(0);
  const out = new Uint8Array(19 + extra.length);
  out.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
  out[8] = 1;
  out[9] = channels;
  out[10] = preSkip & 0xff;
  out[11] = preSkip >> 8;
  out[12] = rate & 0xff;
  out[13] = (rate >> 8) & 0xff;
  out[14] = (rate >> 16) & 0xff;
  out[15] = (rate >>> 24) & 0xff;
  out[16] = gain & 0xff;
  out[17] = (gain >> 8) & 0xff;
  out[18] = family;
  out.set(extra, 19);
  return out;
}
