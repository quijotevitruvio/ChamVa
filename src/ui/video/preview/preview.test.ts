import { describe, expect, it } from 'vitest';
import * as VM from '../../../video/model';
import { NearestCache } from './frameCache';
import { FrameStats } from './frameStats';
import { continuesFrom, driftCorrection, pickReleases, planPreload } from './preloadPlanner';
import { QualityController } from './quality';

function project() {
  let p = VM.createProject();
  p = VM.addTrack(p, 'video', { id: 'V', magnet: false });
  p = VM.addMedia(p, { id: 'a', kind: 'video', name: 'a.mp4', duration: 20, blob: new Blob() });
  p = VM.addMedia(p, { id: 'b', kind: 'video', name: 'b.mp4', duration: 20, blob: new Blob() });
  // A: 0–4 (archivo 0–4); B (continuación del mismo archivo): 4–8 (archivo 4–8); C otro archivo: 8–10
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'A', mediaId: 'a', start: 0, inP: 0, outP: 4 }));
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'B', mediaId: 'a', start: 4, inP: 4, outP: 8 }));
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'C', mediaId: 'b', start: 8, inP: 3, outP: 5 }));
  return p;
}

describe('planificador de precarga', () => {
  const p = project();
  it('lejos de un corte solo está el clip activo', () => {
    const plan = planPreload(p, 1, { horizon: 2 });
    expect(plan.map((i) => i.clipId)).toEqual(['A']);
    expect(plan[0]).toMatchObject({ active: true, play: true, visible: true, seekTo: 1 });
  });

  it('dentro del horizonte precarga el siguiente en su primer fotograma, sin reproducir', () => {
    const plan = planPreload(p, 6.5, { horizon: 2, lead: 0.15 });
    const c = plan.find((i) => i.clipId === 'C')!;
    expect(c).toMatchObject({ active: false, play: false, seekTo: 3 });
    expect(c.startsIn).toBeCloseTo(1.5);
  });

  it('a `lead` s del corte empieza a correr, adelantado para llegar a inP al empezar', () => {
    const c = planPreload(p, 7.9, { lead: 0.15 }).find((i) => i.clipId === 'C')!;
    expect(c.play).toBe(true);
    expect(c.seekTo).toBeCloseTo(3 - 0.1, 6);
  });

  it('si inP es 0 no puede adelantarse: espera al corte', () => {
    const q = VM.addClip(p, 'V', VM.makeClip('video', { id: 'D', mediaId: 'b', start: 10, inP: 0, outP: 2 }));
    const d = planPreload(q, 9.95, { lead: 0.15 }).find((i) => i.clipId === 'D')!;
    expect(d.play).toBe(false);
    expect(d.seekTo).toBe(0);
  });

  it('un clip dividido reutiliza el elemento del anterior (continuesFrom), otro archivo no', () => {
    const plan = planPreload(p, 3.5, { horizon: 2 });
    expect(plan.find((i) => i.clipId === 'B')?.continuesFrom).toBe('A');
    const later = planPreload(p, 7.5, { horizon: 2 });
    expect(later.find((i) => i.clipId === 'C')?.continuesFrom).toBeUndefined();
    expect(continuesFrom(p, VM.findClip(p, 'B')!.clip)?.id).toBe('A');
    expect(continuesFrom(p, VM.findClip(p, 'C')!.clip)).toBeNull();
  });

  it('respeta el máximo de clips por venir y el orden por inicio', () => {
    let q = project();
    for (let i = 0; i < 6; i++) q = VM.addClip(q, 'V', VM.makeClip('video', { id: 'X' + i, mediaId: 'b', start: 20 + i * 0.1, inP: 0, outP: 0.1 }), { mode: 'push' });
    const plan = planPreload(q, 19.5, { horizon: 2, maxUpcoming: 3 });
    expect(plan).toHaveLength(3);
    expect(plan.map((i) => i.startsIn)).toEqual([...plan.map((i) => i.startsIn)].sort((a, b) => a - b));
  });

  it('audible/visible: un clip de video en pista silenciada se ve pero no suena', () => {
    const q = VM.updateTrack(p, 'V', { muted: true });
    const it = planPreload(q, 1)[0];
    expect(it.visible).toBe(true);
    expect(it.audible).toBe(false);
  });
});

describe('deriva y liberación', () => {
  it('driftCorrection: ignora lo pequeño, ajusta velocidad, salta lo grande', () => {
    expect(driftCorrection(0.01, 1)).toEqual({ rate: 1 });
    expect(driftCorrection(0.08, 1).rate).toBeLessThan(1);
    expect(driftCorrection(-0.08, 1).rate).toBeGreaterThan(1);
    expect(driftCorrection(0.5, 1)).toEqual({ seekBy: -0.5, rate: 1 });
  });
  it('pickReleases: suelta lo ocioso y respeta el tope sin tocar lo planificado', () => {
    const have = [
      { clipId: 'a', lastUsed: 0 },
      { clipId: 'b', lastUsed: 9 },
      { clipId: 'c', lastUsed: 9.5 },
      { clipId: 'd', lastUsed: 9.9 },
    ];
    expect(pickReleases(have, new Set(['d']), 8, 10, 1.5)).toEqual(['a']);
    expect(pickReleases(have, new Set(['d']), 2, 10, 1.5)).toEqual(['a', 'b']);
    expect(pickReleases(have, new Set(['a', 'b', 'c', 'd']), 1, 10)).toEqual([]);
  });
});

describe('selección de calidad', () => {
  const feed = (q: QualityController, ms: number, n: number) => {
    let changes = 0;
    for (let i = 0; i < n; i++) if (q.record(ms)) changes++;
    return changes;
  };
  it('Auto arranca en 720 y no baja si hay holgura', () => {
    const q = new QualityController('auto', { fps: 30 });
    expect(q.shortSide).toBe(720);
    expect(feed(q, 8, 300)).toBe(0);
    expect(q.reducedByAuto).toBe(false);
  });
  it('Auto baja un escalón por ventana si el trabajo supera 1/fps, hasta 360', () => {
    const q = new QualityController('auto', { fps: 30 });
    expect(feed(q, 50, 12)).toBe(1);
    expect(q.shortSide).toBe(540);
    expect(q.reducedByAuto).toBe(true);
    feed(q, 50, 12);
    expect(q.shortSide).toBe(360);
    feed(q, 50, 100);
    expect(q.shortSide).toBe(360);
  });
  it('sube de nuevo solo tras mucho rato holgado (histéresis)', () => {
    const q = new QualityController('auto', { fps: 30 });
    feed(q, 50, 12);
    expect(q.shortSide).toBe(540);
    feed(q, 5, 100);
    expect(q.shortSide).toBe(540);
    feed(q, 5, 100);
    expect(q.shortSide).toBe(720);
  });
  it('un pico aislado no baja la calidad', () => {
    const q = new QualityController('auto', { fps: 30 });
    for (let i = 0; i < 60; i++) q.record(i % 12 === 0 ? 60 : 6);
    expect(q.shortSide).toBe(720);
  });
  it('los modos fijos no cambian solos', () => {
    const q = new QualityController('medium', { fps: 30 });
    expect(q.shortSide).toBe(540);
    expect(feed(q, 90, 100)).toBe(0);
    expect(q.reducedByAuto).toBe(false);
    q.setMode('low');
    expect(q.shortSide).toBe(360);
    q.setMode('high');
    expect(q.shortSide).toBe(720);
  });
  it('a 60 fps el presupuesto es la mitad', () => {
    const q = new QualityController('auto', { fps: 60 });
    expect(q.budgetMs).toBeCloseTo(16.67, 1);
    feed(q, 20, 12);
    expect(q.shortSide).toBe(540);
  });
});

describe('caché de fotogramas cercanos (LRU)', () => {
  it('devuelve el más cercano dentro de la tolerancia', () => {
    const c = new NearestCache<string>(100);
    c.put('m', 1.0, 'a');
    c.put('m', 2.0, 'b');
    c.put('m', 3.0, 'c');
    expect(c.nearest('m', 2.2, 0.5)?.value).toBe('b');
    expect(c.nearest('m', 2.6, 0.5)?.value).toBe('c');
    expect(c.nearest('m', 5, 0.5)).toBeNull();
    expect(c.nearest('x', 2)).toBeNull();
  });
  it('expulsa lo menos usado por peso y avisa con onEvict (liberar bitmaps)', () => {
    const closed: string[] = [];
    const c = new NearestCache<string>(3, (v) => closed.push(v));
    c.put('m', 1, 'a');
    c.put('m', 2, 'b');
    c.put('m', 3, 'c');
    c.nearest('m', 1, 0.01); // 'a' se usa: ya no es el más viejo
    c.put('m', 4, 'd');
    expect(closed).toEqual(['b']);
    expect(c.size).toBe(3);
    expect(c.nearest('m', 2, 0.1)).toBeNull();
    expect(c.nearest('m', 1, 0.1)?.value).toBe('a');
  });
  it('misma casilla de tiempo: reemplaza y libera el anterior; el peso nunca se desborda', () => {
    const closed: number[] = [];
    const c = new NearestCache<number>(10, (v) => closed.push(v));
    c.put('m', 1, 1, 4);
    c.put('m', 1.001, 2, 4);
    expect(closed).toEqual([1]);
    expect(c.size).toBe(1);
    for (let i = 0; i < 100; i++) c.put('m', 10 + i, 100 + i, 4);
    expect(c.totalWeight).toBeLessThanOrEqual(10);
    expect(c.size).toBeLessThanOrEqual(3);
  });
  it('dropGroup y clear liberan todo', () => {
    const closed: string[] = [];
    const c = new NearestCache<string>(100, (v) => closed.push(v));
    c.put('a', 1, 'a1');
    c.put('b', 1, 'b1');
    c.dropGroup('a');
    expect(closed).toEqual(['a1']);
    c.clear();
    expect(closed).toEqual(['a1', 'b1']);
    expect(c.size).toBe(0);
    expect(c.totalWeight).toBe(0);
  });
});

describe('estadísticas de fotogramas', () => {
  it('cuenta fps real y fotogramas descartados', () => {
    const s = new FrameStats(30);
    for (let i = 0; i < 30; i++) s.onPresent(i * 33.33, 5);
    expect(s.dropped).toBe(0);
    expect(s.fps(30 * 33.33)).toBeGreaterThan(28);
    s.onPresent(29 * 33.33 + 100, 5); // 3 periodos de golpe → 2 descartados
    expect(s.dropped).toBe(2);
    expect(s.droppedRatio).toBeGreaterThan(0);
  });
  it('tras una pausa el hueco no cuenta como atraso', () => {
    const s = new FrameStats(30);
    s.onPresent(0, 1);
    s.resetGap();
    s.onPresent(5000, 1);
    expect(s.dropped).toBe(0);
  });
});
