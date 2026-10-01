import { describe, expect, it } from 'vitest';
import {
  activeKit,
  contrastLevel,
  contrastMatrix,
  contrastPairs,
  createKit,
  deleteKit,
  duplicateKit,
  layoutBrandSheet,
  migrateKits,
  renameKit,
  respectFactor,
  rgbText,
  invadesZone,
  respectZone,
  sheetItemsToLayers,
} from './brandKits';
import type { UploadedImage } from './types';

const logo = (id: string, w = 200, h = 100): UploadedImage => ({
  id,
  src: 'data:image/png;base64,AAAA',
  naturalWidth: w,
  naturalHeight: h,
  name: id,
});
const legacy = { colors: ['#ff0000'], fonts: ['Inter'], logos: [logo('a')] };
let n = 0;
const nid = () => `k${++n}`;

describe('migración de kits', () => {
  it('sin datos: el kit único antiguo pasa a ser «Mi marca»', () => {
    const kits = migrateKits(undefined, legacy, nid);
    expect(kits).toHaveLength(1);
    expect(kits[0].name).toBe('Mi marca');
    expect(kits[0].colors).toEqual(['#ff0000']);
    expect(kits[0].logos[0].id).toBe('a');
  });
  it('con datos válidos los conserva y descarta basura', () => {
    const kits = migrateKits(
      [{ id: 'x', name: 'Cliente A', colors: ['#000000'], fonts: [] }, null, { name: 'sin id' }],
      legacy,
      nid,
    );
    expect(kits.map((k) => k.id)).toEqual(['x']);
    expect(kits[0].logos).toEqual([]);
  });
  it('lista vacía vuelve a crear el kit', () => {
    expect(migrateKits([], legacy, nid)).toHaveLength(1);
  });
});

describe('selección y operaciones de kits', () => {
  const base = migrateKits(undefined, legacy, () => 'k0');
  it('activeKit cae al primero si el id no existe', () => {
    expect(activeKit(base, 'nope').id).toBe('k0');
    expect(activeKit(base, 'k0').id).toBe('k0');
  });
  it('crear, duplicar y renombrar', () => {
    let kits = createKit(base, 'Cliente B', 'k1');
    expect(kits).toHaveLength(2);
    kits = duplicateKit(kits, 'k0', 'k2');
    expect(kits.map((k) => k.id)).toEqual(['k0', 'k2', 'k1']);
    expect(kits[1].name).toBe('Mi marca (copia)');
    kits[1].colors.push('#00ff00');
    expect(kits[0].colors).toEqual(['#ff0000']); // la copia es independiente
    kits = renameKit(kits, 'k1', '  Cliente Z ');
    expect(kits[2].name).toBe('Cliente Z');
    expect(renameKit(kits, 'k1', '   ')).toBe(kits);
  });
  it('borrar mueve el activo y nunca deja cero kits', () => {
    const kits = createKit(base, 'B', 'k1');
    const r = deleteKit(kits, 'k0', 'k0');
    expect(r.kits.map((k) => k.id)).toEqual(['k1']);
    expect(r.activeId).toBe('k1');
    expect(deleteKit(r.kits, 'k1', 'k1').kits).toHaveLength(1);
  });
  it('factor de zona de respeto', () => {
    expect(respectFactor(base[0], 'a')).toBe(0.5);
    expect(respectFactor({ ...base[0], respect: { a: 0.25 } }, 'a')).toBe(0.25);
  });
});

describe('contraste', () => {
  it('niveles WCAG', () => {
    expect(contrastLevel(21)).toBe('AAA');
    expect(contrastLevel(4.5)).toBe('AA');
    expect(contrastLevel(3.2)).toBe('AA grande');
    expect(contrastLevel(1.5)).toBe('no pasa');
  });
  it('matriz y pares', () => {
    const m = contrastMatrix(['#000000', '#ffffff', '#777777']);
    expect(m).toHaveLength(3);
    expect(m[0][0]).toBeNull();
    expect(m[0][1]?.ratio).toBeCloseTo(21, 0);
    const pairs = contrastPairs(['#000000', '#ffffff', '#777777']);
    expect(pairs).toHaveLength(6);
    expect(pairs[0].ratio).toBeGreaterThanOrEqual(pairs[5].ratio);
    const aa = contrastPairs(['#000000', '#ffffff', '#777777'], true);
    expect(aa.every((p) => p.aa)).toBe(true);
    expect(aa.some((p) => p.fg === '#777777' && p.bg === '#ffffff')).toBe(false); // 4,48
  });
  it('rgbText', () => {
    expect(rgbText('#ff8000')).toBe('RGB 255, 128, 0');
  });
});

describe('layoutBrandSheet', () => {
  const kit = {
    name: 'Cliente A',
    logos: [logo('a'), logo('b', 100, 300)],
    colors: ['#111111', '#ffffff', '#e11d48', '#0ea5e9', '#f59e0b', '#10b981', '#6366f1'],
    fonts: ['Inter', 'Georgia'],
  };
  for (const size of [{ width: 1080, height: 1080 }, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    it(`todo cabe en ${size.width}×${size.height}`, () => {
      const items = layoutBrandSheet(kit, size);
      for (const it of items) {
        expect(it.x).toBeGreaterThanOrEqual(0);
        expect(it.y).toBeGreaterThanOrEqual(0);
        if (it.kind !== 'text') {
          expect(it.x + it.w).toBeLessThanOrEqual(size.width + 0.5);
          expect(it.y + it.h).toBeLessThanOrEqual(size.height + 0.5);
        } else {
          expect(it.x).toBeLessThan(size.width);
          expect(it.y).toBeLessThan(size.height);
        }
      }
    });
  }
  it('incluye logos, hex/RGB, tipografías y título', () => {
    const items = layoutBrandSheet(kit, { width: 1080, height: 1080 });
    expect(items.filter((i) => i.kind === 'logo')).toHaveLength(2);
    const texts = items.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);
    expect(texts.some((t) => t.startsWith('Hoja de marca · Cliente A'))).toBe(true);
    expect(texts.some((t) => t.includes('#E11D48') && t.includes('RGB 225, 29, 72'))).toBe(true);
    expect(texts.some((t) => t.includes('Georgia'))).toBe(true);
  });
  it('el logo conserva su proporción', () => {
    const items = layoutBrandSheet(kit, { width: 1080, height: 1080 });
    const l = items.filter((i) => i.kind === 'logo')[1] as { w: number; h: number };
    expect(l.w / l.h).toBeCloseTo(100 / 300, 3);
  });
  it('un kit vacío no rompe', () => {
    const items = layoutBrandSheet({ name: 'Vacío', logos: [], colors: [], fonts: [] }, { width: 800, height: 600 });
    expect(items.length).toBeGreaterThan(3);
  });
});

describe('hoja → capas', () => {
  it('genera capas editables de cada tipo', () => {
    const kit = { name: 'K', logos: [logo('a')], colors: ['#111111', '#ffffff'], fonts: ['Inter'] };
    const items = layoutBrandSheet(kit, { width: 1080, height: 1080 });
    let i = 0;
    const layers = sheetItemsToLayers(items, kit.logos, () => `L${i++}`);
    expect(layers).toHaveLength(items.length);
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
    expect(layers.some((l) => l.type === 'image')).toBe(true);
    expect(layers.some((l) => l.type === 'text')).toBe(true);
    expect(layers.some((l) => l.type === 'shape')).toBe(true);
  });
});

describe('zona de respeto', () => {
  const lg = { x: 100, y: 100, w: 200, h: 100 };
  it('margen = mitad de la altura por defecto', () => {
    expect(respectZone(lg, 0.5)).toEqual({ x: 50, y: 50, w: 300, h: 200 });
  });
  it('detecta invasión pero no el simple contacto', () => {
    const z = respectZone(lg, 0.5);
    expect(invadesZone(z, { x: 340, y: 100, w: 50, h: 50 })).toBe(true);
    expect(invadesZone(z, { x: 350, y: 100, w: 50, h: 50 })).toBe(false);
    expect(invadesZone(z, { x: 500, y: 500, w: 10, h: 10 })).toBe(false);
  });
});
