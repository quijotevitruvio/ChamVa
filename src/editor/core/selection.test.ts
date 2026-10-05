import { describe, expect, it } from 'vitest';
import {
  colorRange,
  combine,
  combineFromKeys,
  countSelected,
  growShrink,
  invertSel,
  magicWand,
  rasterizePolygon,
  runSelJob,
  selBounds,
  selectionEdges,
  selectionScale,
  selectionToPlane,
  smoothPolygon,
  smoothSel,
  featherSel,
} from './selection';
import { handlePixelJob, type PixelReply } from './pixelWorkerCore';

// Imagen sintética: fondo rojo, dos cuadrados azules NO conectados y un degradado gris a la derecha.
function synth(w = 60, h = 40) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c = [200, 20, 20];
      if (x >= 5 && x < 15 && y >= 5 && y < 15) c = [20, 20, 200]; // 10×10
      if (x >= 25 && x < 31 && y >= 20 && y < 30) c = [20, 20, 210]; // 6×10, casi el mismo azul
      if (x >= 40) c = [x * 4, x * 4, x * 4]; // degradado
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  return { d, w, h };
}

describe('varita mágica', () => {
  it('contigua: exactamente el cuadrado tocado (100 píxeles)', () => {
    const { d, w, h } = synth();
    const s = magicWand(d, w, h, 8, 8, { tolerance: 0, contiguous: true, antiAlias: false });
    expect(countSelected(s)).toBe(100);
    expect(selBounds(s, w, h)).toEqual({ x: 5, y: 5, w: 10, h: 10 });
  });
  it('tolerancia: 0 no coge el azul parecido; 10 sí (global)', () => {
    const { d, w, h } = synth();
    const g0 = magicWand(d, w, h, 8, 8, { tolerance: 0, contiguous: false, antiAlias: false });
    expect(countSelected(g0)).toBe(100);
    const g10 = magicWand(d, w, h, 8, 8, { tolerance: 10, contiguous: false, antiAlias: false });
    expect(countSelected(g10)).toBe(160);
    // Contigua con tolerancia 10: el segundo cuadrado no está conectado.
    const c10 = magicWand(d, w, h, 8, 8, { tolerance: 10, contiguous: true, antiAlias: false });
    expect(countSelected(c10)).toBe(100);
  });
  it('el fondo contiguo rodea los cuadrados y no salta al degradado', () => {
    const { d, w, h } = synth();
    const bg = magicWand(d, w, h, 0, 0, { tolerance: 30, contiguous: true, antiAlias: false });
    expect(countSelected(bg)).toBe(40 * 40 - 100 - 60);
    expect(bg[8 * w + 8]).toBe(0);
    expect(bg[0 * w + 45]).toBe(0);
  });
  it('degradado: la tolerancia decide el ancho de la franja', () => {
    const { d, w, h } = synth();
    const s = magicWand(d, w, h, 50, 0, { tolerance: 8, contiguous: true, antiAlias: false });
    // x*4 ∈ [200-8, 200+8] → x ∈ [48, 52] → 5 columnas × 40 filas.
    expect(countSelected(s)).toBe(5 * 40);
  });
  it('antialias: interior intacto, borde parcial', () => {
    const { d, w, h } = synth();
    const s = magicWand(d, w, h, 8, 8, { tolerance: 0, contiguous: true, antiAlias: true });
    expect(s[10 * w + 10]).toBe(255);
    expect(s[5 * w + 5]).toBeGreaterThan(128);
    expect(s[5 * w + 5]).toBeLessThan(255);
    expect(s[4 * w + 8]).toBeGreaterThan(0);
    expect(s[4 * w + 8]).toBeLessThan(128);
    expect(s[0]).toBe(0);
  });
  it('fuera de la imagen: vacía', () => {
    const { d, w, h } = synth();
    expect(countSelected(magicWand(d, w, h, -1, 5, { tolerance: 10, contiguous: true, antiAlias: false }))).toBe(0);
  });
  it('el worker da el mismo resultado byte a byte', () => {
    const { d, w, h } = synth();
    const job = { kind: 'wand' as const, x: 8, y: 8, tolerance: 10, contiguous: false, antiAlias: true };
    const main = runSelJob(job, d, w, h);
    let out: ArrayBuffer | null = null;
    handlePixelJob({ id: 1, op: 'sel', buffer: new Uint8Array(d).buffer, width: w, height: h, sel: job }, (r: PixelReply) => {
      if ('done' in r) out = r.buffer;
    });
    expect(Array.from(new Uint8Array(out!))).toEqual(Array.from(main));
  });
});

describe('rango de color', () => {
  it('suave: idéntico 255, parecido intermedio, lejano 0', () => {
    const { d, w, h } = synth();
    const s = colorRange(d, w, h, [20, 20, 200], 20);
    expect(s[8 * w + 8]).toBe(255);
    expect(s[22 * w + 27]).toBe(128); // azul 210: diferencia 10 de 20
    expect(s[0]).toBe(0);
  });
});

describe('lazo / polígono', () => {
  it('rectángulo conocido sin antialias: exactamente sus píxeles', () => {
    const s = rasterizePolygon([10, 5, 30, 5, 30, 25, 10, 25], 40, 30, false);
    expect(countSelected(s)).toBe(20 * 20);
    expect(selBounds(s, 40, 30)).toEqual({ x: 10, y: 5, w: 20, h: 20 });
  });
  it('triángulo: área ≈ geometría; con antialias la suma de cobertura ≈ área exacta', () => {
    const tri = [0, 0, 40, 0, 0, 40];
    const s = rasterizePolygon(tri, 50, 50, false);
    expect(Math.abs(countSelected(s) - 800)).toBeLessThan(25);
    const a = rasterizePolygon(tri, 50, 50, true);
    const sum = a.reduce((acc, v) => acc + v, 0) / 255;
    expect(Math.abs(sum - 800)).toBeLessThan(3);
  });
  it('polígono cóncavo (par-impar) y suavizado que conserva la zona', () => {
    // Forma de U.
    const u = [0, 0, 30, 0, 30, 30, 20, 30, 20, 10, 10, 10, 10, 30, 0, 30];
    const s = rasterizePolygon(u, 30, 30, false);
    expect(s[20 * 30 + 15]).toBe(0); // el hueco de la U
    expect(s[20 * 30 + 5]).toBe(255);
    expect(countSelected(s)).toBe(900 - 200);
    const sm = smoothPolygon([0, 0, 20, 0, 20, 20, 0, 20], 2);
    expect(sm.length).toBe(4 * 2 * 2 * 2); // 4 puntos → 8 → 16 (x, y)
  });
});

describe('combinar e invertir', () => {
  const a = new Uint8Array([0, 255, 255, 0]);
  const b = new Uint8Array([0, 0, 255, 255]);
  it('modos con Mayús / Alt', () => {
    expect(combineFromKeys(false, false)).toBe('replace');
    expect(combineFromKeys(true, false)).toBe('add');
    expect(combineFromKeys(false, true)).toBe('subtract');
    expect(combineFromKeys(true, true)).toBe('intersect');
  });
  it('sumar, restar, intersecar, sustituir, invertir', () => {
    expect(Array.from(combine(a, b, 'add'))).toEqual([0, 255, 255, 255]);
    expect(Array.from(combine(a, b, 'subtract'))).toEqual([0, 255, 0, 0]);
    expect(Array.from(combine(a, b, 'intersect'))).toEqual([0, 0, 255, 0]);
    expect(Array.from(combine(a, b, 'replace'))).toEqual(Array.from(b));
    expect(Array.from(combine(null, b, 'add'))).toEqual(Array.from(b));
    expect(Array.from(invertSel(a))).toEqual([255, 0, 0, 255]);
  });
});

describe('expandir / contraer / suavizar / desvanecer', () => {
  const sq = () => rasterizePolygon([20, 20, 30, 20, 30, 30, 20, 30], 50, 50, false); // 10×10
  it('expandir 3 px redondea esquinas; contraer 3 px deja 4×4', () => {
    const g = growShrink(sq(), 50, 50, 3);
    expect(selBounds(g, 50, 50)).toEqual({ x: 17, y: 17, w: 16, h: 16 });
    expect(g[17 * 50 + 17]).toBe(0); // esquina redonda
    const s = growShrink(sq(), 50, 50, -3);
    expect(selBounds(s, 50, 50)).toEqual({ x: 23, y: 23, w: 4, h: 4 });
    expect(countSelected(s)).toBe(16);
  });
  it('suavizar quita un píxel suelto; desvanecer gradúa el borde', () => {
    const s = sq();
    s[5 * 50 + 5] = 255;
    const sm = smoothSel(s, 50, 50, 2);
    expect(sm[5 * 50 + 5]).toBe(0);
    expect(sm[25 * 50 + 25]).toBe(255);
    const f = featherSel(sq(), 50, 50, 4);
    expect(f[25 * 50 + 25]).toBeGreaterThan(200);
    expect(f[25 * 50 + 19]).toBeGreaterThan(0);
    expect(f[25 * 50 + 19]).toBeLessThan(255);
  });
});

describe('contorno, escala y paso a máscara', () => {
  it('bordes de un cuadrado = 4 segmentos', () => {
    const e = selectionEdges(rasterizePolygon([2, 2, 6, 2, 6, 6, 2, 6], 8, 8), 8, 8);
    expect(e.length / 4).toBe(4);
  });
  it('lienzos enormes se seleccionan a menos resolución (≤ 16 MP)', () => {
    expect(selectionScale(1000, 1000)).toBe(1);
    const s = selectionScale(8000, 8000);
    expect(8000 * s * 8000 * s).toBeLessThanOrEqual(16_000_001);
  });
  it('selección del documento → plano local de una capa girada 90° y escalada ×2', () => {
    // Selección: columna x ∈ [10, 20) del documento.
    const W = 40;
    const H = 40;
    const data = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 10; x < 20; x++) data[y * W + x] = 255;
    const sel = { w: W, h: H, scale: 1, data };
    // Capa en (30, 0), girada 90°, escala 2: el eje local x va hacia +y del documento, y local hacia −x.
    const r = (90 * Math.PI) / 180;
    const m: [number, number, number, number, number, number] = [Math.cos(r) * 2, Math.sin(r) * 2, -Math.sin(r) * 2, Math.cos(r) * 2, 30, 0];
    const p = selectionToPlane(sel, m, { x: 0, y: 0, w: 10, h: 10 }, 10, 10);
    // doc x = 30 − 2·ly → dentro si 10 ≤ 30 − 2·ly < 20 → ly ∈ (5, 10].
    expect(p[2 * 10 + 3]).toBe(0); // ly = 2.5
    expect(p[7 * 10 + 3]).toBe(255); // ly = 7.5
  });
});
