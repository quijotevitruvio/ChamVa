import { describe, expect, it } from 'vitest';
import * as VM from '../model';
import { normalizeV2, serializeProject } from '../model';
import { extendedSourceTime } from '../fx/transitions';
import { SpeedMap, SPEED_PRESETS, addPoint, curveSamples, movePoint, presetCurve, removePoint, sanitizeCurve, setPointSpeed, speedAt, speedMap } from './curve';
import { averageSpeed, clipDurationOf, extendedSourceAt, layersAt, loopInfo, localOfSource, passDuration, rateAt, sanitizeLoop, sourceAtLocal } from './clipTime';
import type { Clip, SpeedCurve } from '../model/types';

const base = (o: Partial<Clip> = {}): Clip => VM.makeClip('video', { id: 'c', mediaId: 'm', inP: 0, outP: 10, ...o });

/** integral numérica independiente (trapecios finos) de ds/v(s) */
function refIntegral(c: SpeedCurve, a: number, b: number, n = 200000): number {
  let sum = 0;
  const h = (b - a) / n;
  for (let i = 0; i <= n; i++) {
    const w = i === 0 || i === n ? 0.5 : 1;
    sum += (w * 1) / speedAt(c, a + i * h);
  }
  return sum * h;
}

describe('curva de velocidad: mapeo de tiempo exacto', () => {
  it('velocidad constante: duración = tramo / v, ida y vuelta exactas', () => {
    const m = new SpeedMap({ pts: [{ s: 0, v: 2 }] }, 1, 7);
    expect(m.duration).toBeCloseTo(3, 12);
    expect(m.toLocal(4)).toBeCloseTo(1.5, 12);
    expect(m.toSource(1.5)).toBeCloseTo(4, 12);
  });

  it('rampa 1×→4× en 3 s de archivo: integral en forma cerrada (3·0,75/ln 4)', () => {
    const c: SpeedCurve = { pts: [{ s: 0, v: 1 }, { s: 3, v: 4 }] };
    const m = new SpeedMap(c, 0, 3);
    expect(m.duration).toBeCloseTo((3 * 0.75) / Math.log(4), 12);
    // coincide con una integración numérica independiente
    expect(m.duration).toBeCloseTo(refIntegral(c, 0, 3), 7);
  });

  it('rampa suave: coincide con la integración numérica y es monótona', () => {
    const c: SpeedCurve = { pts: [{ s: 0, v: 0.25 }, { s: 5, v: 4 }, { s: 8, v: 1 }], smooth: true };
    const m = new SpeedMap(c, 0, 8);
    expect(m.duration).toBeCloseTo(refIntegral(c, 0, 8), 6);
    let prev = -1;
    for (let s = 0; s <= 8; s += 0.05) {
      const l = m.toLocal(s);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('toSource es la inversa de toLocal (lineal y suave, 1e-9 / 1e-6)', () => {
    for (const smooth of [false, true]) {
      const c: SpeedCurve = { pts: [{ s: 1, v: 0.5 }, { s: 4, v: 8 }, { s: 6, v: 2 }, { s: 9, v: 0.2 }], smooth };
      const m = new SpeedMap(c, 0, 10);
      for (let s = 0; s <= 10; s += 0.173) expect(Math.abs(m.toSource(m.toLocal(s)) - s)).toBeLessThan(smooth ? 1e-6 : 1e-9);
    }
  });

  it('un sub-tramo (recorte) suma exactamente: F(hi) − F(lo) del mapa completo', () => {
    const c: SpeedCurve = { pts: [{ s: 0, v: 1 }, { s: 3, v: 4 }, { s: 7, v: 0.5 }] };
    const full = new SpeedMap(c, 0, 10);
    const part = new SpeedMap(c, 2, 8);
    expect(part.duration).toBeCloseTo(full.toLocal(8) - full.toLocal(2), 10);
    // dividir en s=5: las dos mitades suman la duración total
    const a = new SpeedMap(c, 2, 5);
    const b = new SpeedMap(c, 5, 8);
    expect(a.duration + b.duration).toBeCloseTo(part.duration, 10);
  });

  it('velocidades extremas 0,1× y 100×', () => {
    expect(new SpeedMap({ pts: [{ s: 0, v: 0.1 }] }, 0, 2).duration).toBeCloseTo(20, 10);
    expect(new SpeedMap({ pts: [{ s: 0, v: 100 }] }, 0, 50).duration).toBeCloseTo(0.5, 12);
    const m = new SpeedMap({ pts: [{ s: 0, v: 0.1 }, { s: 10, v: 100 }] }, 0, 10);
    expect(m.duration).toBeGreaterThan(0.1);
    expect(Math.abs(m.toSource(m.toLocal(7.7)) - 7.7)).toBeLessThan(1e-9);
  });

  it('sanitizeCurve: ordena, quita duplicados, limita 0,1–100 y es idempotente', () => {
    const c = sanitizeCurve({ pts: [{ s: 5, v: 500 }, { s: 1, v: 0.001 }, { s: 1.00001, v: 3 }, { s: -1, v: 2 }, { s: 2, v: NaN }, 'x'], smooth: true })!;
    expect(c.pts).toEqual([{ s: 1.00001, v: 3 }, { s: 5, v: 100 }]);
    expect(c.smooth).toBe(true);
    expect(sanitizeCurve(c)).toEqual(c);
    expect(sanitizeCurve({ pts: [] })).toBeUndefined();
    expect(sanitizeCurve(null)).toBeUndefined();
  });

  it('edición: añadir, mover (sin cruzar vecinos), cambiar velocidad y quitar', () => {
    let c: SpeedCurve = { pts: [{ s: 0, v: 1 }, { s: 10, v: 4 }] };
    c = addPoint(c, 5);
    expect(c.pts).toHaveLength(3);
    expect(c.pts[1].v).toBeCloseTo(2, 5); // log: raíz de 4
    c = movePoint(c, 1, 99, 0, 10);
    expect(c.pts[1].s).toBeLessThan(10);
    c = setPointSpeed(c, 1, 1000);
    expect(c.pts[1].v).toBe(100);
    expect(removePoint(c, 1).pts).toHaveLength(2);
    expect(removePoint({ pts: [{ s: 0, v: 1 }] }, 0).pts).toHaveLength(1);
  });

  it('los 6 preajustes son curvas válidas dentro de 0,1–100 con duración positiva', () => {
    expect(SPEED_PRESETS.map((p) => p.id)).toEqual(expect.arrayContaining(['slow-fast', 'jump', 'coaster']));
    for (const pr of SPEED_PRESETS) {
      const c = presetCurve(pr.id, 2, 12)!;
      expect(sanitizeCurve(c)).toEqual(c);
      expect(c.pts[0].s).toBe(2);
      expect(c.pts[c.pts.length - 1].s).toBe(12);
      const d = speedMap(c, 2, 12).duration;
      expect(d).toBeGreaterThan(0.1);
      expect(d).toBeLessThan(100);
      for (const [, v] of curveSamples(c, 2, 12)) expect(v).toBeGreaterThanOrEqual(0.1);
    }
  });
});

describe('tiempo del clip (duración, origen ↔ salida)', () => {
  it('sin V8 usa las fórmulas de V1 bit a bit', () => {
    const c = base({ inP: 1.3, outP: 8.9, speed: 1.7, start: 2 });
    expect(VM.clipDuration(c)).toBe(Math.max(0.01, (8.9 - 1.3) / 1.7));
    for (const t of [2, 3.1, 4.7, 6.2]) expect(VM.sourceTimeAt(c, t)).toBe(Math.max(1.3, Math.min(8.9 - 0.001, 1.3 + (t - 2) * 1.7)));
  });

  it('con curva: la duración del clip es la integral y sourceTimeAt invierte el mapa', () => {
    const curve: SpeedCurve = { pts: [{ s: 0, v: 0.5 }, { s: 10, v: 4 }] };
    const c = base({ curve, start: 1 });
    const m = speedMap(curve, 0, 10);
    expect(VM.clipDuration(c)).toBeCloseTo(m.duration, 12);
    for (const f of [0.1, 0.4, 0.8]) {
      const t = 1 + m.duration * f;
      expect(VM.sourceTimeAt(c, t)).toBeCloseTo(m.toSource(m.duration * f), 9);
    }
    // a velocidad lenta el origen avanza poco: la 1.ª mitad de la salida cubre < la mitad del archivo
    expect(VM.sourceTimeAt(c, 1 + m.duration / 2)).toBeLessThan(5.5);
  });

  it('invertido: el origen va de outP a inP y la duración no cambia', () => {
    const c = base({ inP: 2, outP: 6, speed: 2, reverse: true });
    expect(VM.clipDuration(c)).toBeCloseTo(2, 12);
    expect(VM.sourceTimeAt(c, 0)).toBeCloseTo(6 - 0.001, 9);
    expect(VM.sourceTimeAt(c, 1)).toBeCloseTo(4, 9);
    expect(VM.sourceTimeAt(c, 1.9999)).toBeCloseTo(2.0002, 3);
    expect(rateAt(c, 0.5)).toBe(-2);
    const cc = base({ inP: 2, outP: 6, curve: { pts: [{ s: 2, v: 1 }, { s: 6, v: 4 }] }, reverse: true });
    expect(passDuration(cc)).toBeCloseTo(passDuration({ ...cc, reverse: false }), 12);
    let prev = Infinity;
    for (let l = 0; l < passDuration(cc); l += 0.05) {
      const s = sourceAtLocal(cc, l);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
    // la curva va con el contenido: al principio del clip invertido (cerca de outP) la velocidad es la de outP (4×)
    expect(Math.abs(rateAt(cc, 0))).toBeCloseTo(4, 6);
  });

  it('congelar: dura `freeze`, siempre el mismo instante de archivo', () => {
    const c = base({ inP: 3, outP: 3.04, freeze: 2.5 });
    expect(VM.clipDuration(c)).toBe(2.5);
    for (const l of [0, 1, 2.4]) expect(sourceAtLocal(c, l)).toBe(3);
    expect(rateAt(c, 1)).toBe(0);
  });

  it('bucle: N pasadas o hasta una duración, con y sin fundido cruzado', () => {
    const c = base({ inP: 0, outP: 4, loop: { n: 3 } });
    expect(VM.clipDuration(c)).toBe(12);
    expect(sourceAtLocal(c, 4.5)).toBeCloseTo(0.5, 12);
    expect(sourceAtLocal(c, 11.9)).toBeCloseTo(3.9, 9);
    const d = base({ inP: 0, outP: 4, loop: { dur: 10 } });
    expect(VM.clipDuration(d)).toBe(10);
    expect(loopInfo(d)!.passes).toBe(3);
    const x = base({ inP: 0, outP: 4, loop: { n: 3, xf: 1 } });
    expect(VM.clipDuration(x)).toBe(10); // 3·4 − 2·1
    // en el fundido: dos capas (saliente primero) con pesos que suman 1
    const ls = layersAt(x, 3.5);
    expect(ls).toHaveLength(2);
    expect(ls[0].pass).toBe(0);
    expect(ls[1].pass).toBe(1);
    expect(ls[0].s).toBeCloseTo(3.5 + 0 /* x+P = 0,5+3 */, 9);
    expect(ls[1].s).toBeCloseTo(0.5, 9);
    expect(ls[0].g + ls[1].g).toBeCloseTo(1, 12);
    expect(ls[1].a).toBeCloseTo(0.5, 12);
    expect(layersAt(x, 1)).toHaveLength(1);
    // la copia `xlayer` ve la pasada saliente
    expect(sourceAtLocal({ ...x, xlayer: true }, 3.5)).toBeCloseTo(3.5, 9);
    expect(sourceAtLocal(x, 3.5)).toBeCloseTo(0.5, 9);
    // la duración con fundido nunca baja de una pasada y el fundido se limita a B/2
    expect(loopInfo(base({ loop: { n: 2, xf: 100 } }))!.xf).toBe(5);
    expect(sanitizeLoop({ n: 1 })).toBeUndefined();
    expect(sanitizeLoop({ n: 4, xf: 0.5 })).toEqual({ n: 4, xf: 0.5 });
  });

  it('transición: fuera del recorte el tiempo sigue a la velocidad del borde y se limita al archivo', () => {
    const c = base({ inP: 2, outP: 6, start: 10, curve: { pts: [{ s: 2, v: 1 }, { s: 6, v: 4 }] } });
    const D = passDuration(c);
    expect(extendedSourceTime(c, 10 + D + 0.5, 20)).toBeCloseTo(6 + 0.5 * 4, 9);
    expect(extendedSourceTime(c, 10 - 0.5, 20)).toBeCloseTo(2 - 0.5, 9);
    expect(extendedSourceTime(c, 10 + D + 100, 20)).toBeCloseTo(20 - 0.001, 9);
    expect(extendedSourceAt(c, -100, 20)).toBe(0);
    // sin V8 la fórmula de V6 no cambia
    expect(extendedSourceTime({ inP: 2, start: 10, speed: 2 }, 11, 20)).toBe(4);
  });

  it('localOfSource es la inversa de sourceAtLocal en una pasada', () => {
    const c = base({ inP: 1, outP: 9, curve: { pts: [{ s: 1, v: 0.3 }, { s: 5, v: 6 }, { s: 9, v: 1 }], smooth: true } });
    for (const rev of [false, true]) {
      const cc = { ...c, reverse: rev };
      for (const l of [0.2, 1, 2.2]) expect(localOfSource(cc, sourceAtLocal(cc, l))).toBeCloseTo(l, 5);
    }
    expect(averageSpeed(c)).toBeCloseTo(8 / passDuration(c), 12);
    expect(clipDurationOf(c)).toBe(passDuration(c));
  });
});

describe('operaciones del modelo con tiempo especial', () => {
  const proj = (c: Clip) => {
    let p = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
    p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'a.mp4', duration: 20, blob: undefined });
    return VM.addClip(p, 'V', c);
  };

  it('dividir una curva reparte el tiempo exacto (las mitades suman el total) y la curva sigue al contenido', () => {
    const curve: SpeedCurve = { pts: [{ s: 0, v: 0.5 }, { s: 10, v: 4 }], smooth: true };
    const p0 = proj(base({ curve }));
    const total = VM.clipDuration(VM.findClip(p0, 'c')!.clip);
    const t = total * 0.4;
    const p1 = VM.splitClip(p0, 'c', t, 'd');
    const a = VM.findClip(p1, 'c')!.clip;
    const b = VM.findClip(p1, 'd')!.clip;
    expect(VM.clipDuration(a)).toBeCloseTo(t, 6);
    expect(VM.clipDuration(a) + VM.clipDuration(b)).toBeCloseTo(total, 6);
    // el fotograma justo antes y después del corte es el mismo instante de archivo
    expect(a.outP).toBeCloseTo(b.inP, 12);
    expect(b.start).toBeCloseTo(a.start + VM.clipDuration(a), 12);
  });

  it('dividir un invertido: la 1.ª mitad es la parte alta del archivo', () => {
    const p1 = VM.splitClip(proj(base({ inP: 0, outP: 10, speed: 2, reverse: true })), 'c', 2, 'd');
    const a = VM.findClip(p1, 'c')!.clip;
    const b = VM.findClip(p1, 'd')!.clip;
    expect(a.reverse && b.reverse).toBe(true);
    expect(a.inP).toBeCloseTo(6, 9); // 2 s de salida a 2× = 4 s de archivo desde 10
    expect(a.outP).toBe(10);
    expect(b.inP).toBe(0);
    expect(b.outP).toBeCloseTo(6, 9);
  });

  it('dividir un congelado reparte la duración; un bucle no se divide', () => {
    const p1 = VM.splitClip(proj(base({ inP: 3, outP: 3.04, freeze: 4 })), 'c', 1.5, 'd');
    expect(VM.findClip(p1, 'c')!.clip.freeze).toBe(1.5);
    expect(VM.findClip(p1, 'd')!.clip.freeze).toBe(2.5);
    const pl = proj(base({ loop: { n: 3 }, outP: 2 }));
    expect(VM.splitClip(pl, 'c', 1, 'd')).toBe(pl);
  });

  it('recortar el final de un clip con curva cambia outP según el mapa (y vuelve a la misma duración pedida)', () => {
    const curve: SpeedCurve = { pts: [{ s: 0, v: 1 }, { s: 10, v: 4 }] };
    const p0 = proj(base({ curve }));
    const p1 = VM.trimClip(p0, 'c', 'out', 3);
    const c = VM.findClip(p1, 'c')!.clip;
    expect(VM.clipDuration(c)).toBeCloseTo(3, 9);
    expect(c.curve).toBe(curve);
    // recortar el inicio: la curva no se mueve respecto al contenido
    const p2 = VM.trimClip(p1, 'c', 'in', 1);
    const c2 = VM.findClip(p2, 'c')!.clip;
    expect(c2.inP).toBeCloseTo(speedMap(curve, 0, 10).toSource(1), 9);
    expect(VM.clipDuration(c2)).toBeCloseTo(2, 6);
  });

  it('recortar el final de un bucle fija su duración; un congelado cambia `freeze`', () => {
    const p1 = VM.trimClip(proj(base({ outP: 4, loop: { n: 3 } })), 'c', 'out', 7);
    expect(VM.findClip(p1, 'c')!.clip.loop).toEqual({ dur: 7 });
    expect(VM.clipDuration(VM.findClip(p1, 'c')!.clip)).toBe(7);
    const p2 = VM.trimClip(proj(base({ inP: 3, outP: 3.04, freeze: 4 })), 'c', 'out', 2);
    expect(VM.findClip(p2, 'c')!.clip.freeze).toBe(2);
  });

  it('updateClip quita los campos de V8 al ponerlos a undefined/falso y los ignora en imágenes', () => {
    const p0 = proj(base({ curve: { pts: [{ s: 0, v: 2 }] }, reverse: true, loop: { n: 2 } }));
    const p1 = VM.updateClip(p0, 'c', { curve: undefined, reverse: false, loop: undefined });
    const c = VM.findClip(p1, 'c')!.clip;
    expect('curve' in c || 'reverse' in c || 'loop' in c).toBe(false);
    let pi = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
    pi = VM.addClip(pi, 'V', VM.makeClip('image', { id: 'i', outP: 3 }));
    const pj = VM.updateClip(pi, 'i', { reverse: true });
    expect(VM.findClip(pj, 'i')!.clip.reverse).toBeUndefined();
  });
});

describe('guardado: campos aditivos del modelo v2', () => {
  it('se conservan al guardar y leer, la normalización es idempotente y un clip sin V8 no gana campos', () => {
    let p = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
    p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'a.mp4', duration: 20 });
    p = VM.addClip(p, 'V', base({ curve: { pts: [{ s: 0, v: 0.5 }, { s: 9, v: 4 }], smooth: true }, reverse: true, pitch: true, loop: { n: 3, xf: 0.5 } }));
    p = VM.addClip(p, 'V', base({ id: 'z', start: 100, inP: 4, outP: 4.04, freeze: 2, reframe: { aspect: '9:16', cx: 0.3, cy: 0.5, zoom: 2 } }));
    p = VM.addClip(p, 'V', base({ id: 'plain', start: 200 }));
    const raw = JSON.parse(JSON.stringify(serializeProject(p)));
    const back = normalizeV2(raw);
    const get = (id: string) => VM.findClip(back, id)!.clip;
    const c = get('c');
    expect(c.curve).toEqual({ pts: [{ s: 0, v: 0.5 }, { s: 9, v: 4 }], smooth: true });
    expect(c.reverse).toBe(true);
    expect(c.pitch).toBe(true);
    expect(c.loop).toEqual({ n: 3, xf: 0.5 });
    expect(get('z').freeze).toBe(2);
    expect(get('z').reframe?.aspect).toBe('9:16');
    const plain = get('plain');
    for (const k of ['curve', 'reverse', 'pitch', 'loop', 'freeze', 'reframe', 'xlayer']) expect(k in plain).toBe(false);
    // idempotente
    const again = normalizeV2(JSON.parse(JSON.stringify(serializeProject(back))));
    expect(JSON.stringify(serializeProject(again))).toBe(JSON.stringify(serializeProject(back)));
  });
});
