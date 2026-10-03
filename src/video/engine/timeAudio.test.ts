import { describe, expect, it } from 'vitest';
import * as VM from '../model';
import { TimelineMixer, type MixEntry, type PcmSource } from './mixer';
import { buildProjectMixEntries } from './compose';
import { ClipTimeSource, PitchTimeSource, ReverseAudioSource, needsTimeSource } from './timeAudio';
import { clipDurationOf, sourceAtLocal } from '../speed/clipTime';
import type { Clip, SpeedCurve } from '../model/types';

const SR = 48000;

/** Fuente falsa: el valor de la muestra en el instante de archivo s es f(s). Solo lee hacia delante (como el decodificador real). */
class FnSource implements PcmSource {
  last = -Infinity;
  closed = false;
  constructor(private f: (s: number) => number, private mono = true) {}
  async read(srcStart: number, step: number, n: number, L: Float32Array, R: Float32Array) {
    if (this.mono && step > 0 && srcStart < this.last - 0.1) throw new Error(`lectura hacia atrás ${srcStart} < ${this.last}`);
    for (let i = 0; i < n; i++) {
      const v = this.f(srcStart + i * step);
      L[i] = v;
      R[i] = -v;
    }
    this.last = srcStart + n * step;
  }
  close() {
    this.closed = true;
  }
}

const ramp = (s: number) => s / 100; // el «sello de tiempo» del audio: valor = instante de archivo / 100
const clip = (o: Partial<Clip>): Clip => VM.makeClip('video', { id: 'c', mediaId: 'm', inP: 0, outP: 10, ...o });

async function readAll(src: PcmSource, from: number, n: number, block = 480) {
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += block) {
    const k = Math.min(block, n - i);
    await src.read(from + i / SR, 1 / SR, k, L.subarray(i, i + k), R.subarray(i, i + k));
  }
  return { L, R };
}

describe('audio de un clip con curva de velocidad', () => {
  it('la muestra a los l s de salida es la del instante de archivo que dice el mapa de tiempo (y el estéreo se conserva)', async () => {
    const curve: SpeedCurve = { pts: [{ s: 0, v: 0.5 }, { s: 10, v: 4 }] };
    const c = clip({ curve });
    const src = new ClipTimeSource(c, async () => new FnSource(ramp));
    const D = clipDurationOf(c);
    const n = Math.floor(D * SR) - 2000;
    const { L, R } = await readAll(src, 0, n);
    let worst = 0;
    for (let i = 0; i < n; i += 997) {
      const want = ramp(sourceAtLocal(c, i / SR));
      worst = Math.max(worst, Math.abs(L[i] - want));
      expect(R[i]).toBeCloseTo(-L[i], 6);
    }
    expect(worst).toBeLessThan(2e-4); // 0,02 s de archivo de tolerancia a 100 s/unidad
  });

  it('el audio y el video comparten mapa: la duración que ve el mezclador es la del clip', () => {
    const c = clip({ curve: { pts: [{ s: 0, v: 2 }, { s: 10, v: 0.5 }], smooth: true } });
    let p = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
    p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'a', duration: 10 });
    p = VM.addClip(p, 'V', c);
    const entries = buildProjectMixEntries(p, VM.projectDuration(p), () => async () => new FnSource(ramp), () => true);
    expect(entries).toHaveLength(1);
    expect(entries[0].end - entries[0].start).toBeCloseTo(VM.clipDuration(c), 12);
    expect(entries[0].speed).toBe(1);
    expect(entries[0].inP).toBe(0);
    expect(needsTimeSource(c)).toBe(true);
    expect(needsTimeSource(clip({}))).toBe(false);
  });

  it('con el mezclador real: el instante de salida t suena con el contenido del instante de archivo esperado', async () => {
    const curve: SpeedCurve = { pts: [{ s: 0, v: 1 }, { s: 6, v: 3 }], smooth: false };
    const c = clip({ curve, start: 0.5, outP: 6, volume: 1 });
    const e: MixEntry = {
      start: c.start,
      end: c.start + clipDurationOf(c),
      inP: 0,
      outP: clipDurationOf(c) + 1,
      speed: 1,
      fx: { volume: 1, hp: 0, lp: 24000, echo: 0, gate: false },
      open: async () => new ClipTimeSource(c, async () => new FnSource(ramp)),
    };
    const m = new TimelineMixer([e], { eq: { low: 0, mid: 0, high: 0 }, normalize: false }, e.end);
    const blk = await m.render(Math.round(e.end * SR));
    for (const t of [0.7, 1.2, 1.9, 2.4]) {
      const i = Math.round(t * SR);
      const want = ramp(sourceAtLocal(c, t - c.start));
      expect(Math.abs(blk.L[i] - want)).toBeLessThan(3e-4);
    }
    m.close();
  });
});

describe('audio invertido por bloques', () => {
  it('suena de atrás adelante: la muestra a los l s es la del instante outP − l·v', async () => {
    const c = clip({ inP: 1, outP: 9, speed: 2, reverse: true });
    let opens = 0;
    const src = new ClipTimeSource(c, async () => (opens++, new FnSource(ramp)));
    const n = Math.floor(clipDurationOf(c) * SR) - 500;
    const { L } = await readAll(src, 0, n);
    for (let i = 0; i < n; i += 1009) {
      const want = ramp(Math.min(9, 9 - (i / SR) * 2));
      expect(Math.abs(L[i] - want)).toBeLessThan(2e-4);
    }
    // decodificó por bloques de 2 s de archivo: varios (no el archivo entero de una vez)
    expect(opens).toBeGreaterThanOrEqual(3);
    src.close();
  });

  it('memoria acotada: un bloque (2 s) a la vez aunque el clip dure 1 hora', async () => {
    let maxRequested = 0;
    const openAt = async () =>
      ({
        async read(s: number, step: number, n: number, L: Float32Array, R: Float32Array) {
          maxRequested = Math.max(maxRequested, n);
          for (let i = 0; i < n; i++) L[i] = R[i] = ramp(s + i * step);
        },
        close() {},
      }) as PcmSource;
    const rs = new ReverseAudioSource(openAt);
    const L = new Float32Array(480);
    const R = new Float32Array(480);
    // de la hora 1 hacia atrás: 5 s de audio
    let s = 3600;
    for (let i = 0; i < 500; i++) {
      await rs.read(s, -1 / SR, 480, L, R);
      s -= 480 / SR;
    }
    expect(maxRequested).toBeLessThanOrEqual(2.2 * SR); // nunca se pidió más que un bloque
    expect(rs.loads).toBeLessThan(6);
    rs.close();
  });

  it('curva + invertido: sigue el mapa de tiempo hacia atrás', async () => {
    const curve: SpeedCurve = { pts: [{ s: 0, v: 1 }, { s: 8, v: 4 }] };
    const c = clip({ outP: 8, curve, reverse: true });
    const src = new ClipTimeSource(c, async () => new FnSource(ramp));
    const n = Math.floor(clipDurationOf(c) * SR) - 400;
    const { L } = await readAll(src, 0, n);
    for (let i = 0; i < n; i += 1511) expect(Math.abs(L[i] - ramp(sourceAtLocal(c, i / SR)))).toBeLessThan(3e-4);
  });
});

describe('bucle y congelado en el audio', () => {
  it('bucle: cada pasada vuelve a empezar; con fundido cruzado las dos pasadas suman ganancia 1', async () => {
    const c = clip({ inP: 0, outP: 2, loop: { n: 3, xf: 0.5 } });
    const src = new ClipTimeSource(c, async () => new FnSource((s) => 0.5 + 0 * s)); // contenido constante 0,5
    const D = clipDurationOf(c); // 3·2 − 2·0,5 = 5
    expect(D).toBe(5);
    const { L } = await readAll(src, 0, Math.floor(D * SR) - 100);
    // en medio de los fundidos (1,75 s y 3,25 s) la suma de ganancias es 1 → sigue valiendo 0,5
    for (const t of [0.3, 1.75, 1.6, 3.25, 4]) expect(L[Math.round(t * SR)]).toBeCloseTo(0.5, 3);
  });

  it('bucle sin fundido: la muestra a los l s es la de (l mod pasada)', async () => {
    const c = clip({ inP: 1, outP: 3, loop: { n: 3 } });
    const src = new ClipTimeSource(c, async () => new FnSource(ramp, false));
    const { L } = await readAll(src, 0, Math.floor(6 * SR) - 100);
    for (const t of [0.5, 2.5, 4.25, 5.5]) expect(L[Math.round(t * SR)]).toBeCloseTo(ramp(1 + (t % 2)), 3);
  });

  it('congelado: sin sonido', async () => {
    const c = clip({ inP: 3, outP: 3.04, freeze: 2 });
    const src = new ClipTimeSource(c, async () => new FnSource(() => 0.7));
    const { L } = await readAll(src, 0, 4800);
    expect(Math.max(...Array.from(L).map(Math.abs))).toBe(0);
  });
});

describe('conservar el tono', () => {
  /** frecuencia estimada por cruces por cero ascendentes */
  const freq = (x: Float32Array, from: number, to: number) => {
    let z = 0;
    for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) z++;
    return z / ((to - from) / SR);
  };
  const sine = (hz: number) => (s: number) => 0.8 * Math.sin(2 * Math.PI * hz * s);

  it('a 2× la salida dura la mitad y el tono sigue siendo 440 Hz (sin conservar, sube a 880 Hz)', async () => {
    const c = clip({ inP: 0, outP: 8, speed: 2, pitch: true });
    const keep = new PitchTimeSource(c, async () => new FnSource(sine(440)));
    const n = SR * 3;
    const { L } = await readAll(keep, 0, n, 480);
    const f = freq(L, SR / 2, n - SR / 2);
    expect(f).toBeGreaterThan(425);
    expect(f).toBeLessThan(455);
    // energía estable: sin huecos de grano (rms de bloques de 50 ms entre 0,5 y 2,5 s)
    let min = Infinity;
    for (let i = SR / 2; i < n - SR / 2; i += 2400) {
      let e = 0;
      for (let j = 0; j < 2400; j++) e += L[i + j] * L[i + j];
      min = Math.min(min, Math.sqrt(e / 2400));
    }
    expect(min).toBeGreaterThan(0.4); // 0,8/√2 = 0,566 nominal
    const plain = new ClipTimeSource(clip({ inP: 0, outP: 8, curve: { pts: [{ s: 0, v: 2 }] } }), async () => new FnSource(sine(440)));
    const p2 = await readAll(plain, 0, n, 480);
    expect(freq(p2.L, SR / 2, n - SR / 2)).toBeGreaterThan(860);
  });

  it('a 0,5× también conserva el tono y no suena antes de tiempo ni se corta al principio', async () => {
    const c = clip({ inP: 0, outP: 4, speed: 0.5, pitch: true });
    const keep = new PitchTimeSource(c, async () => new FnSource(sine(300)));
    const { L } = await readAll(keep, 0, SR * 2, 480);
    const f = freq(L, SR / 4, SR * 2 - SR / 4);
    expect(f).toBeGreaterThan(285);
    expect(f).toBeLessThan(315);
    // desde el primer 20 ms ya suena a tope (sin fundido de entrada artificial)
    let e = 0;
    for (let i = 960; i < 1920; i++) e += L[i] * L[i];
    expect(Math.sqrt(e / 960)).toBeGreaterThan(0.4);
  });
});
