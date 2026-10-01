import { describe, expect, it } from 'vitest';
import { applyVariant, BLACK, flattenOnColor, recolorMono, variantName, WHITE, type RgbaBuf } from './logoVariants';

// 2×1: un píxel rojo opaco y uno azul semitransparente.
const synth = (): RgbaBuf => ({
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 100]),
});

describe('recolorMono', () => {
  it('sustituye el color y conserva el alfa', () => {
    const r = recolorMono(synth(), BLACK);
    expect(Array.from(r.data)).toEqual([0, 0, 0, 255, 0, 0, 0, 100]);
    const w = recolorMono(synth(), WHITE);
    expect(Array.from(w.data)).toEqual([255, 255, 255, 255, 255, 255, 255, 100]);
  });
  it('no modifica el original', () => {
    const s = synth();
    recolorMono(s, WHITE);
    expect(s.data[0]).toBe(255);
    expect(s.data[1]).toBe(0);
  });
});

describe('flattenOnColor', () => {
  it('añade margen y compone sobre el fondo', () => {
    const r = flattenOnColor(recolorMono(synth(), WHITE), { r: 0, g: 0, b: 0 }, 1);
    expect(r.width).toBe(4);
    expect(r.height).toBe(3);
    // esquina = fondo opaco
    expect(Array.from(r.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
    // píxel opaco blanco
    const i = (1 * 4 + 1) * 4;
    expect(Array.from(r.data.slice(i, i + 4))).toEqual([255, 255, 255, 255]);
    // blanco con alfa 100/255 sobre negro ≈ 100 de gris
    const j = (1 * 4 + 2) * 4;
    expect(r.data[j]).toBeGreaterThan(95);
    expect(r.data[j]).toBeLessThan(105);
    expect(r.data[j + 3]).toBe(255);
  });
});

describe('applyVariant y nombres', () => {
  it('negro/blanco mantienen el tamaño; invertida lo amplía y es opaca', () => {
    expect(applyVariant(synth(), 'negro').width).toBe(2);
    const inv = applyVariant(synth(), 'invertida');
    expect(inv.width).toBeGreaterThan(2);
    for (let i = 3; i < inv.data.length; i += 4) expect(inv.data[i]).toBe(255);
  });
  it('nombre con sufijo y sin extensión ni sufijo previo', () => {
    expect(variantName('logo.png', 'negro')).toBe('logo (negro)');
    expect(variantName('logo (blanco)', 'negro')).toBe('logo (negro)');
  });
});
