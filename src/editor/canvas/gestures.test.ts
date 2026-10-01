import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  detectMultiTap,
  dragCacheRatio,
  isHeavyLayer,
  isPalm,
  penIsRecent,
  pinchMetrics,
  pinchScale,
  pressureFactor,
  rotationAfterDeadzone,
  snapAngle,
  type TouchTrack,
} from './gestures';

const tk = (t0: number, maxMove = 2, id = 0): TouchTrack => ({ id, x0: 0, y0: 0, t0, maxMove });

describe('pellizco', () => {
  it('mide distancia, ángulo y centro', () => {
    const m = pinchMetrics({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(m.dist).toBeCloseTo(50);
    expect(m.cx).toBe(15);
    expect(m.cy).toBe(20);
    expect(pinchMetrics({ x: 0, y: 0 }, { x: 0, y: 10 }).angle).toBeCloseTo(90);
  });
  it('escala = cociente de distancias', () => {
    expect(pinchScale(100, 150)).toBeCloseTo(1.5);
    expect(pinchScale(0, 150)).toBe(1);
  });
  it('diferencia de ángulo cruza ±180', () => {
    expect(angleDelta(170, -170)).toBeCloseTo(20);
    expect(angleDelta(-170, 170)).toBeCloseTo(-20);
    expect(angleDelta(10, 30)).toBeCloseTo(20);
  });
  it('zona muerta del giro', () => {
    expect(rotationAfterDeadzone(4)).toBe(0);
    expect(rotationAfterDeadzone(10)).toBeCloseTo(4);
    expect(rotationAfterDeadzone(-10)).toBeCloseTo(-4);
  });
});

describe('ajuste a 45°', () => {
  it('imanta cerca de un múltiplo', () => {
    expect(snapAngle(43)).toBe(45);
    expect(snapAngle(92)).toBe(90);
    expect(snapAngle(-47)).toBe(-45);
    expect(snapAngle(0.5)).toBe(0);
  });
  it('no toca ángulos lejanos', () => {
    expect(snapAngle(30)).toBe(30);
    expect(snapAngle(60)).toBe(60);
  });
});

describe('toques múltiples', () => {
  it('2 dedos rápidos y quietos = deshacer', () => {
    expect(detectMultiTap([tk(0), tk(30)], 150)).toBe('undo');
  });
  it('3 dedos = rehacer', () => {
    expect(detectMultiTap([tk(0), tk(20), tk(40)], 160)).toBe('redo');
  });
  it('si se mueven es pellizco, no toque', () => {
    expect(detectMultiTap([tk(0, 30), tk(10, 2)], 150)).toBeNull();
  });
  it('demasiado largo no es toque', () => {
    expect(detectMultiTap([tk(0), tk(10)], 600)).toBeNull();
  });
  it('dedos apoyados con mucha diferencia no cuentan', () => {
    expect(detectMultiTap([tk(0), tk(200)], 250)).toBeNull();
  });
  it('1 o 4 dedos no cuentan', () => {
    expect(detectMultiTap([tk(0)], 100)).toBeNull();
    expect(detectMultiTap([tk(0), tk(1), tk(2), tk(3)], 100)).toBeNull();
  });
});

describe('rechazo de palma', () => {
  it('ignora toques anchos con el lápiz activo', () => {
    expect(isPalm({ pointerType: 'touch', width: 60, height: 70, penRecent: true })).toBe(true);
  });
  it('deja pasar dedos normales o sin lápiz', () => {
    expect(isPalm({ pointerType: 'touch', width: 12, height: 14, penRecent: true })).toBe(false);
    expect(isPalm({ pointerType: 'touch', width: 60, height: 70, penRecent: false })).toBe(false);
    expect(isPalm({ pointerType: 'pen', width: 60, height: 70, penRecent: true })).toBe(false);
  });
  it('ventana de lápiz reciente', () => {
    expect(penIsRecent(1000, 2000)).toBe(true);
    expect(penIsRecent(1000, 9000)).toBe(false);
    expect(penIsRecent(0, 10)).toBe(false);
  });
});

describe('presión', () => {
  it('solo responde con lápiz e interruptor', () => {
    expect(pressureFactor('pen', 0.5, true)).toBe(0.5);
    expect(pressureFactor('mouse', 0.5, true)).toBe(1);
    expect(pressureFactor('pen', 0.5, false)).toBe(1);
  });
  it('acota y trata 0 como medio', () => {
    expect(pressureFactor('pen', 0.01, true)).toBe(0.15);
    expect(pressureFactor('pen', 0, true)).toBe(0.5);
    expect(pressureFactor('pen', 2, true)).toBe(1);
  });
});

describe('capas pesadas', () => {
  it('sombras y ajustes cuentan', () => {
    expect(isHeavyLayer({ type: 'shape', shadow: true })).toBe(true);
    expect(isHeavyLayer({ type: 'image', filter: 'none', adjust: { brightness: 0 } })).toBe(false);
    expect(isHeavyLayer({ type: 'image', filter: 'none', adjust: { brightness: 10 } })).toBe(true);
    expect(isHeavyLayer({ type: 'image', filter: 'bw' })).toBe(true);
    expect(isHeavyLayer({ type: 'text', textEffect: 'echo' })).toBe(true);
    expect(isHeavyLayer({ type: 'text', textEffect: 'none' })).toBe(false);
  });
  it('resolución de la caché acotada', () => {
    expect(dragCacheRatio(0.1)).toBe(0.2);
    expect(dragCacheRatio(5)).toBe(1);
  });
});
