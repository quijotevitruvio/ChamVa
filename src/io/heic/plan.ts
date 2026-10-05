// Plan de decodificación de la imagen PRINCIPAL de un HEIF: códec, teselas de la rejilla,
// alfa, recorte/orientación y color. Miniaturas, profundidad, mapas HDR y demás se ignoran.
import { av1CodecString, hevcBitDepth, hevcChroma, hevcCodecString } from './codec';
import { colorInfo, type ColorInfo } from './color';
import { HeicError } from './errors';
import { exifOrientationFromItem } from './exif';
import { itemData, parseHeif, prop, refsFrom, refsTo, type HeifFile } from './isobmff';
import { orientationPlan, type OrientPlan } from './transform';

export const MAX_PIXELS = 120_000_000; // 48 MP sobra; por encima la memoria del lienzo no es fiable

export interface ImagePlan {
  codec: 'hevc' | 'av1';
  codecString: string;
  description: Uint8Array;
  bitDepth: number;
  monochrome: boolean;
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
  outW: number; // tamaño de la imagen (rejilla ya recortada a su tamaño de salida)
  outH: number;
  tiles: number[]; // ids de ítem, por filas
}

export interface DecodePlan {
  color: ImagePlan;
  alpha: ImagePlan | null;
  orient: OrientPlan;
  colorInfo: ColorInfo;
  width: number; // tamaño final, ya orientado
  height: number;
  ignored: string[];
  brands: string[];
  file: HeifFile;
}

const ALPHA_URNS = ['urn:mpeg:hevc:2015:auxid:1', 'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha', 'urn:mpeg:avc:2015:auxid:1'];
const DEPTH_URNS = ['urn:mpeg:hevc:2015:auxid:2', 'urn:mpeg:mpegB:cicp:systems:auxiliary:depth'];

const TYPE_LABEL: Record<string, string> = {
  iovl: 'superposición',
  iden: 'imagen derivada',
  jpeg: 'JPEG dentro de HEIF',
  vvc1: 'VVC',
  avc1: 'H.264',
  j2k1: 'JPEG 2000',
  unci: 'sin comprimir',
  tmap: 'mapa de tonos HDR',
};

function tilePlan(f: HeifFile, id: number): Omit<ImagePlan, 'cols' | 'rows' | 'outW' | 'outH' | 'tiles'> {
  const it = f.items.get(id)!;
  if (it.type === 'hvc1') {
    const c = prop(it, 'hvcC');
    if (!c) throw new HeicError('corrupt', 'falta hvcC');
    const sz = prop(it, 'ispe');
    if (!sz || !sz.width || !sz.height) throw new HeicError('corrupt', 'falta el tamaño (ispe)');
    return {
      codec: 'hevc',
      codecString: hevcCodecString(c.data),
      description: c.data,
      bitDepth: hevcBitDepth(c.data),
      monochrome: hevcChroma(c.data) === 0,
      tileW: sz.width,
      tileH: sz.height,
    };
  }
  if (it.type === 'av01') {
    const c = prop(it, 'av1C');
    if (!c) throw new HeicError('corrupt', 'falta av1C');
    const sz = prop(it, 'ispe');
    if (!sz || !sz.width || !sz.height) throw new HeicError('corrupt', 'falta el tamaño (ispe)');
    return { codec: 'av1', codecString: av1CodecString(c.data), description: c.data, bitDepth: 8, monochrome: ((c.data[2] >> 4) & 1) === 1, tileW: sz.width, tileH: sz.height };
  }
  throw new HeicError('unsupported', TYPE_LABEL[it.type] ?? `tipo «${it.type}»`);
}

export function imagePlan(f: HeifFile, u8: Uint8Array, id: number): ImagePlan {
  const it = f.items.get(id);
  if (!it) throw new HeicError('corrupt', `ítem ${id} inexistente`);
  if (it.type === 'grid') {
    const g = itemData(f, u8, id);
    if (g.length < 8) throw new HeicError('corrupt', 'rejilla truncada');
    const big = (g[1] & 1) === 1;
    const rows = g[2] + 1;
    const cols = g[3] + 1;
    const rd = (o: number, n: number) => (n === 4 ? ((g[o] << 24) | (g[o + 1] << 16) | (g[o + 2] << 8) | g[o + 3]) >>> 0 : (g[o] << 8) | g[o + 1]);
    if (big && g.length < 12) throw new HeicError('corrupt', 'rejilla truncada');
    const outW = rd(4, big ? 4 : 2);
    const outH = rd(big ? 8 : 6, big ? 4 : 2);
    const tiles = refsFrom(f, 'dimg', id);
    if (tiles.length !== rows * cols) throw new HeicError('corrupt', `la rejilla declara ${rows * cols} teselas y hay ${tiles.length}`);
    const t0 = tilePlan(f, tiles[0]);
    for (const t of tiles) {
      const ti = f.items.get(t);
      if (!ti || ti.type !== f.items.get(tiles[0])!.type) throw new HeicError('corrupt', 'teselas de tipos distintos');
    }
    if (!outW || !outH || outW > cols * t0.tileW || outH > rows * t0.tileH) throw new HeicError('corrupt', 'tamaño de rejilla incoherente');
    return { ...t0, cols, rows, outW, outH, tiles };
  }
  const t = tilePlan(f, id);
  return { ...t, cols: 1, rows: 1, outW: t.tileW, outH: t.tileH, tiles: [id] };
}

export function buildPlan(buf: ArrayBuffer | Uint8Array, maxPixels = MAX_PIXELS): DecodePlan {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const f = parseHeif(u8);
  const primary = f.items.get(f.primaryId)!;
  const color = imagePlan(f, u8, f.primaryId);
  const px = color.outW * color.outH;
  if (px > maxPixels) throw new HeicError('too-large', `${Math.round(px / 1e6)} MP; máximo ${Math.round(maxPixels / 1e6)} MP`);

  const ignored: string[] = [];
  let alpha: ImagePlan | null = null;
  for (const aid of refsTo(f, 'auxl', f.primaryId)) {
    const ai = f.items.get(aid);
    const aux = ai ? prop(ai, 'auxC')?.auxType ?? '' : '';
    if (ALPHA_URNS.includes(aux) && !alpha) {
      try {
        const p = imagePlan(f, u8, aid);
        if (p.outW === color.outW && p.outH === color.outH) alpha = p;
        else ignored.push('transparencia de otro tamaño');
      } catch {
        ignored.push('transparencia ilegible');
      }
    } else if (DEPTH_URNS.includes(aux)) ignored.push('mapa de profundidad');
    else if (aux.includes('hdrgainmap') || aux.includes('apple')) ignored.push('mapa de ganancia HDR');
    else ignored.push('imagen auxiliar');
  }
  if (refsTo(f, 'thmb', f.primaryId).length) ignored.push('miniatura');
  const others = [...f.items.values()].filter((i) => !i.hidden && i.id !== f.primaryId && ['hvc1', 'grid', 'av01'].includes(i.type));
  const usedTiles = new Set([...color.tiles, ...(alpha?.tiles ?? [])]);
  // Miniaturas y auxiliares (alfa/profundidad de cualquier imagen) no cuentan como «otras».
  const isAux = (id: number) => f.refs.some((r) => r.from === id && (r.type === 'thmb' || r.type === 'auxl'));
  if (others.some((o) => !usedTiles.has(o.id) && !isAux(o.id))) ignored.push('otras imágenes del archivo');

  let exif: number | null = null;
  for (const eid of refsTo(f, 'cdsc', f.primaryId)) {
    if (f.items.get(eid)?.type !== 'Exif') continue;
    try {
      exif = exifOrientationFromItem(itemData(f, u8, eid));
    } catch {
      /* EXIF dañado: se ignora */
    }
  }
  const orient = orientationPlan(primary.props, color.outW, color.outH, exif);
  return {
    color,
    alpha,
    orient,
    colorInfo: colorInfo(primary.props.some((p) => p.kind.startsWith('colr')) ? primary.props : f.items.get(color.tiles[0])!.props),
    width: orient.outW,
    height: orient.outH,
    ignored: [...new Set(ignored)],
    brands: f.brands,
    file: f,
  };
}

/** Bytes comprimidos de una tesela (formato de longitud prefijada, como espera WebCodecs). */
export function tileBytes(plan: DecodePlan, buf: Uint8Array, id: number): Uint8Array {
  return itemData(plan.file, buf, id);
}
