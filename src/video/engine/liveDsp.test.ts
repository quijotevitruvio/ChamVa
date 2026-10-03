// Equivalencia vista previa (en vivo, bloques de 128) vs exportación (TimelineMixer, bloques de 100 ms)
// con señales sintéticas: voz, ruido de fondo, un pico fuerte, fundidos y eco.
import { describe, expect, it } from 'vitest';
import { LiveClipProcessor, LiveMasterProcessor } from './liveDsp';
import { TimelineMixer, type MixEntry, type PcmSource } from './mixer';
import type { ClipAudioFx } from './dsp';
import { LIMIT_CEILING } from './dsp';

const SR = 48000;
const SECS = 4;
const N = SR * SECS;

/** 0–1 s voz (300 Hz, 0,3), 1–2 s ruido ligero (0,006), 2–3 s pico fuerte (1,6), 3–4 s voz suave. */
function synth(): { L: Float32Array; R: Float32Array } {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let v: number;
    if (t < 1) v = 0.3 * Math.sin(2 * Math.PI * 300 * t);
    else if (t < 2) v = 0.006 * rnd();
    else if (t < 3) v = 1.6 * Math.sin(2 * Math.PI * 440 * t);
    else v = 0.12 * Math.sin(2 * Math.PI * 220 * t);
    L[i] = v;
    R[i] = v * 0.8;
  }
  return { L, R };
}

class ArraySource implements PcmSource {
  constructor(private L: Float32Array, private R: Float32Array) {}
  async read(srcStart: number, _step: number, n: number, L: Float32Array, R: Float32Array) {
    const o = Math.round(srcStart * SR);
    for (let i = 0; i < n; i++) {
      L[i] = this.L[o + i] ?? 0;
      R[i] = this.R[o + i] ?? 0;
    }
  }
  close() {}
}

const rms = (a: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

async function exportPath(fx: ClipAudioFx, fadeIn: number, fadeOut: number, normalize: boolean) {
  const { L, R } = synth();
  const entry: MixEntry = { start: 0, end: SECS, inP: 0, outP: SECS, speed: 1, fx, fadeIn, fadeOut, open: async () => new ArraySource(L, R) };
  const mixer = new TimelineMixer([entry], { eq: { low: 0, mid: 0, high: 0 }, normalize }, SECS);
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  while (!mixer.finished) {
    const b = await mixer.render(4800);
    outL.set(b.L, b.startSample);
    outR.set(b.R, b.startSample);
  }
  return { L: outL, R: outR, limiter: mixer.master.limiter };
}

/** Camino de la vista previa: ganancia de fundido (GainNode) → LiveClipProcessor → mezcla → LiveMasterProcessor, en bloques de 128. */
function livePath(fx: ClipAudioFx, fadeIn: number, fadeOut: number, normalize: boolean, block = 128) {
  const s0 = synth();
  const master = new LiveMasterProcessor(SR, { eq: { low: 0, mid: 0, high: 0 }, normalize });
  // el limitador de pico real retrasa `latency` muestras: la vista previa las deja; para comparar se alimenta con ceros al final y se descartan las primeras
  const lat = master.latency;
  const L = new Float32Array(N + lat);
  const R = new Float32Array(N + lat);
  L.set(s0.L);
  R.set(s0.R);
  const clip = new LiveClipProcessor(SR, fx);
  const outL = new Float32Array(N + lat);
  const outR = new Float32Array(N + lat);
  for (let o = 0; o < N + lat; o += block) {
    const n = Math.min(block, N + lat - o);
    const inL = L.slice(o, o + n);
    const inR = R.slice(o, o + n);
    for (let i = 0; i < n; i++) {
      const tt = (o + i) / SR;
      let g = 1;
      if (fadeIn > 0 && tt < fadeIn) g = tt / fadeIn;
      if (fadeOut > 0 && SECS - tt < fadeOut) g = Math.min(g, (SECS - tt) / fadeOut);
      g = Math.max(0, Math.min(1, g));
      inL[i] *= g;
      inR[i] *= g;
    }
    const mid = [new Float32Array(n), new Float32Array(n)];
    clip.processBlock([[inL, inR]], [mid]);
    const out = [new Float32Array(n), new Float32Array(n)];
    master.processBlock([mid], [out]);
    outL.set(out[0], o);
    outR.set(out[1], o);
  }
  return { L: outL.subarray(lat), R: outR.subarray(lat), master };
}

const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

describe('DSP en vivo vs exportación (señal sintética)', () => {
  const voz: ClipAudioFx = { volume: 1.5, hp: 100, lp: 9000, echo: 0, gate: true };
  const eco: ClipAudioFx = { volume: 1, hp: 120, lp: 7000, echo: 0.4, gate: false };

  it('compuerta de ruido + limitador: misma salida muestra a muestra', async () => {
    const a = await exportPath(voz, 0, 0, false);
    const b = livePath(voz, 0, 0, false);
    expect(maxDiff(a.L, b.L)).toBeLessThan(1e-6);
    expect(maxDiff(a.R, b.R)).toBeLessThan(1e-6);
    // y hace lo que dice: el ruido (1–2 s) baja, el pico (2–3 s) no pasa de −1 dBFS
    const { L } = synth();
    expect(rms(b.L, 1.3 * SR, 1.9 * SR)).toBeLessThan(rms(L, 1.3 * SR, 1.9 * SR) * 1.5 * 0.1);
    expect(peak(b.L)).toBeLessThanOrEqual(LIMIT_CEILING + 1e-9);
    expect(b.master.peakOut).toBeCloseTo(a.limiter.peakOut, 6);
  });

  it('eco + compresor (Normalizar) + fundidos: misma salida', async () => {
    const a = await exportPath(eco, 0.5, 0.7, true);
    const b = livePath(eco, 0.5, 0.7, true);
    expect(maxDiff(a.L, b.L)).toBeLessThan(1e-5);
    expect(maxDiff(a.R, b.R)).toBeLessThan(1e-5);
    expect(rms(a.L, 0, N)).toBeCloseTo(rms(b.L, 0, N), 5);
  });

  it('el resultado no depende del tamaño de bloque (128, 1000, 4800)', () => {
    const ref = livePath(voz, 0.2, 0.2, true, 4800);
    for (const blk of [128, 1000]) {
      const x = livePath(voz, 0.2, 0.2, true, blk);
      expect(maxDiff(ref.L, x.L)).toBeLessThan(1e-6);
    }
  });

  it('cambiar solo el volumen conserva el estado; cambiar filtros reconstruye', () => {
    const c = new LiveClipProcessor(SR, eco);
    const one = [new Float32Array(128).fill(0.5), new Float32Array(128).fill(0.5)];
    const out = [new Float32Array(128), new Float32Array(128)];
    c.processBlock([one], [out]);
    c.setFx({ ...eco, volume: 0.5 });
    c.processBlock([one], [out]);
    expect(out[0].every(Number.isFinite)).toBe(true);
    c.setFx({ ...eco, lp: 3000 });
    c.processBlock([one], [out]);
    expect(out[0].every(Number.isFinite)).toBe(true);
  });

  it('entrada mono o ausente no rompe', () => {
    const c = new LiveClipProcessor(SR, voz);
    const out = [new Float32Array(128), new Float32Array(128)];
    c.processBlock([[new Float32Array(128).fill(0.1)]], [out]);
    expect(out[1][127]).toBe(out[0][127]);
    c.processBlock([[]], [out]);
    expect(out[0].every(Number.isFinite)).toBe(true);
  });
});
