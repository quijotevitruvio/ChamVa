// SOLO PARA PRUEBAS (no lo importa la app): escritor mínimo de contenedores HEIF para fabricar
// archivos sintéticos (rejillas, irot/imir, clap, alfa, EXIF, archivos dañados). Los bytes
// comprimidos de las teselas se pasan tal cual; aquí no se codifica nada.

export type TestProp =
  | { t: 'hvcC'; data: Uint8Array }
  | { t: 'av1C'; data: Uint8Array }
  | { t: 'ispe'; w: number; h: number }
  | { t: 'irot'; angle: number }
  | { t: 'imir'; axis: number }
  | { t: 'clap'; w: number; h: number; x?: number; y?: number }
  | { t: 'nclx'; primaries: number; transfer: number; matrix: number; full: boolean }
  | { t: 'icc'; data: Uint8Array }
  | { t: 'auxC'; urn: string };

export interface TestItem {
  id: number;
  type: string;
  data?: Uint8Array; // en mdat
  idat?: Uint8Array; // en idat (construction_method 1)
  sameDataAs?: number; // reutiliza las mismas extensiones que otro ítem
  props?: TestProp[];
  hidden?: boolean;
}

export interface TestHeif {
  brands?: string[];
  primary: number;
  items: TestItem[];
  refs?: { type: string; from: number; to: number[] }[];
}

const enc = new TextEncoder();
const cat = (...a: Uint8Array[]) => {
  const n = a.reduce((s, x) => s + x.length, 0);
  const o = new Uint8Array(n);
  let p = 0;
  for (const x of a) {
    o.set(x, p);
    p += x.length;
  }
  return o;
};
const u8 = (...v: number[]) => new Uint8Array(v);
const u16 = (v: number) => u8((v >> 8) & 255, v & 255);
const u32 = (v: number) => u8((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
const cc = (s: string) => enc.encode(s);
const box = (type: string, ...body: Uint8Array[]) => {
  const b = cat(...body);
  return cat(u32(b.length + 8), cc(type), b);
};
const full = (type: string, version: number, flags: number, ...body: Uint8Array[]) =>
  box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...body);

function propBox(p: TestProp): Uint8Array {
  switch (p.t) {
    case 'hvcC':
      return box('hvcC', p.data);
    case 'av1C':
      return box('av1C', p.data);
    case 'ispe':
      return full('ispe', 0, 0, u32(p.w), u32(p.h));
    case 'irot':
      return box('irot', u8(p.angle & 3));
    case 'imir':
      return box('imir', u8(p.axis & 1));
    case 'clap':
      return box('clap', u32(p.w), u32(1), u32(p.h), u32(1), u32((p.x ?? 0) >>> 0), u32(1), u32((p.y ?? 0) >>> 0), u32(1));
    case 'nclx':
      return box('colr', cc('nclx'), u16(p.primaries), u16(p.transfer), u16(p.matrix), u8(p.full ? 0x80 : 0));
    case 'icc':
      return box('colr', cc('prof'), p.data);
    case 'auxC':
      return full('auxC', 0, 0, enc.encode(p.urn + '\0'));
  }
}

/** Datos de rejilla (ImageGrid) con campos de 16 bits. */
export function gridData(rows: number, cols: number, w: number, h: number): Uint8Array {
  return u8(0, 0, rows - 1, cols - 1, (w >> 8) & 255, w & 255, (h >> 8) & 255, h & 255);
}

/** Ítem Exif con la orientación dada (TIFF big-endian, una sola entrada). */
export function exifItem(orientation: number): Uint8Array {
  const tiff = cat(cc('MM'), u16(42), u32(8), u16(1), u16(0x0112), u16(3), u32(1), u16(orientation), u16(0), u32(0));
  return cat(u32(6), cc('Exif'), u8(0, 0), tiff);
}

export function writeHeif(spec: TestHeif): Uint8Array {
  const brands = spec.brands ?? ['heic', 'mif1', 'heic'];
  const ftyp = box('ftyp', cc(brands[0]), u32(0), ...brands.slice(1).map(cc));
  // propiedades únicas por contenido
  const props: Uint8Array[] = [];
  const key = new Map<string, number>();
  const assoc = new Map<number, number[]>();
  for (const it of spec.items) {
    const idx: number[] = [];
    for (const p of it.props ?? []) {
      const b = propBox(p);
      const k = Array.from(b).join(',');
      let i = key.get(k);
      if (!i) {
        props.push(b);
        i = props.length;
        key.set(k, i);
      }
      idx.push(i);
    }
    assoc.set(it.id, idx);
  }
  const iprp = box(
    'iprp',
    box('ipco', ...props),
    full(
      'ipma',
      0,
      0,
      u32(spec.items.length),
      ...spec.items.map((it) => cat(u16(it.id), u8(assoc.get(it.id)!.length), ...assoc.get(it.id)!.map((i) => u8(0x80 | i)))),
    ),
  );
  const iinf = full('iinf', 0, 0, u16(spec.items.length), ...spec.items.map((it) => full('infe', 2, it.hidden ? 1 : 0, u16(it.id), u16(0), cc(it.type), u8(0))));
  const iref = spec.refs?.length ? full('iref', 0, 0, ...spec.refs.map((r) => box(r.type, u16(r.from), u16(r.to.length), ...r.to.map(u16)))) : new Uint8Array(0);
  const hdlr = full('hdlr', 0, 0, u32(0), cc('pict'), u32(0), u32(0), u32(0), u8(0));
  const pitm = full('pitm', 0, 0, u16(spec.primary));
  // idat
  const idatParts: Uint8Array[] = [];
  const idatOff = new Map<number, [number, number]>();
  let io = 0;
  for (const it of spec.items)
    if (it.idat) {
      idatOff.set(it.id, [io, it.idat.length]);
      idatParts.push(it.idat);
      io += it.idat.length;
    }
  const idat = idatParts.length ? box('idat', ...idatParts) : new Uint8Array(0);
  // mdat (desplazamientos relativos; se fijan tras medir meta)
  const mdatParts: Uint8Array[] = [];
  const rel = new Map<number, [number, number]>();
  let mo = 0;
  for (const it of spec.items)
    if (it.data) {
      rel.set(it.id, [mo, it.data.length]);
      mdatParts.push(it.data);
      mo += it.data.length;
    }
  for (const it of spec.items) if (it.sameDataAs != null) rel.set(it.id, rel.get(it.sameDataAs)!);
  const located = spec.items.filter((it) => rel.has(it.id) || idatOff.has(it.id));
  const ilocFor = (mdatStart: number) =>
    full(
      'iloc',
      1,
      0,
      u8(0x44, 0x00),
      u16(located.length),
      ...located.map((it) => {
        const inIdat = idatOff.has(it.id);
        const [o, l] = inIdat ? idatOff.get(it.id)! : rel.get(it.id)!;
        return cat(u16(it.id), u16(inIdat ? 1 : 0), u16(0), u16(1), u32(inIdat ? o : mdatStart + o), u32(l));
      }),
    );
  const metaFor = (mdatStart: number) => full('meta', 0, 0, hdlr, pitm, ilocFor(mdatStart), iinf, iref, iprp, idat);
  const metaLen = metaFor(0).length;
  const mdatStart = ftyp.length + metaLen + 8;
  return cat(ftyp, metaFor(mdatStart), box('mdat', ...mdatParts));
}
