import { describe, expect, it } from 'vitest';
import * as VM from '../model';
import { clipDurationOf } from './clipTime';
import {
  applyPerfectLoop,
  audioJoinCost,
  findAudioLoop,
  findLoopCandidates,
  joinQuality,
  lumaDiff,
  nearestZeroCrossing,
  planScanTimes,
  snapToZeroCrossings,
  zeroCrossings,
  type LumaSample,
} from './perfectLoop';

const W = 32;
const H = 18;
/** Fotograma sintético periódico de periodo P: un patrón que gira con la fase t/P. */
const frame = (t: number, P: number): Float32Array => {
  const px = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = 128 + 100 * Math.sin((2 * Math.PI * t) / P + x * 0.35 + y * 0.21);
  return px;
};
const sample = (P: number) => (t: number): LumaSample => ({ t, px: frame(t, P) });

/** Escanea el plan con una función de fotograma y devuelve los candidatos. */
function scan(P: number, range: { inP: number; outP: number }, o: Parameters<typeof planScanTimes>[1], dur = 60) {
  const plan = planScanTimes(range, o, 1 / 12, dur)!;
  const s = sample(P);
  return { plan, cands: findLoopCandidates(plan.starts.map(s), plan.ends.map(s), o, { start: plan.startNeighbor, end: plan.endNeighbor }) };
}

describe('plan de muestreo', () => {
  it('cubre el inicio y la ventana final, y añade el fotograma siguiente solo si cabe en el archivo', () => {
    const p = planScanTimes({ inP: 0, outP: 10 }, { endWindow: 2, startWindow: 0.5, minLen: 1 }, 1 / 12, 12)!;
    expect(p.starts[0]).toBe(0);
    expect(p.ends[0]).toBeCloseTo(10 - 2);
    expect(p.ends[p.ends.length - 2]).toBeCloseTo(10);
    expect(p.endNeighbor).toBe(true);
    expect(planScanTimes({ inP: 0, outP: 10 }, {}, 1 / 12, 10)!.endNeighbor).toBe(false);
  });
  it('un tramo más corto que la duración mínima no se puede analizar', () => {
    expect(planScanTimes({ inP: 0, outP: 0.5 }, { minLen: 1 })).toBeNull();
  });
  it('los finales respetan la duración mínima', () => {
    const p = planScanTimes({ inP: 0, outP: 3 }, { endWindow: 10, minLen: 2 }, 1 / 12, 50)!;
    expect(p.ends.filter((_, i) => !(p.endNeighbor && i === p.ends.length - 1)).every((t) => t >= 2 - 1e-6)).toBe(true);
  });
});

describe('unión de imagen', () => {
  it('lumaDiff: 0 iguales, 1 blanco contra negro', () => {
    expect(lumaDiff([10, 20], [10, 20])).toBe(0);
    expect(lumaDiff([0, 0], [255, 255])).toBe(1);
  });

  it('sobre un clip periódico (P = 2 s, múltiplo del paso) la unión elegida coincide con el período', () => {
    const { cands } = scan(2, { inP: 0, outP: 10 }, { endWindow: 3, startWindow: 0, minLen: 1 }, 12);
    const best = cands[0];
    expect(best.inP).toBe(0);
    expect(((best.outP - best.inP) / 2) % 1).toBeCloseTo(0, 6); // múltiplo del período
    expect(best.outP).toBeCloseTo(10); // entre empates, el bucle más largo
    expect(best.diff).toBeLessThan(0.001);
    expect(joinQuality(best.diff).label).toBe('Perfecta');
  });

  it('con un período que no cae en el paso (1,7 s) la unión queda a menos de medio paso de un múltiplo', () => {
    const P = 1.7;
    const { cands } = scan(P, { inP: 0, outP: 9.4 }, { endWindow: 3.5, startWindow: 0, minLen: 1 }, 20);
    const len = cands[0].outP - cands[0].inP;
    const k = Math.round(len / P);
    expect(Math.abs(len - k * P)).toBeLessThanOrEqual(1 / 12 / 2 + 1e-9);
    expect(joinQuality(cands[0].diff).level).toBeLessThanOrEqual(1);
  });

  it('mover el inicio también cuenta: si el clip empieza fuera de fase, se corrige el inicio', () => {
    // el recorte empieza en 0,5 s y acaba en 9,5: con inicio fijo y final libre, el mejor final ya cuadra
    const { cands } = scan(2, { inP: 0.5, outP: 9.5 }, { endWindow: 2, startWindow: 1, minLen: 1 }, 12);
    const len = cands[0].outP - cands[0].inP;
    expect((len / 2) % 1).toBeCloseTo(0, 5);
    expect(cands[0].inP).toBeGreaterThanOrEqual(0.5);
    expect(cands[0].inP).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it('devuelve varios candidatos distintos, de mejor a peor', () => {
    const { cands } = scan(2, { inP: 0, outP: 10 }, { endWindow: 5, startWindow: 0, minLen: 1, top: 3 }, 12);
    expect(cands.length).toBe(3);
    expect(cands[0].cost).toBeLessThanOrEqual(cands[1].cost + 0.002);
    expect(new Set(cands.map((c) => c.outP)).size).toBe(3);
  });

  it('un clip que no se repite (una rampa) da una unión que se nota', () => {
    const ramp = (t: number): LumaSample => ({ t, px: new Float32Array(W * H).fill(Math.min(255, t * 25)) });
    const plan = planScanTimes({ inP: 0, outP: 10 }, { endWindow: 2, startWindow: 0, minLen: 1 }, 1 / 12, 12)!;
    const c = findLoopCandidates(plan.starts.map(ramp), plan.ends.map(ramp), { endWindow: 2, startWindow: 0, minLen: 1 }, { start: plan.startNeighbor, end: plan.endNeighbor });
    expect(joinQuality(c[0].diff).level).toBe(3);
  });

  it('la duración mínima manda aunque exista un empate mejor más corto', () => {
    const { cands } = scan(2, { inP: 0, outP: 10 }, { endWindow: 9, startWindow: 0, minLen: 7 }, 12);
    for (const c of cands) expect(c.outP - c.inP).toBeGreaterThanOrEqual(7 - 1e-9);
  });
});

describe('unión de audio', () => {
  const sr = 48000;
  const sine = (f: number, sec: number, ph = 0) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => Math.sin(2 * Math.PI * f * (i / sr) + ph));

  it('nearestZeroCrossing encuentra el cruce ascendente más cercano', () => {
    const s = sine(440, 1);
    const t = nearestZeroCrossing(s, sr, 0.5001, 0.01)!;
    expect(t).toBeCloseTo(0.5, 4);
    expect(nearestZeroCrossing(s, sr, 0.5 + 1 / 880 + 1e-4, 0.01)!).toBeCloseTo(0.5 + 1 / 440, 4);
  });
  it('no inventa un cruce si no lo hay en la ventana', () => {
    expect(nearestZeroCrossing(new Float32Array(1000).fill(0.5), 1000, 0.5, 0.2)).toBeNull();
    expect(nearestZeroCrossing(new Float32Array(1), 1000, 0, 0.2)).toBeNull();
  });
  it('zeroCrossings cuenta los cruces ascendentes', () => {
    expect(zeroCrossings(sine(100, 1), sr, 0, 1).length).toBeGreaterThanOrEqual(99);
    expect(zeroCrossings(sine(100, 1), sr, 0, 1).length).toBeLessThanOrEqual(100);
  });
  it('snapToZeroCrossings lleva inicio y final a cruces ascendentes', () => {
    const s = sine(440, 4);
    const c = snapToZeroCrossings({ inP: 0.0031, outP: 3.0042, cost: 0, diff: 0 }, s, sr, 1 / 60);
    for (const t of [c.inP, c.outP]) {
      const k = Math.round(t * sr);
      expect(s[k - 1] <= 0.01 && s[k + 1] >= -0.01).toBe(true);
      expect(Math.abs(t * 440 - Math.round(t * 440))).toBeLessThan(0.02);
    }
  });
  it('audioJoinCost es ~0 cuando la forma de onda coincide y grande cuando no', () => {
    const s = sine(440, 2);
    expect(audioJoinCost(s, sr, 0.5, 1.5)).toBeLessThan(0.01);
    expect(audioJoinCost(s, sr, 0.5, 1.5 + 1 / 880)).toBeGreaterThan(0.5);
  });
  it('findAudioLoop: la unión cae en cruces por cero y es un múltiplo del período', () => {
    const s = sine(440, 6, 0.7);
    const c = findAudioLoop(s, sr, { inP: 0, outP: 6 }, { endWindow: 1, startWindow: 0.2, minLen: 1 });
    expect(c.length).toBeGreaterThan(0);
    const best = c[0];
    expect(((best.outP - best.inP) * 440) % 1).toBeCloseTo(0, 1);
    expect(best.cost).toBeLessThan(0.05);
    // ambos puntos son cruces ascendentes
    for (const t of [best.inP, best.outP]) {
      const k = Math.round(t * sr);
      expect(s[k - 1] <= 0.02 && s[k + 1] >= -0.02).toBe(true);
    }
  });
});

describe('aplicar el bucle', () => {
  const proj = () => {
    let p = VM.createProject();
    p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'v', duration: 12, blob: new Blob([new Uint8Array(1)]) });
    p = VM.addTrack(p, 'video', { id: 'V' });
    return VM.addClip(p, 'V', VM.makeClip('video', { id: 'c', mediaId: 'm', inP: 0, outP: 10 }));
  };
  it('recorta a la unión y activa el bucle de 3 pasadas (UN paso de deshacer)', () => {
    const p0 = proj();
    let h = VM.createHistory(p0);
    h = VM.commit(h, applyPerfectLoop(h.present, 'c', { inP: 0.5, outP: 8 }, { mediaDuration: 12 }));
    const c = VM.findClip(h.present, 'c')!.clip;
    expect(c.inP).toBe(0.5);
    expect(c.outP).toBe(8);
    expect(c.loop).toEqual({ n: 3 });
    expect(clipDurationOf(c)).toBeCloseTo(7.5 * 3);
    expect(VM.undo(h).present).toBe(p0);
  });
  it('conserva el bucle que ya tenía el clip (n y fundido)', () => {
    let p = proj();
    p = VM.updateClip(p, 'c', { loop: { n: 5, xf: 0.3 } });
    const q = applyPerfectLoop(p, 'c', { inP: 1, outP: 6 }, { mediaDuration: 12 });
    expect(VM.findClip(q, 'c')!.clip.loop).toEqual({ n: 5, xf: 0.3 });
  });
  it('no pasa del final del archivo ni deja un tramo vacío', () => {
    const q = applyPerfectLoop(proj(), 'c', { inP: 11, outP: 99 }, { mediaDuration: 12 });
    const c = VM.findClip(q, 'c')!.clip;
    expect(c.outP).toBeLessThanOrEqual(12);
    expect(c.outP).toBeGreaterThan(c.inP);
  });
  it('no toca imágenes, textos, pistas bloqueadas ni congelados', () => {
    let p = VM.createProject();
    p = VM.addTrack(p, 'video', { id: 'V' });
    p = VM.addClip(p, 'V', VM.makeClip('text', { id: 't', text: 'x' }));
    expect(applyPerfectLoop(p, 't', { inP: 0, outP: 1 })).toBe(p);
    const base = proj();
    expect(applyPerfectLoop(VM.updateTrack(base, 'V', { locked: true }), 'c', { inP: 1, outP: 5 })).not.toBe(base);
    const locked = VM.updateTrack(base, 'V', { locked: true });
    expect(applyPerfectLoop(locked, 'c', { inP: 1, outP: 5 })).toBe(locked);
    const frozen = VM.updateClip(base, 'c', { freeze: 2 });
    expect(applyPerfectLoop(frozen, 'c', { inP: 1, outP: 5 })).toBe(frozen);
  });
});
