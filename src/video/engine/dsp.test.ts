import { describe, expect, it } from 'vitest';
import { Biquad, Compressor, Echo, LIMIT_CEILING, Limiter, MasterChain, NoiseGate } from './dsp';

const SR = 48000;
const sine = (f: number, amp: number, n: number, sr = SR) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));
const peak = (a: Float32Array, from = 0) => {
  let m = 0;
  for (let i = from; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
};
const rms = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};

describe('filtros (semántica de Web Audio)', () => {
  it('paso bajo a 1 kHz atenúa 10 kHz y deja pasar 100 Hz', () => {
    const lo = sine(100, 0.5, SR);
    const hi = sine(10000, 0.5, SR);
    new Biquad('lowpass', 1000, SR).process(lo, 0);
    new Biquad('lowpass', 1000, SR).process(hi, 0);
    expect(rms(lo, 4800) / (0.5 / Math.SQRT2)).toBeGreaterThan(0.95);
    expect(rms(hi, 4800) / (0.5 / Math.SQRT2)).toBeLessThan(0.02);
  });

  it('paso alto elimina la continua', () => {
    const dc = new Float32Array(SR).fill(0.5);
    new Biquad('highpass', 120, SR).process(dc, 0);
    expect(Math.abs(dc[SR - 1])).toBeLessThan(1e-3);
  });

  it('pico +6 dB en su frecuencia central dobla la amplitud', () => {
    const x = sine(1000, 0.25, SR);
    new Biquad('peaking', 1000, SR, { q: 1, gainDb: 6 }).process(x, 0);
    expect(peak(x, SR / 2)).toBeCloseTo(0.25 * Math.pow(10, 6 / 20), 2);
  });

  it('ecualizador plano (0 dB) no cambia nada', () => {
    const x = sine(440, 0.3, 4800);
    const y = Float32Array.from(x);
    const r = Float32Array.from(x);
    const mc = new MasterChain({ low: 0, mid: 0, high: 0 }, false, SR);
    // el limitador de pico real retrasa mc.latency muestras: se alimenta con ceros al final y se compara alineado
    const pad = (a: Float32Array) => {
      const o = new Float32Array(a.length + mc.latency);
      o.set(a);
      return o;
    };
    const py = pad(y);
    const pr = pad(r);
    mc.process(py, pr);
    for (let i = 0; i < x.length; i++) expect(py[i + mc.latency]).toBeCloseTo(x[i], 6);
  });
});

describe('limitador', () => {
  it('dos tonos a escala completa sumados nunca pasan de −1 dBFS', () => {
    const n = SR * 2;
    const L = sine(440, 1, n);
    const R = sine(445, 1, n);
    for (let i = 0; i < n; i++) {
      L[i] += 0.9 * Math.sin((2 * Math.PI * 1000 * i) / SR);
      R[i] += 0.9;
    }
    const lim = new Limiter(SR);
    lim.process(L, R);
    expect(lim.peakIn).toBeGreaterThan(1.5);
    expect(peak(L)).toBeLessThanOrEqual(LIMIT_CEILING + 1e-6);
    expect(peak(R)).toBeLessThanOrEqual(LIMIT_CEILING + 1e-6);
    expect(LIMIT_CEILING).toBeCloseTo(0.8913, 4);
  });

  it('la señal por debajo del techo pasa intacta', () => {
    const L = sine(440, 0.5, 4800);
    const R = Float32Array.from(L);
    const ref = Float32Array.from(L);
    new Limiter(SR).process(L, R);
    for (let i = 0; i < L.length; i++) expect(L[i]).toBe(ref[i]);
  });

  it('NaN e infinitos se convierten en silencio', () => {
    const L = Float32Array.from([NaN, Infinity, -Infinity, 0.1]);
    const R = Float32Array.from(L);
    new Limiter(SR).process(L, R);
    expect([...L].every((v) => Number.isFinite(v) && Math.abs(v) <= LIMIT_CEILING)).toBe(true);
  });
});

describe('compuerta de ruido («Reducir ruido»)', () => {
  it('silencia el ruido de fondo y deja pasar la voz', () => {
    const n = SR;
    const L = new Float32Array(n * 2);
    // 1 s de «ruido» a 0,01 y 1 s de «voz» a 0,4
    for (let i = 0; i < n; i++) L[i] = 0.01 * Math.sin((2 * Math.PI * 300 * i) / SR);
    for (let i = n; i < 2 * n; i++) L[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / SR);
    const R = Float32Array.from(L);
    new NoiseGate(SR).process(L, R);
    expect(rms(L, n / 2, n)).toBeLessThan(0.01 * 0.03); // ≈ ×0,02
    expect(rms(L, n + SR / 4, 2 * n) / (0.4 / Math.SQRT2)).toBeGreaterThan(0.98);
  });
});

describe('eco', () => {
  it('repite el impulso a 0,28 s con la ganancia del eco', () => {
    const n = SR;
    const L = new Float32Array(n);
    L[0] = 1;
    const R = Float32Array.from(L);
    new Echo(SR, 0.4).process(L, R);
    const d = Math.round(0.28 * SR);
    expect(L[0]).toBe(1);
    expect(L[d]).toBeCloseTo(0.4, 5);
    expect(L[2 * d]).toBeCloseTo(0.4 * 0.35, 5);
  });
});

describe('compresor («Normalizar»)', () => {
  it('reduce la diferencia entre fuerte y suave', () => {
    const c = new Compressor(SR);
    const loud = sine(500, 0.9, SR);
    const soft = sine(500, 0.05, SR);
    c.process(loud, Float32Array.from(loud));
    const c2 = new Compressor(SR);
    c2.process(soft, Float32Array.from(soft));
    const ratioIn = 0.9 / 0.05;
    const ratioOut = peak(loud, SR / 2) / peak(soft, SR / 2);
    expect(ratioOut).toBeLessThan(ratioIn / 2);
  });
});
