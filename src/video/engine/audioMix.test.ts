// V7: mezclador con pistas (ducking, dB, panorámica, solo), fundido cruzado, plan de mezcla desde un proyecto,
// normalización a LUFS en dos pasadas y campos de audio del modelo (saneado idempotente, proyectos viejos intactos).
import { describe, expect, it } from 'vitest';
import { LoudnessMeter, toDb } from '../audio/loudness';
import { setClipAudio, setMediaBeats, setProjectAudio, setTrackMix } from '../audio/mixOps';
import { clipBeatTimes, nearestBeat, projectBeatMarks } from '../audio/beatMarks';
import { DEFAULT_DUCK } from '../audio/duck';
import * as VM from '../model';
import { normalizeV2 } from '../model/migrate';
import { crossfadeWindows, planProjectMix, resolveTrackPlan } from './audioPlan';
import { solveLoudnessGain } from './loudnessPass';
import { TimelineMixer, type MixEntry, type PcmSource } from './mixer';

const SR = 48000;

class SineSource implements PcmSource {
  constructor(private freq: number, private amp: number, private active?: (t: number) => boolean) {}
  async read(srcStart: number, step: number, n: number, L: Float32Array, R: Float32Array) {
    for (let i = 0; i < n; i++) {
      const t = srcStart + i * step;
      const on = this.active ? this.active(t) : true;
      const v = on ? this.amp * Math.sin(2 * Math.PI * this.freq * t) : 0;
      L[i] = v;
      R[i] = v;
    }
  }
  close() {}
}

const entry = (o: Partial<MixEntry> & { src: PcmSource }): MixEntry => ({
  start: 0,
  end: 4,
  inP: 0,
  outP: 4,
  speed: 1,
  fx: { volume: 1, hp: 0, lp: 24000, echo: 0, gate: false },
  open: async () => o.src,
  ...o,
});

async function renderAll(m: TimelineMixer) {
  const L = new Float32Array(m.totalSamples);
  const R = new Float32Array(m.totalSamples);
  while (!m.finished) {
    const b = await m.render(4800);
    L.set(b.L, b.startSample);
    R.set(b.R, b.startSample);
  }
  return { L, R };
}
const rms = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const master = { eq: { low: 0, mid: 0, high: 0 }, normalize: false };

describe('mezclador con pistas', () => {
  it('sin pistas configuradas la salida es la de V6 (sin retardo: alineada con la entrada)', async () => {
    const e = entry({ src: new SineSource(440, 0.2) });
    const m = new TimelineMixer([e], master, 1);
    const { L } = await renderAll(m);
    for (const i of [0, 1, 100, 5000, 40000]) expect(L[i]).toBeCloseTo(0.2 * Math.sin((2 * Math.PI * 440 * i) / SR), 5);
  });

  it('ducking: la música baja X dB durante la voz (medido en la salida mezclada) y vuelve después', async () => {
    const X = 12;
    const voice = entry({ src: new SineSource(180, 0.25, (t) => t >= 1 && t < 2.5), trackId: 'V' });
    const music = entry({ src: new SineSource(330, 0.2), trackId: 'M' });
    const mk = (duckOn: boolean) =>
      new TimelineMixer([voice, music], master, 4, SR, {
        V: { fx: {}, key: [] },
        M: { fx: duckOn ? { duck: { ...DEFAULT_DUCK, on: true, db: X } } : {}, key: duckOn ? ['V'] : [] },
      });
    // para aislar la música se mide una mezcla sin la voz audible: voz muda en la salida pero activa de control
    const withDuck = await renderAll(mk(true));
    const without = await renderAll(mk(false));
    // la voz es de 180 Hz y la música de 330 Hz: se separan con el análisis de potencia por correlación con un seno de 330 Hz
    const tone = (x: Float32Array, a: number, b: number) => {
      let c = 0, s = 0;
      for (let i = a; i < b; i++) {
        c += x[i] * Math.cos((2 * Math.PI * 330 * i) / SR);
        s += x[i] * Math.sin((2 * Math.PI * 330 * i) / SR);
      }
      return Math.hypot(c, s) / (b - a);
    };
    const dbDuring = toDb(tone(withDuck.L, Math.round(1.3 * SR), Math.round(2.4 * SR))) - toDb(tone(without.L, Math.round(1.3 * SR), Math.round(2.4 * SR)));
    expect(dbDuring).toBeLessThan(-X + 0.3);
    expect(dbDuring).toBeGreaterThan(-X - 0.5);
    const before = toDb(tone(withDuck.L, Math.round(0.2 * SR), Math.round(0.9 * SR))) - toDb(tone(without.L, Math.round(0.2 * SR), Math.round(0.9 * SR)));
    expect(Math.abs(before)).toBeLessThan(0.1);
    const after = toDb(tone(withDuck.L, Math.round(3.6 * SR), Math.round(3.95 * SR))) - toDb(tone(without.L, Math.round(3.6 * SR), Math.round(3.95 * SR)));
    expect(after).toBeGreaterThan(-1);
    // las estadísticas de pista informan de la bajada
    const m = mk(true);
    await renderAll(m);
    expect(m.trackStats().M.minDuckDb).toBeLessThan(-X + 0.5);
  });

  it('dB y panorámica de pista: −6 dB baja a la mitad; pan a la derecha deja L en silencio con potencia constante', async () => {
    const src = () => new SineSource(500, 0.2);
    const run = async (fx: object) => renderAll(new TimelineMixer([entry({ src: src(), trackId: 'T' })], master, 1, SR, { T: { fx, key: [] } }));
    const base = await run({});
    const quiet = await run({ gainDb: -6.0206 });
    expect(rms(quiet.L, 1000, 40000) / rms(base.L, 1000, 40000)).toBeCloseTo(0.5, 3);
    const right = await run({ pan: 1 });
    expect(rms(right.L, 1000, 40000)).toBeLessThan(1e-6);
    expect(rms(right.R, 1000, 40000) / rms(base.R, 1000, 40000)).toBeCloseTo(Math.SQRT2, 3);
    // potencia total constante a cualquier pan
    for (const pan of [-0.7, -0.3, 0.4, 0.9]) {
      const o = await run({ pan });
      const p = rms(o.L, 1000, 40000) ** 2 + rms(o.R, 1000, 40000) ** 2;
      const p0 = rms(base.L, 1000, 40000) ** 2 + rms(base.R, 1000, 40000) ** 2;
      expect(p / p0).toBeCloseTo(1, 3);
    }
  });

  it('EQ de pista: un pico de +6 dB a 1 kHz sube ese tono 6 dB', async () => {
    const run = async (eq?: object[]) => renderAll(new TimelineMixer([entry({ src: new SineSource(1000, 0.1), trackId: 'T' })], master, 1, SR, { T: { fx: eq ? { eq: eq as never } : {}, key: [] } }));
    const a = await run();
    const b = await run([{ type: 'peak', f: 1000, g: 6, q: 1 }]);
    expect(toDb(rms(b.L, 24000, 47000)) - toDb(rms(a.L, 24000, 47000))).toBeCloseTo(6, 1);
  });

  it('fundido cruzado: potencia constante en la unión y empalme sin salto', async () => {
    const h = 0.1;
    const a = entry({ src: new SineSource(300, 0.3), start: 0, end: 1, inP: 0, outP: 1, trackId: 'T', xfOut: { post: h, len: 2 * h } });
    const b = entry({ src: new SineSource(450, 0.3), start: 1, end: 2, inP: h, outP: 2, trackId: 'T', xfIn: { pre: h, len: 2 * h } });
    // b empieza h antes: lee el archivo desde inP − h (aquí la fuente es un seno continuo, vale cualquier instante)
    b.inP = h;
    const m = new TimelineMixer([a, b], master, 2, SR, { T: { fx: {}, key: [] } });
    const { L } = await renderAll(m);
    // potencia (ventana de 20 ms) a lo largo del fundido: ≈ constante, e igual que fuera
    const pw = (t: number) => rms(L, Math.round(t * SR), Math.round((t + 0.02) * SR)) ** 2;
    const outside = pw(0.5);
    for (const t of [0.9, 0.93, 0.96, 0.99, 1.02, 1.05, 1.08]) expect(pw(t) / outside).toBeGreaterThan(0.8);
    for (const t of [0.9, 0.95, 1.0, 1.05, 1.08]) expect(pw(t) / outside).toBeLessThan(1.25);
    // sin el fundido hay un hueco de potencia en un corte seco entre dos tonos desfasados? (control: sin xf la potencia en el corte es la de un solo clip)
  });
});

describe('plan de mezcla del proyecto', () => {
  const base = () => {
    let p = VM.createProject();
    p = VM.addTrack(p, 'video', { id: 'V' });
    p = VM.addTrack(p, 'audio', { id: 'A' });
    p = VM.addTrack(p, 'audio', { id: 'M' });
    for (const id of ['x', 'y']) p = VM.addMedia(p, { id, kind: 'audio', name: id, duration: 10 });
    return p;
  };
  const open = () => () => async () => null;

  it('silencio y solo: con una pista en solo, solo suena esa (y también al exportar)', () => {
    let p = base();
    expect([...resolveTrackPlan(p).values()].every((t) => t.active)).toBe(true);
    p = setTrackMix(p, 'A', { solo: true });
    const pl = resolveTrackPlan(p);
    expect(pl.get('A')!.active).toBe(true);
    expect(pl.get('M')!.active).toBe(false);
    expect(pl.get('V')!.active).toBe(false);
    p = VM.updateTrack(p, 'A', { muted: true });
    expect(resolveTrackPlan(p).get('A')!.active).toBe(false);
  });

  it('ducking: las pistas de control son las demás activas sin ducking; sin bucles; `by` limita', () => {
    let p = base();
    p = setTrackMix(p, 'M', { duck: { on: true, db: 10 } });
    expect(resolveTrackPlan(p).get('M')!.key.sort()).toEqual(['A', 'V']);
    p = setTrackMix(p, 'A', { duck: { on: true, db: 6 } }); // A también baja: ya no puede ser control
    expect(resolveTrackPlan(p).get('M')!.key).toEqual(['V']);
    p = setTrackMix(p, 'A', { duck: null });
    p = setTrackMix(p, 'M', { duck: { by: ['A'] } });
    expect(resolveTrackPlan(p).get('M')!.key).toEqual(['A']);
    p = VM.updateTrack(p, 'A', { muted: true });
    expect(resolveTrackPlan(p).get('M')!.key).toEqual([]);
  });

  it('planProjectMix: entradas con su pista; las pistas silenciadas no aportan', () => {
    let p = base();
    p = VM.addClip(p, 'A', VM.makeClip('audio', { id: 'a1', mediaId: 'x', start: 0, inP: 0, outP: 3 }));
    p = VM.addClip(p, 'M', VM.makeClip('audio', { id: 'm1', mediaId: 'y', start: 0, inP: 0, outP: 3 }));
    const plan = planProjectMix(p, 5, open(), () => true);
    expect(plan.entries.map((e) => e.trackId).sort()).toEqual(['A', 'M']);
    p = VM.updateTrack(p, 'M', { muted: true });
    expect(planProjectMix(p, 5, open(), () => true).entries.map((e) => e.trackId)).toEqual(['A']);
    expect(plan.master.ceilingDb).toBeLessThanOrEqual(-1);
  });

  it('fundido cruzado en uniones: usa los márgenes del archivo, se acorta sin margen y no actúa en continuaciones', () => {
    let p = base();
    p = setProjectAudio(p, { xfade: 0.4 });
    p = VM.addClip(p, 'A', VM.makeClip('audio', { id: 'c1', mediaId: 'x', start: 0, inP: 1, outP: 4 }));
    p = VM.addClip(p, 'A', VM.makeClip('audio', { id: 'c2', mediaId: 'y', start: 3, inP: 2, outP: 5 }));
    const w = crossfadeWindows(p, VM.findTrack(p, 'A')!, 0.4);
    expect(w.get('c1')!.out!.post).toBeCloseTo(0.2, 6);
    expect(w.get('c2')!.in!.pre).toBeCloseTo(0.2, 6);
    expect(w.get('c1')!.out!.len).toBeCloseTo(0.4, 6);
    // sin margen a la entrada del segundo (inP 0): la ventana se acorta a lo que ofrece el primer clip
    let q = VM.updateClip(p, 'c2', { inP: 0, outP: 3 });
    q = VM.updateClip(q, 'c1', { inP: 1, outP: 9.9 }); // casi sin margen a la salida del primero (10 − 9,9)
    const w2 = crossfadeWindows(q, VM.findTrack(q, 'A')!, 0.4);
    const c1 = w2.get('c1')?.out;
    if (c1) expect(c1.len).toBeLessThan(0.15);
    // continuación (mismo archivo, punto contiguo): no hay fundido
    let r = base();
    r = VM.addClip(r, 'A', VM.makeClip('audio', { id: 'd1', mediaId: 'x', start: 0, inP: 0, outP: 2 }));
    r = VM.addClip(r, 'A', VM.makeClip('audio', { id: 'd2', mediaId: 'x', start: 2, inP: 2, outP: 4 }));
    expect(crossfadeWindows(r, VM.findTrack(r, 'A')!, 0.4).size).toBe(0);
    expect(crossfadeWindows(p, VM.findTrack(p, 'A')!, 0).size).toBe(0);
    // el plan reparte las ventanas por entrada
    const plan = planProjectMix(p, 6, open(), () => true);
    const e1 = plan.entries.find((e) => e.start === 0)!;
    const e2 = plan.entries.find((e) => e.start === 3)!;
    expect(e1.xfOut?.post).toBeCloseTo(0.2, 6);
    expect(e2.xfIn?.pre).toBeCloseTo(0.2, 6);
  });
});

describe('normalización a LUFS en dos pasadas', () => {
  const run = (fx: MixEntry['fx'], amp: number, secs = 6) => {
    const make = (gainDb: number) => new TimelineMixer([entry({ src: new SineSource(1000, amp), end: secs, outP: secs, fx })], { ...master, gainDb, ceilingDb: -1.3 }, secs);
    return make;
  };
  const measure = async (make: (g: number) => TimelineMixer, gain: number) => {
    const m = make(gain);
    const meter = new LoudnessMeter(SR);
    while (!m.finished) {
      const b = await m.render(SR);
      meter.process(b.L, b.R, b.frames);
    }
    return meter;
  };
  const fx = { volume: 1, hp: 0, lp: 24000, echo: 0, gate: false };

  it.each([-14, -16, -23])('lleva una señal baja a %i LUFS (±0,1) sin pasar de −1 dBTP', async (target) => {
    const make = run(fx, 0.03); // ≈ −30 dBFS
    const solve = await solveLoudnessGain(make, target, { ceilingDb: -1.3 });
    expect(solve.silent).toBe(false);
    const meter = await measure(make, solve.gainDb);
    expect(meter.integrated()).toBeGreaterThan(target - 0.1);
    expect(meter.integrated()).toBeLessThan(target + 0.1);
    expect(meter.truePeakDb()).toBeLessThanOrEqual(-1);
  });

  it('con picos fuertes el limitador actúa: se corrige la ganancia hasta quedar a ±0,1 LU', async () => {
    // tono continuo + un chasquido de 5 ms por segundo: muy picudo respecto a su sonoridad
    const make = (gainDb: number) => {
      const spike = new SineSource(3000, 0.9, (t) => t % 1 > 0.5 && t % 1 < 0.505);
      return new TimelineMixer([entry({ src: new SineSource(1000, 0.3), end: 8, outP: 8 }), entry({ src: spike, end: 8, outP: 8 })], { ...master, gainDb, ceilingDb: -1.3 }, 8);
    };
    const solve = await solveLoudnessGain(make, -8, { ceilingDb: -1.3 });
    expect(solve.passes).toBeGreaterThan(1);
    const meter = await measure(make, solve.gainDb);
    expect(Math.abs(meter.integrated() - -8)).toBeLessThan(0.1);
    expect(meter.truePeakDb()).toBeLessThanOrEqual(-1);
  });

  it('silencio: no hay nada que normalizar', async () => {
    const solve = await solveLoudnessGain(run(fx, 0), -14, { ceilingDb: -1.3 });
    expect(solve.silent).toBe(true);
    expect(solve.gainDb).toBe(0);
  });
});

describe('campos de audio del modelo (V7)', () => {
  const proj = () => {
    let p = VM.createProject();
    p = VM.addTrack(p, 'audio', { id: 'A' });
    p = VM.addMedia(p, { id: 'x', kind: 'audio', name: 'x', duration: 10, blob: new Blob(['x']) });
    p = VM.addClip(p, 'A', VM.makeClip('audio', { id: 'c', mediaId: 'x', start: 0, inP: 0, outP: 4 }));
    return p;
  };
  const roundtrip = (p: VM.VideoProject) => normalizeV2(JSON.parse(JSON.stringify(p)));

  it('un proyecto sin ajustes de audio se lee igual que antes: no gana ningún campo', () => {
    const p = proj();
    const q = roundtrip(p);
    const keys = (o: object) => JSON.stringify(Object.keys(o).sort());
    expect(keys(q.tracks[0])).toBe(keys(p.tracks[0]));
    const ck = (c: object) => JSON.stringify(Object.keys(c).filter((k) => k !== 'name').sort());
    expect(ck(q.tracks[0].clips[0])).toBe(ck(p.tracks[0].clips[0]));
    expect(q.audio).toBeUndefined();
    expect(q.media.x.beats).toBeUndefined();
  });

  it('pan, dB, EQ, ruido, mezclador, ducking, audio del proyecto y ritmo se guardan y leen (idempotente)', () => {
    let p = proj();
    p = setClipAudio(p, 'c', { pan: -0.4, gainDb: 3.5, denoise: 0.6, eq: [{ type: 'peak', f: 1000, g: 4, q: 1 }] });
    p = setTrackMix(p, 'A', { gainDb: -3, pan: 0.2, solo: true, eq: [{ type: 'lowshelf', f: 100, g: 2, q: 0.7 }], duck: { on: true, db: 9 } });
    p = setProjectAudio(p, { loud: { on: true, target: -16 }, xfade: 0.2, beatSnap: true, eq: [{ type: 'highshelf', f: 8000, g: -3, q: 0.7 }] });
    p = setMediaBeats(p, 'x', { bpm: 120, beats: [0.5, 1, 1.5, 2] });
    const q = roundtrip(p);
    expect(q.tracks[0].clips[0].pan).toBe(-0.4);
    expect(q.tracks[0].clips[0].gainDb).toBe(3.5);
    expect(q.tracks[0].clips[0].denoise).toBe(0.6);
    expect(q.tracks[0].clips[0].eq).toHaveLength(1);
    expect(q.tracks[0].gainDb).toBe(-3);
    expect(q.tracks[0].solo).toBe(true);
    expect(q.tracks[0].duck).toMatchObject({ on: true, db: 9 });
    expect(q.audio).toMatchObject({ loud: { on: true, target: -16 }, xfade: 0.2, beatSnap: true });
    expect(q.media.x.beats!.beats).toEqual([0.5, 1, 1.5, 2]);
    expect(JSON.stringify(roundtrip(q))).toBe(JSON.stringify(q));
  });

  it('valores neutros quitan el campo; datos corruptos se descartan', () => {
    let p = proj();
    p = setClipAudio(p, 'c', { pan: 0.5 });
    expect(VM.findClip(p, 'c')!.clip.pan).toBe(0.5);
    p = setClipAudio(p, 'c', { pan: 0 });
    expect('pan' in VM.findClip(p, 'c')!.clip).toBe(false);
    p = setClipAudio(p, 'c', { eq: [{ type: 'peak', f: 1000, g: 0, q: 1 }] });
    expect('eq' in VM.findClip(p, 'c')!.clip).toBe(false);
    const same = setClipAudio(p, 'c', { gainDb: 0 });
    expect(same).toBe(p);
    const bad = normalizeV2({ ...JSON.parse(JSON.stringify(p)), audio: { loud: { on: true, target: 'x' }, xfade: -3, eq: 7 }, tracks: [{ id: 'A', kind: 'audio', name: 'a', clips: [{ id: 'c', kind: 'audio', mediaId: 'x', start: 0, inP: 0, outP: 1, speed: 1, volume: 1, effect: 'none', fadeIn: 0, fadeOut: 0, audioFadeIn: 0, audioFadeOut: 0, pan: 99, gainDb: 'a', denoise: -1, eq: 'zzz', transform: {} }], duck: { on: true, db: 999 } }] });
    const c = bad.tracks[0].clips[0];
    expect(c.pan).toBe(1);
    expect(c.gainDb).toBeUndefined();
    expect(c.denoise).toBeUndefined();
    expect(c.eq).toBeUndefined();
    expect(bad.tracks[0].duck!.db).toBe(40);
    expect(bad.audio).toBeUndefined();
  });

  it('pistas bloqueadas: el clip no cambia; el mezclador de pista sí (como silenciar)', () => {
    let p = proj();
    p = VM.updateTrack(p, 'A', { locked: true });
    expect(setClipAudio(p, 'c', { pan: 1 })).toBe(p);
    expect(setTrackMix(p, 'A', { gainDb: -6 }).tracks[0].gainDb).toBe(-6);
  });

  it('marcas de ritmo: caen dentro del clip con su velocidad; imán a las marcas; nearestBeat', () => {
    let p = proj();
    p = setMediaBeats(p, 'x', { bpm: 120, beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4.5] });
    p = VM.updateClip(p, 'c', { start: 10, inP: 1, outP: 3 });
    expect(clipBeatTimes(p, VM.findClip(p, 'c')!.clip)).toEqual([10, 10.5, 11, 11.5]);
    p = VM.updateClip(p, 'c', { speed: 2 });
    expect(clipBeatTimes(p, VM.findClip(p, 'c')!.clip)).toEqual([10, 10.25, 10.5, 10.75]);
    expect(projectBeatMarks(p)).toHaveLength(4);
    expect(nearestBeat([10, 10.25, 10.5], 10.23, 0.05)).toBe(10.25);
    expect(nearestBeat([10, 10.25, 10.5], 10.4, 0.05)).toBeNull();
    // el imán de la línea de tiempo usa las marcas solo si está activado
    const off = VM.snapTime(p, 10.26, { threshold: 0.03 });
    expect(off.target).toBeNull();
    const on = VM.snapTime(setProjectAudio(p, { beatSnap: true }), 10.26, { threshold: 0.03 });
    expect(on.target).toBe('beat');
    expect(on.time).toBeCloseTo(10.25, 6);
  });
});
