import { describe, expect, it } from 'vitest';
import { buildWeights, kernelSupport, kernelValue, resampleRGBA, type ResampleMethod } from './resample';
import { handlePixelJob } from './pixelWorkerCore';

const METHODS: ResampleMethod[] = ['bilinear', 'bicubic', 'lanczos'];

function img(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
  return d;
}

describe('núcleos de remuestreo: valores conocidos', () => {
  it('bilineal (triángulo)', () => {
    expect(kernelValue('bilinear', 0)).toBe(1);
    expect(kernelValue('bilinear', 0.5)).toBeCloseTo(0.5, 12);
    expect(kernelValue('bilinear', 1)).toBe(0);
    expect(kernelValue('bilinear', -0.25)).toBeCloseTo(0.75, 12);
  });
  it('bicúbico Catmull-Rom', () => {
    expect(kernelValue('bicubic', 0)).toBe(1);
    expect(kernelValue('bicubic', 1)).toBeCloseTo(0, 12);
    expect(kernelValue('bicubic', 2)).toBe(0);
    expect(kernelValue('bicubic', 0.5)).toBeCloseTo(0.5625, 12); // 9/16
    expect(kernelValue('bicubic', 1.5)).toBeCloseTo(-0.0625, 12); // -1/16
  });
  it('Lanczos3', () => {
    expect(kernelValue('lanczos', 0)).toBe(1);
    expect(kernelValue('lanczos', 1)).toBeCloseTo(0, 12);
    expect(kernelValue('lanczos', 2)).toBeCloseTo(0, 12);
    expect(kernelValue('lanczos', 3)).toBe(0);
    // sinc(0,5)·sinc(0,5/3) = (sen(π/2)/(π/2)) · (sen(π/6)/(π/6)) = 0,6079...
    expect(kernelValue('lanczos', 0.5)).toBeCloseTo(0.607927, 5);
    expect(kernelValue('lanczos', 1.5)).toBeCloseTo(-0.135095, 5);
  });
  it('los pesos de cada destino suman 1, también en los bordes y al reducir', () => {
    for (const m of METHODS) {
      for (const [s, d] of [[100, 37], [37, 100], [64, 64], [1000, 7], [5, 2]]) {
        const w = buildWeights(s, d, m);
        for (let i = 0; i < d; i++) {
          let sum = 0;
          for (let k = 0; k < w.count[i]; k++) sum += w.coef[i * w.stride + k];
          expect(sum).toBeCloseTo(1, 9);
          expect(w.start[i]).toBeGreaterThanOrEqual(0);
          expect(w.start[i] + w.count[i]).toBeLessThanOrEqual(s);
        }
      }
    }
  });
  it('a la misma escala el remuestreo es la identidad (núcleo interpolante)', () => {
    for (const m of METHODS) {
      const w = buildWeights(16, 16, m);
      for (let i = 0; i < 16; i++) {
        expect(w.count[i] > 0).toBe(true);
        const k0 = i - w.start[i];
        expect(w.coef[i * w.stride + k0]).toBeCloseTo(1, 9);
      }
    }
    expect(kernelSupport('bilinear')).toBe(1);
    expect(kernelSupport('bicubic')).toBe(2);
    expect(kernelSupport('lanczos')).toBe(3);
  });
});

describe('remuestreo de imagen', () => {
  it('mismo tamaño: copia exacta', () => {
    const src = img(9, 7, (x, y) => [x * 20, y * 30, (x + y) * 10, 255]);
    for (const m of METHODS) {
      const out = resampleRGBA(src, 9, 7, 9, 7, m);
      expect(Array.from(out)).toEqual(Array.from(src));
      expect(out).not.toBe(src);
    }
  });

  it('un color uniforme se conserva al ampliar y reducir (con cualquier núcleo)', () => {
    const src = img(40, 30, () => [200, 100, 50, 255]);
    for (const m of METHODS) {
      for (const [w, h] of [[80, 60], [13, 9], [5, 3], [160, 7]]) {
        const out = resampleRGBA(src, 40, 30, w, h, m);
        for (let i = 0; i < out.length; i += 4) {
          expect(Math.abs(out[i] - 200)).toBeLessThanOrEqual(1);
          expect(Math.abs(out[i + 1] - 100)).toBeLessThanOrEqual(1);
          expect(Math.abs(out[i + 2] - 50)).toBeLessThanOrEqual(1);
          expect(out[i + 3]).toBe(255);
        }
      }
    }
  });

  it('reducir un tablero de ajedrez fino da gris uniforme (sin aliasing)', () => {
    const src = img(64, 64, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    for (const m of METHODS) {
      const out = resampleRGBA(src, 64, 64, 8, 8, m);
      for (let i = 0; i < out.length; i += 4) {
        expect(Math.abs(out[i] - 127.5)).toBeLessThanOrEqual(m === 'lanczos' ? 6 : 3);
        expect(out[i + 3]).toBe(255);
      }
    }
  });

  it('reducción por mitades: 2×2 → 1×1 es el promedio exacto', () => {
    const src = img(2, 2, (x, y) => [x * 100 + y * 50, 0, 0, 255]); // 0,100,50,150 → 75
    const out = resampleRGBA(src, 2, 2, 1, 1, 'lanczos');
    expect(out[0]).toBe(75);
    expect(out[3]).toBe(255);
  });

  it('ampliar un degradado lineal con bilineal da valores intermedios monótonos', () => {
    const src = img(2, 1, (x) => [x * 255, x * 255, x * 255, 255]);
    const out = resampleRGBA(src, 2, 1, 8, 1, 'bilinear');
    const row = Array.from({ length: 8 }, (_, i) => out[i * 4]);
    for (let i = 1; i < 8; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]);
    expect(row[0]).toBe(0);
    expect(row[7]).toBe(255);
    // el centro de la imagen cae a medio camino
    expect(Math.abs(row[3] + row[4] - 255)).toBeLessThanOrEqual(1);
  });

  it('el alfa premultiplicado evita halos: el color de píxeles transparentes no sangra', () => {
    // izquierda opaca roja, derecha totalmente transparente con color «verde» basura
    const src = img(8, 1, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 0]));
    for (const m of METHODS) {
      const out = resampleRGBA(src, 8, 1, 4, 1, m);
      for (let x = 0; x < 4; x++) {
        const a = out[x * 4 + 3];
        if (a > 8) {
          expect(out[x * 4 + 1]).toBeLessThanOrEqual(2); // nada de verde donde hay algo visible
          expect(out[x * 4]).toBeGreaterThan(250);
        }
      }
    }
  });

  it('el resultado es determinista y el mismo en el worker que en el hilo principal', () => {
    const src = img(50, 40, (x, y) => [(x * 5) % 256, (y * 6) % 256, (x * y) % 256, 255 - ((x + y) % 60)]);
    for (const m of METHODS) {
      const a = resampleRGBA(src, 50, 40, 21, 33, m);
      const b = resampleRGBA(src, 50, 40, 21, 33, m);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      let got: ArrayBuffer | null = null;
      handlePixelJob(
        { id: 1, op: 'resample', buffer: new Uint8ClampedArray(src).buffer as ArrayBuffer, width: 50, height: 40, dw: 21, dh: 33, method: m },
        (r) => {
          if ('done' in r) got = r.buffer;
        },
      );
      expect(Buffer.from(new Uint8ClampedArray(got!)).equals(Buffer.from(a))).toBe(true);
    }
  });

  it('dimensiones de salida y progreso monótono hasta 1', () => {
    const src = img(100, 80, () => [1, 2, 3, 255]);
    const seen: number[] = [];
    const out = resampleRGBA(src, 100, 80, 12, 10, 'bicubic', (f) => seen.push(f));
    expect(out.length).toBe(12 * 10 * 4);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[seen.length - 1]).toBe(1);
  });
});
