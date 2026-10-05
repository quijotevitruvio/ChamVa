import { describe, expect, it } from 'vitest';
import {
  decodeAlpha,
  editableAlpha,
  encodeAlpha,
  featherAlpha,
  invertMatrix,
  layerMatrix,
  maskActive,
  maskPlane,
  MaskStroke,
  normalizeLayerMasks,
  packBits,
  rasterizeVector,
  rasterMask,
  sampleMask,
  solidMask,
  unpackBits,
  validMask,
  vectorMask,
  withAlpha,
  MASK_PREFIX,
} from './layerMask';
import { parseProject } from '../../io/project';
import { handlePixelJob, type PixelReply } from './pixelWorkerCore';

const rnd = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);

describe('codificación PackBits + base64', () => {
  it('ida y vuelta exacta: uniforme, ruido, bordes y vacío', () => {
    const r = rnd(7);
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([5]),
      new Uint8Array(1000).fill(255),
      Uint8Array.from({ length: 5000 }, () => Math.floor(r() * 256)),
      Uint8Array.from({ length: 3000 }, (_, i) => (i % 300 < 150 ? 0 : i % 7 === 0 ? 128 : 255)),
      Uint8Array.from({ length: 257 }, (_, i) => i & 255),
      Uint8Array.from({ length: 999 }, (_, i) => (i % 3 === 0 ? 1 : 2)), // literal-repetición alternos (peor caso)
      new Uint8Array(300_000).fill(7), // repetición larga
    ];
    for (const c of cases) expect(Array.from(unpackBits(packBits(c), c.length))).toEqual(Array.from(c));
  });
  it('una máscara blanca de 12 MP ocupa poco (comprimida)', () => {
    const big = new Uint8Array(4000 * 3000).fill(255);
    const s = encodeAlpha(big);
    expect(s.startsWith(MASK_PREFIX)).toBe(true);
    expect(s.length).toBeLessThan(100);
    expect(decodeAlpha(s, 4000, 3000)!.every((v) => v === 255)).toBe(true);
  });
  it('datos dañados o sin hidratar → null (no se aplica una máscara inventada)', () => {
    expect(decodeAlpha('asset:abc', 10, 10)).toBeNull();
    expect(decodeAlpha(MASK_PREFIX + '%%%', 10, 10)).toBeNull();
    expect(decodeAlpha(undefined, 10, 10)).toBeNull();
  });
});

describe('validación y migración', () => {
  it('máscara válida pasa; inválida se quita; diseño sin máscara queda idéntico', () => {
    const good = solidMask({ x: 0, y: 0, w: 10, h: 10 }, 255);
    const doc = {
      layers: [
        { id: 'a', type: 'shape', mask: good },
        { id: 'b', type: 'shape', mask: { kind: 'raster', rect: { x: 0, y: 0, w: 0, h: 5 } } },
        { id: 'c', type: 'text' },
      ],
    };
    const before = JSON.stringify(doc.layers[2]);
    normalizeLayerMasks(doc);
    expect((doc.layers[0] as { mask?: unknown }).mask).toEqual(good);
    expect('mask' in doc.layers[1]).toBe(false);
    expect(JSON.stringify(doc.layers[2])).toBe(before);
    // Idempotente.
    const again = JSON.stringify(doc);
    normalizeLayerMasks(doc);
    expect(JSON.stringify(doc)).toBe(again);
  });
  it('acepta referencias «asset:» (máscara deshidratada) y vectoriales', () => {
    expect(validMask({ kind: 'raster', rect: { x: 0, y: 0, w: 4, h: 4 }, w: 4, h: 4, data: 'asset:123' })).not.toBeNull();
    expect(validMask(vectorMask({ x: 0, y: 0, w: 4, h: 4 }, { type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 }, 2))).not.toBeNull();
    expect(validMask({ kind: 'vector', rect: { x: 0, y: 0, w: 4, h: 4 }, shape: { type: 'nope' } })).toBeNull();
    expect(validMask({ kind: 'raster', rect: { x: 0, y: 0, w: 4, h: 4 }, w: 99999, h: 4, data: 'x' })).toBeNull();
  });
  it('.chamva: un proyecto con máscara se abre igual y uno viejo sin máscara no cambia', () => {
    const m = rasterMask({ x: 0, y: 0, w: 3, h: 2 }, 3, 2, new Uint8Array([0, 128, 255, 255, 128, 0]), 0);
    const layer = { id: 'l', type: 'shape', name: 's', x: 1, y: 2, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, blendMode: 'normal', visible: true, locked: false, shape: 'rect', width: 3, height: 2, fill: '#f00', stroke: '#000', strokeWidth: 0, cornerRadius: 0, shadow: false, shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0 };
    const page = { id: 'p', name: 'd', width: 10, height: 10, background: { type: 'transparent' }, version: 1 };
    const withMask = parseProject(JSON.stringify({ kind: 'chamva-project', version: 2, pageIndex: 0, pages: [{ ...page, layers: [{ ...layer, mask: m }] }] }));
    const back = withMask.pages[0].layers[0].mask!;
    expect(back).toEqual(m);
    expect(Array.from(decodeAlpha(back.data, 3, 2)!)).toEqual([0, 128, 255, 255, 128, 0]);
    const old = parseProject(JSON.stringify({ kind: 'chamva-project', version: 2, pageIndex: 0, pages: [{ ...page, layers: [layer] }] }));
    expect(old.pages[0].layers[0]).toEqual(layer);
    expect('mask' in old.pages[0].layers[0]).toBe(false);
  });
  it('desactivada no se aplica', () => {
    const m = solidMask({ x: 0, y: 0, w: 2, h: 2 }, 0);
    expect(maskActive(m)).toBe(true);
    expect(maskActive({ ...m, enabled: false })).toBe(false);
    expect(maskActive(undefined)).toBe(false);
  });
});

describe('plano final: invertir, fuera del rect, desvanecer', () => {
  it('invertir y valor de fuera', () => {
    const m = rasterMask({ x: 0, y: 0, w: 2, h: 1 }, 2, 1, new Uint8Array([0, 255]), 0);
    const p = maskPlane(m)!;
    expect(Array.from(p.alpha)).toEqual([0, 255]);
    expect(p.outside).toBe(0);
    const pi = maskPlane({ ...m, invert: true })!;
    expect(Array.from(pi.alpha)).toEqual([255, 0]);
    expect(pi.outside).toBe(255);
    expect(sampleMask(p, m.rect, -5, 0.5)).toBe(0);
    expect(sampleMask(p, m.rect, 1.5, 0.5)).toBe(255);
  });
  it('feather: conserva la media, suaviza el borde y deja lo lejano intacto', () => {
    const w = 64;
    const h = 8;
    const a = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 32; x < w; x++) a[y * w + x] = 255;
    const f = featherAlpha(a, w, h, 6);
    const row = Array.from(f.subarray(4 * w, 5 * w));
    expect(row[0]).toBe(0);
    expect(row[63]).toBe(255);
    expect(row[31]).toBeGreaterThan(40);
    expect(row[32]).toBeLessThan(215);
    for (let x = 1; x < w; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]); // monótono
    expect(Array.from(featherAlpha(a, w, h, 0))).toEqual(Array.from(a)); // radio 0 = copia
    // Mismo resultado en el worker (misma función pura).
    let out: ArrayBuffer | null = null;
    handlePixelJob({ id: 1, op: 'maskFeather', buffer: new Uint8Array(a).buffer, width: w, height: h, radius: 6 }, (r: PixelReply) => {
      if ('done' in r) out = r.buffer;
    });
    expect(Array.from(new Uint8Array(out!))).toEqual(Array.from(f));
  });
  it('máscara ráster con feather: el feather está en px LOCALES (se escala al plano)', () => {
    const a = new Uint8Array(20 * 20);
    for (let i = 0; i < a.length; i++) a[i] = i % 20 >= 10 ? 255 : 0;
    const m1 = { ...rasterMask({ x: 0, y: 0, w: 20, h: 20 }, 20, 20, a), feather: 4 };
    const m2 = { ...rasterMask({ x: 0, y: 0, w: 40, h: 40 }, 20, 20, a), feather: 8 }; // doble de grande en local
    expect(Array.from(maskPlane(m1)!.alpha)).toEqual(Array.from(maskPlane(m2)!.alpha));
  });
});

describe('máscaras vectoriales', () => {
  const rect = { x: 0, y: 0, w: 100, h: 50 };
  it('elipse: dentro 255, fuera 0, borde suave con feather', () => {
    const a = rasterizeVector({ type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 }, rect, 100, 50, 0);
    expect(a[25 * 100 + 50]).toBe(255);
    expect(a[0]).toBe(0);
    const f = rasterizeVector({ type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3 }, rect, 100, 50, 10);
    const edge = f[25 * 100 + 80]; // x=80.5 → justo en el borde (rx = 30 px desde x=50)
    expect(edge).toBeGreaterThan(80);
    expect(edge).toBeLessThan(175);
  });
  it('rectángulo exacto sin feather (antialias de 1 px)', () => {
    const a = rasterizeVector({ type: 'rect', cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.5 }, rect, 100, 50, 0);
    // Caja x ∈ [25, 75): píxeles 25..74 dentro.
    expect(a[10 * 100 + 24]).toBe(0);
    expect(a[10 * 100 + 25]).toBe(255);
    expect(a[10 * 100 + 74]).toBe(255);
    expect(a[10 * 100 + 75]).toBe(0);
  });
  it('degradado lineal y radial', () => {
    const l = rasterizeVector({ type: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5 }, rect, 100, 50);
    expect(l[0]).toBeLessThan(5);
    expect(l[99]).toBeGreaterThan(250);
    expect(Math.abs(l[50] - 128)).toBeLessThan(4);
    const r = rasterizeVector({ type: 'radial', cx: 0.5, cy: 0.5, r0: 0.2, r1: 0.5 }, rect, 100, 50);
    expect(r[25 * 100 + 50]).toBe(255);
    expect(r[0]).toBe(0);
  });
  it('editable: una vectorial se convierte en ráster con su borde, sin volver a desenfocar', () => {
    const v = vectorMask(rect, { type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4 }, 6);
    const ed = editableAlpha(v)!;
    const r = withAlpha(v, ed.w, ed.h, ed.alpha);
    expect(r.kind).toBe('raster');
    expect(r.feather).toBeUndefined();
    expect(Array.from(maskPlane(r)!.alpha)).toEqual(Array.from(maskPlane(v)!.alpha));
  });
});

describe('pincel sobre la máscara', () => {
  it('pinta negro (ocultar) y blanco (mostrar); repasar no acumula; opacidad 1 llega al valor exacto', () => {
    const w = 40;
    const h = 40;
    const plane = new Uint8Array(w * h).fill(255);
    const s = new MaskStroke(plane, w, h, { value: 0, size: 10, hardness: 1, opacity: 1 });
    s.dab(20, 20);
    expect(plane[20 * w + 20]).toBe(0);
    expect(plane[0]).toBe(255);
    expect(s.changed()).toBe(true);
    // Opacidad 0.5: un solo trazo deja ~128 aunque se pase dos veces.
    const p2 = new Uint8Array(w * h).fill(255);
    const s2 = new MaskStroke(p2, w, h, { value: 0, size: 10, hardness: 1, opacity: 0.5 });
    s2.dab(20, 20);
    const once = p2[20 * w + 20];
    s2.dab(20, 20);
    s2.line(15, 20, 25, 20);
    expect(p2[20 * w + 20]).toBe(once);
    expect(Math.abs(once - 128)).toBeLessThanOrEqual(1);
    // Mostrar de nuevo.
    const s3 = new MaskStroke(plane, w, h, { value: 255, size: 30, hardness: 1, opacity: 1 });
    s3.dab(20, 20);
    expect(plane[20 * w + 20]).toBe(255);
  });
});

describe('matriz de la capa', () => {
  it('local → documento y vuelta (girada, escalada y volteada)', () => {
    const m = layerMatrix({ x: 30, y: 40, rotation: 33, scaleX: -1.5, scaleY: 0.7 });
    const inv = invertMatrix(m)!;
    const [a, b, c, d, e, f] = m;
    const px = a * 12 + c * 7 + e;
    const py = b * 12 + d * 7 + f;
    const [ia, ib, ic, id, ie, iff] = inv;
    expect(ia * px + ic * py + ie).toBeCloseTo(12, 9);
    expect(ib * px + id * py + iff).toBeCloseTo(7, 9);
  });
});
