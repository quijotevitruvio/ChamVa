import { describe, expect, it } from 'vitest';
import type { MixEntry } from '../../video/engine/mixer';
import { MonoDecimator, shiftEntries, toMono16k } from './audio';

describe('remuestreo a 16 kHz mono', () => {
  it('por bloques da lo mismo que de una vez', () => {
    const n = 48000 * 2;
    const L = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 7));
    const R = Float32Array.from({ length: n }, (_, i) => Math.cos(i / 11));
    const d1 = new MonoDecimator();
    const one = d1.push(L, R);
    const d2 = new MonoDecimator();
    const parts: number[] = [];
    for (let i = 0; i < n; i += 4801) parts.push(...d2.push(L.subarray(i, i + 4801), R.subarray(i, i + 4801)));
    expect(parts.length).toBe(one.length);
    for (let i = 0; i < one.length; i += 97) expect(parts[i]).toBeCloseTo(one[i], 5);
  });
  it('conserva un tono de 1 kHz y elimina uno de 12 kHz (aliasing)', () => {
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const tone = (f: number) => Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * f * i) / 48000));
    const lo = toMono16k(tone(1000), null, 48000);
    const hi = toMono16k(tone(12000), null, 48000);
    expect(lo.length).toBe(16000);
    expect(rms(lo.subarray(200, 15800))).toBeCloseTo(Math.SQRT1_2, 1);
    expect(rms(hi.subarray(200, 15800))).toBeLessThan(0.01);
  });
  it('sin desfase: un clic en t=0,5 s sigue en t=0,5 s', () => {
    const a = new Float32Array(48000);
    a[24000] = 1;
    const y = toMono16k(a, null, 48000);
    let best = 0;
    for (let i = 1; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[best])) best = i;
    expect(Math.abs(best - 8000)).toBeLessThanOrEqual(1);
  });
});

describe('shiftEntries (rango)', () => {
  const e = (start: number, end: number, inP = 0, speed = 1): MixEntry =>
    ({ start, end, inP, outP: inP + (end - start) * speed, speed, fx: {} as never, fadeIn: 0.5, open: async () => null }) as MixEntry;
  it('quita lo de fuera, recorta lo que empieza antes y desplaza al origen', () => {
    const r = shiftEntries([e(0, 5), e(5, 10, 2, 2), e(12, 15)], { start: 6, end: 11 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ start: 0, end: 4, inP: 4 }); // 2 + 1 s × velocidad 2
    expect(r[0].fadeIn).toBeUndefined();
  });
  it('lo que empieza dentro conserva su fundido', () => {
    const r = shiftEntries([e(8, 20)], { start: 6, end: 11 });
    expect(r[0]).toMatchObject({ start: 2, end: 5, inP: 0, fadeIn: 0.5 });
  });
});
