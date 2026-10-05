// Lector propio (MIT) del contenedor HEIF/ISOBMFF: solo la caja `meta` (ítems, ubicaciones,
// propiedades y referencias). NO decodifica HEVC: eso lo hace el navegador/SO (ver index.ts).
// Lógica pura, sin DOM; todos los accesos van acotados al tamaño real del archivo.
import { HeicError } from './errors';

export interface Extent {
  offset: number; // absoluto en el archivo (method 0) o dentro de idat (method 1)
  length: number; // 0 = hasta el final
}

export interface HeifItem {
  id: number;
  type: string; // 'hvc1' | 'grid' | 'av01' | 'Exif' | 'mime' | …
  hidden: boolean;
  method: number; // construction_method: 0 archivo, 1 idat
  extents: Extent[];
  props: HeifProp[]; // en el orden de ipma (importa para clap/irot/imir)
}

export type HeifProp =
  | { kind: 'hvcC'; data: Uint8Array }
  | { kind: 'av1C'; data: Uint8Array }
  | { kind: 'ispe'; width: number; height: number }
  | { kind: 'irot'; angle: number } // 0..3, en pasos de 90° antihorarios
  | { kind: 'imir'; axis: number } // 0 eje vertical (voltear izq-der), 1 eje horizontal
  | { kind: 'clap'; wN: number; wD: number; hN: number; hD: number; xN: number; xD: number; yN: number; yD: number }
  | { kind: 'colr-nclx'; primaries: number; transfer: number; matrix: number; fullRange: boolean }
  | { kind: 'colr-icc'; data: Uint8Array }
  | { kind: 'auxC'; auxType: string }
  | { kind: 'pixi'; bits: number[] }
  | { kind: 'other'; type: string };

export interface HeifRef {
  type: string; // 'dimg' | 'thmb' | 'auxl' | 'cdsc' | 'prem' | …
  from: number;
  to: number[];
}

export interface HeifFile {
  brands: string[];
  primaryId: number;
  items: Map<number, HeifItem>;
  refs: HeifRef[];
  idat: { start: number; end: number } | null; // posición del contenido de idat en el archivo
  fileSize: number;
}

interface Box {
  type: string;
  start: number; // inicio de la caja
  body: number; // inicio del contenido
  end: number;
}

const corrupt = (d: string) => new HeicError('corrupt', d);

class R {
  constructor(
    readonly v: DataView,
    public p: number,
    readonly end: number,
  ) {}
  need(n: number) {
    if (this.p + n > this.end) throw corrupt('caja truncada');
  }
  u8() {
    this.need(1);
    return this.v.getUint8(this.p++);
  }
  u16() {
    this.need(2);
    const x = this.v.getUint16(this.p);
    this.p += 2;
    return x;
  }
  u32() {
    this.need(4);
    const x = this.v.getUint32(this.p);
    this.p += 4;
    return x;
  }
  i32() {
    this.need(4);
    const x = this.v.getInt32(this.p);
    this.p += 4;
    return x;
  }
  uN(bytes: number): number {
    if (bytes === 0) return 0;
    if (bytes === 1) return this.u8();
    if (bytes === 2) return this.u16();
    if (bytes === 4) return this.u32();
    if (bytes === 8) {
      const hi = this.u32();
      const lo = this.u32();
      if (hi > 0x1fffff) throw corrupt('desplazamiento de 64 bits fuera de rango');
      return hi * 2 ** 32 + lo;
    }
    throw corrupt(`tamaño de campo ${bytes} no válido`);
  }
  cc() {
    this.need(4);
    const s = String.fromCharCode(this.v.getUint8(this.p), this.v.getUint8(this.p + 1), this.v.getUint8(this.p + 2), this.v.getUint8(this.p + 3));
    this.p += 4;
    return s;
  }
  str() {
    let s = '';
    while (this.p < this.end) {
      const c = this.v.getUint8(this.p++);
      if (c === 0) return s;
      s += String.fromCharCode(c);
    }
    return s; // algunas herramientas omiten el 0 final
  }
  full() {
    const version = this.u8();
    this.need(3);
    const flags = (this.v.getUint8(this.p) << 16) | (this.v.getUint8(this.p + 1) << 8) | this.v.getUint8(this.p + 2);
    this.p += 3;
    return { version, flags };
  }
}

function boxes(v: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  let guard = 0;
  while (p + 8 <= end) {
    if (++guard > 100_000) throw corrupt('demasiadas cajas');
    let size = v.getUint32(p);
    const type = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7));
    let body = p + 8;
    if (size === 1) {
      if (p + 16 > end) throw corrupt('caja truncada');
      const hi = v.getUint32(p + 8);
      const lo = v.getUint32(p + 12);
      if (hi > 0x1fffff) throw corrupt('caja demasiado grande');
      size = hi * 2 ** 32 + lo;
      body = p + 16;
    } else if (size === 0) size = end - p;
    if (size < body - p || p + size > end) throw corrupt(`caja «${type}» fuera del archivo`);
    out.push({ type, start: p, body, end: p + size });
    p += size;
  }
  return out;
}

function parseProp(v: DataView, b: Box): HeifProp {
  const r = new R(v, b.body, b.end);
  const bytes = () => new Uint8Array(v.buffer, v.byteOffset + b.body, b.end - b.body);
  switch (b.type) {
    case 'hvcC':
      return { kind: 'hvcC', data: bytes() };
    case 'av1C':
      return { kind: 'av1C', data: bytes() };
    case 'ispe': {
      r.full();
      return { kind: 'ispe', width: r.u32(), height: r.u32() };
    }
    case 'irot':
      return { kind: 'irot', angle: r.u8() & 3 };
    case 'imir':
      return { kind: 'imir', axis: r.u8() & 1 };
    case 'clap':
      return { kind: 'clap', wN: r.u32(), wD: r.u32(), hN: r.u32(), hD: r.u32(), xN: r.i32(), xD: r.u32(), yN: r.i32(), yD: r.u32() };
    case 'colr': {
      const t = r.cc();
      if (t === 'nclx') return { kind: 'colr-nclx', primaries: r.u16(), transfer: r.u16(), matrix: r.u16(), fullRange: (r.u8() & 0x80) !== 0 };
      if (t === 'prof' || t === 'rICC') return { kind: 'colr-icc', data: new Uint8Array(v.buffer, v.byteOffset + r.p, b.end - r.p) };
      return { kind: 'other', type: `colr-${t}` };
    }
    case 'auxC': {
      r.full();
      return { kind: 'auxC', auxType: r.str() };
    }
    case 'pixi': {
      r.full();
      const n = r.u8();
      const bits: number[] = [];
      for (let i = 0; i < n; i++) bits.push(r.u8());
      return { kind: 'pixi', bits };
    }
    default:
      return { kind: 'other', type: b.type };
  }
}

/** Lee la estructura HEIF. Lanza HeicError('corrupt'|'unsupported'). */
export function parseHeif(buf: ArrayBuffer | Uint8Array): HeifFile {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const top = boxes(v, 0, u8.byteLength);
  const ftyp = top.find((b) => b.type === 'ftyp');
  if (!ftyp) throw corrupt('no es un archivo HEIF');
  const fr = new R(v, ftyp.body, ftyp.end);
  const brands = [fr.cc()];
  fr.u32();
  while (fr.p + 4 <= ftyp.end) brands.push(fr.cc());
  const meta = top.find((b) => b.type === 'meta');
  if (!meta) {
    if (top.some((b) => b.type === 'moov')) throw new HeicError('unsupported', 'secuencia de imágenes sin imagen fija');
    throw corrupt('falta la caja meta');
  }
  const mr = new R(v, meta.body, meta.end);
  mr.full();
  const kids = boxes(v, mr.p, meta.end);
  const find = (t: string) => kids.find((b) => b.type === t);

  // pitm
  const pitm = find('pitm');
  if (!pitm) throw corrupt('falta la imagen principal (pitm)');
  const pr = new R(v, pitm.body, pitm.end);
  const primaryId = pr.full().version === 0 ? pr.u16() : pr.u32();

  // iinf / infe
  const items = new Map<number, HeifItem>();
  const iinf = find('iinf');
  if (!iinf) throw corrupt('falta iinf');
  {
    const r = new R(v, iinf.body, iinf.end);
    const { version } = r.full();
    if (version === 0) r.u16();
    else r.u32();
    for (const e of boxes(v, r.p, iinf.end)) {
      if (e.type !== 'infe') continue;
      const er = new R(v, e.body, e.end);
      const { version: ev, flags } = er.full();
      if (ev < 2) continue; // infe v0/v1 no se usa en HEIF
      const id = ev === 2 ? er.u16() : er.u32();
      er.u16(); // protection index
      const type = er.cc();
      items.set(id, { id, type, hidden: (flags & 1) === 1, method: 0, extents: [], props: [] });
    }
  }

  // iloc
  const iloc = find('iloc');
  if (!iloc) throw corrupt('falta iloc');
  {
    const r = new R(v, iloc.body, iloc.end);
    const { version } = r.full();
    const a = r.u8();
    const b = r.u8();
    const offSize = a >> 4;
    const lenSize = a & 15;
    const baseSize = b >> 4;
    const idxSize = version === 1 || version === 2 ? b & 15 : 0;
    const count = version < 2 ? r.u16() : r.u32();
    for (let i = 0; i < count; i++) {
      const id = version < 2 ? r.u16() : r.u32();
      const method = version === 1 || version === 2 ? r.u16() & 15 : 0;
      r.u16(); // data_reference_index
      const base = r.uN(baseSize);
      const n = r.u16();
      const extents: Extent[] = [];
      for (let k = 0; k < n; k++) {
        if (idxSize) r.uN(idxSize);
        const off = r.uN(offSize);
        const len = r.uN(lenSize);
        extents.push({ offset: base + off, length: len });
      }
      const it = items.get(id);
      if (it) {
        it.method = method;
        it.extents = extents;
      }
    }
  }

  // iprp: ipco + ipma
  const iprp = find('iprp');
  if (iprp) {
    const sub = boxes(v, iprp.body, iprp.end);
    const ipco = sub.find((s) => s.type === 'ipco');
    const props = ipco ? boxes(v, ipco.body, ipco.end).map((p) => parseProp(v, p)) : [];
    for (const ipma of sub.filter((s) => s.type === 'ipma')) {
      const r = new R(v, ipma.body, ipma.end);
      const { version, flags } = r.full();
      const n = r.u32();
      for (let i = 0; i < n; i++) {
        const id = version < 1 ? r.u16() : r.u32();
        const k = r.u8();
        const it = items.get(id);
        for (let j = 0; j < k; j++) {
          const idx = flags & 1 ? r.u16() & 0x7fff : r.u8() & 0x7f;
          if (idx > 0 && idx <= props.length && it) it.props.push(props[idx - 1]);
        }
      }
    }
  }

  // iref
  const refs: HeifRef[] = [];
  const iref = find('iref');
  if (iref) {
    const r = new R(v, iref.body, iref.end);
    const { version } = r.full();
    for (const rb of boxes(v, r.p, iref.end)) {
      const rr = new R(v, rb.body, rb.end);
      const from = version === 0 ? rr.u16() : rr.u32();
      const n = rr.u16();
      const to: number[] = [];
      for (let i = 0; i < n; i++) to.push(version === 0 ? rr.u16() : rr.u32());
      refs.push({ type: rb.type, from, to });
    }
  }

  const idatBox = find('idat');
  const idat = idatBox ? { start: idatBox.body, end: idatBox.end } : null;
  if (!items.has(primaryId)) throw corrupt('la imagen principal no existe');
  return { brands, primaryId, items, refs, idat, fileSize: u8.byteLength };
}

/** Bytes de un ítem (concatenando extensiones). Acotado al archivo. */
export function itemData(f: HeifFile, u8: Uint8Array, id: number): Uint8Array {
  const it = f.items.get(id);
  if (!it) throw corrupt(`ítem ${id} inexistente`);
  if (it.method > 1) throw new HeicError('unsupported', `construcción ${it.method}`);
  const base = it.method === 1 ? f.idat : { start: 0, end: f.fileSize };
  if (!base) throw corrupt('falta idat');
  const parts = it.extents.map((e) => {
    const s = base.start + e.offset;
    const end = e.length === 0 ? base.end : s + e.length;
    if (s < base.start || end > base.end || end < s) throw corrupt(`datos del ítem ${id} fuera del archivo`);
    return u8.subarray(s, end);
  });
  if (parts.length === 1) return parts[0];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function prop<K extends HeifProp['kind']>(it: HeifItem, kind: K): Extract<HeifProp, { kind: K }> | undefined {
  return it.props.find((p) => p.kind === kind) as Extract<HeifProp, { kind: K }> | undefined;
}

export function refsFrom(f: HeifFile, type: string, from: number): number[] {
  return f.refs.filter((r) => r.type === type && r.from === from).flatMap((r) => r.to);
}

/** Ítems que apuntan a `to` con una referencia `type` (p. ej. alfa: auxl → principal). */
export function refsTo(f: HeifFile, type: string, to: number): number[] {
  return f.refs.filter((r) => r.type === type && r.to.includes(to)).map((r) => r.from);
}
