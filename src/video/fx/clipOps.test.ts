import { describe, expect, it } from 'vitest';
import { buildProjectMixEntries } from '../engine/compose';
import { normalizeV2, serializeProject } from '../model/migrate';
import { addClip, addMedia, addTrack, createProject, makeClip, updateTrack } from '../model/ops';
import { clipDuration, clipsAt, findClip, projectDuration } from '../model/query';
import type { Clip, VideoProject } from '../model/types';
import { addAdjustClip, addFx, addFxOfType, addKeyAtPlayhead, applyPreset, baseValue, clearClipKeys, junctionSpec, moveFx, moveKeyTo, pasteClipKeys, copyKeys, removeFx, removeKeyAt, setBlend, setJunctionTransition, setKeyAt, setPropValue, setTransition, updateFx, updateKeyAt, updateTransition, valueNow } from './clipOps';
import { makeFx } from './effects';
import { transformAt } from './keyframes';
import { makeTransition } from './transitions';

function base(): VideoProject {
  let p = addTrack(createProject(), 'video', { id: 'V' });
  p = addTrack(p, 'audio', { id: 'A' });
  p = addMedia(p, { id: 'm', kind: 'video', name: 'm', duration: 20, blob: {} as Blob });
  p = addClip(p, 'V', makeClip('video', { id: 'a', mediaId: 'm', start: 0, inP: 0, outP: 4 }));
  p = addClip(p, 'V', makeClip('video', { id: 'b', mediaId: 'm', start: 4, inP: 4, outP: 8 }));
  return p;
}
const clip = (p: VideoProject, id: string): Clip => findClip(p, id)!.clip;

describe('transiciones (operaciones)', () => {
  it('setJunctionTransition guarda en B y quita la salida de A', () => {
    let p = setTransition(base(), 'a', 'out', makeTransition('fade'));
    p = setJunctionTransition(p, 'b', makeTransition('wipe', { dur: 1.2 }));
    expect(clip(p, 'b').tin).toMatchObject({ type: 'wipe', dur: 1.2 });
    expect(clip(p, 'a').tout).toBeUndefined();
    expect('tout' in clip(p, 'a')).toBe(false);
    expect(junctionSpec(clip(p, 'a'), clip(p, 'b'))!.owner).toBe('in');
  });
  it('quitar con null; la duración se limita; updateTransition solo cambia lo pedido', () => {
    let p = setTransition(base(), 'b', 'in', makeTransition('fade', { dur: 99 }));
    expect(clip(p, 'b').tin!.dur).toBe(3);
    p = updateTransition(p, 'b', 'in', { dur: 0.5, ease: 'bounce' });
    expect(clip(p, 'b').tin).toMatchObject({ type: 'fade', dur: 0.5, ease: 'bounce' });
    p = setTransition(p, 'b', 'in', null);
    expect('tin' in clip(p, 'b')).toBe(false);
  });
  it('pista bloqueada o audio: no cambia (mismo objeto)', () => {
    const p = base();
    expect(setTransition(updateTrack(p, 'V', { locked: true }), 'b', 'in', makeTransition('fade'))).toEqual(updateTrack(p, 'V', { locked: true }));
    let q = addClip(p, 'A', makeClip('audio', { id: 'au', outP: 3 }));
    expect(setTransition(q, 'au', 'in', makeTransition('fade'))).toBe(q);
  });
});

describe('efectos (operaciones)', () => {
  it('añadir, ordenar, apagar, cambiar parámetros e intensidad, quitar', () => {
    let p = base();
    p = addFx(p, 'a', makeFx('brightness', { id: 'f1' }));
    p = addFx(p, 'a', makeFx('contrast', { id: 'f2' }));
    p = addFxOfType(p, 'a', 'blur', { id: 'f3' });
    expect(clip(p, 'a').fx!.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    p = moveFx(p, 'a', 'f3', 0);
    expect(clip(p, 'a').fx!.map((f) => f.id)).toEqual(['f3', 'f1', 'f2']);
    p = updateFx(p, 'a', 'f1', { on: false, amount: 0.3, p: { v: 0.9 } });
    expect(clip(p, 'a').fx![1]).toMatchObject({ on: false, amount: 0.3, p: { v: 0.9 } });
    p = updateFx(p, 'a', 'f1', { on: true });
    expect('on' in clip(p, 'a').fx![1]).toBe(false);
    p = removeFx(p, 'a', 'f2');
    expect(clip(p, 'a').fx!.map((f) => f.id)).toEqual(['f3', 'f1']);
  });
  it('quitar un efecto quita sus fotogramas clave; sin efectos desaparece `fx`', () => {
    let p = addFx(base(), 'a', makeFx('brightness', { id: 'f1' }));
    p = setKeyAt(p, 'a', 'fx.f1.amount', 1, 0.5);
    p = setKeyAt(p, 'a', 'x', 1, 0.3);
    p = removeFx(p, 'a', 'f1');
    expect(clip(p, 'a').fx).toBeUndefined();
    expect(Object.keys(clip(p, 'a').keys!)).toEqual(['x']);
  });
  it('tipo desconocido, audio y subtítulos no admiten efectos', () => {
    const p = base();
    expect(addFx(p, 'a', { id: 'z', type: 'nada', amount: 1 })).toBe(p);
    const q = addClip(p, 'A', makeClip('audio', { id: 'au', outP: 3 }));
    expect(addFx(q, 'au', makeFx('blur', { id: 'z' }))).toBe(q);
  });
  it('fusión: normal la quita', () => {
    let p = setBlend(base(), 'a', 'multiply');
    expect(clip(p, 'a').blend).toBe('multiply');
    p = setBlend(p, 'a', 'normal');
    expect('blend' in clip(p, 'a')).toBe(false);
  });
});

describe('capa de ajuste', () => {
  it('es un clip de la pista de video con duración y efectos; cuenta en clipsAt', () => {
    let p = base();
    p = addTrack(p, 'video', { id: 'ADJ', index: 0 });
    p = addAdjustClip(p, 'ADJ', 1, 2, { id: 'adj', fx: [makeFx('saturation', { id: 's' })] });
    const c = clip(p, 'adj');
    expect(c.kind).toBe('adjust');
    expect(clipDuration(c)).toBe(2);
    expect(projectDuration(p)).toBe(8);
    const ids = (t: number) => clipsAt(p, t, 8).visual.map((v) => v.clip.id);
    expect(ids(0.5)).toEqual(['a']);
    expect(ids(1.5)).toEqual(['a', 'adj']); // el ajuste va ENCIMA (se dibuja después) y actúa sobre lo de abajo
    expect(ids(3.5)).toEqual(['a']);
  });
  it('no cabe en pistas de audio', () => {
    const p = base();
    expect(addAdjustClip(p, 'A', 0, 2)).toBe(p);
  });
});

describe('fotogramas clave (operaciones)', () => {
  it('setPropValue: sin claves cambia el valor base; con auto-key o con claves escribe un fotograma', () => {
    let p = base();
    p = setPropValue(p, 'b', 'scale', 1.5, 5, false);
    expect(clip(p, 'b').transform.scale).toBe(1.5);
    expect(clip(p, 'b').keys).toBeUndefined();
    p = setPropValue(p, 'b', 'opacity', 0.4, 5, true); // auto-key
    expect(clip(p, 'b').keys!.opacity).toEqual([{ t: 1, v: 0.4 }]);
    expect(clip(p, 'b').transform.opacity).toBe(1); // la base no cambia
    p = setPropValue(p, 'b', 'opacity', 0.8, 6, false); // ya tiene claves: se escribe otra
    expect(clip(p, 'b').keys!.opacity.map((k) => [k.t, k.v])).toEqual([[1, 0.4], [2, 0.8]]);
    p = setPropValue(p, 'b', 'volume', 0.5, 5, false);
    expect(clip(p, 'b').volume).toBe(0.5);
  });
  it('propiedades de efectos: base y animadas', () => {
    let p = addFx(base(), 'a', makeFx('blur', { id: 'f', p: { r: 12 } }));
    expect(baseValue(clip(p, 'a'), 'fx.f.r')).toBe(12);
    expect(baseValue(clip(p, 'a'), 'fx.f.amount')).toBe(1);
    p = setPropValue(p, 'a', 'fx.f.r', 20, 0, false);
    expect(clip(p, 'a').fx![0].p!.r).toBe(20);
    p = setKeyAt(p, 'a', 'fx.f.amount', 0, 0);
    p = setKeyAt(p, 'a', 'fx.f.amount', 4, 1);
    expect(valueNow(clip(p, 'a'), 'fx.f.amount', 2)).toBeCloseTo(0.5, 9);
  });
  it('añadir fotograma en el cabezal toma el valor actual; el instante se limita al clip', () => {
    let p = base();
    p = setKeyAt(p, 'a', 'x', 0, 0.2);
    p = setKeyAt(p, 'a', 'x', 4, 0.8);
    p = addKeyAtPlayhead(p, 'a', 'x', 2);
    expect(clip(p, 'a').keys!.x.map((k) => [k.t, +k.v.toFixed(3)])).toEqual([[0, 0.2], [2, 0.5], [4, 0.8]]);
    p = setKeyAt(p, 'a', 'y', 99, 0.1); // más allá del final → en el borde
    expect(clip(p, 'a').keys!.y[0].t).toBe(4);
  });
  it('mover, editar, quitar, copiar y pegar fotogramas; un gesto = un resultado', () => {
    let p = base();
    p = setKeyAt(p, 'a', 'x', 0, 0.1);
    p = setKeyAt(p, 'a', 'x', 2, 0.9);
    p = moveKeyTo(p, 'a', 'x', 1, 3);
    expect(clip(p, 'a').keys!.x[1].t).toBe(3);
    p = updateKeyAt(p, 'a', 'x', 0, { e: 'hold' });
    expect(clip(p, 'a').keys!.x[0].e).toBe('hold');
    const clipboard = copyKeys(clip(p, 'a'), 0, 3);
    p = pasteClipKeys(p, 'b', clipboard, 6); // b empieza en 4 → t local 2
    expect(clip(p, 'b').keys!.x.map((k) => k.t)).toEqual([2]); // el de t=5 caería después del final (b dura 4 s)
    p = removeKeyAt(p, 'a', 'x', 0);
    expect(clip(p, 'a').keys!.x).toHaveLength(1);
    p = clearClipKeys(p, 'a');
    expect('keys' in clip(p, 'a')).toBe(false);
  });
  it('pegar no deja fotogramas más allá del final del clip', () => {
    let p = setKeyAt(setKeyAt(base(), 'a', 'x', 0, 0.1), 'a', 'x', 3, 0.9);
    const clipboard = copyKeys(clip(p, 'a'), 0, 3);
    p = pasteClipKeys(p, 'b', clipboard, 6); // b: 4–8, local 2: caben 0 (t=2) pero no 3 (t=5 > 4)
    expect(clip(p, 'b').keys!.x.map((k) => k.t)).toEqual([2]);
  });
  it('preset Ken Burns', () => {
    const p = applyPreset(base(), 'a', 'kenburns-in');
    expect(transformAt(clip(p, 'a'), 2).scale).toBeCloseTo(1.125, 6);
    expect(applyPreset(base(), 'a', 'xx')).toEqual(base());
  });
});

describe('mezcla: volumen con fotogramas clave', () => {
  it('sin claves no cambia; con claves el volumen va como envolvente', () => {
    let p = base();
    const open = () => async () => null;
    const e0 = buildProjectMixEntries(p, 8, open, () => true);
    expect(e0[0].gain).toBeUndefined();
    expect(e0[0].fx.volume).toBe(1);
    p = setKeyAt(p, 'a', 'volume', 0, 0);
    p = setKeyAt(p, 'a', 'volume', 4, 2);
    const e1 = buildProjectMixEntries(p, 8, open, () => true);
    expect(e1[0].fx.volume).toBe(1);
    expect(e1[0].gain!(2)).toBeCloseTo(1, 9);
    expect(e1[0].gain!(4)).toBe(2);
    expect(e1[1].gain).toBeUndefined();
  });
});

describe('guardado y normalización (aditivo, idempotente)', () => {
  const rich = (): VideoProject => {
    let p = base();
    p = setTransition(p, 'b', 'in', makeTransition('circle', { dur: 1.5, ease: 'bezier' }));
    p = updateTransition(p, 'b', 'in', { bz: [0.2, 0.1, 0.4, 1.4] });
    p = addFx(p, 'a', makeFx('look', { id: 'L', p: { preset: 'cine' } }));
    p = addFx(p, 'a', makeFx('chroma', { id: 'K' }));
    p = setBlend(p, 'b', 'screen');
    p = setKeyAt(p, 'a', 'scale', 0, 1, { e: 'bezier', bz: [0.1, 0.2, 0.3, 0.9] });
    p = setKeyAt(p, 'a', 'scale', 4, 2);
    p = setKeyAt(p, 'a', 'fx.L.amount', 0, 0);
    p = addTrack(p, 'video', { id: 'ADJ', index: 0 });
    p = addAdjustClip(p, 'ADJ', 0, 3, { id: 'adj', fx: [makeFx('vignette', { id: 'v' })] });
    return p;
  };
  const strip = (p: VideoProject) => JSON.parse(JSON.stringify(serializeProject(p), (k, v) => (k === 'blob' ? undefined : v)));

  it('un proyecto con todo lo de V6 sobrevive a guardar → leer → guardar', () => {
    const p = rich();
    const once = normalizeV2(JSON.parse(JSON.stringify(serializeProject(p), (k, v) => (k === 'blob' ? undefined : v))));
    // los medios pierden el blob al pasar por JSON; se compara la parte de clips
    const clips = (q: VideoProject) => q.tracks.map((t) => t.clips);
    expect(clips(once)).toEqual(clips(p));
    const twice = normalizeV2(JSON.parse(JSON.stringify(serializeProject(once), (k, v) => (k === 'blob' ? undefined : v))));
    expect(clips(twice)).toEqual(clips(once));
    expect(strip(twice).tracks).toEqual(strip(once).tracks);
  });
  it('un proyecto sin campos de V6 se lee exactamente como antes (sin añadir nada)', () => {
    const p = base();
    const back = normalizeV2(JSON.parse(JSON.stringify(serializeProject(p), (k, v) => (k === 'blob' ? undefined : v))));
    for (const c of back.tracks[0].clips) for (const k of ['tin', 'tout', 'fx', 'blend', 'keys']) expect(k in c).toBe(false);
  });
  it('datos corruptos se limpian sin tirar el proyecto', () => {
    const raw = JSON.parse(JSON.stringify(serializeProject(base()), (k, v) => (k === 'blob' ? undefined : v)));
    const c = raw.tracks[0].clips[0];
    c.tin = { type: 7, dur: 'x' };
    c.tout = { type: 'fade', dur: 99, ease: 'raro', bz: [1, 2] };
    c.fx = [{ type: 'blur', amount: 5, p: { r: 3, q: {}, s: 'a' } }, { type: 'blur', id: 'x', amount: 'mucho' }, null, { id: 'z' }];
    c.blend = 'rarisimo';
    c.keys = { x: [{ t: 3, v: 1 }, { t: 'a', v: 1 }, { t: 1, v: 2, e: 'raro' }, { t: 1.0004, v: 9 }], y: 'no', z: [] };
    const q = normalizeV2(raw);
    const n = q.tracks[0].clips[0];
    expect(n.tin).toBeUndefined();
    expect(n.tout).toEqual({ type: 'fade', dur: 3 });
    expect(n.fx).toEqual([{ id: 'fx0', type: 'blur', amount: 1, p: { r: 3, s: 'a' } }, { id: 'x', type: 'blur', amount: 1 }]);
    expect(n.blend).toBeUndefined();
    expect(n.keys).toEqual({ x: [{ t: 1.0004, v: 9 }, { t: 3, v: 1 }] }); // ordenado y sin duplicar el instante
  });
  it('una capa de ajuste sin pista de video válida va a huérfanos, no se pierde', () => {
    const raw = JSON.parse(JSON.stringify(serializeProject(addTrack(createProject(), 'audio', { id: 'A' }))));
    raw.tracks[0].clips = [{ id: 'x', kind: 'adjust', start: 0, inP: 0, outP: 2 }];
    const q = normalizeV2(raw);
    expect(q.tracks[0].clips).toHaveLength(0);
    expect(q.legacy?.orphanClips).toHaveLength(1);
  });
});
