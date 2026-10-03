import { describe, expect, it } from 'vitest';
import {
  addClip,
  addMedia,
  addTrack,
  appendClip,
  closeGaps,
  createProject,
  duplicateClip,
  makeClip,
  moveClip,
  moveClipToIndex,
  moveTrack,
  normalizeTrack,
  pruneMedia,
  removeClip,
  removeTrack,
  snapClipStart,
  snapTime,
  splitClip,
  trimClip,
  updateClip,
  updateTrack,
} from './ops';
import { clipEnd, clipsAt, findClip, projectDuration, sourceTimeAt } from './query';
import type { VideoProject } from './types';

const vid = (id: string, start: number, inP: number, outP: number, o = {}) => makeClip('video', { id, start, inP, outP, mediaId: 'm1', ...o });
const spans = (p: VideoProject, trackId: string) => p.tracks.find((t) => t.id === trackId)!.clips.map((c) => [c.id, +c.start.toFixed(6), +clipEnd(c).toFixed(6)]);

function base(magnet = false) {
  let p = createProject();
  p = addMedia(p, { id: 'm1', kind: 'video', name: 'a.mp4', duration: 10 });
  p = addTrack(p, 'video', { id: 'V1', magnet });
  p = addTrack(p, 'audio', { id: 'A1' });
  return p;
}

describe('pistas', () => {
  it('añade, ordena capas (la primera del array tapa), silencia/oculta/bloquea y elimina', () => {
    let p = base();
    p = addTrack(p, 'video', { id: 'V2' }); // por defecto encima de las de video
    expect(p.tracks.map((t) => t.id)).toEqual(['V2', 'V1', 'A1']);
    p = moveTrack(p, 'V2', 1);
    expect(p.tracks.map((t) => t.id)).toEqual(['V1', 'V2', 'A1']);
    p = updateTrack(p, 'V1', { hidden: true, muted: true, locked: true });
    expect(p.tracks[0]).toMatchObject({ hidden: true, muted: true, locked: true });
    expect(removeTrack(p, 'V1')).toBe(p); // bloqueada
    p = updateTrack(p, 'V1', { locked: false });
    expect(removeTrack(p, 'V1').tracks.map((t) => t.id)).toEqual(['V2', 'A1']);
    expect(updateTrack(p, 'V1', { locked: false })).toBe(p); // sin cambios → mismo objeto
  });

  it('rechaza un clip de audio en pista de video', () => {
    expect(() => addClip(base(), 'V1', makeClip('audio', { id: 'x' }))).toThrow();
  });
});

describe('añadir y mover clips', () => {
  it('push: un clip que cae encima empuja al posterior, nunca se borra', () => {
    let p = base();
    p = addClip(p, 'V1', vid('a', 0, 0, 2));
    p = addClip(p, 'V1', vid('b', 3, 0, 2));
    p = addClip(p, 'V1', vid('c', 1, 0, 3)); // 1..4 solapa a «a» (0..2) y a «b»
    expect(spans(p, 'V1')).toEqual([
      ['a', 0, 2],
      ['c', 2, 5],
      ['b', 5, 7],
    ]);
  });

  it('reject no coloca si se solapa; insert desplaza lo posterior', () => {
    let p = base();
    p = addClip(p, 'V1', vid('a', 0, 0, 2));
    p = addClip(p, 'V1', vid('b', 4, 0, 2));
    expect(addClip(p, 'V1', vid('c', 1, 0, 1), { mode: 'reject' })).toBe(p);
    const q = addClip(p, 'V1', vid('c', 1, 0, 1), { mode: 'insert' }); // cae dentro de «a» → detrás de «a»
    expect(spans(q, 'V1')).toEqual([
      ['a', 0, 2],
      ['c', 2, 3],
      ['b', 5, 7],
    ]);
  });

  it('mover entre pistas y en el tiempo; pista bloqueada = sin efecto', () => {
    let p = addTrack(base(), 'video', { id: 'V2' });
    p = addClip(p, 'V1', vid('a', 0, 0, 2));
    const q = moveClip(p, 'a', { start: 5, trackId: 'V2' });
    expect(spans(q, 'V1')).toEqual([]);
    expect(spans(q, 'V2')).toEqual([['a', 5, 7]]);
    const locked = updateTrack(p, 'V2', { locked: true });
    expect(moveClip(locked, 'a', { start: 5, trackId: 'V2' })).toBe(locked);
    expect(moveClip(p, 'a', { start: 1, trackId: 'A1' })).toBe(p); // tipo incompatible
  });

  it('imán: secuencia sin huecos desde 0; insertar por posición y reordenar como V1', () => {
    let p = base(true);
    p = appendClip(p, 'V1', vid('a', 0, 0, 2));
    p = appendClip(p, 'V1', vid('b', 0, 0, 3));
    p = addClip(p, 'V1', vid('c', 9, 1, 2)); // pide 9 s pero el imán la pone al final, sin hueco
    expect(spans(p, 'V1')).toEqual([
      ['a', 0, 2],
      ['b', 2, 5],
      ['c', 5, 6],
    ]);
    p = moveClipToIndex(p, 'c', 0);
    expect(spans(p, 'V1').map((s) => s[0])).toEqual(['c', 'a', 'b']);
    p = removeClip(p, 'a');
    expect(spans(p, 'V1')).toEqual([
      ['c', 0, 1],
      ['b', 1, 4],
    ]);
  });

  it('cerrar huecos (ripple de toda la pista)', () => {
    let p = base();
    p = addClip(p, 'V1', vid('a', 1, 0, 1));
    p = addClip(p, 'V1', vid('b', 4, 0, 1));
    expect(spans(closeGaps(p, 'V1'), 'V1')).toEqual([
      ['a', 0, 1],
      ['b', 1, 2],
    ]);
  });
});

describe('dividir, recortar, eliminar, duplicar', () => {
  it('dividir en t: tiempos de origen continuos; fundidos a cada extremo; fuera de margen no divide', () => {
    let p = base();
    p = addClip(p, 'V1', vid('a', 1, 2, 6, { speed: 2, fadeIn: 0.5, fadeOut: 0.5 })); // 1..3
    const q = splitClip(p, 'a', 2, 'b');
    const [a, b] = q.tracks[0].clips;
    expect([a.id, a.inP, a.outP, a.fadeIn, a.fadeOut]).toEqual(['a', 2, 4, 0.5, 0]);
    expect([b.id, b.inP, b.outP, b.fadeIn, b.fadeOut, b.start]).toEqual(['b', 4, 6, 0, 0.5, 2]);
    expect(sourceTimeAt(b, 2.5)).toBe(5);
    expect(splitClip(p, 'a', 1.01, 'z')).toBe(p);
    expect(splitClip(p, 'a', 2, 'a')).toBe(p); // id repetido
  });

  it('dividir un texto «hasta el final»: la 1.ª mitad deja de serlo', () => {
    let p = base();
    p = addClip(p, 'V1', vid('v', 0, 0, 10));
    p = addTrack(p, 'video', { id: 'T' });
    p = addClip(p, 'T', makeClip('text', { id: 't', start: 2, outP: 1, toEnd: true, text: 'hola' }));
    const q = splitClip(p, 't', 5, 't2');
    const [a, b] = q.tracks[0].clips;
    expect([a.start, clipEnd(a), a.toEnd]).toEqual([2, 5, undefined]);
    expect([b.start, b.toEnd]).toEqual([5, true]);
  });

  it('recortar sin ripple no invade al vecino; con ripple corre lo posterior; respeta el archivo', () => {
    let p = base();
    p = addClip(p, 'V1', vid('a', 0, 1, 4)); // 0..3
    p = addClip(p, 'V1', vid('b', 3, 0, 2)); // 3..5
    expect(spans(trimClip(p, 'a', 'out', 4), 'V1')[0]).toEqual(['a', 0, 3]); // choca con b
    const r = trimClip(p, 'a', 'out', 4, { ripple: true });
    expect(spans(r, 'V1')).toEqual([
      ['a', 0, 4],
      ['b', 4, 6],
    ]);
    const tin = trimClip(p, 'b', 'in', 3.5);
    expect(findClip(tin, 'b')!.clip).toMatchObject({ start: 3.5, inP: 0.5, outP: 2 });
    expect(findClip(trimClip(p, 'a', 'out', 50, { ripple: true }), 'a')!.clip.outP).toBe(10); // duración del archivo
    expect(findClip(trimClip(p, 'a', 'in', -5), 'a')!.clip).toMatchObject({ start: 0, inP: 1 }); // no antes de 0
  });

  it('eliminar con ripple y duplicar (inserta detrás y corre lo posterior)', () => {
    let p = base();
    p = addClip(p, 'V1', vid('a', 0, 0, 2));
    p = addClip(p, 'V1', vid('b', 2, 0, 1));
    p = addClip(p, 'V1', vid('c', 5, 0, 1));
    expect(spans(removeClip(p, 'b', { ripple: true }), 'V1')).toEqual([
      ['a', 0, 2],
      ['c', 4, 5],
    ]);
    expect(spans(duplicateClip(p, 'a', 'a2'), 'V1')).toEqual([
      ['a', 0, 2],
      ['a2', 2, 4],
      ['b', 4, 5],
      ['c', 7, 8],
    ]);
    expect(removeClip(p, 'nada')).toBe(p);
  });

  it('cambiar la velocidad en una pista con imán recoloca lo siguiente; valores inválidos se ignoran', () => {
    let p = base(true);
    p = appendClip(p, 'V1', vid('a', 0, 0, 4));
    p = appendClip(p, 'V1', vid('b', 0, 0, 1));
    p = updateClip(p, 'a', { speed: 2 });
    expect(spans(p, 'V1')).toEqual([
      ['a', 0, 2],
      ['b', 2, 3],
    ]);
    expect(updateClip(p, 'a', { speed: NaN })).toBe(p);
    expect(updateClip(p, 'a', { transform: { opacity: 1 } })).toBe(p);
    const t = updateClip(p, 'a', { transform: { x: 0.2, scale: 0.5, opacity: 3 } });
    expect(findClip(t, 'a')!.clip.transform).toEqual({ x: 0.2, y: 0.5, scale: 0.5, rotation: 0, opacity: 1 });
  });

  it('pruneMedia quita los medios sin clips', () => {
    let p = addMedia(base(), { id: 'm2', kind: 'audio', name: 'x', duration: 1 });
    p = addClip(p, 'V1', vid('a', 0, 0, 1));
    expect(Object.keys(pruneMedia(p).media)).toEqual(['m1']);
  });
});

describe('imán de bordes', () => {
  it('pega al borde de otro clip, al cabezal o a 0 dentro del umbral', () => {
    let p = base();
    p = addClip(p, 'V1', vid('a', 0, 0, 2));
    p = addClip(p, 'V1', vid('b', 5, 0, 1));
    expect(snapTime(p, 2.08, { threshold: 0.1 })).toEqual({ time: 2, target: 'clip' });
    expect(snapTime(p, 3.02, { threshold: 0.1, playhead: 3 })).toEqual({ time: 3, target: 'playhead' });
    expect(snapTime(p, 3.5, { threshold: 0.1 }).target).toBeNull();
    // arrastrar «b» (1 s): su FIN se pega al inicio… de nada; su inicio se pega al fin de «a»
    expect(snapClipStart(p, 'b', 2.05, { threshold: 0.1 }).time).toBe(2);
  });
});

describe('qué está activo en t', () => {
  it('capas de abajo arriba, sin ocultas; audio sin silenciadas; [inicio, fin)', () => {
    let p = base();
    p = addTrack(p, 'video', { id: 'V2' }); // encima de V1
    p = addClip(p, 'V1', vid('bajo', 0, 0, 4));
    p = addClip(p, 'V2', vid('alto', 1, 0, 2));
    p = addClip(p, 'A1', makeClip('audio', { id: 'mus', start: 0, inP: 0, outP: 10, mediaId: 'm1' }));
    const at = (t: number) => {
      const r = clipsAt(p, t);
      return { v: r.visual.map((x) => x.clip.id), a: r.audible.map((x) => x.clip.id) };
    };
    expect(at(1.5)).toEqual({ v: ['bajo', 'alto'], a: ['bajo', 'alto', 'mus'] });
    expect(at(3)).toEqual({ v: ['bajo'], a: ['bajo', 'mus'] }); // «alto» acaba en 3 (exclusivo)
    p = updateTrack(p, 'V2', { hidden: true });
    p = updateTrack(p, 'A1', { muted: true });
    expect(at(1.5)).toEqual({ v: ['bajo'], a: ['bajo', 'alto'] });
    expect(projectDuration(p)).toBe(4); // el audio (10 s) no alarga
  });

  it('normalizeTrack devuelve la misma pista si ya cumple las invariantes', () => {
    const p = addClip(base(), 'V1', vid('a', 0, 0, 2));
    expect(normalizeTrack(p.tracks[0])).toBe(p.tracks[0]);
  });
});
