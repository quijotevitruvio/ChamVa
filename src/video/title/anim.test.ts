import { describe, expect, it } from 'vitest';
import { ANIM_IN, NEUTRAL, animDurations, effectiveUnit, emphasisState, enterState, needsUnits, unitProgress, unitState } from './anim';
import { activeWordIndex, splitWords, wordKaraoke, wordTimings } from './karaoke';

describe('entradas', () => {
  it('todas empiezan «fuera» y acaban en su sitio', () => {
    for (const a of ANIM_IN) {
      if (a.id === 'none' || a.id === 'typewriter') continue;
      const end = enterState(a.id, 1);
      expect(end.opacity, a.id).toBeCloseTo(1, 6);
      expect(end.scale, a.id).toBeCloseTo(1, 6);
      expect(Math.abs(end.dx) + Math.abs(end.dy) + Math.abs(end.rotation), a.id).toBeCloseTo(0, 6);
      const start = enterState(a.id, 0);
      expect(start.opacity, a.id).toBeCloseTo(0, 6);
    }
  });
  it('avanzan de forma monótona (fundido y subir)', () => {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      const o = enterState('fade', p).opacity;
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
    expect(enterState('slideUp', 0).dy).toBeGreaterThan(enterState('slideUp', 0.5).dy);
    expect(enterState('slideLeft', 0).dx).toBeLessThan(0);
    expect(enterState('slideRight', 0).dx).toBeGreaterThan(0);
  });
  it('pop rebasa 1 y vuelve; bounce rebota', () => {
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => enterState('pop', i / 100).scale));
    expect(peak).toBeGreaterThan(1.05);
    const dys = Array.from({ length: 101 }, (_, i) => enterState('bounce', i / 100).dy);
    // rebota: sube y baja más de una vez (cambia de sentido)
    let turns = 0;
    for (let i = 2; i < dys.length; i++) if ((dys[i] - dys[i - 1]) * (dys[i - 1] - dys[i - 2]) < 0) turns++;
    expect(turns).toBeGreaterThanOrEqual(2);
  });
  it('fuera de rango se limita', () => {
    expect(enterState('fade', -3).opacity).toBe(0);
    expect(enterState('fade', 9).opacity).toBe(1);
    expect(enterState('inventada', 0.3)).toEqual(NEUTRAL);
    expect(enterState(undefined, 0.3)).toEqual(NEUTRAL);
  });
});

describe('unitState: entrada y salida en el tiempo', () => {
  const anim = { in: 'fade', out: 'fade', inDur: 0.5, outDur: 0.5 };
  it('aparece, se queda y desaparece', () => {
    const o = (lt: number) => unitState(anim, lt, 4).state.opacity;
    expect(o(0)).toBe(0);
    expect(o(0.25)).toBeGreaterThan(0.5); // easeOut: más rápido al principio
    expect(o(0.25)).toBeLessThan(1);
    expect(o(0.5)).toBe(1);
    expect(o(2)).toBe(1);
    expect(o(3.75)).toBeGreaterThan(0.5);
    expect(o(3.75)).toBeLessThan(1);
    expect(o(4)).toBe(0);
  });
  it('sin animación todo es neutro y visible', () => {
    expect(unitState(undefined, 1, 4)).toEqual({ state: NEUTRAL, visible: true });
    expect(unitState({}, 1, 4).state).toEqual(NEUTRAL);
  });
  it('si entrada + salida no caben en el clip se reducen en proporción', () => {
    expect(animDurations(anim, 0.5)).toEqual({ inD: 0.25, outD: 0.25 });
    expect(animDurations(anim, 10)).toEqual({ inD: 0.5, outD: 0.5 });
    expect(animDurations({ in: 'fade', inDur: 2 }, 1).inD).toBe(1);
  });
  it('entrada y salida solapadas en un clip muy corto no dan NaN', () => {
    for (let lt = 0; lt <= 0.2; lt += 0.02) {
      const s = unitState(anim, lt, 0.2).state;
      expect(Number.isFinite(s.opacity)).toBe(true);
    }
  });
  it('máquina de escribir: se revelan 1 letra cada vez y se borran al final', () => {
    const tw = { in: 'typewriter', out: 'typewriter', inDur: 1, outDur: 1 };
    const n = 10;
    const shown = (lt: number) => Array.from({ length: n }, (_, i) => unitState(tw, lt, 5, i, n).visible).filter(Boolean).length;
    expect(shown(0)).toBe(0);
    expect(shown(0.05)).toBe(1);
    expect(shown(0.35)).toBe(4);
    expect(shown(0.99)).toBe(10);
    expect(shown(2.5)).toBe(10);
    expect(shown(4.5)).toBe(5);
    expect(shown(4.99)).toBe(1);
    expect(shown(5)).toBe(0);
  });
  it('por unidades: con retardo escalonado la primera va por delante de la última', () => {
    const a = { in: 'fade', unit: 'word' as const, inDur: 1, stagger: 0.6 };
    const first = unitState(a, 0.4, 5, 0, 5).state.opacity;
    const last = unitState(a, 0.4, 5, 4, 5).state.opacity;
    expect(first).toBeGreaterThan(last);
    expect(unitState(a, 1, 5, 4, 5).state.opacity).toBe(1);
    expect(unitProgress(1, 4, 5, 0.6)).toBe(1);
    expect(unitProgress(0, 4, 5, 0.6)).toBe(0);
    expect(unitProgress(0.5, 0, 1, 0.6)).toBe(0.5);
  });
});

describe('énfasis', () => {
  it('es continuo y periódico', () => {
    const a = { emphasis: 'pulse', emphasisSpeed: 2 };
    expect(emphasisState(a, 0).scale).toBe(1);
    expect(emphasisState(a, 0.125).scale).toBeGreaterThan(1.05);
    expect(emphasisState(a, 0.375).scale).toBeLessThan(0.95);
    expect(emphasisState(a, 0.5).scale).toBeCloseTo(1, 6);
    expect(emphasisState(a, 3.125).scale).toBeCloseTo(emphasisState(a, 0.125).scale, 6);
  });
  it('cada uno mueve lo suyo', () => {
    expect(emphasisState({ emphasis: 'float' }, 0.25).dy).not.toBe(0);
    expect(emphasisState({ emphasis: 'wiggle' }, 0.25).rotation).not.toBe(0);
    expect(emphasisState({ emphasis: 'shake' }, 0.03).dx).not.toBe(0);
    const o = Array.from({ length: 20 }, (_, i) => emphasisState({ emphasis: 'blink' }, i * 0.05).opacity);
    expect(Math.min(...o)).toBeLessThan(0.5);
    expect(Math.max(...o)).toBeGreaterThan(0.95);
    expect(emphasisState({ emphasis: 'none' }, 1)).toEqual(NEUTRAL);
    expect(emphasisState(undefined, 1)).toEqual(NEUTRAL);
  });
});

describe('unidad efectiva', () => {
  it('la máquina de escribir va letra a letra; sin animación todo', () => {
    expect(effectiveUnit({ in: 'typewriter' })).toBe('letter');
    expect(effectiveUnit({ in: 'fade' })).toBe('all');
    expect(effectiveUnit({ in: 'fade', unit: 'word' })).toBe('word');
    expect(effectiveUnit(undefined)).toBe('all');
    expect(needsUnits({ in: 'fade' })).toBe(false);
    expect(needsUnits({ in: 'fade', unit: 'letter' })).toBe(true);
    expect(needsUnits({ karaoke: { color: '#fff', scale: 1, keep: false } })).toBe(true);
  });
});

describe('karaoke', () => {
  it('palabras con su posición (acentos, eñes y espacios dobles)', () => {
    expect(splitWords('  El  niño\nmás')).toEqual([
      { text: 'El', from: 2, to: 4 },
      { text: 'niño', from: 6, to: 10 },
      { text: 'más', from: 11, to: 14 },
    ]);
  });
  it('reparte el tiempo por letras y cubre toda la duración', () => {
    const t = wordTimings('uno tres cuatro', 3);
    expect(t).toHaveLength(3);
    expect(t[0].start).toBe(0);
    expect(t[2].end).toBeCloseTo(3, 9);
    expect(t[1].start).toBeCloseTo(t[0].end, 9);
    expect(t[2].end - t[2].start).toBeGreaterThan(t[0].end - t[0].start);
  });
  it('usa los tiempos del clip si coinciden con el texto; si se editó el texto, vuelve al reparto', () => {
    const words = [
      { text: 'a', start: 0.5, end: 1 },
      { text: 'b', start: 1, end: 2 },
    ];
    expect(wordTimings('a b', 5, words)).toEqual(words);
    expect(wordTimings('a b c', 5, words)[0].start).toBe(0);
  });
  it('palabra activa en el tiempo', () => {
    const t = wordTimings('uno dos tres', 3, [
      { text: 'uno', start: 0, end: 1 },
      { text: 'dos', start: 1, end: 2 },
      { text: 'tres', start: 2, end: 3 },
    ]);
    expect(activeWordIndex(t, -1)).toBe(-1);
    expect(activeWordIndex(t, 0)).toBe(0);
    expect(activeWordIndex(t, 1.5)).toBe(1);
    expect(activeWordIndex(t, 99)).toBe(2);
    const k = { color: '#ff0', scale: 1.2, keep: false };
    const at = (lt: number) => t.map((_, i) => wordKaraoke(k, t, i, lt));
    expect(at(0.5).map((x) => x.colored)).toEqual([true, false, false]);
    expect(at(1.5).map((x) => x.colored)).toEqual([false, true, false]);
    expect(at(1.5)[1].scale).toBeCloseTo(1.2, 6);
    expect(at(1.01)[1].scale).toBeLessThan(1.2); // rampa de entrada
    expect(at(1.01)[1].scale).toBeGreaterThan(1);
    expect(at(2.5).map((x) => x.colored)).toEqual([false, false, true]);
  });
  it('keep: las ya dichas conservan el color', () => {
    const t = wordTimings('a b c', 3);
    const k = { color: '#0f0', scale: 1, keep: true };
    const colored = (lt: number) => t.map((_, i) => wordKaraoke(k, t, i, lt).colored);
    expect(colored(0.1)).toEqual([true, false, false]);
    expect(colored(1.5)).toEqual([true, true, false]);
    expect(colored(2.9)).toEqual([true, true, true]);
  });
  it('texto vacío', () => {
    expect(wordTimings('', 2)).toEqual([]);
    expect(wordKaraoke({ color: '#fff', scale: 1, keep: false }, [], 0, 0).colored).toBe(false);
  });
});
