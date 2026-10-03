import { describe, expect, it } from 'vitest';
import * as VM from '../model';
import { applySpeedPreset, curveFromSpeed, freezeFrame, removeReframe, setConstantSpeed, setLoop, setPitch, setReframe, setReverse, setSpeedCurve, stillFromFrame } from './speedOps';
import { fmtSpeed, fromPx, nudgeSpeed, sliderToSpeed, speedToSlider, toPx, type SpeedBox } from '../../ui/video/speedCurveMath';
import { passDuration } from './clipTime';
import type { Clip } from '../model/types';

const proj = (c: Partial<Clip> = {}, locked = false) => {
  let p = VM.addTrack(VM.createProject(), 'video', { id: 'V', locked });
  p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'a.mp4', duration: 20 });
  // la pista se bloquea después de añadir el clip
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'c', mediaId: 'm', inP: 0, outP: 10, ...c }));
  return locked ? VM.updateTrack(p, 'V', { locked: true }) : p;
};
const clipOf = (p: VM.VideoProject, id = 'c') => VM.findClip(p, id)!.clip;

describe('operaciones de V8 (un paso de deshacer cada una)', () => {
  it('velocidad constante 0,1×–100× (se limita) y quita la curva', () => {
    let p = proj({ curve: { pts: [{ s: 0, v: 2 }] } });
    p = setConstantSpeed(p, 'c', 500);
    expect(clipOf(p).speed).toBe(100);
    expect(clipOf(p).curve).toBeUndefined();
    p = setConstantSpeed(p, 'c', 0.01);
    expect(clipOf(p).speed).toBe(0.1);
    expect(VM.clipDuration(clipOf(p))).toBeCloseTo(100, 9);
    expect(setConstantSpeed(p, 'c', NaN)).toBe(p);
  });

  it('curva: preajuste, edición desde la velocidad actual, quitar; las imágenes y las pistas bloqueadas no cambian', () => {
    const p0 = proj({ speed: 2 });
    const p1 = curveFromSpeed(p0, 'c');
    expect(clipOf(p1).speed).toBe(1);
    expect(passDuration(clipOf(p1))).toBeCloseTo(5, 9); // misma duración que a 2×
    const p2 = applySpeedPreset(p1, 'c', 'coaster');
    expect(clipOf(p2).curve!.pts.length).toBe(6);
    expect(setSpeedCurve(p2, 'c', null)).not.toBe(p2);
    expect(clipOf(setSpeedCurve(p2, 'c', null)).curve).toBeUndefined();
    expect(applySpeedPreset(p0, 'c', 'no-existe')).toBe(p0);
    expect(setConstantSpeed(proj({}, true), 'c', 3)).toEqual(proj({}, true));
    let pi = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
    pi = VM.addClip(pi, 'V', VM.makeClip('image', { id: 'i', outP: 3 }));
    expect(setReverse(pi, 'i', true)).toBe(pi);
  });

  it('invertir, conservar el tono y bucle (n, hasta una duración, quitar)', () => {
    let p = setReverse(proj(), 'c', true);
    expect(clipOf(p).reverse).toBe(true);
    p = setReverse(p, 'c', false);
    expect('reverse' in clipOf(p)).toBe(false);
    p = setPitch(p, 'c', true);
    expect(clipOf(p).pitch).toBe(true);
    p = setLoop(p, 'c', { n: 4, xf: 1 });
    expect(VM.clipDuration(clipOf(p))).toBe(37); // 4·10 − 3·1
    p = setLoop(p, 'c', { dur: 25 });
    expect(VM.clipDuration(clipOf(p))).toBe(25);
    expect(setLoop(p, 'c', { xf: 1 })).toBe(p); // sin n ni dur no es un bucle
    p = setLoop(p, 'c', null);
    expect(clipOf(p).loop).toBeUndefined();
  });

  it('congelar fotograma en medio: tres clips, lo posterior se corre y el congelado muestra el fotograma del corte', () => {
    let p = proj({ inP: 2, outP: 12, speed: 2 });
    p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'next', mediaId: 'm', start: 5, inP: 0, outP: 3 }));
    const q = freezeFrame(p, 'c', 2, 1.5, { freeze: 'z', right: 'r' });
    const [a, z, r, n] = q.tracks[0].clips;
    expect([a.id, z.id, r.id, n.id]).toEqual(['c', 'z', 'r', 'next']);
    expect(z.freeze).toBe(1.5);
    expect(z.start).toBeCloseTo(2, 9);
    expect(z.inP).toBeCloseTo(6, 9); // 2 s a 2× desde el segundo 2 del archivo
    expect(r.start).toBeCloseTo(3.5, 9);
    expect(n.start).toBeCloseTo(5 + 1.5, 9);
    expect(VM.clipDuration(a) + VM.clipDuration(r)).toBeCloseTo(5, 9);
    // un paso: el original se puede recuperar con un solo deshacer del historial
    let h = VM.createHistory(p);
    h = VM.commit(h, q);
    expect(VM.canUndo(h)).toBe(true);
    expect(VM.undo(h).present).toBe(p);
  });

  it('congelar en el borde del clip lo pone antes o después; sin duración o en pista bloqueada no hace nada', () => {
    const p = proj();
    const start = freezeFrame(p, 'c', 0, 2, { freeze: 'z', right: 'r' });
    expect(start.tracks[0].clips.map((c) => c.id)).toEqual(['z', 'c']);
    expect(clipOf(start).start).toBe(2);
    const end = freezeFrame(p, 'c', 10, 2, { freeze: 'z', right: 'r' });
    expect(end.tracks[0].clips.map((c) => c.id)).toEqual(['c', 'z']);
    expect(freezeFrame(p, 'c', 3, 0, { freeze: 'z', right: 'r' })).toBe(p);
    const locked = proj({}, true);
    expect(freezeFrame(locked, 'c', 3, 1, { freeze: 'z', right: 'r' })).toBe(locked);
    // un bucle no se puede dividir: congelar en medio no hace nada
    const loop = proj({ loop: { n: 2 } });
    expect(freezeFrame(loop, 'c', 5, 1, { freeze: 'z', right: 'r' })).toBe(loop);
  });

  it('fotograma a imagen: medio nuevo + pista nueva encima con una imagen de la duración pedida', () => {
    const p = proj();
    const img = { id: 'img', kind: 'image' as const, name: 'Fotograma.png', duration: 0, blob: undefined };
    const q = stillFromFrame(p, img, 4, 3, { track: 'T2', clip: 'i1' });
    expect(q.tracks[0].id).toBe('T2');
    const i = clipOf(q, 'i1');
    expect([i.kind, i.start, i.outP - i.inP, i.mediaId]).toEqual(['image', 4, 3, 'img']);
    expect(q.media.img).toBeDefined();
  });

  it('reencuadre: aplica transformación y marcos, y se quita sin dejar rastro', () => {
    const p = proj();
    const q = setReframe(p, 'c', { aspect: '9:16', cx: 0.5, cy: 0.5, zoom: 1, track: [{ t: 0, cx: 0.3, cy: 0.5 }, { t: 5, cx: 0.7, cy: 0.5 }] }, { w: 1920, h: 1080 }, { w: 720, h: 1280 });
    const c = clipOf(q);
    expect(c.reframe?.track).toHaveLength(2);
    expect(c.keys!.x).toHaveLength(2);
    expect(c.transform.scale).toBeGreaterThan(3);
    const r = removeReframe(q, 'c');
    const d = clipOf(r);
    expect(d.reframe).toBeUndefined();
    expect(d.keys).toBeUndefined();
    expect(d.transform).toEqual({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 });
    expect(removeReframe(p, 'c')).toBe(p);
  });
});

describe('geometría del editor de la curva de velocidad', () => {
  const B: SpeedBox = { w: 300, h: 150, pad: 14 };
  it('ida y vuelta (s, v) ↔ píxeles, con el eje de velocidad en escala logarítmica', () => {
    for (const [s, v] of [[0, 0.1], [5, 1], [10, 100], [2.5, 0.37], [7.5, 8]] as const) {
      const [x, y] = toPx(B, 0, 10, s, v);
      const back = fromPx(B, 0, 10, x, y);
      expect(back.s).toBeCloseTo(s, 1);
      expect(Math.log10(back.v)).toBeCloseTo(Math.log10(v), 1);
    }
    // 1× queda a un tercio de la altura (0,1 abajo, 100 arriba: tres décadas)
    const [, y1] = toPx(B, 0, 10, 0, 1);
    const [, y01] = toPx(B, 0, 10, 0, 0.1);
    const [, y100] = toPx(B, 0, 10, 0, 100);
    expect((y01 - y1) / (y01 - y100)).toBeCloseTo(1 / 3, 2);
    // fuera de rango se limita
    expect(fromPx(B, 0, 10, -50, 999).v).toBe(0.1);
    expect(fromPx(B, 0, 10, 999, -50).v).toBe(100);
  });

  it('formato de velocidad, deslizador logarítmico y pasos del teclado', () => {
    expect(fmtSpeed(0.25)).toBe('0,25×');
    expect(fmtSpeed(2)).toBe('2×');
    expect(fmtSpeed(12.4)).toBe('12×');
    expect(sliderToSpeed(speedToSlider(0.1))).toBeCloseTo(0.1, 2);
    expect(sliderToSpeed(speedToSlider(100))).toBe(100);
    expect(sliderToSpeed(speedToSlider(1))).toBeCloseTo(1, 1);
    expect(speedToSlider(1)).toBe(333);
    expect(nudgeSpeed(1, 1)).toBeCloseTo(1.1, 3);
    expect(nudgeSpeed(100, 1)).toBe(100);
    expect(nudgeSpeed(0.1, -1)).toBe(0.1);
  });
});
