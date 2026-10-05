import { describe, expect, it } from 'vitest';
import {
  BrushStroke,
  applyPatch,
  blendPixel,
  brushCoverage,
  diffPatch,
  eraseAll,
  patchBytes,
  restoreAll,
  smoothEdges,
  smoothPoint,
  type MaskPatch,
} from './maskEdit';
import { StepHistory } from './maskHistory';

const W = 48;
const H = 36;

/** Foto original sintética: opaca, con color distinto en cada píxel. */
function makeOrig(): Uint8ClampedArray {
  const o = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    o[i * 4] = (i * 7) % 256;
    o[i * 4 + 1] = (i * 13 + 5) % 256;
    o[i * 4 + 2] = (i * 29 + 11) % 256;
    o[i * 4 + 3] = 255;
  }
  return o;
}

/** Recorte inicial: el original con alfa 255 dentro de un círculo y 0 fuera. */
function makeCut(orig: Uint8ClampedArray): Uint8ClampedArray {
  const c = new Uint8ClampedArray(orig);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (Math.hypot(x - W / 2, y - H / 2) > 12) c[(y * W + x) * 4 + 3] = 0;
  return c;
}

const hard = { size: 20, hardness: 1, opacity: 1 };

describe('cobertura y suavizado', () => {
  it('opaca en el núcleo, 0 fuera, lineal entre medias', () => {
    expect(brushCoverage(0, 10, 0.5)).toBe(1);
    expect(brushCoverage(5, 10, 0.5)).toBe(1);
    expect(brushCoverage(7.5, 10, 0.5)).toBeCloseTo(0.5, 10);
    expect(brushCoverage(10, 10, 0.5)).toBe(0);
    expect(brushCoverage(30, 10, 0.5)).toBe(0);
  });
  it('dureza 1: borde nítido de 1 px', () => {
    expect(brushCoverage(9.5, 10, 1)).toBe(1);
    expect(brushCoverage(10.5, 10, 1)).toBe(0);
  });
  it('suavizado 0 = sin cambio; con suavizado se queda a medio camino', () => {
    expect(smoothPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
    expect(smoothPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
    expect(smoothPoint(null, { x: 3, y: 4 }, 0.9)).toEqual({ x: 3, y: 4 });
  });
});

describe('composición borrar / restaurar', () => {
  it('borrar con cobertura total deja alfa 0 y NO toca el color', () => {
    const orig = makeOrig();
    const cur = new Uint8ClampedArray(orig);
    const s = new BrushStroke(cur, orig, W, H, { mode: 'erase', ...hard });
    s.dab(24, 18);
    const i = (18 * W + 24) * 4;
    expect(cur[i + 3]).toBe(0);
    expect([cur[i], cur[i + 1], cur[i + 2]]).toEqual([orig[i], orig[i + 1], orig[i + 2]]);
    // fuera del pincel: intacto
    const far = (2 * W + 2) * 4;
    expect(cur[far + 3]).toBe(255);
  });

  it('restaurar tras borrar devuelve los píxeles originales bit a bit', () => {
    const orig = makeOrig();
    const cur = new Uint8ClampedArray(orig);
    const er = new BrushStroke(cur, orig, W, H, { mode: 'erase', ...hard });
    for (let x = 6; x <= 42; x += 2) er.dab(x, 18);
    expect(er.finish()).not.toBeNull();
    const rs = new BrushStroke(cur, orig, W, H, { mode: 'restore', ...hard });
    for (let x = 4; x <= 44; x += 2) rs.dab(x, 18);
    rs.finish();
    for (let y = 8; y <= 28; y++)
      for (let x = 6; x <= 42; x++) {
        const i = (y * W + x) * 4;
        expect(Array.from(cur.slice(i, i + 4))).toEqual(Array.from(orig.slice(i, i + 4)));
      }
  });

  it('restaurar sobre un recorte devuelve el color ORIGINAL (no el descontaminado)', () => {
    const orig = makeOrig();
    const cur = makeCut(orig);
    // El recorte trae el borde con otro color y alfa parcial.
    const e = (18 * W + 24) * 4;
    cur[e] = 1;
    cur[e + 1] = 2;
    cur[e + 2] = 3;
    cur[e + 3] = 128;
    const rs = new BrushStroke(cur, orig, W, H, { mode: 'restore', ...hard });
    rs.dab(24, 18);
    expect(Array.from(cur.slice(e, e + 4))).toEqual(Array.from(orig.slice(e, e + 4)));
  });

  it('la opacidad limita y NO se acumula pasando dos veces por el mismo trazo', () => {
    const orig = makeOrig();
    const a = new Uint8ClampedArray(orig);
    const b = new Uint8ClampedArray(orig);
    const p = { mode: 'erase' as const, size: 20, hardness: 1, opacity: 0.5 };
    const sa = new BrushStroke(a, orig, W, H, p);
    sa.dab(24, 18);
    const sb = new BrushStroke(b, orig, W, H, p);
    sb.dab(24, 18);
    sb.dab(24, 18);
    sb.dab(25, 18);
    const i = (18 * W + 24) * 4;
    expect(a[i + 3]).toBe(Math.round((255 * (255 - 128)) / 255)); // 127
    expect(b[i + 3]).toBe(a[i + 3]);
  });

  it('un trazo nuevo SÍ acumula sobre el anterior', () => {
    const orig = makeOrig();
    const cur = new Uint8ClampedArray(orig);
    const p = { mode: 'erase' as const, size: 20, hardness: 1, opacity: 0.5 };
    for (let k = 0; k < 2; k++) {
      const s = new BrushStroke(cur, orig, W, H, p);
      s.dab(24, 18);
      s.finish();
    }
    expect(cur[(18 * W + 24) * 4 + 3]).toBeLessThan(80);
  });

  it('restaurar parcial mezcla alfa y color hacia el original', () => {
    const base = new Uint8ClampedArray([10, 20, 30, 0]);
    const o = new Uint8ClampedArray([200, 100, 50, 255]);
    const out = new Uint8ClampedArray(4);
    blendPixel('restore', base, 0, o, 0, 128, out, 0);
    expect(Array.from(out)).toEqual([200, 100, 50, 128]); // alfa 0: el color sale del original
    const base2 = new Uint8ClampedArray([0, 0, 0, 255]);
    blendPixel('restore', base2, 0, new Uint8ClampedArray([255, 255, 255, 255]), 0, 51, out, 0);
    expect(Array.from(out)).toEqual([51, 51, 51, 255]);
  });

  it('Restaurar todo vuelve a la foto sin quitar fondo; Borrar todo deja todo transparente', () => {
    const orig = makeOrig();
    const cur = makeCut(orig);
    const p = restoreAll(cur, orig, W, H)!;
    expect(Array.from(cur)).toEqual(Array.from(orig));
    applyPatch(cur, W, p, 'undo');
    expect(Array.from(cur)).toEqual(Array.from(makeCut(orig)));
    eraseAll(cur, W, H);
    for (let i = 3; i < cur.length; i += 4) expect(cur[i]).toBe(0);
    expect(eraseAll(cur, W, H)).toBeNull(); // ya estaba todo borrado
  });

  it('suavizar bordes solo toca el borde y deja lo liso igual', () => {
    const orig = makeOrig();
    const cur = makeCut(orig);
    const before = new Uint8ClampedArray(cur);
    const p = smoothEdges(cur, orig, W, H, 1)!;
    expect(p).not.toBeNull();
    // el centro sigue opaco; una esquina sigue transparente
    expect(cur[(18 * W + 24) * 4 + 3]).toBe(255);
    expect(cur[3]).toBe(0);
    // y hay alfa intermedio en el borde
    let mid = 0;
    for (let i = 3; i < cur.length; i += 4) if (cur[i] > 0 && cur[i] < 255) mid++;
    expect(mid).toBeGreaterThan(0);
    applyPatch(cur, W, p, 'undo');
    expect(Array.from(cur)).toEqual(Array.from(before));
  });
});

describe('parches: deshacer / rehacer', () => {
  it('undo y redo son idempotentes y exactos', () => {
    const orig = makeOrig();
    const cur = makeCut(orig);
    const start = new Uint8ClampedArray(cur);
    const s = new BrushStroke(cur, orig, W, H, { mode: 'restore', size: 16, hardness: 0.6, opacity: 0.8 });
    for (let x = 4; x <= 44; x += 3) s.dab(x, 10);
    const p = s.finish()!;
    const done = new Uint8ClampedArray(cur);
    expect(Array.from(p.before)).not.toEqual(Array.from(p.after));
    applyPatch(cur, W, p, 'undo');
    expect(Array.from(cur)).toEqual(Array.from(start));
    applyPatch(cur, W, p, 'undo'); // repetir no cambia nada
    expect(Array.from(cur)).toEqual(Array.from(start));
    applyPatch(cur, W, p, 'redo');
    applyPatch(cur, W, p, 'redo');
    expect(Array.from(cur)).toEqual(Array.from(done));
  });

  it('un trazo que no cambia nada no genera parche', () => {
    const orig = makeOrig();
    const cur = makeCut(orig);
    const s = new BrushStroke(cur, orig, W, H, { mode: 'erase', ...hard });
    s.dab(2, 2); // ya transparente
    expect(s.finish()).toBeNull();
  });

  it('el parche solo guarda la región tocada, no la imagen', () => {
    const orig = makeOrig();
    const cur = new Uint8ClampedArray(orig);
    const s = new BrushStroke(cur, orig, W, H, { mode: 'erase', size: 6, hardness: 1, opacity: 1 });
    s.dab(10, 10);
    const p = s.finish()!;
    expect(patchBytes(p)).toBeLessThan((W * H * 4 * 2) / 10);
    expect(p.w).toBeLessThanOrEqual(8);
  });

  it('diffPatch: null si es igual y bbox exacto si cambia', () => {
    const a = new Uint8ClampedArray(W * H);
    const b = new Uint8ClampedArray(W * H);
    expect(diffPatch(a, b, W, H, 1, 'mark')).toBeNull();
    b[5 * W + 7] = 255;
    b[9 * W + 12] = 1;
    const p = diffPatch(a, b, W, H, 1, 'mark') as MaskPatch;
    expect([p.x, p.y, p.w, p.h]).toEqual([7, 5, 6, 5]);
  });
});

describe('StepHistory', () => {
  const mk = (n = 5, limits = { maxSteps: 100, maxBytes: 1e9 }) => {
    const h = new StepHistory<string>(limits);
    for (let i = 1; i <= n; i++) h.push(`paso ${i}`, `p${i}`, 10);
    return h;
  };

  it('push, undo y redo mueven el cursor', () => {
    const h = mk(3);
    expect(h.cursor).toBe(3);
    expect(h.undo()!.label).toBe('paso 3');
    expect(h.undo()!.label).toBe('paso 2');
    expect(h.canRedo).toBe(true);
    expect(h.redo()!.label).toBe('paso 2');
    expect(h.cursor).toBe(2);
  });

  it('undo en el inicio y redo al final no hacen nada', () => {
    const h = mk(1);
    h.undo();
    expect(h.undo()).toBeNull();
    h.redo();
    expect(h.redo()).toBeNull();
  });

  it('un paso nuevo tras deshacer descarta lo rehacible', () => {
    const h = mk(4);
    h.undo();
    h.undo();
    h.push('nuevo', 'pn', 10);
    expect(h.labels()).toEqual(['paso 1', 'paso 2', 'nuevo']);
    expect(h.canRedo).toBe(false);
    expect(h.totalBytes).toBe(30);
  });

  it('límite de pasos: se descartan los más antiguos y el cursor se mantiene coherente', () => {
    const h = mk(10, { maxSteps: 4, maxBytes: 1e9 });
    expect(h.labels()).toEqual(['paso 7', 'paso 8', 'paso 9', 'paso 10']);
    expect(h.cursor).toBe(4);
    expect(h.dropped).toBe(6);
    expect(h.changed).toBe(true);
  });

  it('límite de bytes: nunca pasa del tope y conserva al menos el último paso', () => {
    const h = new StepHistory<string>({ maxSteps: 100, maxBytes: 25 });
    h.push('a', 'a', 10);
    h.push('b', 'b', 10);
    h.push('c', 'c', 10);
    expect(h.totalBytes).toBeLessThanOrEqual(25);
    expect(h.labels()).toEqual(['b', 'c']);
    h.push('gigante', 'g', 1000);
    expect(h.labels()).toEqual(['gigante']);
  });

  it('saltar a un paso: lista qué deshacer (nuevo→viejo) y qué rehacer (viejo→nuevo)', () => {
    const h = mk(5);
    let j = h.jump(2);
    expect(j.undo.map((e) => e.label)).toEqual(['paso 5', 'paso 4', 'paso 3']);
    expect(j.redo).toEqual([]);
    expect(h.cursor).toBe(2);
    j = h.jump(4);
    expect(j.redo.map((e) => e.label)).toEqual(['paso 3', 'paso 4']);
    j = h.jump(4);
    expect(j.undo).toEqual([]);
    expect(j.redo).toEqual([]);
    j = h.jump(0);
    expect(j.undo).toHaveLength(4);
    expect(h.changed).toBe(false);
    expect(h.jump(99).redo).toHaveLength(5); // se recorta al final
  });

  it('saltar con parches reales deja la máscara exactamente en ese paso', () => {
    const orig = makeOrig();
    const cur = makeCut(orig);
    const snaps: Uint8ClampedArray[] = [new Uint8ClampedArray(cur)];
    const h = new StepHistory<MaskPatch>();
    const add = (label: string, p: MaskPatch | null) => {
      expect(p).not.toBeNull();
      h.push(label, p!, patchBytes(p!));
      snaps.push(new Uint8ClampedArray(cur));
    };
    let s = new BrushStroke(cur, orig, W, H, { mode: 'erase', ...hard });
    s.dab(24, 18);
    add('Pincel borrar', s.finish());
    s = new BrushStroke(cur, orig, W, H, { mode: 'restore', ...hard });
    s.dab(8, 8);
    add('Restaurar', s.finish());
    add('Suavizar bordes', smoothEdges(cur, orig, W, H));
    const go = (n: number) => {
      const j = h.jump(n);
      for (const e of j.undo) applyPatch(cur, W, e.patch, 'undo');
      for (const e of j.redo) applyPatch(cur, W, e.patch, 'redo');
    };
    for (const n of [0, 3, 1, 2, 0, 2, 3]) {
      go(n);
      expect(Array.from(cur)).toEqual(Array.from(snaps[n]));
    }
  });
});
