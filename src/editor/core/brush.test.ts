import { describe, expect, it } from 'vitest';
import {
  BRUSHES,
  BRUSH_MAX_POINTS,
  buildStrokeGeometry,
  catmullRom,
  limitPoints,
  resizePatch,
  rng,
  samplePoints,
  simplifyRDP,
  simulatedPressure,
  stabilize,
  strokeHit,
  strokePrims,
  strokeToSvg,
} from './brush';
import type { Doc, StrokeLayer } from './types';
import { parseProject } from '../../io/project';

// Línea ondulada de muestra: [x, y, p, …]
const wave = (n = 60, w = 300) => {
  const o: number[] = [];
  for (let i = 0; i < n; i++) o.push((i * w) / (n - 1), 100 + 40 * Math.sin(i / 6), 0.3 + 0.7 * Math.abs(Math.sin(i / 9)));
  return o;
};

const mk = (brush: StrokeLayer['brush'], over: Partial<StrokeLayer> = {}): StrokeLayer => {
  const g = buildStrokeGeometry(wave(), brush, 12);
  return {
    id: 's1',
    type: 'stroke',
    name: 'Trazo',
    brush,
    color: '#112233',
    size: 12,
    pts: g.pts,
    seed: 42,
    width: g.width,
    height: g.height,
    x: g.x,
    y: g.y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    ...over,
  };
};

describe('suavizado', () => {
  it('stabilize: sin suavizado sigue al puntero; con suavizado se queda atrás', () => {
    expect(stabilize([0, 0], [10, 0], 0)).toEqual([10, 0]);
    const [x] = stabilize([0, 0], [10, 0], 1);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(2);
    expect(stabilize([0, 0], [10, 0], 0.5)[0]).toBeGreaterThan(x);
  });

  it('presión simulada: rápido = fino, lento = grueso, y siempre dentro de rango', () => {
    expect(simulatedPressure(0, 0.6)).toBeGreaterThan(simulatedPressure(5, 0.6));
    for (const v of [0, 1, 10, 1e6]) {
      const p = simulatedPressure(v, 0.6);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('catmullRom pasa por los puntos de control y termina en el último', () => {
    const pts = [0, 0, 1, 10, 10, 0.5, 20, 0, 0.2, 30, 10, 1];
    const d = catmullRom(pts, 4);
    expect(d.slice(0, 3)).toEqual([0, 0, 1]);
    expect(d.slice(-3)).toEqual([30, 10, 1]);
    expect(d.length).toBe((3 * 4 + 1) * 3);
    expect(d[4 * 3]).toBeCloseTo(10); // 4 muestras por tramo: el nodo 1 cae en la muestra 4
    expect(d[4 * 3 + 1]).toBeCloseTo(10);
  });

  it('catmullRom con menos de 3 puntos no inventa nada', () => {
    expect(catmullRom([0, 0, 1, 5, 5, 1])).toEqual([0, 0, 1, 5, 5, 1]);
  });
});

describe('simplificación Douglas-Peucker', () => {
  it('una recta con ruido mínimo se reduce a sus extremos y conserva la presión', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 50; i++) pts.push(i, (i % 2) * 0.01, i === 0 ? 0.2 : i === 50 ? 0.9 : 0.5);
    const out = simplifyRDP(pts, 0.5);
    expect(out).toEqual([0, 0, 0.2, 50, 0, 0.9]);
  });

  it('conserva las esquinas', () => {
    const pts = [0, 0, 1, 50, 0, 1, 100, 0, 1, 100, 50, 1, 100, 100, 1];
    const out = simplifyRDP(pts, 1);
    expect(out).toEqual([0, 0, 1, 100, 0, 1, 100, 100, 1]);
  });

  it('limitPoints respeta el máximo aunque haya miles de puntos', () => {
    const pts: number[] = [];
    for (let i = 0; i < 5000; i++) pts.push(i * 0.4, Math.sin(i / 3) * 30 + Math.cos(i / 17) * 20, 0.5);
    expect(simplifyRDP(pts, 0.3).length / 3).toBeGreaterThan(BRUSH_MAX_POINTS);
    expect(limitPoints(pts, 0.3).length / 3).toBeLessThanOrEqual(BRUSH_MAX_POINTS);
  });
});

describe('geometría por estilo', () => {
  it('hay al menos 8 estilos de pincel con nombre único', () => {
    expect(BRUSHES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(BRUSHES.map((b) => b.id)).size).toBe(BRUSHES.length);
  });

  it.each(BRUSHES.map((b) => b.id))('%s genera primitivas finitas y deterministas', (id) => {
    const l = mk(id);
    const a = strokePrims(l);
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
    expect(JSON.stringify(strokePrims(l))).toBe(JSON.stringify(a)); // misma semilla = mismo dibujo
    for (const p of a) {
      expect(p.alpha).toBeGreaterThan(0);
      expect(p.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('el grano cambia con la semilla (aerógrafo, tiza, lápiz) pero no el trazo liso', () => {
    for (const id of ['airbrush', 'chalk', 'pencil'] as const) {
      expect(JSON.stringify(strokePrims(mk(id, { seed: 1 })))).not.toBe(JSON.stringify(strokePrims(mk(id, { seed: 2 }))));
    }
    expect(JSON.stringify(strokePrims(mk('pen', { seed: 1 })))).toBe(JSON.stringify(strokePrims(mk('pen', { seed: 2 }))));
  });

  it('el pincel varía el ancho con la presión; el rotulador no', () => {
    const lo = [0, 0, 0.1, 100, 0, 0.1];
    const hi = [0, 0, 1, 100, 0, 1];
    const d = (brush: StrokeLayer['brush'], pts: number[]) => JSON.stringify(strokePrims({ brush, size: 20, pts, seed: 1 }));
    expect(d('brush', lo)).not.toBe(d('brush', hi));
    expect(d('marker', lo)).toBe(d('marker', hi));
  });

  it('el resaltador es translúcido y de punta cuadrada; la acuarela se apila en capas suaves', () => {
    const h = strokePrims(mk('highlighter'))[0];
    expect(h.k === 'line' && h.alpha < 1 && h.cap === 'butt').toBe(true);
    const w = strokePrims(mk('watercolor'));
    expect(w.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...w.map((p) => p.alpha))).toBeLessThan(0.2);
  });

  it('un toque suelto (un solo punto) también dibuja', () => {
    for (const b of BRUSHES) {
      const g = buildStrokeGeometry([50, 50, 0.6], b.id, 10);
      expect(strokePrims({ brush: b.id, size: 10, pts: g.pts, seed: 3 }).length).toBeGreaterThan(0);
    }
  });

  it('la cantidad de granos está acotada aunque el trazo sea larguísimo', () => {
    const long = buildStrokeGeometry(wave(400, 20000), 'airbrush', 80);
    const dots = strokePrims({ brush: 'airbrush', size: 80, pts: long.pts, seed: 1 }).flatMap((p) => (p.k === 'dots' ? [p.sq.length / 3] : []));
    expect(dots.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(13000);
  });

  it('la caja de la capa contiene los puntos con margen', () => {
    const g = buildStrokeGeometry(wave(), 'brush', 20);
    for (let i = 0; i < g.pts.length; i += 3) {
      expect(g.pts[i]).toBeGreaterThan(0);
      expect(g.pts[i]).toBeLessThan(g.width);
      expect(g.pts[i + 1]).toBeGreaterThan(0);
      expect(g.pts[i + 1]).toBeLessThan(g.height);
    }
    expect(g.pts.length / 3).toBeLessThanOrEqual(BRUSH_MAX_POINTS);
  });
});

describe('SVG', () => {
  it.each(BRUSHES.map((b) => b.id))('%s sale como <path> (sin imágenes)', (id) => {
    const svg = strokeToSvg(mk(id));
    expect(svg).toMatch(/^<path /);
    expect(svg).not.toMatch(/<image|<canvas|href=/);
    expect(svg).not.toMatch(/NaN|undefined/);
    expect(svg).toContain('#112233');
  });
});

describe('borrador, edición y serialización', () => {
  it('strokeHit tiene en cuenta posición, escala y giro', () => {
    const l = mk('pen', { pts: [10, 10, 1, 110, 10, 1], x: 100, y: 200, size: 6 });
    expect(strokeHit(l, 160, 210, 2)).toBe(true); // sobre el trazo
    expect(strokeHit(l, 160, 260, 2)).toBe(false); // lejos
    expect(strokeHit({ ...l, scaleY: 2 }, 160, 240, 2)).toBe(false);
    expect(strokeHit({ ...l, rotation: 90 }, 100 - 10, 200 + 60, 2)).toBe(true);
  });

  it('resizePatch cambia el grosor y reajusta la caja y los puntos al nuevo margen', () => {
    const l = mk('marker');
    const p = resizePatch(l, 40);
    expect(p.size).toBe(40);
    expect(p.width!).toBeGreaterThan(l.width);
    const d = (p.x ?? 0) - l.x;
    expect(d).toBeLessThan(0);
    expect(p.pts![0]).toBeCloseTo(l.pts[0] - d, 0);
    expect(p.pts![2]).toBe(l.pts[2]); // la presión no se toca
  });

  it('ida y vuelta por JSON: mismas primitivas, y el SVG es idéntico', () => {
    for (const b of BRUSHES) {
      const l = mk(b.id);
      const back = JSON.parse(JSON.stringify(l)) as StrokeLayer;
      expect(back).toEqual(l);
      expect(strokeToSvg(back)).toBe(strokeToSvg(l));
    }
  });

  it('el trazo guardado es compacto (≤ 600 puntos, números cortos)', () => {
    const raw: number[] = [];
    for (let i = 0; i < 4000; i++) raw.push(i * 0.3, 50 + Math.sin(i / 5) * 20, Math.random());
    const g = buildStrokeGeometry(raw, 'pen', 6);
    expect(g.pts.length / 3).toBeLessThanOrEqual(BRUSH_MAX_POINTS);
    expect(JSON.stringify(g.pts).length).toBeLessThan(BRUSH_MAX_POINTS * 3 * 9);
  });

  it('rng es determinista', () => {
    const a = rng(5), b = rng(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('samplePoints para la vista previa es una curva con presión', () => {
    const p = samplePoints(120, 40);
    expect(p.length % 3).toBe(0);
    expect(p.length / 3).toBeGreaterThan(10);
  });
});

describe('compatibilidad de documentos', () => {
  const base = { id: 'a', name: 'x', width: 100, height: 50, background: { type: 'transparent' }, version: 2 };

  it('un diseño viejo sin trazos se abre igual', () => {
    const p = parseProject(JSON.stringify({ ...base, layers: [] }));
    expect(p.pages[0].layers).toEqual([]);
  });

  it('un diseño con trazos conserva el tipo y sus campos al guardar y abrir', () => {
    const l = mk('brush');
    const doc = { ...base, layers: [l] } as unknown as Doc;
    const p = parseProject(JSON.stringify({ kind: 'chamva-project', version: 2, pageIndex: 0, pages: [doc] }));
    const back = p.pages[0].layers[0] as StrokeLayer;
    expect(back.type).toBe('stroke');
    expect(back).toEqual(l);
  });
});
