// Resultado común de los desmultiplexores (MP4/MOV y WebM/MKV): la tabla de
// muestras de cada pista con su posición en el archivo, para leerlas por trozos
// y pasarlas a VideoDecoder/AudioDecoder.

export interface SampleTable {
  count: number;
  /** Posición en bytes de cada muestra (orden de decodificación). */
  offset: Float64Array;
  size: Uint32Array;
  /** Instante de presentación en segundos. */
  pts: Float64Array;
  /** Duración en segundos (0 si se desconoce). */
  dur: Float64Array;
  /** 1 = fotograma clave (sync). */
  key: Uint8Array;
}

export interface VideoTrackInfo {
  kind: 'video';
  codec: string;
  description?: Uint8Array;
  codedWidth: number;
  codedHeight: number;
  /** Rotación de presentación en grados horarios (metadato de los móviles). */
  rotation: 0 | 90 | 180 | 270;
  samples: SampleTable;
}

export interface AudioTrackInfo {
  kind: 'audio';
  codec: string;
  description?: Uint8Array;
  sampleRate: number;
  channels: number;
  samples: SampleTable;
}

export interface DemuxedFile {
  container: 'mp4' | 'webm';
  duration: number;
  video?: VideoTrackInfo;
  audio?: AudioTrackInfo;
}

export class UnsupportedMediaError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UnsupportedMediaError';
  }
}

/** Construye una SampleTable a partir de listas. */
export function makeTable(rows: { offset: number; size: number; pts: number; dur: number; key: boolean }[]): SampleTable {
  const n = rows.length;
  const t: SampleTable = {
    count: n,
    offset: new Float64Array(n),
    size: new Uint32Array(n),
    pts: new Float64Array(n),
    dur: new Float64Array(n),
    key: new Uint8Array(n),
  };
  rows.forEach((r, i) => {
    t.offset[i] = r.offset;
    t.size[i] = r.size;
    t.pts[i] = r.pts;
    t.dur[i] = r.dur;
    t.key[i] = r.key ? 1 : 0;
  });
  return t;
}

/** Última muestra clave (en orden de decodificación) cuya presentación es ≤ t. */
export function keyIndexBefore(s: SampleTable, t: number): number {
  let best = -1;
  for (let i = 0; i < s.count; i++) {
    if (!s.key[i]) continue;
    if (s.pts[i] <= t + 1e-6) best = i;
    else if (best >= 0) break;
  }
  if (best < 0) for (let i = 0; i < s.count; i++) if (s.key[i]) return i;
  return Math.max(0, best);
}

/** Primera muestra (orden de decodificación) con pts ≥ t − margen; para audio (todo son claves). */
export function indexAtOrBefore(s: SampleTable, t: number): number {
  let lo = 0;
  let hi = s.count - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.pts[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Cadena de códec y descripción a partir de un registro avcC. */
export function avcCodecFromAvcC(avcC: Uint8Array): string {
  return `avc1.${hex2(avcC[1])}${hex2(avcC[2])}${hex2(avcC[3])}`;
}

/** Cadena de códec HEVC (ISO 14496-15, anexo E) a partir de hvcC. */
export function hevcCodecFromHvcC(h: Uint8Array, fourcc = 'hvc1'): string {
  const space = h[1] >> 6;
  const tier = (h[1] >> 5) & 1;
  const profile = h[1] & 0x1f;
  let compat = ((h[2] << 24) | (h[3] << 16) | (h[4] << 8) | h[5]) >>> 0;
  // se escribe con los bits invertidos
  let rev = 0;
  for (let i = 0; i < 32; i++) {
    rev = (rev << 1) | (compat & 1);
    compat >>>= 1;
  }
  const level = h[12];
  const cons: number[] = [];
  for (let i = 6; i < 12; i++) cons.push(h[i]);
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  const sp = ['', 'A', 'B', 'C'][space];
  let s = `${fourcc}.${sp}${profile}.${(rev >>> 0).toString(16)}.${tier ? 'H' : 'L'}${level}`;
  for (const c of cons) s += '.' + c.toString(16);
  return s;
}

/** Cadena de códec AV1 a partir de av1C. */
export function av1CodecFromAv1C(a: Uint8Array): string {
  const profile = a[1] >> 5;
  const level = a[1] & 0x1f;
  const tier = a[2] >> 7;
  const high = (a[2] >> 6) & 1;
  const twelve = (a[2] >> 5) & 1;
  const depth = high ? (twelve ? 12 : 10) : 8;
  return `av01.${profile}.${String(level).padStart(2, '0')}${tier ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`;
}

/** Cadena mp4a.40.x a partir de un AudioSpecificConfig. */
export function aacCodecFromAsc(asc: Uint8Array | undefined): string {
  if (!asc || !asc.length) return 'mp4a.40.2';
  let aot = asc[0] >> 3;
  if (aot === 31 && asc.length > 1) aot = 32 + (((asc[0] & 7) << 3) | (asc[1] >> 5));
  return `mp4a.40.${aot || 2}`;
}
