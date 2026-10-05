import { describe, expect, it } from 'vitest';
import { av1CodecString, hevcCodecString } from './codec';
import { colorInfo, colorOverride, iccDescription } from './color';
import { decodeWithPlan, type DecodeDeps, type FrameLike, type SurfaceLike } from './decodeCore';
import { isHeicLike, isHeifBrand, sniffFtyp } from './detect';
import { HeicError, heicErrorReason, isHeicError } from './errors';
import { exifOrientationFromItem } from './exif';
import { parseHeif } from './isobmff';
import { buildPlan, type ImagePlan } from './plan';
import { exifItem, gridData, writeHeif, type TestItem, type TestProp } from './testHeif';
import { applyMatrix, cleanAperture, exifOps, orientationPlan } from './transform';

// hvcC sintético: Main, compat 0x60000000, tier L, nivel 93, restricción B0, 4:2:0, 8 bits.
function hvcC(profile = 1, level = 93, chroma = 1): Uint8Array {
  const b = new Uint8Array(23);
  b[0] = 1;
  b[1] = profile & 31;
  b.set([0x60, 0, 0, 0], 2);
  b[6] = 0xb0;
  b[12] = level;
  b[16] = 0xfc | chroma;
  b[17] = 0xf8;
  b[18] = 0xf8;
  b[21] = 3;
  return b;
}
const tile = (id: number, w: number, h: number, extra: Partial<TestItem> = {}): TestItem => ({
  id,
  type: 'hvc1',
  data: new Uint8Array([0, 0, 0, 2, id & 255, 7]),
  hidden: true,
  props: [{ t: 'hvcC', data: hvcC() }, { t: 'ispe', w, h }],
  ...extra,
});
function gridFile(rows: number, cols: number, tw: number, th: number, outW: number, outH: number, props: TestProp[] = [], more: Partial<Parameters<typeof writeHeif>[0]> = {}) {
  const ids = Array.from({ length: rows * cols }, (_, i) => 100 + i);
  return writeHeif({
    primary: 1,
    items: [{ id: 1, type: 'grid', idat: gridData(rows, cols, outW, outH), props: [{ t: 'ispe', w: outW, h: outH }, ...props] }, ...ids.map((id) => tile(id, tw, th)), ...(more.items ?? [])],
    refs: [{ type: 'dimg', from: 1, to: ids }, ...(more.refs ?? [])],
  });
}
const single = (w: number, h: number, props: TestProp[] = []) =>
  writeHeif({ primary: 1, items: [{ ...tile(1, w, h), hidden: false, props: [{ t: 'hvcC', data: hvcC() }, { t: 'ispe', w, h }, ...props] }] });

describe('detección', () => {
  it('por extensión y tipo', () => {
    expect(isHeicLike({ name: 'IMG_0001.HEIC', type: '' })).toBe(true);
    expect(isHeicLike({ name: 'foto.heif', type: '' })).toBe(true);
    expect(isHeicLike({ name: 'x', type: 'image/heic' })).toBe(true);
    expect(isHeicLike({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false);
    expect(isHeicLike({ name: 'a.avif', type: 'image/avif' })).toBe(false); // AVIF lo abre el navegador
  });
  it('marca ftyp', () => {
    const f = single(8, 8);
    expect(sniffFtyp(f)?.major).toBe('heic');
    expect(isHeifBrand(f)).toBe(true);
    expect(isHeifBrand(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe('cadenas de códec', () => {
  it('HEVC Main', () => expect(hevcCodecString(hvcC())).toBe('hvc1.1.6.L93.B0'));
  it('HEVC Main Still Picture sin restricciones', () => {
    const b = hvcC(3, 60);
    b[6] = 0;
    b.set([0x70, 0, 0, 0], 2);
    expect(hevcCodecString(b)).toBe('hvc1.3.E.L60');
  });
  it('AV1', () => expect(av1CodecString(new Uint8Array([0x81, 0x0d, 0x0c, 0]))).toBe('av01.0.13M.08'));
  it('hvcC corto = dañado', () => expect(() => hevcCodecString(new Uint8Array(5))).toThrow(HeicError));
});

describe('contenedor', () => {
  it('rejilla con datos en idat, teselas compartiendo extensiones y propiedades en orden', () => {
    const f = parseHeif(gridFile(2, 3, 512, 512, 1500, 1000, [{ t: 'irot', angle: 1 }, { t: 'imir', axis: 0 }]));
    const g = f.items.get(f.primaryId)!;
    expect(g.type).toBe('grid');
    expect(g.method).toBe(1);
    expect(g.props.map((p) => p.kind)).toEqual(['ispe', 'irot', 'imir']);
    expect(f.refs[0]).toEqual({ type: 'dimg', from: 1, to: [100, 101, 102, 103, 104, 105] });
  });
  it('plan de rejilla: 6 teselas, tamaño de salida y orientación', () => {
    const p = buildPlan(gridFile(2, 3, 512, 512, 1500, 1000, [{ t: 'irot', angle: 1 }]));
    expect(p.color).toMatchObject({ codec: 'hevc', cols: 3, rows: 2, outW: 1500, outH: 1000, tileW: 512 });
    expect(p.color.tiles).toHaveLength(6);
    expect([p.width, p.height]).toEqual([1000, 1500]);
  });
  it('alfa, miniatura y profundidad: solo se usa la principal (+ alfa)', () => {
    const f = writeHeif({
      primary: 1,
      items: [
        { ...tile(1, 64, 48), hidden: false },
        { ...tile(2, 64, 48), props: [{ t: 'hvcC', data: hvcC(1, 93, 0) }, { t: 'ispe', w: 64, h: 48 }, { t: 'auxC', urn: 'urn:mpeg:hevc:2015:auxid:1' }] },
        { ...tile(3, 16, 12), hidden: false },
        { ...tile(4, 32, 24), props: [{ t: 'hvcC', data: hvcC() }, { t: 'ispe', w: 32, h: 24 }, { t: 'auxC', urn: 'urn:mpeg:hevc:2015:auxid:2' }] },
      ],
      refs: [
        { type: 'auxl', from: 2, to: [1] },
        { type: 'thmb', from: 3, to: [1] },
        { type: 'auxl', from: 4, to: [1] },
      ],
    });
    const p = buildPlan(f);
    expect(p.alpha?.monochrome).toBe(true);
    expect(p.ignored).toEqual(expect.arrayContaining(['miniatura', 'mapa de profundidad']));
    expect(p.ignored).not.toContain('otras imágenes del archivo');
  });
  it('varias imágenes: avisa de las otras', () => {
    const f = writeHeif({ primary: 1, items: [{ ...tile(1, 8, 8), hidden: false }, { ...tile(2, 8, 8), hidden: false }] });
    expect(buildPlan(f).ignored).toContain('otras imágenes del archivo');
  });
  it('EXIF solo si no hay irot/imir', () => {
    const mk = (props: TestProp[]) =>
      writeHeif({
        primary: 1,
        items: [{ ...tile(1, 40, 30), hidden: false, props: [{ t: 'hvcC', data: hvcC() }, { t: 'ispe', w: 40, h: 30 }, ...props] }, { id: 2, type: 'Exif', data: exifItem(6) }],
        refs: [{ type: 'cdsc', from: 2, to: [1] }],
      });
    const e = buildPlan(mk([]));
    expect(e.orient.orientationFrom).toBe('exif');
    expect([e.width, e.height]).toEqual([30, 40]);
    const h = buildPlan(mk([{ t: 'irot', angle: 2 }]));
    expect(h.orient.orientationFrom).toBe('heif');
    expect([h.width, h.height]).toEqual([40, 30]);
  });
  it('errores legibles: truncado, basura, rejilla incoherente, códec no admitido, demasiado grande', () => {
    const full = gridFile(1, 2, 64, 64, 128, 64);
    const code = (fn: () => unknown) => {
      try {
        fn();
        return 'ok';
      } catch (e) {
        return isHeicError(e) ? e.code : 'otro';
      }
    };
    expect(code(() => buildPlan(full.slice(0, full.length - 3)))).toBe('corrupt');
    expect(code(() => buildPlan(new Uint8Array(16)))).toBe('corrupt');
    expect(code(() => buildPlan(gridFile(1, 2, 64, 64, 300, 64)))).toBe('corrupt');
    expect(code(() => buildPlan(writeHeif({ primary: 1, items: [{ id: 1, type: 'iovl', idat: new Uint8Array(8) }] })))).toBe('unsupported');
    expect(code(() => buildPlan(gridFile(1, 2, 64, 64, 128, 64), 1000))).toBe('too-large');
    // ftyp con tamaño enorme (caso github_15 de libheif)
    expect(code(() => buildPlan(new Uint8Array([0, 0, 0, 1, 0x66, 0x74, 0x79, 0x70, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0])))).toBe('corrupt');
  });
});

describe('orientación y recorte', () => {
  const W = 40;
  const H = 30;
  // dónde acaba la esquina superior derecha (W,0) de la foto para cada orientación EXIF
  const cases: [number, [number, number], [number, number]][] = [
    [1, [W, 0], [W, H]],
    [2, [0, 0], [W, H]],
    [3, [0, H], [W, H]],
    [4, [W, H], [W, H]],
    [5, [0, W], [H, W]],
    [6, [H, W], [H, W]],
    [7, [H, 0], [H, W]],
    [8, [0, 0], [H, W]],
  ];
  for (const [o, corner, size] of cases)
    it(`EXIF ${o}`, () => {
      const p = orientationPlan([], W, H, o);
      expect([p.outW, p.outH]).toEqual(size);
      expect(applyMatrix(p.matrix, W, 0).map((v) => Math.round(v) + 0)).toEqual(corner);
    });
  it('irot 90° antihorario + imir', () => {
    const p = orientationPlan([{ kind: 'irot', angle: 1 }], W, H);
    expect(applyMatrix(p.matrix, W, 0)).toEqual([0, 0]); // arriba-derecha → arriba-izquierda
    expect(exifOps(8)).toEqual(['rot90ccw']);
  });
  it('clap centrado y clap inválido ignorado', () => {
    expect(cleanAperture({ kind: 'clap', wN: 20, wD: 1, hN: 10, hD: 1, xN: 0, xD: 1, yN: 0, yD: 1 }, 40, 30)).toEqual({ x: 10, y: 10, w: 20, h: 10 });
    expect(cleanAperture({ kind: 'clap', wN: 80, wD: 1, hN: 10, hD: 1, xN: 0, xD: 1, yN: 0, yD: 1 }, 40, 30)).toEqual({ x: 0, y: 0, w: 40, h: 30 });
  });
  it('EXIF desde el ítem', () => expect(exifOrientationFromItem(exifItem(3))).toBe(3));
});

describe('color', () => {
  const icc = (name: string) => {
    const b = new Uint8Array(200);
    const v = new DataView(b.buffer);
    v.setUint32(0, 200);
    v.setUint32(128, 1);
    b.set([100, 101, 115, 99], 132);
    v.setUint32(136, 144);
    v.setUint32(140, 40);
    b.set([100, 101, 115, 99], 144);
    v.setUint32(152, name.length + 1);
    b.set(new TextEncoder().encode(name), 156);
    return b;
  };
  it('nombre del perfil ICC', () => expect(iccDescription(icc('Display P3'))).toBe('Display P3'));
  it('ICC P3 reetiqueta primarias solo si el flujo no las trae', () => {
    const info = colorInfo([{ kind: 'colr-icc', data: icc('Display P3') }]);
    expect(info.primaries).toBe('smpte432');
    const fr = { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'smpte170m', fullRange: true };
    expect(colorOverride(info, fr)).toEqual({ ...fr, primaries: 'smpte432' });
    expect(colorOverride(info, { ...fr, primaries: 'smpte432' })).toBeNull();
  });
  it('nclx manda; sin color declarado no se toca', () => {
    const info = colorInfo([{ kind: 'colr-nclx', primaries: 1, transfer: 13, matrix: 6, fullRange: true }]);
    expect(colorOverride(info, { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'smpte170m', fullRange: true })).toBeNull();
    expect(colorOverride(colorInfo([]), { primaries: null, transfer: null, matrix: null, fullRange: null })).toBeNull();
  });
});

// ---- decodificador simulado ----
interface Draw {
  src: unknown;
  args: number[];
}
function fakeDeps(opts: { fail?: (i: number, role: string) => Error | null; noAlpha?: boolean; none?: boolean; onDecode?: (i: number) => void } = {}) {
  const draws: Draw[] = [];
  const surfaces: { w: number; h: number; released: boolean }[] = [];
  const deps: DecodeDeps = {
    async openDecoder(p: ImagePlan, role) {
      if (opts.none) return null;
      if (role === 'alpha' && opts.noAlpha) return null;
      return {
        async decode(_d, i) {
          opts.onDecode?.(i);
          const e = opts.fail?.(i, role);
          if (e) throw e;
          const f: FrameLike & { role: string; i: number } = { displayWidth: p.tileW, displayHeight: p.tileH, close() {}, role, i };
          return f;
        },
        close() {},
      };
    },
    surface(w, h): SurfaceLike {
      const rec = { w, h, released: false };
      surfaces.push(rec);
      const s: SurfaceLike = {
        width: w,
        height: h,
        source: rec,
        ctx: {
          drawImage: (src: unknown, ...args: number[]) => draws.push({ src, args }),
          setTransform: () => {},
          getImageData: (_x: number, _y: number, ww: number, hh: number) => ({ data: new Uint8ClampedArray(ww * hh * 4).fill(rec === surfaces[1] ? 77 : 200) }),
          putImageData: () => {},
        } as SurfaceLike['ctx'],
        toBlob: async (type) => new Blob([new Uint8Array(4)], { type }),
        release: () => {
          rec.released = true;
        },
      };
      return s;
    },
  };
  return { deps, draws, surfaces };
}

describe('decodificación (simulada)', () => {
  it('coloca las teselas por filas, orienta, informa progreso y libera los lienzos', async () => {
    const buf = gridFile(2, 3, 512, 512, 1500, 1000, [{ t: 'irot', angle: 1 }]);
    const plan = buildPlan(buf);
    const { deps, draws, surfaces } = fakeDeps();
    const prog: number[] = [];
    const r = await decodeWithPlan(plan, buf, deps, { onProgress: (p) => prog.push(p) });
    const tilesDrawn = draws.filter((d) => (d.src as { role?: string }).role === 'color');
    expect(tilesDrawn.map((d) => d.args.slice(0, 2))).toEqual([
      [0, 0],
      [512, 0],
      [1024, 0],
      [0, 512],
      [512, 512],
      [1024, 512],
    ]);
    expect([r.width, r.height]).toEqual([1000, 1500]);
    expect(r.blob.type).toBe('image/jpeg');
    expect(prog[prog.length - 1]).toBe(1);
    expect(prog).toEqual([...prog].sort((a, b) => a - b));
    expect(surfaces.every((s) => s.released)).toBe(true);
  });
  it('sin decodificador → no-decoder con guía', async () => {
    const buf = single(16, 16);
    await expect(decodeWithPlan(buildPlan(buf), buf, fakeDeps({ none: true }).deps)).rejects.toMatchObject({ code: 'no-decoder' });
    expect(heicErrorReason('no-decoder')).toContain('Fotos de Windows');
  });
  it('error del decodificador → decode-failed; NotSupportedError → no-decoder', async () => {
    const buf = single(16, 16);
    const plan = buildPlan(buf);
    await expect(decodeWithPlan(plan, buf, fakeDeps({ fail: () => new Error('Decoder error.') }).deps)).rejects.toMatchObject({ code: 'decode-failed' });
    const ns = Object.assign(new Error('Unsupported configuration'), { name: 'NotSupportedError' });
    await expect(decodeWithPlan(plan, buf, fakeDeps({ fail: () => ns }).deps)).rejects.toMatchObject({ code: 'no-decoder' });
  });
  it('cancelar a mitad corta en la siguiente tesela y libera memoria', async () => {
    const buf = gridFile(4, 4, 256, 256, 1024, 1024);
    let n = 0;
    const { deps, surfaces } = fakeDeps({ onDecode: () => n++ });
    await expect(decodeWithPlan(buildPlan(buf), buf, deps, { isCancelled: () => n >= 5 })).rejects.toMatchObject({ code: 'aborted' });
    expect(n).toBe(5);
    expect(surfaces.every((s) => s.released)).toBe(true);
  });
  it('alfa: PNG si se puede leer; si no, opaca con aviso', async () => {
    const buf = writeHeif({
      primary: 1,
      items: [{ ...tile(1, 32, 32), hidden: false }, { ...tile(2, 32, 32), props: [{ t: 'hvcC', data: hvcC(1, 93, 0) }, { t: 'ispe', w: 32, h: 32 }, { t: 'auxC', urn: 'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha' }] }],
      refs: [{ type: 'auxl', from: 2, to: [1] }],
    });
    const ok = await decodeWithPlan(buildPlan(buf), buf, fakeDeps().deps);
    expect(ok.blob.type).toBe('image/png');
    const no = await decodeWithPlan(buildPlan(buf), buf, fakeDeps({ noAlpha: true }).deps);
    expect(no.blob.type).toBe('image/jpeg');
    expect(no.warnings.join()).toContain('transparencia');
    const bad = await decodeWithPlan(buildPlan(buf), buf, fakeDeps({ fail: (_i, role) => (role === 'alpha' ? new Error('mono') : null) }).deps);
    expect(bad.blob.type).toBe('image/jpeg');
    expect(bad.warnings.join()).toContain('transparencia');
  });
});
