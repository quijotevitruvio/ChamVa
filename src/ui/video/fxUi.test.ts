import { describe, expect, it } from 'vitest';
import { addClip, addMedia, addTrack, createProject, makeClip, updateTrack } from '../../video/model/ops';
import { findClip } from '../../video/model/query';
import type { Clip, VideoProject } from '../../video/model/types';
import { setKeyAt } from '../../video/fx/clipOps';
import * as T from './timelineMath';
import { applyPayload, decodePayload, dragKind, encodePayload, fxDropTarget, junctionMarks, keyClusters, keyIndexAt, neighborKey, payloadMime, propLabel } from './fxUi';
import { clampHandle, fromPx, nudgeHandle, setHandle, toPx, Y_MAX, Y_MIN } from './curveMath';

function base(): VideoProject {
  let p = addTrack(createProject(), 'video', { id: 'V' });
  p = addTrack(p, 'audio', { id: 'A' });
  p = addMedia(p, { id: 'm', kind: 'video', name: 'm', duration: 20, blob: {} as Blob });
  p = addClip(p, 'V', makeClip('video', { id: 'a', mediaId: 'm', start: 0, inP: 0, outP: 4 }));
  p = addClip(p, 'V', makeClip('video', { id: 'b', mediaId: 'm', start: 4, inP: 4, outP: 8 }));
  p = addClip(p, 'V', makeClip('video', { id: 'c', mediaId: 'm', start: 10, inP: 8, outP: 12 }));
  return p;
}
const clip = (p: VideoProject, id: string): Clip => findClip(p, id)!.clip;

describe('arrastre desde los paneles', () => {
  it('ida y vuelta de la carga y validación', () => {
    const store: Record<string, string> = {};
    encodePayload({ setData: (k, v) => void (store[k] = v) }, { kind: 'transition', id: 'wipe' });
    expect(decodePayload(store['application/x-chamva-fx'])).toEqual({ kind: 'transition', id: 'wipe' });
    expect(dragKind(Object.keys(store))).toBe('transition');
    expect(dragKind(['Files', 'text/plain'])).toBeNull();
    expect(payloadMime('look')).toBe('application/x-chamva-fx-look');
  });
  it('rechaza lo que no es del catálogo', () => {
    expect(decodePayload('{"kind":"transition","id":"nope"}')).toBeNull();
    expect(decodePayload('{"kind":"effect","type":"zzz"}')).toBeNull();
    expect(decodePayload('{"kind":"blend","mode":"x"}')).toBeNull();
    expect(decodePayload('basura')).toBeNull();
  });
});

describe('applyPayload', () => {
  it('transición sobre una unión va a B.tin; fuera de unión es de entrada; salida de A unida = unión', () => {
    let p = applyPayload(base(), 'b', { kind: 'transition', id: 'wipe' });
    expect(clip(p, 'b').tin?.type).toBe('wipe');
    p = applyPayload(base(), 'c', { kind: 'transition', id: 'fade' });
    expect(clip(p, 'c').tin?.type).toBe('fade'); // c no tiene vecino contiguo
    p = applyPayload(base(), 'a', { kind: 'transition', id: 'fade' }, 'out');
    expect(clip(p, 'b').tin?.type).toBe('fade');
    expect(clip(p, 'a').tout).toBeUndefined();
    p = applyPayload(base(), 'c', { kind: 'transition', id: 'fade' }, 'out');
    expect(clip(p, 'c').tout?.type).toBe('fade');
  });
  it('efecto, preajuste y fusión; el mismo proyecto si no aplica', () => {
    let p = applyPayload(base(), 'a', { kind: 'effect', type: 'blur' });
    p = applyPayload(p, 'a', { kind: 'look', id: 'sepia' });
    expect(clip(p, 'a').fx?.map((f) => f.type)).toEqual(['blur', 'look']);
    expect(clip(p, 'a').fx![1].p).toMatchObject({ preset: 'sepia' });
    expect(clip(applyPayload(p, 'a', { kind: 'blend', mode: 'multiply' }), 'a').blend).toBe('multiply');
    const locked = updateTrack(base(), 'V', { locked: true });
    expect(applyPayload(locked, 'a', { kind: 'effect', type: 'blur' })).toBe(locked);
    expect(applyPayload(base(), 'zzz', { kind: 'effect', type: 'blur' }).tracks).toBeDefined();
  });
});

describe('uniones', () => {
  it('lista los pares contiguos con su transición y duración efectiva', () => {
    const p = applyPayload(base(), 'b', { kind: 'transition', id: 'wipe' });
    const marks = junctionMarks(p.tracks[0], 20);
    expect(marks).toHaveLength(1); // c no es contiguo a b
    expect(marks[0]).toMatchObject({ aId: 'a', bId: 'b', cut: 4, type: 'wipe', label: 'Barrido' });
    expect(marks[0].dur).toBeCloseTo(0.8);
    expect(junctionMarks(base().tracks[0], 20)[0]).toMatchObject({ type: null, dur: 0 });
    expect(junctionMarks(base().tracks[1], 20)).toEqual([]);
  });
});

describe('destino de lo que se suelta', () => {
  const p = base();
  const rows = T.rowLayout(p);
  const pps = 100;
  const y = rows[0].y + 20;
  it('cerca del corte: la unión (B); en el cuerpo: entrada (mitad izquierda) o salida', () => {
    expect(fxDropTarget(p, rows, pps, 4 * pps + 5, y, 'transition')).toMatchObject({ clipId: 'b', mode: 'junction' });
    expect(fxDropTarget(p, rows, pps, 11 * pps, y, 'transition')).toMatchObject({ clipId: 'c', mode: 'in' });
    expect(fxDropTarget(p, rows, pps, 13.5 * pps, y, 'transition')).toMatchObject({ clipId: 'c', mode: 'out' });
  });
  it('efectos: el clip bajo el cursor; hueco o audio: nada', () => {
    expect(fxDropTarget(p, rows, pps, 2 * pps, y, 'effect')).toMatchObject({ clipId: 'a', mode: 'clip' });
    expect(fxDropTarget(p, rows, pps, 9 * pps, y, 'effect')).toBeNull();
    expect(fxDropTarget(p, rows, pps, 2 * pps, rows[1].y + 5, 'transition')).toBeNull();
  });
  it('la fusión no cae sobre una capa de ajuste', () => {
    let q = addTrack(base(), 'video', { id: 'V2', index: 0 });
    q = addClip(q, 'V2', makeClip('adjust', { id: 'adj', start: 0, outP: 5 }));
    const r = T.rowLayout(q);
    expect(fxDropTarget(q, r, pps, 100, r[0].y + 10, 'blend')).toBeNull();
    expect(fxDropTarget(q, r, pps, 100, r[0].y + 10, 'effect')).toMatchObject({ clipId: 'adj' });
  });
});

describe('fotogramas clave', () => {
  const p = (() => {
    let q = base();
    q = setKeyAt(q, 'c', 'scale', 11, 1);
    q = setKeyAt(q, 'c', 'scale', 13, 2);
    q = setKeyAt(q, 'c', 'x', 11, 0.5);
    return q;
  })();
  const c = clip(p, 'c');
  it('un rombo por instante, con todas las propiedades que lo comparten', () => {
    const cl = keyClusters(c);
    expect(cl.map((k) => k.t)).toEqual([1, 3]);
    expect(cl[0].members.map((m) => m.prop).sort()).toEqual(['scale', 'x']);
    expect(cl[1].members).toEqual([{ prop: 'scale', index: 1 }]);
    expect(keyClusters({})).toEqual([]);
  });
  it('índice en el cabezal (±1 ms) y vecinos', () => {
    expect(keyIndexAt(c, 'scale', 11)).toBe(0);
    expect(keyIndexAt(c, 'scale', 11.0005)).toBe(0);
    expect(keyIndexAt(c, 'scale', 12)).toBe(-1);
    expect(neighborKey(c, 'scale', 11, 1)).toBe(13);
    expect(neighborKey(c, 'scale', 11, -1)).toBeNull();
    expect(neighborKey(c, 'scale', 13, -1)).toBe(11);
    expect(neighborKey(c, 'y', 12, 1)).toBeNull();
  });
  it('etiquetas legibles', () => {
    const q = applyPayload(p, 'c', { kind: 'effect', type: 'blur' });
    const f = clip(q, 'c').fx![0];
    expect(propLabel(clip(q, 'c'), 'scale')).toBe('Escala');
    expect(propLabel(clip(q, 'c'), `fx.${f.id}.amount`)).toBe('Desenfoque gaussiano · Intensidad');
    expect(propLabel(clip(q, 'c'), `fx.${f.id}.r`)).toBe('Desenfoque gaussiano · Radio');
  });
});

describe('curveMath', () => {
  it('limita las manijas (x 0..1, y −0,5..1,5)', () => {
    expect(clampHandle(2, 9)).toEqual([1, Y_MAX]);
    expect(clampHandle(-1, -9)).toEqual([0, Y_MIN]);
    expect(clampHandle(NaN, 0.3)).toEqual([0, 0.3]);
  });
  it('setHandle y nudgeHandle cambian solo su manija', () => {
    expect(setHandle([0.4, 0, 0.6, 1], 0, 0.1, 0.9)).toEqual([0.1, 0.9, 0.6, 1]);
    expect(setHandle([0.4, 0, 0.6, 1], 1, 5, -3)).toEqual([0.4, 0, 1, Y_MIN]);
    expect(nudgeHandle([0.4, 0, 0.6, 1], 1, -0.1, 0.5)).toEqual([0.4, 0, 0.5, 1.5]);
  });
  it('píxeles ↔ curva son inversos', () => {
    const b = { size: 160, pad: 14 };
    const [px, py] = toPx(b, 0.25, 0.75);
    const [x, y] = fromPx(b, px, py);
    expect(x).toBeCloseTo(0.25, 2);
    expect(y).toBeCloseTo(0.75, 2);
  });
});
