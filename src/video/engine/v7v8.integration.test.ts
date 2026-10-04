// Integración V7 (mezclador: LUFS, ducking, EQ, pan, reducción de ruido, fundido cruzado) × V8 (velocidad: curvas,
// invertir, congelar, bucle, conservar tono). Se escribieron en paralelo; aquí se prueba la COMBINACIÓN con el mismo
// plan de mezcla y el mismo mezclador que la exportación (`mixerFactory`), sobre fuentes sintéticas de formas conocidas.
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120000 }); // mezclas de varios segundos con limitador y medidor de sonoridad
import { LoudnessMeter } from '../audio/loudness';
import { setClipAudio, setProjectAudio, setTrackMix } from '../audio/mixOps';
import * as VM from '../model';
import { migrateVideoProject, normalizeV2, serializeProject } from '../model/migrate';
import realV1Json from '../model/fixtures/v1-real.json';
import { clipDurationOf, sourceAtLocal } from '../speed/clipTime';
import { audioDuration, mixerFactory } from './audioExport';
import { planProjectMix } from './audioPlan';
import { buildProjectMixEntries } from './compose';
import { solveLoudnessGain } from './loudnessPass';
import { TimelineMixer, buildMixEntries, type PcmSource } from './mixer';
import { TRUE_PEAK_CEILING_DB } from './dsp';

const SR = 48000;
type Fn = (s: number) => number;

class FnSource implements PcmSource {
  constructor(private f: Fn) {}
  async read(srcStart: number, step: number, n: number, L: Float32Array, R: Float32Array) {
    for (let i = 0; i < n; i++) {
      const v = this.f(srcStart + i * step);
      L[i] = v;
      R[i] = v;
    }
  }
  close() {}
}

const TAU = 2 * Math.PI;
const music: Fn = (s) => 0.3 * (Math.sin(TAU * 220 * s) + 0.7 * Math.sin(TAU * 330 * s + 1)) * (0.6 + 0.4 * Math.sin(TAU * 0.3 * s));

interface Src {
  id: string;
  dur: number;
  f: Fn;
}

/** Proyecto con las pistas dadas (id → tipo) y los medios sintéticos; los clips los añade cada prueba. */
function base(tracks: [string, 'video' | 'audio'][], srcs: Src[]) {
  let p = VM.createProject();
  for (const [id, kind] of tracks) p = VM.addTrack(p, kind, { id });
  for (const s of srcs) p = VM.addMedia(p, { id: s.id, kind: tracks.some(([, k]) => k === 'video') ? 'video' : 'audio', name: s.id, duration: s.dur, blob: new Blob([new Uint8Array(4)]) });
  const fns = new Map(srcs.map((s) => [s.id, s.f]));
  return { p, fns };
}
const clipOn = (p: VM.VideoProject, track: string, kind: 'video' | 'audio', f: Partial<VM.Clip>) => VM.addClip(p, track, VM.makeClip(kind, f));

function factory(p: VM.VideoProject, fns: Map<string, Fn>, ceilingDb?: number) {
  const dur = audioDuration(p);
  const f = mixerFactory(p, dur, (c) => async () => new FnSource(fns.get(c.mediaId!)!), () => true, ceilingDb);
  return { ...f, dur };
}

async function renderAll(m: TimelineMixer) {
  const L = new Float32Array(m.totalSamples);
  const R = new Float32Array(m.totalSamples);
  while (!m.finished) {
    const b = await m.render(4800);
    if (!b.frames) break;
    L.set(b.L.subarray(0, b.frames), b.startSample);
    R.set(b.R.subarray(0, b.frames), b.startSample);
  }
  m.close();
  return { L, R };
}
const lufs = (L: Float32Array, R: Float32Array) => {
  const m = new LoudnessMeter(SR);
  m.process(L, R, L.length);
  const i = m.integrated();
  return { lufs: Number.isFinite(i) ? i : m.ungated(), tp: m.truePeakDb() };
};
const rms = (x: Float32Array, t0: number, t1: number) => {
  const a = Math.round(t0 * SR);
  const b = Math.min(x.length, Math.round(t1 * SR));
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
/** Amplitud de un tono (correlación seno/coseno) en [t0, t1). */
const tone = (x: Float32Array, f: number, t0: number, t1: number) => {
  const a = Math.round(t0 * SR);
  const b = Math.min(x.length, Math.round(t1 * SR));
  let c = 0;
  let s = 0;
  for (let i = a; i < b; i++) {
    c += x[i] * Math.cos((TAU * f * i) / SR);
    s += x[i] * Math.sin((TAU * f * i) / SR);
  }
  return (2 * Math.hypot(c, s)) / Math.max(1, b - a);
};
const db = (x: number) => 20 * Math.log10(Math.max(1e-12, x));
const allFinite = (x: Float32Array) => {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false;
  return true;
};
/** Pico real con sobremuestreo ×8 (independiente del medidor del proyecto). */
function truePeak8(x: Float32Array): number {
  const R = 8;
  const H = 24;
  let best = 0;
  for (let i = H; i < x.length - H; i++) {
    for (let p = 1; p < R; p++) {
      const f = p / R;
      let s = 0;
      for (let j = -H + 1; j <= H; j++) {
        const d = j - f;
        s += x[i + j] * (Math.sin(Math.PI * d) / (Math.PI * d)) * (0.5 + 0.5 * Math.cos((Math.PI * d) / (H + 1)));
      }
      if (Math.abs(s) > best) best = Math.abs(s);
    }
    if (Math.abs(x[i]) > best) best = Math.abs(x[i]);
  }
  return db(best);
}

describe('(a) rampa de velocidad 0,5×→4×→1× con audio + normalización a −14 LUFS', () => {
  it('la sonoridad se mide sobre el audio ya transformado y el archivo sale a −14 ±0,5 con la duración de la rampa', { timeout: 120000 }, async () => {
    const curve = { pts: [{ s: 0, v: 0.5 }, { s: 7, v: 4 }, { s: 14, v: 1 }], smooth: true };
    let { p, fns } = base([['V', 'video']], [{ id: 'm', dur: 14, f: music }]);
    p = clipOn(p, 'V', 'video', { id: 'c', mediaId: 'm', start: 0, inP: 0, outP: 14, curve });
    p = setProjectAudio(p, { loud: { on: true, target: -14 } });
    const c = p.tracks[0].clips[0];
    const D = clipDurationOf(c);
    const { make, plan, dur } = factory(p, fns);
    expect(plan.entries).toHaveLength(1);
    expect(dur).toBeCloseTo(D, 6);
    // referencia INDEPENDIENTE: el audio leído en cada instante de salida con el mapa de tiempo del clip
    const n = Math.round(D * SR);
    const refL = new Float32Array(n);
    for (let i = 0; i < n; i++) refL[i] = music(sourceAtLocal(c, i / SR));
    const raw = await renderAll(make(0));
    const meterRaw = lufs(raw.L, raw.R);
    const meterRef = lufs(refL, refL);
    expect(Math.abs(meterRaw.lufs - meterRef.lufs)).toBeLessThan(0.3); // mide el audio acelerado/frenado, no el original
    expect(Math.abs(raw.L.length - n)).toBeLessThanOrEqual(2);
    const solve = await solveLoudnessGain(make, -14, { ceilingDb: TRUE_PEAK_CEILING_DB });
    expect(solve.silent).toBe(false);
    expect(Math.abs(solve.measured - meterRef.lufs)).toBeLessThan(0.3);
    const out = await renderAll(make(solve.gainDb));
    const m = lufs(out.L, out.R);
    expect(Math.abs(m.lufs + 14)).toBeLessThan(0.5);
    expect(m.tp).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DB + 0.3);
    expect(allFinite(out.L) && allFinite(out.R)).toBe(true);
    // la duración sale de la rampa: (0,5×→4×→1×) ≠ 14 s de archivo
    expect(Math.abs(out.L.length / SR - D)).toBeLessThan(2 / SR + 1e-9);
    expect(D).toBeLessThan(14);
  });
});

describe('(b) clip invertido + ducking contra una pista de voz', () => {
  // música: seno de 330 Hz con envolvente CRECIENTE en el archivo (invertida, decrece con el tiempo); voz: ráfaga de 1 kHz
  const env = (s: number) => 0.1 + 0.3 * (s / 12);
  const mus: Fn = (s) => env(s) * Math.sin(TAU * 330 * s);
  const voz: Fn = (s) => (s >= 0 && s < 2 ? 0.3 * Math.sin(TAU * 1000 * s) : 0);
  const duckedDb = (L: Float32Array, t0: number, t1: number, tm: number) => db(tone(L, 330, t0, t1)) - db(env(12 - tm)); // 0 dB si no hay ducking

  it('la música invertida baja ~12 dB exactamente en el tramo de voz (voz normal: 4–6 s)', async () => {
    let { p, fns } = base([['V', 'audio'], ['M', 'audio']], [{ id: 'voz', dur: 2, f: voz }, { id: 'mus', dur: 12, f: mus }]);
    p = clipOn(p, 'V', 'audio', { id: 'cv', mediaId: 'voz', start: 4, inP: 0, outP: 2 });
    p = clipOn(p, 'M', 'audio', { id: 'cm', mediaId: 'mus', start: 0, inP: 0, outP: 12, reverse: true });
    p = setTrackMix(p, 'M', { duck: { on: true, db: 12 } });
    const { make } = factory(p, fns);
    const { L } = await renderAll(make(0));
    // la envolvente invertida comprueba la inversión; el nivel respecto de la esperada, el ducking
    expect(Math.abs(duckedDb(L, 1, 3, 2))).toBeLessThan(0.5);
    expect(Math.abs(duckedDb(L, 3.2, 3.8, 3.5))).toBeLessThan(0.5); // aún sin bajar
    expect(duckedDb(L, 4.6, 5.8, 5.2)).toBeLessThan(-10.5);
    expect(duckedDb(L, 4.6, 5.8, 5.2)).toBeGreaterThan(-13.5);
    expect(Math.abs(duckedDb(L, 8.5, 11, 9.75))).toBeLessThan(0.7); // vuelve
  });

  it('la voz también invertida: el ducking cae donde queda la voz tras la transformación (5–6 s), no donde está en el archivo (3–4 s)', async () => {
    // ráfaga en los primeros 1,0 s del archivo; clip de 3 s invertido en start 3 → la ráfaga queda en 5–6 s
    const burst: Fn = (s) => (s >= 0 && s < 1 ? 0.3 * Math.sin(TAU * 1000 * s) : 0);
    let { p, fns } = base([['V', 'audio'], ['M', 'audio']], [{ id: 'voz', dur: 3, f: burst }, { id: 'mus', dur: 12, f: mus }]);
    p = clipOn(p, 'V', 'audio', { id: 'cv', mediaId: 'voz', start: 3, inP: 0, outP: 3, reverse: true });
    p = clipOn(p, 'M', 'audio', { id: 'cm', mediaId: 'mus', start: 0, inP: 0, outP: 12, reverse: true });
    p = setTrackMix(p, 'M', { duck: { on: true, db: 12 } });
    const { make } = factory(p, fns);
    const { L } = await renderAll(make(0));
    expect(Math.abs(duckedDb(L, 3.2, 3.9, 3.55))).toBeLessThan(0.5); // donde está la voz en el ARCHIVO: no baja
    expect(Math.abs(duckedDb(L, 4.1, 4.7, 4.4))).toBeLessThan(0.5);
    expect(duckedDb(L, 5.15, 5.9, 5.5)).toBeLessThan(-10.5); // donde suena la voz tras invertir
    expect(Math.abs(duckedDb(L, 7.5, 11, 9))).toBeLessThan(0.7);
  });

  it('el ducking con la voz acelerada (2×) sigue a la voz transformada', async () => {
    // ráfaga de 4 s de archivo a 2× → 2 s en la línea de tiempo (start 6 → 6–8 s)
    const burst: Fn = (s) => (s >= 2 && s < 6 ? 0.3 * Math.sin(TAU * 600 * s) : 0);
    let { p, fns } = base([['V', 'audio'], ['M', 'audio']], [{ id: 'voz', dur: 8, f: burst }, { id: 'mus', dur: 12, f: (s) => 0.3 * Math.sin(TAU * 330 * s) }]);
    p = clipOn(p, 'V', 'audio', { id: 'cv', mediaId: 'voz', start: 5, inP: 0, outP: 8, speed: 2 }); // ráfaga en 6–8 s
    p = clipOn(p, 'M', 'audio', { id: 'cm', mediaId: 'mus', start: 0, inP: 0, outP: 12 });
    p = setTrackMix(p, 'M', { duck: { on: true, db: 12 } });
    const { make } = factory(p, fns);
    const { L } = await renderAll(make(0));
    const lvl = (a: number, b: number) => db(tone(L, 330, a, b)) - db(0.3);
    expect(Math.abs(lvl(1, 5.5))).toBeLessThan(0.5);
    expect(lvl(6.3, 7.8)).toBeLessThan(-10.5);
  });
});

describe('(c) bucle de 3 pasadas con fundido cruzado + EQ + pan', () => {
  it('sin saltos en las uniones, longitud de bucle correcta y pan con la ley de potencia constante', async () => {
    const f440: Fn = (s) => 0.5 * Math.sin(TAU * 440 * s); // 3 s = 1320 ciclos exactos: las pasadas empalman en fase
    let { p, fns } = base([['A', 'audio']], [{ id: 'm', dur: 8, f: f440 }]);
    p = clipOn(p, 'A', 'audio', { id: 'c', mediaId: 'm', start: 0, inP: 2, outP: 5, loop: { n: 3, xf: 0.5 } });
    p = setClipAudio(p, 'c', { pan: 0.5, eq: [{ type: 'peak', f: 2000, g: 3, q: 1 }] });
    const c = p.tracks[0].clips[0];
    expect(clipDurationOf(c)).toBeCloseTo(8, 9); // 3 pasadas de 3 s con 0,5 s de fundido: 3 + 2×2,5
    const { make, dur } = factory(p, fns);
    expect(dur).toBeCloseTo(8, 9);
    const { L, R } = await renderAll(make(0));
    expect(L.length).toBe(8 * SR);
    expect(allFinite(L) && allFinite(R)).toBe(true);
    const maxStep = (x: Float32Array, t0: number, t1: number) => {
      let m = 0;
      for (let i = Math.round(t0 * SR) + 1; i < Math.round(t1 * SR); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
      return m;
    };
    const steady = maxStep(L, 0.6, 2.2);
    // ventanas de unión: fundido 2,5–3,0 s y 5,0–5,5 s (más margen) sin ningún salto mayor que el paso normal de la señal
    for (const [a, b] of [[2.4, 3.1], [4.9, 5.6]]) expect(maxStep(L, a, b)).toBeLessThan(steady * 1.15);
    // amplitud constante a través de la unión (misma fase): no hay hueco ni bulto
    const ampL = (a: number, b: number) => tone(L, 440, a, b);
    const ref = ampL(0.6, 2.2);
    for (const [a, b] of [[2.6, 2.9], [5.1, 5.4]]) expect(Math.abs(db(ampL(a, b)) - db(ref))).toBeLessThan(0.4);
    // pan 0,5: gL = √2·cos(3π/8), gR = √2·sin(3π/8) → R/L = tan(3π/8), en pasada y en unión
    const want = Math.tan((3 * Math.PI) / 8);
    for (const [a, b] of [[0.6, 2.2], [2.6, 2.9], [6, 7.8]]) expect(rms(R, a, b) / rms(L, a, b)).toBeCloseTo(want, 1);
  });

  it('sin fundido (xf 0) el bucle se oye igual pero la unión puede tener salto: el fundido es lo que lo evita (fase NO coincidente)', async () => {
    const f: Fn = (s) => 0.5 * Math.sin(TAU * 437.3 * s); // 3 s ≠ ciclos enteros
    const run = async (xf: number) => {
      let { p, fns } = base([['A', 'audio']], [{ id: 'm', dur: 8, f }]);
      p = clipOn(p, 'A', 'audio', { id: 'c', mediaId: 'm', start: 0, inP: 2, outP: 5, loop: { n: 3, ...(xf ? { xf } : {}) } });
      const { make } = factory(p, fns);
      return (await renderAll(make(0))).L;
    };
    const step = (x: Float32Array, t0: number, t1: number) => {
      let m = 0;
      for (let i = Math.round(t0 * SR) + 1; i < Math.round(t1 * SR); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
      return m;
    };
    const dry = await run(0);
    const wet = await run(0.5);
    const normal = step(dry, 0.5, 2.5);
    expect(step(dry, 2.9, 3.1)).toBeGreaterThan(normal * 1.5); // hay un clic de verdad sin fundido
    expect(step(wet, 2.4, 3.1)).toBeLessThan(normal * 2.2); // con fundido, el cruce de fases no genera clic
  });
});

describe('(d) clip congelado + reducción de ruido', () => {
  it('el congelado no suena (sin audio fantasma de la reducción de ruido) y no hay NaN en ninguna parte', async () => {
    const noisy: Fn = (s) => 0.25 * Math.sin(TAU * 500 * s) + 0.02 * Math.sin(TAU * 7000 * s * (1 + 0.1 * Math.sin(s)));
    let { p, fns } = base([['V', 'video']], [{ id: 'v', dur: 8, f: noisy }]);
    p = clipOn(p, 'V', 'video', { id: 'a', mediaId: 'v', start: 0, inP: 0, outP: 2 });
    p = clipOn(p, 'V', 'video', { id: 'fz', mediaId: 'v', start: 2, inP: 3, outP: 4, freeze: 2 });
    p = clipOn(p, 'V', 'video', { id: 'b', mediaId: 'v', start: 4, inP: 4, outP: 6 });
    for (const id of ['a', 'fz', 'b']) p = setClipAudio(p, id, { denoise: 0.7 });
    const { make, dur } = factory(p, fns);
    expect(dur).toBeCloseTo(6, 9);
    const { L, R } = await renderAll(make(0));
    expect(allFinite(L) && allFinite(R)).toBe(true);
    // tras la cola de la reducción de ruido del clip anterior (<150 ms, −60 dBFS) no queda nada hasta que empieza el siguiente
    let ghost = 0;
    for (let i = Math.round(2.15 * SR); i < Math.round(3.95 * SR); i++) ghost = Math.max(ghost, Math.abs(L[i]), Math.abs(R[i]));
    expect(ghost).toBeLessThan(1e-6);
    // control: la misma mezcla con un HUECO en lugar del congelado tiene la misma cola (es de V7, el congelado no añade nada)
    const q = VM.removeClip(p, 'fz');
    const ctl = await renderAll(factory(q, fns).make(0));
    let diff = 0;
    for (let i = Math.round(2 * SR); i < Math.round(3.95 * SR); i++) diff = Math.max(diff, Math.abs(L[i] - ctl.L[i]));
    expect(diff).toBeLessThan(1e-6);
    expect(rms(L, 0.2, 1.8)).toBeGreaterThan(0.05);
    expect(rms(L, 4.2, 5.8)).toBeGreaterThan(0.05);
  });

  it('un proyecto SOLO de congelado: silencio finito, la normalización no inventa ganancia (sin NaN ni ∞)', async () => {
    let { p, fns } = base([['V', 'video']], [{ id: 'v', dur: 8, f: music }]);
    p = clipOn(p, 'V', 'video', { id: 'fz', mediaId: 'v', start: 0, inP: 3, outP: 4, freeze: 2 });
    p = setClipAudio(p, 'fz', { denoise: 0.8 });
    p = setProjectAudio(p, { loud: { on: true, target: -14 } });
    const { make } = factory(p, fns);
    const solve = await solveLoudnessGain(make, -14, { ceilingDb: TRUE_PEAK_CEILING_DB });
    expect(solve.silent).toBe(true);
    expect(solve.gainDb).toBe(0);
    const { L, R } = await renderAll(make(solve.gainDb));
    expect(allFinite(L) && allFinite(R)).toBe(true);
    expect(rms(L, 0, 2)).toBe(0);
  });
});

describe('(e) 2× con «conservar tono» + reducción de ruido + limitador', () => {
  it('el tono se conserva, el pico real queda por debajo del techo (≤ −1 dBTP) con una normalización agresiva', async () => {
    // poca energía y picos altos (un chasquido cada 0,5 s): para llegar a −8 LUFS los picos pasan del techo y el limitador tiene que actuar
    const loud: Fn = (s) => 0.2 * Math.sin(TAU * 440 * s) + 0.03 * Math.sin(TAU * 91 * s) + (s % 0.5 < 0.0004 ? 0.8 * Math.sin(TAU * 3000 * s) : 0);
    let { p, fns } = base([['V', 'video']], [{ id: 'm', dur: 10, f: loud }]);
    p = clipOn(p, 'V', 'video', { id: 'c', mediaId: 'm', start: 0, inP: 0, outP: 10, speed: 2, pitch: true });
    p = setClipAudio(p, 'c', { denoise: 0.5 });
    p = setProjectAudio(p, { loud: { on: true, target: -8 } });
    const { make, dur } = factory(p, fns);
    expect(dur).toBeCloseTo(5, 9);
    const solve = await solveLoudnessGain(make, -8, { ceilingDb: TRUE_PEAK_CEILING_DB });
    const { L, R } = await renderAll(make(solve.gainDb));
    expect(allFinite(L) && allFinite(R)).toBe(true);
    expect(solve.gainDb).toBeGreaterThan(0);
    // sin limitador (techo +20 dBTP) el mismo mezclado pasaría de −1 dBTP: el limitador es lo que lo evita
    const free = await renderAll(factory(p, fns, 20).make(solve.gainDb));
    expect(Math.max(truePeak8(free.L), truePeak8(free.R))).toBeGreaterThan(-1);
    const tp = Math.max(truePeak8(L), truePeak8(R));
    expect(tp).toBeLessThanOrEqual(-1);
    // el tono sigue en 440 Hz (sin «conservar tono» saldría a 880 Hz)
    const a440 = tone(L, 440, 1, 4);
    const a880 = tone(L, 880, 1, 4);
    expect(a440).toBeGreaterThan(a880 * 5);
  });
});

describe('V8 especial en la cadena V7: el plan de mezcla trata igual a cada clip (needsTimeSource)', () => {
  it('curva, invertido, congelado, bucle y 2×+tono dan entradas en tiempo local; el resto, las de siempre', () => {
    const cases: Record<string, Partial<VM.Clip>> = {
      curva: { curve: { pts: [{ s: 0, v: 1 }, { s: 6, v: 2 }] } },
      invertido: { reverse: true },
      congelado: { freeze: 1, inP: 2, outP: 3 },
      bucle: { loop: { n: 2 } },
      tono: { speed: 2, pitch: true },
    };
    for (const [name, f] of Object.entries(cases)) {
      let { p, fns } = base([['V', 'video'], ['A', 'audio']], [{ id: 'm', dur: 8, f: music }]);
      p = clipOn(p, 'V', 'video', { id: 'c', mediaId: 'm', start: 1, inP: 0, outP: 6, ...f });
      if (!f.freeze) p = clipOn(p, 'A', 'audio', { id: 'd', mediaId: 'm', start: 0, inP: 1, outP: 3, ...f }); // el congelado es solo de video
      const plan = planProjectMix(p, 40, (c) => async () => new FnSource(fns.get(c.mediaId!)!), () => true);
      expect(plan.entries, name).toHaveLength(f.freeze ? 1 : 2);
      for (const e of plan.entries) {
        expect(e.speed, name).toBe(1);
        expect(e.inP, name).toBe(0);
        expect(e.trackId, name).toBeTruthy();
      }
    }
    // sin nada especial: el mezclador recibe inP/outP/velocidad del clip
    let { p, fns } = base([['V', 'video']], [{ id: 'm', dur: 8, f: music }]);
    p = clipOn(p, 'V', 'video', { id: 'c', mediaId: 'm', start: 1, inP: 1, outP: 5, speed: 2 });
    const plan = planProjectMix(p, 40, (c) => async () => new FnSource(fns.get(c.mediaId!)!), () => true);
    expect([plan.entries[0].inP, plan.entries[0].outP, plan.entries[0].speed]).toEqual([1, 5, 2]);
  });

  it('un clip especial no recibe fundido cruzado de V7 (lo excluye por el mismo criterio que needsTimeSource)', async () => {
    let { p, fns } = base([['A', 'audio']], [{ id: 'x', dur: 10, f: (s) => 0.3 * Math.sin(TAU * 300 * s) }, { id: 'y', dur: 10, f: (s) => 0.3 * Math.sin(TAU * 500 * s) }]);
    p = clipOn(p, 'A', 'audio', { id: 'a', mediaId: 'x', start: 0, inP: 2, outP: 6, reverse: true });
    p = clipOn(p, 'A', 'audio', { id: 'b', mediaId: 'y', start: 4, inP: 2, outP: 6 });
    p = setProjectAudio(p, { xfade: 0.4 });
    const plan = planProjectMix(p, 40, (c) => async () => new FnSource(fns.get(c.mediaId!)!), () => true);
    expect(plan.entries.every((e) => !e.xfIn && !e.xfOut)).toBe(true);
    const { make } = factory(p, fns);
    const { L, R } = await renderAll(make(0));
    expect(allFinite(L) && allFinite(R)).toBe(true);
    expect(tone(L, 500, 4.5, 7.5)).toBeGreaterThan(0.25); // el clip normal suena íntegro desde el principio
  });
});

describe('«conservar tono» combinado con bucle y con curva (la ruta WSOLA también debe seguir el mapa de tiempo completo)', () => {
  const f440: Fn = (s) => 0.4 * Math.sin(TAU * 440 * s);
  it('bucle de 3 pasadas a 2× con conservar tono: suena TODO el bucle (6 s), no solo la primera pasada', async () => {
    // el archivo sigue más allá de outP con OTRO contenido (1 kHz): si el bucle no reinicia, se cuela
    const beyond: Fn = (s) => (s < 4 ? f440(s) : 0.4 * Math.sin(TAU * 1000 * s));
    let { p, fns } = base([['A', 'audio']], [{ id: 'm', dur: 8, f: beyond }]);
    p = clipOn(p, 'A', 'audio', { id: 'c', mediaId: 'm', start: 0, inP: 0, outP: 4, speed: 2, pitch: true, loop: { n: 3 } });
    const { make, dur } = factory(p, fns);
    expect(dur).toBeCloseTo(6, 9);
    const { L } = await renderAll(make(0));
    for (const [a, b] of [[0.5, 1.5], [2.5, 3.5], [4.5, 5.5]]) {
      expect(tone(L, 440, a, b), `440 Hz en ${a}`).toBeGreaterThan(0.3);
      expect(tone(L, 1000, a, b), `1 kHz colado en ${a}`).toBeLessThan(0.05);
    }
  });
  it('bucle con fundido cruzado a 2× con conservar tono: sin huecos ni NaN en la unión', async () => {
    const beyond: Fn = (s) => (s < 4 ? f440(s) : 0.4 * Math.sin(TAU * 1000 * s));
    let { p, fns } = base([['A', 'audio']], [{ id: 'm', dur: 8, f: beyond }]);
    p = clipOn(p, 'A', 'audio', { id: 'c', mediaId: 'm', start: 0, inP: 0, outP: 4, speed: 2, pitch: true, loop: { n: 3, xf: 0.5 } });
    const { make, dur } = factory(p, fns);
    expect(dur).toBeCloseTo(5, 9); // 2 s + 2 × 1,5 s
    const { L } = await renderAll(make(0));
    expect(allFinite(L)).toBe(true);
    for (const [a, b] of [[0.4, 1.4], [1.55, 1.95], [3.05, 3.45], [3.6, 4.8]]) {
      expect(tone(L, 440, a, b), `${a}`).toBeGreaterThan(0.25);
      expect(tone(L, 1000, a, b), `1 kHz ${a}`).toBeLessThan(0.05);
    }
  });
  it('curva 0,5×→2× con conservar tono: dura lo que dice la curva y el tono sigue en 440 Hz', async () => {
    let { p, fns } = base([['A', 'audio']], [{ id: 'm', dur: 8, f: f440 }]);
    p = clipOn(p, 'A', 'audio', { id: 'c', mediaId: 'm', start: 0, inP: 0, outP: 8, curve: { pts: [{ s: 0, v: 0.5 }, { s: 8, v: 2 }] }, pitch: true });
    const c = p.tracks[0].clips[0];
    const D = clipDurationOf(c);
    const { make, dur } = factory(p, fns);
    expect(dur).toBeCloseTo(D, 9);
    const { L } = await renderAll(make(0));
    expect(allFinite(L)).toBe(true);
    expect(tone(L, 440, 1, D - 1)).toBeGreaterThan(0.25);
  });
});

describe('(g) sin ajustes V7/V8: idéntico bit a bit a V1/V6; proyectos .chamva viejos', () => {
  const sameBits = (a: Float32Array, b: Float32Array) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  };

  it('la ruta nueva (planProjectMix + mezclador con pistas) da exactamente las muestras de la ruta V1 (buildMixEntries sin pistas)', async () => {
    const fa: Fn = (s) => 0.3 * Math.sin(TAU * 200 * s) + 0.1 * Math.sin(TAU * 3300 * s);
    const fb: Fn = (s) => 0.4 * Math.sin(TAU * 310 * s);
    const fm: Fn = (s) => 0.2 * Math.sin(TAU * 120 * s);
    let { p, fns } = base([['V', 'video'], ['A', 'audio']], [{ id: 'a', dur: 6, f: fa }, { id: 'b', dur: 6, f: fb }]);
    p = VM.addMedia(p, { id: 'mu', kind: 'audio', name: 'mu', duration: 8, blob: new Blob([new Uint8Array(4)]) });
    fns.set('mu', fm);
    p = clipOn(p, 'V', 'video', { id: 'v1', mediaId: 'a', start: 0, inP: 0.3, outP: 3, volume: 0.6, effect: 'clean' });
    p = clipOn(p, 'V', 'video', { id: 'v2', mediaId: 'b', start: 2.7, inP: 0, outP: 3, speed: 1.5, effect: 'echo' });
    p = clipOn(p, 'A', 'audio', { id: 'm1', mediaId: 'mu', start: 0, inP: 0, outP: 4.7, volume: 0.5 });
    p = { ...p, eq: { low: 3, mid: 0, high: -2 }, normalize: true };
    const dur = VM.projectDuration(p);
    const open = (c: VM.Clip) => async () => new FnSource(fns.get(c.mediaId!)!);
    const planned = planProjectMix(p, dur, open, () => true);
    const a = await renderAll(new TimelineMixer(planned.entries, planned.master, dur, SR, planned.tracks));
    // ruta de V1: sin pistas ni cadena de V7
    const legacyEntries = buildProjectMixEntries(p, dur, open, () => true);
    const b = await renderAll(new TimelineMixer(legacyEntries, { eq: p.eq, normalize: p.normalize, ceilingDb: TRUE_PEAK_CEILING_DB }, dur, SR));
    expect(sameBits(a.L, b.L)).toBe(true);
    expect(sameBits(a.R, b.R)).toBe(true);
    expect(rms(a.L, 0.5, 2)).toBeGreaterThan(0.05);
    // y V1 puro: los segmentos de video + clips de audio como los hacía el motor original
    const v1c = (c: VM.Clip) => ({ ...c, ...VM.clipAudioFx(c) }); // V1 llevaba volumen/filtros/eco en el propio clip
    const [va, vb] = p.tracks[0].clips.map(v1c);
    const segs = [
      { clip: va, start: 0, end: VM.clipEnd(p.tracks[0].clips[0]) },
      { clip: vb, start: 2.7, end: VM.clipEnd(p.tracks[0].clips[1]) },
    ];
    const v1Entries = buildMixEntries(segs, [v1c(p.tracks[1].clips[0])], dur, (c) => open(c));
    const c = await renderAll(new TimelineMixer(v1Entries, { eq: p.eq, normalize: p.normalize, ceilingDb: TRUE_PEAK_CEILING_DB }, dur, SR));
    expect(sameBits(a.L, c.L)).toBe(true);
    expect(sameBits(a.R, c.R)).toBe(true);
  });

  const NEW_CLIP = ['curve', 'reverse', 'freeze', 'loop', 'pitch', 'pan', 'gainDb', 'eq', 'denoise', 'xlayer', 'reframe'];
  const NEW_TRACK = ['solo', 'duck', 'pan', 'gainDb', 'eq'];

  function reviveBlobs<T>(json: T): T {
    const blobs = new Map<string, Blob>();
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.__blob === 'string') {
          if (!blobs.has(o.__blob)) blobs.set(o.__blob, new Blob([new Uint8Array(Number(o.size) % 97)], { type: String(o.type) }));
          return blobs.get(o.__blob);
        }
        return Object.fromEntries(Object.entries(o).filter(([k]) => k !== '_nota').map(([k, x]) => [k, walk(x)]));
      }
      return v;
    };
    return walk(json) as T;
  }

  it('un .chamva V1 real migra sin campos de V7/V8, se guarda y se reabre igual (v2) y mezcla igual', async () => {
    const { project: m1 } = migrateVideoProject(reviveBlobs(realV1Json));
    const clips = m1.tracks.flatMap((t) => t.clips);
    expect(clips.length).toBeGreaterThan(3);
    for (const c of clips) for (const k of NEW_CLIP) expect(c, `clip ${c.id}`).not.toHaveProperty(k);
    for (const t of m1.tracks) for (const k of NEW_TRACK) expect(t, `pista ${t.id}`).not.toHaveProperty(k);
    expect(m1.audio).toBeUndefined();
    // v2 guardado → reabierto: el mismo proyecto
    const saved = structuredClone(serializeProject(m1));
    const { project: m2 } = migrateVideoProject(saved);
    const again = structuredClone(serializeProject(m2));
    expect(again).toEqual(saved);
    expect(normalizeV2(structuredClone(saved) as unknown as Record<string, unknown>)).toEqual(m2);
    // las mismas entradas de mezcla y las mismas muestras
    const dur = VM.projectDuration(m1);
    const fn: Fn = (s) => 0.2 * Math.sin(TAU * 261 * s);
    const open = () => async () => new FnSource(fn);
    const mk = (pr: VM.VideoProject) => {
      const pl = planProjectMix(pr, dur, open, () => true);
      return renderAll(new TimelineMixer(pl.entries, pl.master, dur, SR, pl.tracks));
    };
    const [x, y] = [await mk(m1), await mk(m2)];
    expect(sameBits(x.L, y.L) && sameBits(x.R, y.R)).toBe(true);
    for (const e of planProjectMix(m1, dur, open, () => true).entries) expect(e.speed).toBeGreaterThan(0);
    expect(rms(x.L, 0.2, 1)).toBeGreaterThan(0);
  });

  it('un v2 sin campos nuevos (con los de V6) abre y mezcla igual; los campos desconocidos no se inventan', async () => {
    let { p, fns } = base([['V', 'video'], ['A', 'audio']], [{ id: 'a', dur: 6, f: music }]);
    p = clipOn(p, 'V', 'video', { id: 'v1', mediaId: 'a', start: 0, inP: 0, outP: 4, volume: 0.8, speed: 1.25 });
    p = clipOn(p, 'A', 'audio', { id: 'a1', mediaId: 'a', start: 1, inP: 1, outP: 4 });
    const raw = structuredClone(serializeProject(p));
    // un archivo v2 sin los campos opcionales de V7/V8 (los quita explícitamente: así los escribía V6)
    for (const t of raw.tracks) for (const c of t.clips) for (const k of NEW_CLIP) delete (c as unknown as Record<string, unknown>)[k];
    delete (raw as { audio?: unknown }).audio;
    const { project: q } = migrateVideoProject(raw);
    for (const c of q.tracks.flatMap((t) => t.clips)) for (const k of NEW_CLIP) expect(c as unknown as object).not.toHaveProperty(k);
    const dur = VM.projectDuration(q);
    const open = (c: VM.Clip) => async () => new FnSource(fns.get(c.mediaId!)!);
    const render = (pr: VM.VideoProject) => {
      const pl = planProjectMix(pr, dur, open, () => true);
      return renderAll(new TimelineMixer(pl.entries, pl.master, dur, SR, pl.tracks));
    };
    const [a, b] = [await render(p), await render(q)];
    expect(sameBits(a.L, b.L) && sameBits(a.R, b.R)).toBe(true);
  });
});
