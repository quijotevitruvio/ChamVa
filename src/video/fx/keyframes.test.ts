import { describe, expect, it } from 'vitest';
import { makeClip } from '../model/ops';
import type { Clip, Keyframe } from '../model/types';
import { ANIM_PRESETS, applyAnimPreset, clearKeys, copyKeys, fxAt, interpolateKeys, moveKey, pasteKeys, removeKey, setKey, shiftKeys, splitKeys, transformAt, updateKey, valueAt, volumeAt } from './keyframes';

const k = (t: number, v: number, e?: Keyframe['e'], bz?: Keyframe['bz']): Keyframe => ({ t, v, ...(e ? { e } : {}), ...(bz ? { bz } : {}) });

describe('interpolación de fotogramas clave', () => {
  it('sin fotogramas: undefined (se usa el valor base)', () => {
    expect(interpolateKeys(undefined, 1)).toBeUndefined();
    expect(interpolateKeys([], 1)).toBeUndefined();
  });
  it('un solo fotograma: constante', () => {
    expect(interpolateKeys([k(2, 7)], 0)).toBe(7);
    expect(interpolateKeys([k(2, 7)], 99)).toBe(7);
  });
  it('bordes: antes del primero y después del último valen lo de los extremos', () => {
    const ks = [k(1, 10), k(3, 30)];
    expect(interpolateKeys(ks, -5)).toBe(10);
    expect(interpolateKeys(ks, 1)).toBe(10);
    expect(interpolateKeys(ks, 3)).toBe(30);
    expect(interpolateKeys(ks, 100)).toBe(30);
  });
  it('lineal: escala 1,0 → 2,0 a mitad = 1,5', () => {
    const ks = [k(0, 1, 'linear'), k(4, 2, 'linear')];
    expect(interpolateKeys(ks, 2)).toBeCloseTo(1.5, 9);
    expect(interpolateKeys(ks, 1)).toBeCloseTo(1.25, 9);
    expect(interpolateKeys(ks, 3)).toBeCloseTo(1.75, 9);
  });
  it('sin `e` cuenta como lineal', () => {
    expect(interpolateKeys([k(0, 0), k(10, 100)], 5)).toBe(50);
  });
  it('suave: lento en los extremos, 50 % a mitad', () => {
    const ks = [k(0, 0, 'smooth'), k(1, 100)];
    expect(interpolateKeys(ks, 0.5)).toBeCloseTo(50, 9);
    expect(interpolateKeys(ks, 0.1)!).toBeLessThan(10);
    expect(interpolateKeys(ks, 0.9)!).toBeGreaterThan(90);
  });
  it('mantener: conserva el valor hasta el siguiente fotograma y salta', () => {
    const ks = [k(0, 5, 'hold'), k(2, 9)];
    expect(interpolateKeys(ks, 1.999)).toBe(5);
    expect(interpolateKeys(ks, 2)).toBe(9);
  });
  it('bézier: usa su curva (ease-in-out ≈ 0,5 a mitad; manijas distintas dan otro valor)', () => {
    expect(interpolateKeys([k(0, 0, 'bezier', [0.42, 0, 0.58, 1]), k(1, 1)], 0.5)).toBeCloseTo(0.5, 4);
    const fastStart = interpolateKeys([k(0, 0, 'bezier', [0, 1, 0.5, 1]), k(1, 1)], 0.25)!;
    expect(fastStart).toBeGreaterThan(0.5);
    // sin bz toma la bézier por defecto (ease-in-out)
    expect(interpolateKeys([k(0, 0, 'bezier'), k(1, 1)], 0.5)).toBeCloseTo(0.5, 4);
  });
  it('varios tramos con distinta interpolación', () => {
    const ks = [k(0, 0, 'linear'), k(1, 10, 'hold'), k(2, 20, 'linear'), k(3, 0)];
    expect(interpolateKeys(ks, 0.5)).toBe(5);
    expect(interpolateKeys(ks, 1.5)).toBe(10); // tramo 1→2 en hold
    expect(interpolateKeys(ks, 2.5)).toBe(10); // 20 → 0 lineal
  });
  it('dos fotogramas en el mismo instante no dividen por cero', () => {
    expect(Number.isFinite(interpolateKeys([k(1, 0), k(1, 5), k(2, 7)], 1.5)!)).toBe(true);
  });
});

describe('valores animados del clip', () => {
  const clip = (over: Partial<Clip> = {}) => makeClip('video', { id: 'c', start: 10, outP: 4, ...over });
  it('transformAt: sin claves devuelve el mismo objeto', () => {
    const c = clip();
    expect(transformAt(c, 11)).toBe(c.transform);
  });
  it('escala 1→2 en 4 s: a los 2 s del clip vale 1,5 (t es de la línea de tiempo)', () => {
    const c = clip({ keys: { scale: [k(0, 1), k(4, 2)] } });
    expect(transformAt(c, 12).scale).toBeCloseTo(1.5, 9);
    expect(transformAt(c, 10).scale).toBe(1);
    expect(transformAt(c, 14).scale).toBe(2);
    expect(transformAt(c, 12).x).toBe(0.5); // lo demás no cambia
  });
  it('la opacidad se limita a 0..1 y la escala no baja de 0', () => {
    const c = clip({ keys: { opacity: [k(0, -1), k(1, 3)], scale: [k(0, -2), k(1, -2)] } });
    expect(transformAt(c, 10).opacity).toBe(0);
    expect(transformAt(c, 11).opacity).toBe(1);
    expect(transformAt(c, 10.5).scale).toBe(0);
  });
  it('volumen animado', () => {
    const c = clip({ volume: 1, keys: { volume: [k(0, 0), k(2, 2)] } });
    expect(volumeAt(c, 11)).toBeCloseTo(1, 9);
    expect(volumeAt(clip({ volume: 0.7 }), 11)).toBe(0.7);
    expect(valueAt(c, 'volume', 12, 1)).toBe(2);
  });
  it('intensidad y parámetros de un efecto animados', () => {
    const c = clip({ keys: { 'fx.a.amount': [k(0, 0), k(2, 1)], 'fx.a.v': [k(0, -1), k(2, 1)] } });
    const fx = { id: 'a', type: 'brightness', amount: 1, p: { v: 0.2 } };
    const at1 = fxAt(c, fx, 11);
    expect(at1.amount).toBeCloseTo(0.5, 9);
    expect(at1.p!.v).toBeCloseTo(0, 9);
    expect(fx.p.v).toBe(0.2); // no muta
    expect(fxAt(c, { ...fx, id: 'otro' }, 11)).toEqual({ ...fx, id: 'otro' });
  });
});

describe('edición de fotogramas', () => {
  const base = () => makeClip('video', { id: 'c', start: 0, outP: 10 });
  it('setKey ordena, reemplaza en el mismo instante y conserva la interpolación', () => {
    let c = setKey(base(), 'scale', 2, 2, { e: 'smooth' });
    c = setKey(c, 'scale', 0, 1);
    expect(c.keys!.scale.map((x) => x.t)).toEqual([0, 2]);
    c = setKey(c, 'scale', 2.0004, 3); // mismo instante (< 1 ms)
    expect(c.keys!.scale).toHaveLength(2);
    expect(c.keys!.scale[1]).toMatchObject({ t: 2, v: 3, e: 'smooth' });
  });
  it('rechaza valores no finitos', () => {
    const c = base();
    expect(setKey(c, 'x', NaN, 1)).toBe(c);
    expect(setKey(c, 'x', 1, Infinity)).toBe(c);
  });
  it('quitar el último fotograma quita la propiedad y `keys`', () => {
    let c = setKey(base(), 'x', 1, 0.3);
    c = removeKey(c, 'x', 0);
    expect(c.keys).toBeUndefined();
    expect(removeKey(base(), 'x', 0)).toEqual(base());
  });
  it('mover: reordena y sustituye al que haya en el destino', () => {
    let c = base();
    for (const [t, v] of [[0, 0], [2, 1], [4, 2]] as const) c = setKey(c, 'y', t, v);
    c = moveKey(c, 'y', 0, 5);
    expect(c.keys!.y.map((x) => [x.t, x.v])).toEqual([[2, 1], [4, 2], [5, 0]]);
    c = moveKey(c, 'y', 0, 4); // cae sobre el de t=4
    expect(c.keys!.y.map((x) => [x.t, x.v])).toEqual([[4, 1], [5, 0]]);
  });
  it('updateKey cambia valor e interpolación', () => {
    let c = setKey(base(), 'x', 1, 0.2);
    c = updateKey(c, 'x', 0, { v: 0.9, e: 'hold' });
    expect(c.keys!.x[0]).toMatchObject({ v: 0.9, e: 'hold' });
  });
  it('copiar y pegar en otro instante (relativo)', () => {
    let c = base();
    c = setKey(c, 'x', 1, 0.1);
    c = setKey(c, 'x', 2, 0.9, { e: 'smooth' });
    c = setKey(c, 'y', 2, 0.4);
    const clip = copyKeys(c, 1, 2);
    expect(clip).toHaveLength(2);
    const pasted = pasteKeys(c, clip, 6);
    expect(pasted.keys!.x.map((x) => [x.t, x.v])).toEqual([[1, 0.1], [2, 0.9], [6, 0.1], [7, 0.9]]);
    expect(pasted.keys!.x[3].e).toBe('smooth');
    expect(copyKeys(c, 1, 2, 'y')).toHaveLength(1);
  });
  it('clearKeys', () => {
    let c = setKey(setKey(base(), 'x', 1, 1), 'y', 1, 1);
    expect(Object.keys(clearKeys(c, 'x').keys!)).toEqual(['y']);
    expect(clearKeys(c).keys).toBeUndefined();
  });
  it('shiftKeys: al recortar el inicio los fotogramas se quedan en su instante de la línea de tiempo', () => {
    let c = base();
    c = setKey(setKey(c, 'scale', 0, 1, { e: 'linear' }), 'scale', 4, 2);
    // el clip empieza 1 s más tarde: lo que estaba en t=4 queda en 3; el borde 0 vale lo interpolado a 1 s (1,25)
    const s = shiftKeys(c, -1);
    expect(s.keys!.scale.map((x) => [x.t, x.v])).toEqual([[0, 1.25], [3, 2]]);
    expect(interpolateKeys(s.keys!.scale, 3)).toBe(2);
    expect(shiftKeys(c, 0)).toBe(c);
  });
  it('splitKeys: continúa el valor en el corte y rebasa la 2.ª mitad', () => {
    const keys = { scale: [k(0, 1, 'linear'), k(4, 2, 'linear')] };
    const { left, right } = splitKeys(keys, 1)!;
    expect(interpolateKeys(left!.scale, 1)).toBeCloseTo(1.25, 9);
    expect(interpolateKeys(right!.scale, 0)).toBeCloseTo(1.25, 9);
    expect(interpolateKeys(right!.scale, 3)).toBeCloseTo(2, 9); // 4 − 1
    expect(interpolateKeys(right!.scale, 1.5)).toBeCloseTo(1.625, 9); // 2,5 s del original
    expect(splitKeys(undefined, 1)).toEqual({});
  });
});

describe('presets de animación', () => {
  it('Ken Burns acerca de x1 a x1,25 durante todo el clip', () => {
    const c = applyAnimPreset(makeClip('image', { id: 'i', outP: 6 }), 'kenburns-in', 6);
    const sc = c.keys!.scale;
    expect(sc[0]).toMatchObject({ t: 0, v: 1 });
    expect(sc[sc.length - 1]).toMatchObject({ t: 6, v: 1.25 });
    expect(transformAt(c, 3).scale).toBeCloseTo(1.125, 6);
  });
  it('todos los presets dan fotogramas válidos, ordenados y finitos', () => {
    for (const p of ANIM_PRESETS) {
      const c = applyAnimPreset(makeClip('video', { id: 'v', outP: 5 }), p.id, 5);
      expect(c.keys, p.id).toBeTruthy();
      for (const list of Object.values(c.keys!)) {
        for (let i = 0; i < list.length; i++) {
          expect(Number.isFinite(list[i].v)).toBe(true);
          if (i) expect(list[i].t).toBeGreaterThan(list[i - 1].t);
          expect(list[i].t).toBeLessThanOrEqual(5 + 1e-9);
        }
      }
    }
  });
  it('latido repite cada segundo', () => {
    const c = applyAnimPreset(makeClip('video', { id: 'v', outP: 3 }), 'pulse', 3);
    expect(transformAt(c, 0.15).scale).toBeGreaterThan(1.1);
    expect(transformAt(c, 1.15).scale).toBeGreaterThan(1.1);
    expect(transformAt(c, 0.9).scale).toBeCloseTo(1, 6);
  });
  it('un preset desconocido o una duración nula no cambia nada', () => {
    const c = makeClip('video', { id: 'v', outP: 3 });
    expect(applyAnimPreset(c, 'nope', 3)).toBe(c);
    expect(applyAnimPreset(c, 'pulse', 0)).toBe(c);
  });
});
