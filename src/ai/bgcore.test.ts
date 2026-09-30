import { describe, expect, it } from 'vitest';
import { boxBlur, refineCutout } from './bgcore';

// Imagen sintética w×h: fondo azul, círculo rojo en el centro con borde
// semitransparente "contaminado" (mezcla de rojo y azul en proporción alfa).
function synth(w: number, h: number, soft: boolean) {
  const data = new Uint8ClampedArray(w * h * 4);
  const original = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 3;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.hypot(x - cx, y - cy);
      let a = d < r - 2 ? 1 : d > r + 2 ? 0 : soft ? (r + 2 - d) / 4 : d <= r ? 1 : 0;
      a = Math.max(0, Math.min(1, a));
      // Color observado C = a·F + (1−a)·B, F = rojo, B = azul
      original[i] = Math.round(a * 220 + (1 - a) * 20);
      original[i + 1] = Math.round(a * 30 + (1 - a) * 40);
      original[i + 2] = Math.round(a * 30 + (1 - a) * 200);
      original[i + 3] = 255;
      data.set(original.subarray(i, i + 3), i);
      data[i + 3] = Math.round(a * 255);
    }
  return { px: { data, width: w, height: h } as ImageData, original };
}

describe('boxBlur', () => {
  it('deja intacto un plano constante', () => {
    const src = new Float32Array(16 * 16).fill(100);
    const out = boxBlur(src, 16, 16, 2);
    for (const v of out) expect(v).toBeCloseTo(100, 5);
  });

  it('reparte un pico y conserva (aprox.) la energía', () => {
    const src = new Float32Array(9 * 9);
    src[4 * 9 + 4] = 81;
    const out = boxBlur(src, 9, 9, 1);
    expect(out[4 * 9 + 4]).toBeCloseTo(9, 5); // 81 / 9 celdas
    expect(out[3 * 9 + 3]).toBeCloseTo(9, 5);
    expect(out[0]).toBe(0);
  });
});

describe('refineCutout', () => {
  it('modo none no toca nada', () => {
    const { px, original } = synth(64, 64, true);
    const before = new Uint8ClampedArray(px.data);
    refineCutout(px, original, 64, 64, 'none');
    expect(px.data).toEqual(before);
  });

  it('descontamina el borde: el rojo sube y el azul baja en píxeles semitransparentes', () => {
    const { px, original } = synth(96, 96, true);
    const w = 96;
    // Buscar un píxel de borde (alfa intermedio) antes de refinar.
    let idx = -1;
    for (let i = 0; i < w * w; i++) {
      const a = px.data[i * 4 + 3];
      if (a > 90 && a < 170) {
        idx = i;
        break;
      }
    }
    expect(idx).toBeGreaterThan(-1);
    const rBefore = px.data[idx * 4];
    const bBefore = px.data[idx * 4 + 2];
    refineCutout(px, original, w, w, 'photo');
    expect(px.data[idx * 4]).toBeGreaterThan(rBefore);
    expect(px.data[idx * 4 + 2]).toBeLessThan(bBefore);
  });

  it('auto: un gráfico de bordes duros no se suaviza', () => {
    const { px, original } = synth(64, 64, false);
    const alphaBefore = Array.from({ length: 64 * 64 }, (_, i) => px.data[i * 4 + 3]);
    refineCutout(px, original, 64, 64, 'auto');
    const alphaAfter = Array.from({ length: 64 * 64 }, (_, i) => px.data[i * 4 + 3]);
    expect(alphaAfter).toEqual(alphaBefore); // sin feather en modo gráfico
  });

  it('auto: una foto (bordes suaves) recibe feather sin romper el interior', () => {
    const { px, original } = synth(64, 64, true);
    refineCutout(px, original, 64, 64, 'auto');
    const center = (32 * 64 + 32) * 4 + 3;
    const corner = 3;
    expect(px.data[center]).toBe(255);
    expect(px.data[corner]).toBe(0);
  });
});
