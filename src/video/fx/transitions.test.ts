import { describe, expect, it } from 'vitest';
import { addClip, addMedia, addTrack, createProject, makeClip, splitClip, trimClip } from '../model/ops';
import { clipsAt, projectDuration } from '../model/query';
import type { VideoProject } from '../model/types';
import { barRects, blobGrow, circleRadius, diagonalPolygon, flipScaleX, hasTransitionDraw, inkBlobs, moveOffsets } from './transitionDraw';
import { TRANSITIONS, areJoined, clampTransDur, extendedSourceTime, junctionDur, junctionOf, makeTransition, resolveTransitions, transitionAt, windowProgress } from './transitions';

/** V: A 0–4 (archivo 2–6), B 4–8 (archivo 10–14), en un archivo de 20 s. */
function proj(tin?: ReturnType<typeof makeTransition>, tout?: ReturnType<typeof makeTransition>): VideoProject {
  let p = addTrack(createProject(), 'video', { id: 'V' });
  p = addMedia(p, { id: 'm', kind: 'video', name: 'm', duration: 20, blob: {} as Blob });
  p = addClip(p, 'V', makeClip('video', { id: 'A', mediaId: 'm', start: 0, inP: 2, outP: 6, ...(tout ? { tout } : {}) }));
  p = addClip(p, 'V', makeClip('video', { id: 'B', mediaId: 'm', start: 4, inP: 10, outP: 14, ...(tin ? { tin } : {}) }));
  return p;
}
const dur = (p: VideoProject) => projectDuration(p);

describe('catálogo', () => {
  it('hay al menos 20 transiciones, con id único y dibujo', () => {
    expect(TRANSITIONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TRANSITIONS.map((t) => t.id)).size).toBe(TRANSITIONS.length);
    for (const t of TRANSITIONS) expect(hasTransitionDraw(t.id), t.id).toBe(true);
  });
  it('incluye las pedidas', () => {
    const ids = TRANSITIONS.map((t) => t.id);
    for (const id of ['fade', 'fadeBlack', 'fadeWhite', 'dissolve', 'slideLeft', 'slideRight', 'slideUp', 'slideDown', 'pushLeft', 'pushRight', 'pushUp', 'pushDown', 'zoomIn', 'zoomOut', 'cover', 'reveal', 'circle', 'bars', 'diagonal', 'flip', 'pixelate', 'blur', 'flash', 'glitch', 'ink'])
      expect(ids).toContain(id);
  });
  it('duración limitada a 0,1–3 s', () => {
    expect(clampTransDur(0)).toBe(0.1);
    expect(clampTransDur(9)).toBe(3);
    expect(clampTransDur(NaN)).toBe(0.8);
    expect(makeTransition('fade', { dur: 1.5 })).toEqual({ type: 'fade', dur: 1.5, ease: 'smooth' });
  });
});

describe('semántica de la unión (A 0–4, B 4–8)', () => {
  it('ventana centrada en el corte', () => {
    const p = proj(makeTransition('fade', { dur: 1 }));
    const [r] = resolveTransitions(p.tracks[0], dur(p));
    expect(r.kind).toBe('junction');
    expect([r.t0, r.t1, r.dur]).toEqual([3.5, 4.5, 1]);
    expect([r.a!.id, r.b!.id]).toEqual(['A', 'B']);
  });
  it('la duración se limita a la del clip más corto (las ventanas de un clip no se pisan)', () => {
    let p = addTrack(createProject(), 'video', { id: 'V' });
    p = addClip(p, 'V', makeClip('image', { id: 'A', start: 0, outP: 0.6 }));
    p = addClip(p, 'V', makeClip('image', { id: 'B', start: 0.6, outP: 5, tin: makeTransition('fade', { dur: 3 }) }));
    const [r] = resolveTransitions(p.tracks[0], 5.6);
    expect(r.dur).toBeCloseTo(0.6, 9);
    expect(junctionDur(makeTransition('fade', { dur: 3 }), p.tracks[0].clips[0], p.tracks[0].clips[1])).toBeCloseTo(0.6, 9);
  });
  it('tin de B manda sobre tout de A; tout de A basta si B no tiene', () => {
    let p = proj(makeTransition('wipe', { dur: 1 }), makeTransition('fade', { dur: 2 }));
    expect(resolveTransitions(p.tracks[0], dur(p))[0].spec.type).toBe('wipe');
    p = proj(undefined, makeTransition('fade', { dur: 2 }));
    const [r] = resolveTransitions(p.tracks[0], dur(p));
    expect(r.spec.type).toBe('fade');
    expect(r.kind).toBe('junction');
  });
  it('si no son contiguos la transición pasa a ser de entrada/salida (no se pierde)', () => {
    let p = addTrack(createProject(), 'video', { id: 'V' });
    p = addClip(p, 'V', makeClip('image', { id: 'A', start: 0, outP: 3, tout: makeTransition('fade', { dur: 1 }) }));
    p = addClip(p, 'V', makeClip('image', { id: 'B', start: 5, outP: 3, tin: makeTransition('wipe', { dur: 0.5 }) }));
    const rs = resolveTransitions(p.tracks[0], 8);
    expect(rs.map((r) => [r.kind, r.t0, r.t1])).toEqual([['out', 2, 3], ['in', 5, 5.5]]);
    expect(areJoined(p.tracks[0].clips[0], p.tracks[0].clips[1])).toBe(false);
    expect(junctionOf(p.tracks[0], 'B')).toBeNull();
  });
  it('entrada de un clip suelto: [inicio, inicio + d] acotada a su duración', () => {
    let p = addTrack(createProject(), 'video', { id: 'V' });
    p = addClip(p, 'V', makeClip('image', { id: 'A', start: 2, outP: 0.5, tin: makeTransition('fade', { dur: 2 }) }));
    const [r] = resolveTransitions(p.tracks[0], 10);
    expect([r.kind, r.t0, r.t1]).toEqual(['in', 2, 2.5]);
  });
  it('los clips de audio no tienen transiciones', () => {
    let p = addTrack(createProject(), 'audio', { id: 'A' });
    p = addClip(p, 'A', makeClip('audio', { id: 'a', outP: 3, tin: makeTransition('fade') }));
    expect(resolveTransitions(p.tracks[0], 3)).toEqual([]);
  });
  it('progreso y curva en t', () => {
    const p = proj(makeTransition('fade', { dur: 1, ease: 'linear' }));
    const rs = resolveTransitions(p.tracks[0], dur(p));
    expect(windowProgress(rs[0], 3.49)).toBeNull();
    expect(windowProgress(rs[0], 3.5)).toBe(0);
    expect(transitionAt(rs, 4)!.raw).toBeCloseTo(0.5, 9);
    expect(transitionAt(rs, 4)!.eased).toBeCloseTo(0.5, 9);
    expect(transitionAt(rs, 4.5)).toBeNull(); // exclusivo al final
    const smooth = resolveTransitions(proj(makeTransition('fade', { dur: 1, ease: 'in' })).tracks[0], 8);
    expect(transitionAt(smooth, 3.75)!.eased).toBeCloseTo(0.25 ** 3, 9);
    const bounce = resolveTransitions(proj(makeTransition('fade', { dur: 1, ease: 'bounce' })).tracks[0], 8);
    expect(transitionAt(bounce, 4)!.eased).toBeCloseTo(0.765625, 6); // easeOutBounce(0,5)
  });
});

describe('solape sin romper el modelo', () => {
  it('clipsAt muestra a la vez A y B en la ventana (el que no está activo, como `ext`), en orden', () => {
    const p = proj(makeTransition('fade', { dur: 1 }));
    const at = (t: number) => clipsAt(p, t, dur(p)).visual.map((v) => `${v.clip.id}${v.ext ? '*' : ''}`);
    expect(at(3.4)).toEqual(['A']);
    expect(at(3.6)).toEqual(['A', 'B*']);
    expect(at(4.2)).toEqual(['A*', 'B']);
    expect(at(4.5)).toEqual(['B']);
  });
  it('el audio y la duración del proyecto no cambian', () => {
    const p = proj(makeTransition('fade', { dur: 1 }));
    expect(dur(p)).toBe(8);
    expect(clipsAt(p, 3.6, 8).audible.map((a) => a.clip.id)).toEqual(['A']);
    expect(clipsAt(p, 4.2, 8).audible.map((a) => a.clip.id)).toEqual(['B']);
  });
  it('los clips no se solapan ni se mueven', () => {
    const p = proj(makeTransition('fade', { dur: 3 }));
    expect(p.tracks[0].clips.map((c) => [c.id, c.start])).toEqual([['A', 0], ['B', 4]]);
  });
  it('pista oculta: no se ve nada', () => {
    const p = { ...proj(makeTransition('fade', { dur: 1 })) };
    p.tracks = [{ ...p.tracks[0], hidden: true }];
    expect(clipsAt(p, 3.6, 8).visual).toEqual([]);
  });
  it('márgenes de recorte: el tiempo de archivo sigue avanzando fuera del rango y se limita al archivo', () => {
    const A = { inP: 2, start: 0, speed: 1 };
    const B = { inP: 10, start: 4, speed: 1 };
    expect(extendedSourceTime(A, 4.5, 20)).toBeCloseTo(6.5, 9); // A pasa de su salida (6) usando el margen
    expect(extendedSourceTime(B, 3.5, 20)).toBeCloseTo(9.5, 9); // B antes de su entrada (10)
    expect(extendedSourceTime(B, 3.5, 20)).toBeLessThan(10);
    expect(extendedSourceTime({ inP: 0, start: 4, speed: 1 }, 3.5, 20)).toBe(0); // sin margen anterior: primer fotograma
    expect(extendedSourceTime({ inP: 18, start: 0, speed: 1 }, 5, 20)).toBeCloseTo(19.999, 6); // sin margen posterior: último fotograma
    expect(extendedSourceTime({ inP: 2, start: 0, speed: 2 }, 5, 0)).toBe(12); // duración desconocida: sin tope
  });
  it('dividir un clip: la entrada se queda en la 1.ª mitad y la salida pasa a la 2.ª', () => {
    let p = addTrack(createProject(), 'video', { id: 'V' });
    p = addClip(p, 'V', makeClip('image', { id: 'X', start: 0, outP: 6, tin: makeTransition('fade'), tout: makeTransition('wipe') }));
    p = splitClip(p, 'X', 3, 'Y');
    const [x, y] = p.tracks[0].clips;
    expect([x.tin?.type, x.tout?.type, y.tin?.type, y.tout?.type]).toEqual(['fade', undefined, undefined, 'wipe']);
  });
  it('recortar el inicio no desplaza los fotogramas clave en la línea de tiempo', () => {
    let p = addTrack(createProject(), 'video', { id: 'V' });
    p = addClip(p, 'V', makeClip('image', { id: 'X', start: 0, outP: 6, keys: { scale: [{ t: 0, v: 1 }, { t: 4, v: 2 }] } }));
    p = trimClip(p, 'X', 'in', 1);
    const c = p.tracks[0].clips[0];
    expect(c.start).toBe(1);
    expect(c.keys!.scale[c.keys!.scale.length - 1]).toMatchObject({ t: 3, v: 2 }); // seguía en t = 4 de la línea de tiempo
  });
});

describe('geometría de las transiciones', () => {
  it('cortina circular: a mitad el radio es un cuarto de la diagonal', () => {
    expect(circleRadius(0.5, 1280, 720)).toBeCloseTo(0.25 * Math.hypot(1280, 720), 9);
    expect(circleRadius(0, 1280, 720)).toBe(0);
    expect(circleRadius(1, 1280, 720)).toBeCloseTo(Math.hypot(1280, 720) / 2, 9); // cubre las esquinas
    expect(circleRadius(1, 1280, 720)).toBeGreaterThanOrEqual(Math.hypot(640, 360));
  });
  it('diagonal: triángulo hasta la mitad y pentágono después; cubre todo al final', () => {
    expect(diagonalPolygon(0.25, 100, 50)).toEqual([[0, 0], [50, 0], [0, 25]]);
    expect(diagonalPolygon(0.5, 100, 50)).toEqual([[0, 0], [100, 0], [0, 50]]);
    expect(diagonalPolygon(0.75, 100, 50)).toEqual([[0, 0], [100, 0], [100, 25], [50, 50], [0, 50]]);
    expect(diagonalPolygon(1, 100, 50)).toEqual([[0, 0], [100, 0], [100, 50], [100, 50], [0, 50]]);
  });
  it('barras: 8 franjas, cada una descubierta en la misma fracción', () => {
    const r = barRects(0.5, 800, 400);
    expect(r).toHaveLength(8);
    expect(r[3]).toEqual([0, 150, 800, 25]);
  });
  it('giro 3D: la saliente se estrecha hasta 0 a mitad y la entrante se abre', () => {
    expect(flipScaleX(0)).toEqual({ which: 'A', sx: 1 });
    expect(flipScaleX(0.49).sx).toBeLessThan(0.1);
    expect(flipScaleX(0.51).which).toBe('B');
    expect(flipScaleX(1).sx).toBeCloseTo(1, 9);
  });
  it('deslizar, empujar, cubrir y revelar', () => {
    expect(moveOffsets('slideLeft', 0.25)).toEqual({ a: [0, 0], b: [0.75, 0] });
    expect(moveOffsets('pushLeft', 0.5)).toEqual({ a: [-0.5, 0], b: [0.5, 0] });
    expect(moveOffsets('pushDown', 0.4)!.a).toEqual([0, 0.4]);
    expect(moveOffsets('cover', 1)!.a[0]).toBeCloseTo(-0.25, 9);
    expect(moveOffsets('reveal', 0.5)!.a).toEqual([-0.5, 0]);
    expect(moveOffsets('zoomIn', 0.5)).toBeNull();
  });
  it('tinta: determinista y cubre todo al final', () => {
    expect(inkBlobs(7)).toEqual(inkBlobs(7));
    expect(inkBlobs(7)).not.toEqual(inkBlobs(8));
    for (const b of inkBlobs(3)) {
      expect(blobGrow(0, b)).toBe(0);
      expect(blobGrow(1, b)).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });
});
