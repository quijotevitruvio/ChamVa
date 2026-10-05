import { describe, expect, it } from 'vitest';
import {
  clampBox,
  cropPatch,
  cropPixelRect,
  displayBox,
  fitAspect,
  flipBox,
  fullSize,
  moveInside,
  normalizeImageCrops,
  snapBox,
  sourceBox,
  validCrop,
  type Box,
} from './imageCrop';
import { parseProject } from '../../io/project';
import type { ImageLayer } from './types';

type L = Pick<ImageLayer, 'naturalWidth' | 'naturalHeight' | 'crop' | 'flipX' | 'flipY' | 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>;
const base = (o: Partial<L> = {}): L => ({
  naturalWidth: 4000,
  naturalHeight: 3000,
  crop: undefined,
  flipX: false,
  flipY: false,
  x: 100,
  y: 50,
  rotation: 0,
  scaleX: 0.25,
  scaleY: 0.25,
  ...o,
});

// Oráculo independiente: posición en el lienzo de un píxel de la FUENTE (unidades naturales
// completas) tal y como lo dibuja Konva/export: volteo del trozo + T·R·S desde el origen local.
function worldOf(l: L, px: number, py: number) {
  const f = fullSize(l);
  const d = displayBox(l);
  const dx = (l.flipX ? f.w - px : px) - d.x;
  const dy = (l.flipY ? f.h - py : py) - d.y;
  const r = (l.rotation * Math.PI) / 180;
  const lx = dx * l.scaleX;
  const ly = dy * l.scaleY;
  return { x: l.x + lx * Math.cos(r) - ly * Math.sin(r), y: l.y + lx * Math.sin(r) + ly * Math.cos(r) };
}
const apply = (l: L, disp: Box): L => ({ ...l, ...cropPatch(l, disp)! });

describe('validCrop / migración', () => {
  it('acepta fracciones válidas y rechaza vacíos, fuera de límites, NaN y la imagen entera', () => {
    expect(validCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
    expect(validCrop(undefined)).toBeUndefined();
    expect(validCrop({ x: 0, y: 0, w: 0, h: 0.5 })).toBeUndefined();
    expect(validCrop({ x: 0.8, y: 0, w: 0.5, h: 0.5 })).toBeUndefined();
    expect(validCrop({ x: -0.2, y: 0, w: 0.5, h: 0.5 })).toBeUndefined();
    expect(validCrop({ x: NaN, y: 0, w: 0.5, h: 0.5 })).toBeUndefined();
    expect(validCrop({ x: '0', y: 0, w: 0.5, h: 0.5 })).toBeUndefined();
    expect(validCrop({ x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
  });

  it('capa antigua sin crop: tamaño y región = la imagen entera (se ve igual)', () => {
    const l = base();
    expect(fullSize(l)).toEqual({ w: 4000, h: 3000 });
    expect(sourceBox(l)).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
    expect(displayBox(l)).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
  });

  it('normalizeImageCrops es idempotente y solo quita recortes inválidos', () => {
    const doc = {
      layers: [
        { type: 'image', crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
        { type: 'image', crop: { x: 2, y: 0, w: 1, h: 1 } },
        { type: 'image' },
        { type: 'text', crop: 'no se toca' },
      ],
    };
    const once = JSON.stringify(normalizeImageCrops(doc));
    expect(JSON.stringify(normalizeImageCrops(JSON.parse(once)))).toBe(once);
    const l = JSON.parse(once).layers;
    expect(l[0].crop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect('crop' in l[1]).toBe(false);
    expect('crop' in l[2]).toBe(false);
    expect(l[3].crop).toBe('no se toca');
  });

  it('round-trip de proyecto: el recorte (4 números) sobrevive a guardar/abrir', () => {
    const crop = { x: 0.125, y: 0.25, w: 0.5, h: 0.375 };
    const layer = { id: 'i', type: 'image', src: 'data:image/png;base64,AAAA', naturalWidth: 2000, naturalHeight: 1125, crop, layers: [] };
    const text = JSON.stringify({ kind: 'chamva-project', version: 2, pageIndex: 0, pages: [{ id: 'p', width: 10, height: 10, background: { type: 'transparent' }, layers: [layer] }] });
    const back = parseProject(text).pages[0].layers[0] as unknown as ImageLayer;
    expect(back.crop).toEqual(crop);
    expect(back.naturalWidth).toBe(2000);
    expect(JSON.stringify(back.crop).length).toBeLessThan(60); // no infla autoguardado ni historial
  });
});

describe('cropPatch: recorte en el marco local de la capa', () => {
  const cases: [string, Partial<L>][] = [
    ['sin giro', {}],
    ['girada 30°', { rotation: 30 }],
    ['girada -125° y escala no uniforme', { rotation: -125, scaleX: 0.3, scaleY: 0.7 }],
    ['volteada H', { flipX: true, rotation: 30 }],
    ['volteada H+V con escala', { flipX: true, flipY: true, rotation: 200, scaleX: 1.5, scaleY: 0.4 }],
  ];
  for (const [name, o] of cases) {
    it(`${name}: los píxeles que quedan no se mueven en el lienzo y se puede recortar de nuevo`, () => {
      const l0 = base(o);
      const disp: Box = { x: 1000, y: 500, w: 1600, h: 900 };
      const l1 = apply(l0, disp);
      expect(l1.naturalWidth).toBe(1600);
      expect(l1.naturalHeight).toBe(900);
      expect(displayBox(l1)).toEqual(disp); // el editor se reabre con el recorte actual
      for (const [px, py] of [[1500, 800], [2100, 1300], [1234, 987]]) {
        // px,py: puntos de la fuente dentro del recorte (en el marco visto o no, da igual al oráculo)
        const a = worldOf(l0, px, py);
        const b = worldOf(l1, px, py);
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.y).toBeCloseTo(a.y, 6);
      }
      // Segundo recorte (más pequeño y desplazado) sobre la capa ya recortada.
      const disp2: Box = { x: 1200, y: 600, w: 400, h: 300 };
      const l2 = apply(l1, disp2);
      expect(displayBox(l2)).toEqual(disp2);
      const a = worldOf(l0, 1300, 700);
      const b = worldOf(l2, 1300, 700);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
      // Restablecer: imagen completa exacta, sin crop, y en su sitio original.
      const l3 = apply(l2, { x: 0, y: 0, w: 4000, h: 3000 });
      expect(l3.crop).toBeUndefined();
      expect(l3.naturalWidth).toBe(4000);
      expect(l3.naturalHeight).toBe(3000);
      expect(l3.x).toBeCloseTo(l0.x, 6);
      expect(l3.y).toBeCloseTo(l0.y, 6);
    });
  }

  it('el crop guardado está en la FUENTE (sin volteo): voltear la capa no cambia qué región es', () => {
    const l = apply(base({ flipX: true }), { x: 0, y: 0, w: 1000, h: 3000 }); // lado izquierdo VISTO
    expect(l.crop).toEqual({ x: 0.75, y: 0, w: 0.25, h: 1 }); // = lado derecho de la fuente
    expect(flipBox(flipBox({ x: 1, y: 2, w: 3, h: 4 }, { w: 10, h: 10 }, true, true), { w: 10, h: 10 }, true, true)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('recorte vacío o fuera de la imagen: null (no toca la capa)', () => {
    expect(cropPatch(base(), { x: 5000, y: 0, w: 100, h: 100 })).toBeNull();
    expect(cropPatch(base(), { x: 10, y: 10, w: 0, h: 100 })).toBeNull();
    expect(cropPatch(base(), { x: NaN, y: 10, w: 10, h: 100 })).toBeNull();
  });

  it('recorte que se sale se limita a la imagen y a píxel entero', () => {
    const p = cropPatch(base(), { x: -50.4, y: 2900.6, w: 500, h: 400 })!;
    expect(p.naturalWidth).toBe(450);
    expect(p.naturalHeight).toBe(99);
    expect(p.crop).toEqual({ x: 0, y: 2901 / 3000, w: 450 / 4000, h: 99 / 3000 });
  });

  it('fracciones: sigue alineado si la fuente cambia de resolución (Optimizar ×2)', () => {
    const l = apply(base(), { x: 1000, y: 500, w: 1600, h: 900 });
    expect(cropPixelRect(l.crop, 4000, 3000)).toEqual({ x: 1000, y: 500, w: 1600, h: 900 });
    expect(cropPixelRect(l.crop, 8000, 6000)).toEqual({ x: 2000, y: 1000, w: 3200, h: 1800 });
    expect(cropPixelRect(undefined, 8000, 6000)).toBeNull();
  });

  it('tamaños naturales no redondos (QR/SVG) también se restablecen exactos', () => {
    const l0 = base({ naturalWidth: 512, naturalHeight: 512 });
    const l1 = apply(l0, { x: 37, y: 101, w: 211, h: 333 });
    expect(fullSize(l1)).toEqual({ w: 512, h: 512 });
    const l2 = apply(l1, { x: 0, y: 0, w: 512, h: 512 });
    expect(l2.naturalWidth).toBe(512);
    expect(l2.crop).toBeUndefined();
  });
});

describe('ayudas de caja', () => {
  const full = { w: 100, h: 50 };
  it('clampBox recorta a la imagen y normaliza cajas invertidas', () => {
    expect(clampBox({ x: 90, y: 40, w: 20, h: 20 }, full)).toEqual({ x: 90, y: 40, w: 10, h: 10 });
    expect(clampBox({ x: 20, y: 20, w: -10, h: -10 }, full)).toEqual({ x: 10, y: 10, w: 10, h: 10 });
    expect(clampBox({ x: 200, y: 0, w: 5, h: 5 }, full)).toBeNull();
  });
  it('moveInside conserva el tamaño y mete la caja dentro', () => {
    expect(moveInside({ x: 95, y: -5, w: 20, h: 10 }, full)).toEqual({ x: 80, y: 0, w: 20, h: 10 });
    expect(moveInside({ x: 0, y: 0, w: 500, h: 500 }, full)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
  it('snapBox lleva los bordes a píxel entero (mínimo 1)', () => {
    expect(snapBox({ x: 1.4, y: 2.6, w: 10.2, h: 0.1 }, full)).toEqual({ x: 1, y: 3, w: 11, h: 1 });
  });
  it('fitAspect usa la proporción VISTA (con la escala de la capa) y no se sale', () => {
    const b = fitAspect({ x: 0, y: 0, w: 40, h: 10 }, 1, 2, 1, full); // escala X doble
    expect(b.w * 2).toBeCloseTo(b.h * 1, 9); // cuadrado en pantalla
    const big = fitAspect({ x: 0, y: 0, w: 100, h: 50 }, 1, 1, 1, full);
    expect(big).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });
});
