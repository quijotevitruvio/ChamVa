import { describe, expect, it } from 'vitest';
import {
  buildArcTable,
  coverRect,
  curveBounds,
  defaultPathPoints,
  drawTextWithFx,
  extrudeCopies,
  extrudeSteps,
  fillInkMask,
  hasTextFx,
  highlightPolygon,
  inkRemoval,
  normalizePathPoints,
  pathToSvgD,
  pointAtLength,
  ringPasses,
  shadeHex,
  tileGrid,
} from './textFx';
import type { TextLayer } from './types';

const straight = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 200, y: 0 },
  { x: 300, y: 0 },
];
const arch = [
  { x: 0, y: 0 },
  { x: 0, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 0 },
];

describe('extrusión', () => {
  it('sin profundidad no hay copias y respeta el tope de 200', () => {
    expect(extrudeCopies(undefined)).toEqual([]);
    expect(extrudeCopies({ depth: 0, angle: 45, color: '#000', mode: 'long' })).toEqual([]);
    const c = extrudeCopies({ depth: 5000, angle: 0, color: '#000', mode: 'long' });
    expect(Math.hypot(c[0].dx, c[0].dy)).toBeCloseTo(200, 5);
  });
  it('usa pasos adaptativos, no una copia por píxel', () => {
    expect(extrudeSteps(10)).toBeLessThanOrEqual(10);
    expect(extrudeSteps(200)).toBeLessThanOrEqual(120);
    expect(extrudeSteps(0.5)).toBe(0);
  });
  it('va de la copia más lejana a la más cercana y es determinista', () => {
    const ex = { depth: 30, angle: 90, color: '#ff8800', mode: 'solid' as const };
    const a = extrudeCopies(ex);
    expect(a).toEqual(extrudeCopies(ex));
    expect(a[0].dy).toBeCloseTo(30, 5);
    expect(a[a.length - 1].dy).toBeLessThan(a[0].dy);
    expect(Math.abs(a[0].dx)).toBeLessThan(1e-9);
  });
  it('long = color plano; solid = se oscurece hacia el fondo', () => {
    const l = extrudeCopies({ depth: 20, angle: 45, color: '#ffffff', mode: 'long' });
    expect(new Set(l.map((c) => c.color)).size).toBe(1);
    const s = extrudeCopies({ depth: 20, angle: 45, color: '#ffffff', mode: 'solid' });
    expect(s[0].color).not.toBe(s[s.length - 1].color);
    expect(shadeHex('#ffffff', 0.5)).toBe('#808080');
    expect(shadeHex('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)');
  });
});

describe('contornos múltiples', () => {
  it('anillos del exterior al interior con grosor acumulado', () => {
    const r = ringPasses([{ color: 'a', width: 2 }, { color: 'b', width: 3 }], 0);
    expect(r.map((x) => x.color)).toEqual(['b', 'a']);
    expect(r.map((x) => x.lineWidth)).toEqual([10, 4]);
  });
  it('arranca tras el contorno propio, descarta ancho 0 y limita a 4', () => {
    expect(ringPasses([{ color: 'a', width: 2 }], 4)[0].lineWidth).toBe(8);
    expect(ringPasses([{ color: 'a', width: 0 }], 0)).toEqual([]);
    expect(ringPasses(Array.from({ length: 9 }, () => ({ color: 'x', width: 1 })), 0)).toHaveLength(4);
  });
});

describe('relleno con imagen', () => {
  it('cubrir: centra y cubre el cuadro', () => {
    const r = coverRect(100, 100, 200, 100, 1, 0, 0);
    expect(r.h).toBeCloseTo(100);
    expect(r.w).toBeCloseTo(200);
    expect(r.x).toBeCloseTo(-50);
    expect(coverRect(100, 100, 200, 100, 1, 10, 0).x).toBeCloseTo(-40);
  });
  it('mosaico cubre el cuadro y tiene tope de mosaicos', () => {
    const g = tileGrid(100, 50, 20, 20, 1, 0, 0);
    expect(g.tiles.length).toBe(5 * 3);
    const huge = tileGrid(5000, 5000, 1, 1, 1, 0, 0);
    expect(huge.tiles.length).toBeLessThan(3500);
  });
});

describe('tinta', () => {
  it('es determinista y depende de la semilla', () => {
    expect(inkRemoval(10, 20, 0.5, 3, 8)).toBe(inkRemoval(10, 20, 0.5, 3, 8));
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 60; i++) {
      a.push(inkRemoval(i * 3.1, i * 1.7, 0.5, 1, 8));
      b.push(inkRemoval(i * 3.1, i * 1.7, 0.5, 2, 8));
    }
    expect(a).not.toEqual(b);
  });
  it('amount 0 no borra nada y más amount borra más', () => {
    let s0 = 0;
    let s3 = 0;
    let s9 = 0;
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 40; x++) {
        s0 += inkRemoval(x, y, 0, 1, 6);
        s3 += inkRemoval(x, y, 0.3, 1, 6);
        s9 += inkRemoval(x, y, 0.9, 1, 6);
      }
    expect(s0).toBe(0);
    expect(s3).toBeGreaterThan(0);
    expect(s9).toBeGreaterThan(s3);
  });
  it('la máscara se muestrea en coordenadas locales (independiente de la resolución)', () => {
    const w = 20;
    const h = 20;
    for (const k of [1, 2.5]) {
      const pw = Math.round(w * k);
      const ph = Math.round(h * k);
      const d = new Uint8ClampedArray(pw * ph * 4);
      fillInkMask(d, pw, ph, k, 3, 0.6, 5, 4);
      const px = 7;
      const py = 5;
      const expected = Math.round(inkRemoval((px + 0.5) / k - 3, (py + 0.5) / k - 3, 0.6, 5, 4) * 255);
      expect(d[(py * pw + px) * 4 + 3]).toBe(expected);
    }
  });
});

describe('resaltador', () => {
  const rect = { x: 10, y: 5, w: 200 };
  it('es determinista, cerrado y se queda cerca de la línea', () => {
    const a = highlightPolygon(rect, 40, { mode: 'marker', thickness: 0.8 }, 1, 0);
    expect(a).toEqual(highlightPolygon(rect, 40, { mode: 'marker', thickness: 0.8 }, 1, 0));
    expect(a.length).toBeGreaterThan(6);
    for (const p of a) {
      expect(p.x).toBeGreaterThan(rect.x - 10);
      expect(p.x).toBeLessThan(rect.x + rect.w + 10);
      expect(p.y).toBeGreaterThan(rect.y - 5);
      expect(p.y).toBeLessThan(rect.y + 40 * 1.3);
    }
  });
  it('el subrayado queda más abajo que el tachado', () => {
    const u = highlightPolygon(rect, 40, { mode: 'underline', thickness: 0.14 }, 1, 0);
    const s = highlightPolygon(rect, 40, { mode: 'strike', thickness: 0.12 }, 1, 0);
    const avg = (p: { y: number }[]) => p.reduce((t, q) => t + q.y, 0) / p.length;
    expect(avg(u)).toBeGreaterThan(avg(s));
  });
  it('otra semilla da otro borde', () => {
    const a = highlightPolygon(rect, 40, { mode: 'marker', thickness: 0.8 }, 1, 0);
    const b = highlightPolygon(rect, 40, { mode: 'marker', thickness: 0.8 }, 9, 0);
    expect(a).not.toEqual(b);
  });
});

describe('trazado Bézier', () => {
  it('longitud de una recta = distancia', () => {
    expect(buildArcTable(straight).length).toBeCloseTo(300, 3);
  });
  it('pointAtLength recorre una recta y deja el ángulo', () => {
    const t = buildArcTable(straight);
    const p = pointAtLength(t, 150);
    expect(p.x).toBeCloseTo(150, 1);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.angle).toBeCloseTo(0, 5);
    expect(pointAtLength(t, 0).x).toBeCloseTo(0, 5);
    expect(pointAtLength(t, 300).x).toBeCloseTo(300, 1);
  });
  it('prolonga en línea recta fuera de los extremos', () => {
    const t = buildArcTable(straight);
    expect(pointAtLength(t, -20).x).toBeCloseTo(-20, 3);
    expect(pointAtLength(t, 340).x).toBeCloseTo(340, 3);
  });
  it('avanza por longitud de arco (pasos iguales a lo largo de la curva)', () => {
    const t = buildArcTable(arch);
    expect(t.length).toBeGreaterThan(200);
    let prev = pointAtLength(t, 0);
    let steps = 0;
    for (let s = 5; s <= t.length; s += 5) {
      const p = pointAtLength(t, s);
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      expect(d).toBeGreaterThan(3);
      expect(d).toBeLessThanOrEqual(5.05);
      prev = p;
      steps++;
    }
    expect(steps).toBeGreaterThan(30);
  });
  it('el ángulo sigue la tangente', () => {
    const t = buildArcTable(arch);
    expect(pointAtLength(t, 1).angle).toBeCloseTo(Math.PI / 2, 1); // arranca hacia abajo
    expect(pointAtLength(t, t.length / 2).angle).toBeCloseTo(0, 1); // abajo del todo, horizontal
  });
  it('puntos degenerados no revientan', () => {
    const z = { x: 5, y: 5 };
    const t = buildArcTable([z, z, z, z]);
    expect(t.length).toBeCloseTo(0, 6);
    const p = pointAtLength(t, 10);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle)).toBe(true);
    expect(pointAtLength(buildArcTable([]), 3)).toEqual({ x: 0, y: 0, angle: 0 });
  });
  it('normaliza los puntos y exporta el d de SVG', () => {
    const n = normalizePathPoints(straight.map((p) => ({ x: p.x - 50, y: p.y + 70 })), 40);
    const b = curveBounds(n.points);
    expect(b.minX).toBeCloseTo(44);
    expect(b.minY).toBeCloseTo(44);
    expect(pathToSvgD(straight)).toBe('M0,0 C100,0 200,0 300,0');
    expect(defaultPathPoints(300, 40)).toHaveLength(4);
  });
});

describe('drawTextWithFx', () => {
  const layer = { fontSize: 40, strokeWidth: 0, shadow: false, shadowBlur: 0, shadowX: 0, shadowY: 0, fill: '#000' } as unknown as TextLayer;
  const fakeCtx = () => new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D;
  it('extrusión + anillos dibujan una pasada por copia, por anillo y la normal', () => {
    const passes: (string | undefined)[] = [];
    const l = { ...layer, extrude: { depth: 6, angle: 0, color: '#123456', mode: 'long' }, outlines: [{ color: '#fff', width: 2 }] } as TextLayer;
    expect(hasTextFx(l)).toBe(true);
    drawTextWithFx(fakeCtx(), l, { width: 100, height: 50 }, (_c, pass) => passes.push(pass?.color));
    expect(passes.filter((c) => c === '#123456')).toHaveLength(extrudeSteps(6));
    expect(passes.filter((c) => c === '#fff')).toHaveLength(1);
    expect(passes[passes.length - 1]).toBeUndefined();
  });
  it('sin efectos hasTextFx es falso', () => {
    expect(hasTextFx(layer)).toBe(false);
    expect(hasTextFx({ ...layer, outlines: [], extrude: { depth: 0, angle: 0, color: '#000', mode: 'long' } } as TextLayer)).toBe(false);
  });
});
