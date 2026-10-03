import { describe, expect, it } from 'vitest';
import { LIMIT_CEILING } from './dsp';
import { PcmWindow } from './audioSource';
import { TimelineMixer, buildMixEntries, type PcmSource } from './mixer';
import { buildSegments } from './timeline';

const SR = 48000;
// hp: 0 = sin paso alto (las señales de prueba son casi continuas y el de 20 Hz las borraría)
const fx = { volume: 1, hp: 0, lp: 24000, echo: 0, gate: false };

/** Fuente sintética: valor = f(tiempo del archivo). Registra los tiempos pedidos. */
class FnSource implements PcmSource {
  calls: number[] = [];
  closed = false;
  constructor(private f: (t: number) => number) {}
  async read(srcStart: number, step: number, n: number, L: Float32Array, R: Float32Array) {
    this.calls.push(srcStart);
    for (let i = 0; i < n; i++) L[i] = R[i] = this.f(srcStart + i * step);
  }
  close() {
    this.closed = true;
  }
}

async function renderAll(m: TimelineMixer) {
  const L = new Float32Array(m.totalSamples);
  const R = new Float32Array(m.totalSamples);
  while (!m.finished) {
    const b = await m.render(1000);
    L.set(b.L, b.startSample);
    R.set(b.R, b.startSample);
  }
  return { L, R };
}

describe('mezclador en streaming', () => {
  it('cada clip suena en su tramo de la línea de tiempo y a su velocidad', async () => {
    // clip A: archivo 1..2 s a 1× (tramo 0..1); clip B: archivo 0..2 s a 2× (tramo 1..2)
    const clips = [
      { inP: 1, outP: 2, speed: 1, fadeIn: 0, fadeOut: 0, ...fx, tag: 'A' },
      { inP: 0, outP: 2, speed: 2, fadeIn: 0, fadeOut: 0, ...fx, tag: 'B' },
    ];
    const segs = buildSegments(clips);
    const srcA = new FnSource((t) => 0.1 + t * 0.01); // codifica el tiempo de origen
    const srcB = new FnSource((t) => -(0.1 + t * 0.01));
    const entries = buildMixEntries(segs, [], 2, (c) => async () => (c.tag === 'A' ? srcA : srcB));
    const m = new TimelineMixer(entries, { eq: { low: 0, mid: 0, high: 0 }, normalize: false }, 2, SR);
    const { L } = await renderAll(m);
    expect(L.length).toBe(2 * SR);
    // t = 0.5 → A en el archivo 1,5 s
    expect(L[SR / 2]).toBeCloseTo(0.1 + 1.5 * 0.01, 3);
    // t = 1.5 → B en el archivo (1.5−1)·2 = 1 s
    expect(L[SR + SR / 2]).toBeCloseTo(-(0.1 + 1 * 0.01), 3);
    // las fuentes se cierran al acabar su tramo
    m.close();
    expect(srcA.closed).toBe(true);
  });

  it('la pista de audio va en secuencia desde 0 y se corta en la duración del video', async () => {
    const a1 = new FnSource(() => 0.2);
    const a2 = new FnSource(() => 0.3);
    const audio = [
      { inP: 0, outP: 1, speed: 1, ...fx, n: 1 },
      { inP: 0, outP: 5, speed: 1, ...fx, n: 2 },
    ];
    const entries = buildMixEntries([], audio, 3, (c) => async () => (c.n === 1 ? a1 : a2));
    expect(entries.map((e) => [e.start, e.end])).toEqual([
      [0, 1],
      [1, 3],
    ]);
    const m = new TimelineMixer(entries, { eq: { low: 0, mid: 0, high: 0 }, normalize: false }, 3, SR);
    const { L } = await renderAll(m);
    expect(L[SR / 2]).toBeCloseTo(0.2, 5);
    expect(L[2 * SR]).toBeCloseTo(0.3, 5);
  });

  it('nada suena más allá del punto de salida del clip', async () => {
    const src = new FnSource(() => 0.5);
    const segs = buildSegments([{ inP: 0, outP: 1, speed: 1, fadeIn: 0, fadeOut: 0, ...fx }]);
    const m = new TimelineMixer(buildMixEntries(segs, [], 1.5, () => async () => src), { eq: { low: 0, mid: 0, high: 0 }, normalize: false }, 1.5, SR);
    const { L } = await renderAll(m);
    expect(L[SR - 10]).toBeCloseTo(0.5, 5);
    expect(L[SR + 10]).toBe(0);
  });

  it('tres fuentes fuertes solapadas: pico final ≤ −1 dBFS (antes 1,00)', async () => {
    const tone = (f: number) => new FnSource((t) => 0.95 * Math.sin(2 * Math.PI * f * t));
    const segs = buildSegments([{ inP: 0, outP: 2, speed: 1, fadeIn: 0, fadeOut: 0, ...fx }]);
    const music = [{ inP: 0, outP: 2, speed: 1, fadeIn: 0, fadeOut: 0, ...fx }];
    let k = 0;
    const entries = buildMixEntries(segs, music, 2, () => async () => tone([440, 660][k++ % 2]));
    const m = new TimelineMixer(entries, { eq: { low: 6, mid: 6, high: 0 }, normalize: true }, 2, SR);
    const { L, R } = await renderAll(m);
    let p = 0;
    for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    expect(m.master.limiter.peakIn).toBeGreaterThan(1);
    expect(p).toBeLessThanOrEqual(LIMIT_CEILING + 1e-6);
  });

  it('la compuerta del clip se aplica en la mezcla exportada', async () => {
    const noisy = new FnSource((t) => (t < 1 ? 0.01 : 0.4) * Math.sin(2 * Math.PI * 300 * t));
    const segs = buildSegments([{ inP: 0, outP: 2, speed: 1, fadeIn: 0, fadeOut: 0, ...fx, gate: true }]);
    const m = new TimelineMixer(buildMixEntries(segs, [], 2, () => async () => noisy), { eq: { low: 0, mid: 0, high: 0 }, normalize: false }, 2, SR);
    const { L } = await renderAll(m);
    let s = 0;
    for (let i = SR / 2; i < SR; i++) s += L[i] * L[i];
    expect(Math.sqrt(s / (SR / 2))).toBeLessThan(0.0003);
  });
});

describe('ventana de PCM (remuestreo y huecos)', () => {
  it('remuestrea 44,1 kHz → 48 kHz sin desplazar el tiempo', () => {
    const w = new PcmWindow();
    const n = 44100;
    const l = Float32Array.from({ length: n }, (_, i) => i / 44100); // valor = tiempo
    w.push(0, 44100, l, l);
    const out = new Float32Array(10);
    const out2 = new Float32Array(10);
    w.readInto(0.5, 1 / 48000, 10, out, out2);
    expect(out[0]).toBeCloseTo(0.5, 4);
    expect(out[9]).toBeCloseTo(0.5 + 9 / 48000, 4);
  });

  it('rellena huecos de más de 40 ms con silencio (audio con cortes de móvil)', () => {
    const w = new PcmWindow();
    const one = new Float32Array(4800).fill(1);
    w.push(0, 48000, one, one);
    w.push(0.2, 48000, one, one); // hueco de 0,1 s
    const L = new Float32Array(1);
    const R = new Float32Array(1);
    w.readInto(0.15, 0, 1, L, R);
    expect(L[0]).toBe(0);
    w.readInto(0.25, 0, 1, L, R);
    expect(L[0]).toBe(1);
    expect(w.end).toBeCloseTo(0.3, 5);
  });

  it('descarta lo ya leído (memoria acotada)', () => {
    const w = new PcmWindow();
    const big = new Float32Array(48000 * 10);
    w.push(0, 48000, big, big);
    w.discardBefore(9);
    expect(w.start).toBeGreaterThan(8.99);
    expect(w.end).toBeCloseTo(10, 5);
  });
});
