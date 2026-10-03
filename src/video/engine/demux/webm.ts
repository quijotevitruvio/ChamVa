// Desmultiplexor WebM/Matroska mínimo. Recorre el archivo una vez leyendo por
// ventanas (sin cargarlo entero) y arma el índice de bloques de cada pista.
// Acepta tamaños desconocidos (los WebM de MediaRecorder no los escriben), sin
// Cues ni Duration, SimpleBlock y BlockGroup, y encaje (lacing) Xiph/EBML/fijo.
import { BlobReader } from '../byteReader';
import {
  type AudioTrackInfo,
  type DemuxedFile,
  type VideoTrackInfo,
  UnsupportedMediaError,
  aacCodecFromAsc,
  av1CodecFromAv1C,
  avcCodecFromAvcC,
  hevcCodecFromHvcC,
  makeTable,
} from './types';

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  BlockDuration: 0x9b,
};
// Elementos de nivel 1: cierran un Cluster de tamaño desconocido.
const LEVEL1 = new Set([0x1f43b675, 0x1c53bb6b, 0x1254c367, 0x1043a770, 0x1941a469, 0x114d9b74, 0x1549a966, 0x1654ae6b]);
const UNKNOWN = -1;

/** Lee un entero de longitud variable EBML. Para IDs se conserva el marcador. */
export function readVint(b: Uint8Array, p: number, keepMarker = false): { value: number; len: number } | null {
  const first = b[p];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[p + i];
    if (b[p + i] !== 0xff) allOnes = false;
  }
  if (!keepMarker && allOnes) return { value: UNKNOWN, len };
  return { value, len };
}

const readUint = (b: Uint8Array) => {
  let v = 0;
  for (let i = 0; i < b.length; i++) v = v * 256 + b[i];
  return v;
};
const readFloat = (b: Uint8Array) => {
  const dv = new DataView(b.buffer, b.byteOffset, b.length);
  return b.length === 4 ? dv.getFloat32(0) : b.length === 8 ? dv.getFloat64(0) : 0;
};
const readStr = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length && b[i]; i++) s += String.fromCharCode(b[i]);
  return s;
};

interface Header {
  id: number;
  size: number; // UNKNOWN si desconocido
  dataStart: number; // posición absoluta
}

async function readHeader(r: BlobReader, pos: number): Promise<Header | null> {
  const b = await r.read(pos, 12);
  const id = readVint(b, 0, true);
  if (!id) return null;
  const size = readVint(b, id.len);
  if (!size) return null;
  return { id: id.value, size: size.value, dataStart: pos + id.len + size.len };
}

/** Recorre los hijos de un elemento cargado en memoria. */
function* children(b: Uint8Array, start = 0, end = b.length): Generator<{ id: number; data: Uint8Array }> {
  let p = start;
  while (p < end) {
    const id = readVint(b, p, true);
    if (!id) return;
    const size = readVint(b, p + id.len);
    if (!size) return;
    const ds = p + id.len + size.len;
    const de = size.value === UNKNOWN ? end : Math.min(end, ds + size.value);
    yield { id: id.value, data: b.subarray(ds, de) };
    p = de;
  }
}

interface TrackDef {
  number: number;
  type: number; // 1 video, 2 audio
  codecId: string;
  priv?: Uint8Array;
  defaultDuration: number; // ns
  width: number;
  height: number;
  rate: number;
  channels: number;
}

function parseTracks(b: Uint8Array): TrackDef[] {
  const out: TrackDef[] = [];
  for (const e of children(b)) {
    if (e.id !== ID.TrackEntry) continue;
    const t: TrackDef = { number: 0, type: 0, codecId: '', defaultDuration: 0, width: 0, height: 0, rate: 8000, channels: 1 };
    for (const f of children(e.data)) {
      if (f.id === ID.TrackNumber) t.number = readUint(f.data);
      else if (f.id === ID.TrackType) t.type = readUint(f.data);
      else if (f.id === ID.CodecID) t.codecId = readStr(f.data);
      else if (f.id === ID.CodecPrivate) t.priv = f.data.slice();
      else if (f.id === ID.DefaultDuration) t.defaultDuration = readUint(f.data);
      else if (f.id === ID.Video)
        for (const v of children(f.data)) {
          if (v.id === ID.PixelWidth) t.width = readUint(v.data);
          else if (v.id === ID.PixelHeight) t.height = readUint(v.data);
        }
      else if (f.id === ID.Audio)
        for (const a of children(f.data)) {
          if (a.id === ID.SamplingFrequency) t.rate = readFloat(a.data);
          else if (a.id === ID.Channels) t.channels = readUint(a.data);
        }
    }
    out.push(t);
  }
  return out;
}

interface Row {
  offset: number;
  size: number;
  pts: number;
  dur: number;
  key: boolean;
  lacedGroup?: number; // bloques con encaje sin duración conocida
}

/** Tamaños de los fotogramas de un bloque con encaje. Devuelve [cabecera, tamaños]. */
function laceSizes(b: Uint8Array, p: number, lacing: number, total: number): { header: number; sizes: number[] } | null {
  const n = b[p] + 1;
  let q = p + 1;
  const sizes: number[] = [];
  if (lacing === 1) {
    for (let i = 0; i < n - 1; i++) {
      let s = 0;
      while (b[q] === 255) {
        s += 255;
        q++;
      }
      s += b[q++];
      sizes.push(s);
    }
  } else if (lacing === 3) {
    const first = readVint(b, q);
    if (!first) return null;
    q += first.len;
    let prev = first.value;
    sizes.push(prev);
    for (let i = 1; i < n - 1; i++) {
      const d = readVint(b, q);
      if (!d) return null;
      q += d.len;
      const bias = Math.pow(2, 7 * d.len - 1) - 1;
      prev = prev + (d.value - bias);
      sizes.push(prev);
    }
  } else if (lacing === 2) {
    const each = Math.floor((total - 1) / n);
    for (let i = 0; i < n - 1; i++) sizes.push(each);
  }
  const header = q - p;
  const used = sizes.reduce((a, c) => a + c, 0);
  sizes.push(total - header - used);
  if (sizes.some((s) => s < 0)) return null;
  return { header, sizes };
}

export async function demuxWebm(blob: Blob): Promise<DemuxedFile> {
  const r = new BlobReader(blob, 4 << 20);
  const head = await readHeader(r, 0);
  if (!head || head.id !== ID.EBML) throw new UnsupportedMediaError('No es un archivo WebM/Matroska');
  let pos = head.dataStart + head.size;
  const seg = await readHeader(r, pos);
  if (!seg || seg.id !== ID.Segment) throw new UnsupportedMediaError('WebM sin segmento');
  const segEnd = seg.size === UNKNOWN ? r.size : Math.min(r.size, seg.dataStart + seg.size);
  pos = seg.dataStart;

  let scale = 1e6; // ns por unidad de tiempo
  let durationUnits = 0;
  let tracks: TrackDef[] = [];
  const rows = new Map<number, Row[]>();
  let groupId = 0;

  // `data` = primeros bytes del bloque (cabecera y tamaños de encaje); `total` = tamaño real.
  const addBlock = (data: Uint8Array, total: number, absStart: number, clusterTc: number, keyHint: boolean | null, blockDur: number) => {
    const tn = readVint(data, 0);
    if (!tn) return;
    const p = tn.len;
    if (p + 3 > data.length) return;
    const rel = (data[p] << 24) >> 16 | data[p + 1]; // int16 con signo
    const flags = data[p + 2];
    const key = keyHint ?? !!(flags & 0x80);
    const lacing = (flags >> 1) & 3;
    const ts = ((clusterTc + rel) * scale) / 1e9;
    const list = rows.get(tn.value) ?? [];
    rows.set(tn.value, list);
    const dataStart = p + 3;
    const tdef = tracks.find((t) => t.number === tn.value);
    const defDur = tdef?.defaultDuration ? tdef.defaultDuration / 1e9 : 0;
    const dur = blockDur ? (blockDur * scale) / 1e9 : defDur;
    if (!lacing) {
      list.push({ offset: absStart + dataStart, size: total - dataStart, pts: ts, dur, key });
      return;
    }
    const ls = laceSizes(data, dataStart, lacing, total - dataStart);
    if (!ls) return;
    let off = absStart + dataStart + ls.header;
    const g = defDur ? undefined : ++groupId;
    ls.sizes.forEach((s, i) => {
      list.push({ offset: off, size: s, pts: ts + i * defDur, dur: defDur, key, lacedGroup: g });
      off += s;
    });
  };

  while (pos < segEnd) {
    const h = await readHeader(r, pos);
    if (!h) break;
    if (h.id === ID.Cluster) {
      const cEnd = h.size === UNKNOWN ? segEnd : Math.min(segEnd, h.dataStart + h.size);
      let p = h.dataStart;
      let tc = 0;
      while (p < cEnd) {
        const ch = await readHeader(r, p);
        if (!ch) {
          p = cEnd;
          break;
        }
        if (h.size === UNKNOWN && LEVEL1.has(ch.id)) break; // empieza otro cluster
        const end = ch.size === UNKNOWN ? cEnd : ch.dataStart + ch.size;
        if (ch.id === ID.Timecode) tc = readUint(await r.read(ch.dataStart, ch.size));
        else if (ch.id === ID.SimpleBlock) {
          // Solo hace falta la cabecera del bloque (pista, tiempo, banderas, encaje).
          addBlock(await r.read(ch.dataStart, Math.min(ch.size, 4096)), ch.size, ch.dataStart, tc, null, 0);
        } else if (ch.id === ID.BlockGroup) {
          let q = ch.dataStart;
          let block: { at: number; size: number; head: Uint8Array } | null = null;
          let hasRef = false;
          let bdur = 0;
          while (q < end) {
            const e = await readHeader(r, q);
            if (!e || e.size === UNKNOWN) break;
            if (e.id === ID.Block) block = { at: e.dataStart, size: e.size, head: (await r.read(e.dataStart, Math.min(e.size, 4096))).slice() };
            else if (e.id === ID.ReferenceBlock) hasRef = true;
            else if (e.id === ID.BlockDuration) bdur = readUint(await r.read(e.dataStart, e.size));
            q = e.dataStart + e.size;
          }
          if (block) addBlock(block.head, block.size, block.at, tc, !hasRef, bdur);
        }
        p = end;
      }
      pos = p;
      continue;
    }
    if (h.size === UNKNOWN) break; // otro elemento de tamaño desconocido: no se puede saltar
    if (h.id === ID.Info) {
      for (const e of children((await r.read(h.dataStart, h.size)).slice())) {
        if (e.id === ID.TimecodeScale) scale = readUint(e.data) || 1e6;
        else if (e.id === ID.Duration) durationUnits = readFloat(e.data);
      }
    } else if (h.id === ID.Tracks) {
      tracks = parseTracks((await r.read(h.dataStart, h.size)).slice());
    }
    pos = h.dataStart + h.size;
  }

  // Encaje sin duración: repartir el tiempo hasta el bloque siguiente de la pista.
  for (const list of rows.values()) {
    for (let i = 0; i < list.length; ) {
      const g = list[i].lacedGroup;
      if (!g) {
        i++;
        continue;
      }
      let j = i;
      while (j < list.length && list[j].lacedGroup === g) j++;
      const next = j < list.length ? list[j].pts : list[i].pts + 0.02 * (j - i);
      const step = (next - list[i].pts) / (j - i);
      for (let k = i; k < j; k++) {
        list[k].pts = list[i].pts + (k - i) * step;
        list[k].dur = step;
      }
      i = j;
    }
    // duración de cada muestra a partir de la siguiente (si no venía)
    for (let i = 0; i < list.length; i++)
      if (!list[i].dur && i + 1 < list.length) list[i].dur = Math.max(0, list[i + 1].pts - list[i].pts);
  }

  let video: VideoTrackInfo | undefined;
  let audio: AudioTrackInfo | undefined;
  for (const t of tracks) {
    const list = rows.get(t.number);
    if (!list || !list.length) continue;
    if (t.type === 1 && !video) {
      const codec = webmVideoCodec(t);
      if (!codec) continue;
      video = { kind: 'video', codec, description: codec.startsWith('vp') ? undefined : t.priv, codedWidth: t.width, codedHeight: t.height, rotation: 0, samples: makeTable(list) };
    } else if (t.type === 2 && !audio) {
      const codec = webmAudioCodec(t);
      if (!codec) continue;
      audio = { kind: 'audio', codec, description: t.priv, sampleRate: t.codecId === 'A_OPUS' ? 48000 : t.rate, channels: t.channels, samples: makeTable(list) };
    }
  }
  if (!video && !audio) throw new UnsupportedMediaError('WebM sin pistas compatibles');
  let duration = (durationUnits * scale) / 1e9;
  if (!(duration > 0)) {
    for (const tr of [video, audio]) {
      const s = tr?.samples;
      if (s && s.count) duration = Math.max(duration, s.pts[s.count - 1] + (s.dur[s.count - 1] || 0));
    }
  }
  return { container: 'webm', duration, video, audio };
}

function webmVideoCodec(t: TrackDef): string | null {
  switch (t.codecId) {
    case 'V_VP8':
      return 'vp8';
    case 'V_VP9': {
      // CodecPrivate de VP9: lista de (id, len, valor): 1 perfil, 2 nivel, 3 bits.
      let prof = 0, lvl = 10, depth = 8;
      const p = t.priv;
      if (p)
        for (let i = 0; i + 2 < p.length; ) {
          const id = p[i], len = p[i + 1], val = p[i + 2];
          if (id === 1) prof = val;
          else if (id === 2) lvl = val || 10;
          else if (id === 3) depth = val || 8;
          i += 2 + len;
        }
      return `vp09.${String(prof).padStart(2, '0')}.${String(lvl).padStart(2, '0')}.${String(depth).padStart(2, '0')}`;
    }
    case 'V_AV1':
      return t.priv && t.priv.length >= 4 ? av1CodecFromAv1C(t.priv) : 'av01.0.08M.08';
    case 'V_MPEG4/ISO/AVC':
      return t.priv && t.priv.length >= 4 ? avcCodecFromAvcC(t.priv) : null;
    case 'V_MPEGH/ISO/HEVC':
      return t.priv && t.priv.length >= 13 ? hevcCodecFromHvcC(t.priv) : null;
    default:
      return null;
  }
}

function webmAudioCodec(t: TrackDef): string | null {
  switch (t.codecId) {
    case 'A_OPUS':
      return 'opus';
    case 'A_VORBIS':
      return 'vorbis';
    case 'A_AAC':
      return aacCodecFromAsc(t.priv);
    case 'A_MPEG/L3':
      return 'mp3';
    case 'A_FLAC':
      return 'flac';
    default:
      return null;
  }
}
