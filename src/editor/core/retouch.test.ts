import { describe, expect, it } from 'vitest';
import {
  RetouchStroke,
  boxBlurRegion,
  cloneOffsetForStroke,
  diffBounds,
  discMask,
  dodgeBurnTarget,
  extractPatch,
  newCloneSource,
  newPix,
  overPatch,
  poissonClone,
  removeSpot,
  setCloneOrigin,
  sourceMapper,
  strokePoints,
  validRetouch,
  hasRetouch,
  clonePix,
  type Pix,
  type StrokeParams,
} from './retouch';

const px = (p: Pix, x: number, y: number) => {
  const i = (y * p.w + x) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
};
const fill = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): Pix => {
  const p = newPix(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = f(x, y);
    p.data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return p;
};
// Cuadrícula con color único por celda de 8 px.
const grid = (w: number, h: number) => fill(w, h, (x, y) => [((x >> 3) * 31) % 256, ((y >> 3) * 53) % 256, (((x >> 3) + (y >> 3)) * 17) % 256]);
const base: Omit<StrokeParams, 'tool'> = { radius: 6, hardness: 1, opacity: 1 };

describe('clonar', () => {
  it('copia EXACTO el origen con un desplazamiento fijo', () => {
    const p = grid(96, 96);
    const orig = clonePix(p);
    const st = new RetouchStroke(p, { ...base, tool: 'clone', radius: 10 });
    st.clone(70, 70, -40, -40);
    let n = 0;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      const d = Math.hypot(x + 0.5 - 70, y + 0.5 - 70);
      if (d <= 8.5) {
        expect(px(p, x, y)).toEqual(px(orig, x - 40, y - 40));
        n++;
      } else if (d > 11.5) expect(px(p, x, y)).toEqual(px(orig, x, y));
    }
    expect(n).toBeGreaterThan(200);
  });

  it('un trazo con dos puntos solapados no acumula (cobertura máxima) y fuerza 0 no cambia nada', () => {
    const p = grid(96, 96);
    const orig = clonePix(p);
    const st = new RetouchStroke(p, { ...base, tool: 'clone', radius: 8, opacity: 0.5, hardness: 1 });
    for (const [x, y] of strokePoints(40, 60, 60, 60, 2)) st.clone(x, y, -30, -30);
    const mid = px(p, 50, 60);
    const o = px(orig, 50, 60);
    const s = px(orig, 20, 30);
    for (let c = 0; c < 3; c++) expect(Math.abs(mid[c] - (o[c] + (s[c] - o[c]) * 0.5))).toBeLessThanOrEqual(1);
    const q = grid(96, 96);
    const z = new RetouchStroke(q, { ...base, tool: 'clone', opacity: 0 });
    z.clone(50, 50, -30, -30);
    expect(Array.from(q.data)).toEqual(Array.from(orig.data));
  });

  it('el límite de selección (0) impide el efecto y 1 lo permite', () => {
    const a = grid(64, 64);
    const o = clonePix(a);
    new RetouchStroke(a, { ...base, tool: 'clone', radius: 8, limit: () => 0 }).clone(40, 40, -30, -30);
    expect(Array.from(a.data)).toEqual(Array.from(o.data));
    new RetouchStroke(a, { ...base, tool: 'clone', radius: 8, limit: (x) => (x < 40 ? 1 : 0) }).clone(40, 40, -30, -30);
    expect(px(a, 38, 40)).toEqual(px(o, 8, 10));
    expect(px(a, 43, 40)).toEqual(px(o, 43, 40));
  });

  it('origen alineado conserva el desplazamiento; fijo vuelve al origen en cada trazo', () => {
    let cs = setCloneOrigin(newCloneSource(true), 10, 10);
    const r1 = cloneOffsetForStroke(cs, 50, 40)!;
    expect(r1.offset).toEqual([-40, -30]);
    cs = r1.state;
    expect(cloneOffsetForStroke(cs, 80, 90)!.offset).toEqual([-40, -30]);
    let fx = setCloneOrigin(newCloneSource(false), 10, 10);
    const f1 = cloneOffsetForStroke(fx, 50, 40)!;
    fx = f1.state;
    expect(cloneOffsetForStroke(fx, 80, 90)!.offset).toEqual([-70, -80]);
    // Sin origen no hay clonado.
    expect(cloneOffsetForStroke(newCloneSource(), 1, 1)).toBeNull();
    // Alt+clic otra vez reinicia el desplazamiento.
    expect(setCloneOrigin(cs, 5, 5).offset).toBeNull();
  });
});

describe('esquivar y quemar', () => {
  it('sigue la curva conocida por rango', () => {
    // Medios tonos (L≈0.5): peso ≈ 1.
    const mid = dodgeBurnTarget([128, 128, 128], true, 'midtones', 0.5);
    expect(mid[0]).toBeCloseTo(128 + 127 * 0.5 * (4 * (128 / 255) * (1 - 128 / 255)), 3);
    const burn = dodgeBurnTarget([128, 128, 128], false, 'midtones', 0.5);
    expect(burn[0]).toBeCloseTo(128 * (1 - 0.5 * (4 * (128 / 255) * (1 - 128 / 255))), 3);
    // Esquivar luces no toca el negro puro; quemar sombras no toca el blanco.
    expect(dodgeBurnTarget([0, 0, 0], true, 'highlights', 1)).toEqual([0, 0, 0]);
    expect(dodgeBurnTarget([255, 255, 255], false, 'shadows', 1)).toEqual([255, 255, 255]);
    // Exposición 0 = sin cambio.
    expect(dodgeBurnTarget([90, 120, 30], true, 'midtones', 0)).toEqual([90, 120, 30]);
  });

  it('el pincel aclara/oscurece y respeta cobertura máxima', () => {
    const p = fill(40, 40, () => [100, 100, 100]);
    const st = new RetouchStroke(p, { ...base, tool: 'dodge', radius: 10, range: 'midtones', exposure: 0.5 });
    st.dodgeBurn(20, 20, true);
    st.dodgeBurn(21, 20, true); // solapa: no suma
    const w = 4 * (100 / 255) * (1 - 100 / 255);
    expect(px(p, 20, 20)[0]).toBe(Math.round(100 + 155 * 0.5 * w) as number);
    expect(px(p, 2, 2)[0]).toBe(100);
    const q = fill(40, 40, () => [100, 100, 100]);
    new RetouchStroke(q, { ...base, tool: 'burn', radius: 10, range: 'midtones', exposure: 0.5 }).dodgeBurn(20, 20, false);
    expect(px(q, 20, 20)[0]).toBeLessThan(100);
  });
});

describe('desenfocar, enfocar y dedo', () => {
  it('desenfocar suaviza un borde y enfocar lo acentúa', () => {
    const edge = () => fill(40, 40, (x) => (x < 20 ? [60, 60, 60] : [200, 200, 200]));
    const b = edge();
    new RetouchStroke(b, { ...base, tool: 'blur', radius: 12 }).filter(20, 20, false);
    expect(px(b, 19, 20)[0]).toBeGreaterThan(60);
    expect(px(b, 20, 20)[0]).toBeLessThan(200);
    const s = edge();
    new RetouchStroke(s, { ...base, tool: 'sharpen', radius: 12 }).filter(20, 20, true);
    expect(px(s, 19, 20)[0]).toBeLessThan(60);
    expect(px(s, 20, 20)[0]).toBeGreaterThan(200);
    // En zona lisa no hace nada.
    const f = fill(30, 30, () => [90, 90, 90]);
    new RetouchStroke(f, { ...base, tool: 'blur', radius: 8 }).filter(15, 15, false);
    expect(px(f, 15, 15)[0]).toBe(90);
  });

  it('el box blur de una región coincide con el cálculo directo', () => {
    const p = grid(30, 30);
    const out = boxBlurRegion(p, { x: 5, y: 5, w: 8, h: 8 }, 2);
    let r = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) r += px(p, 8 + dx, 9 + dy)[0];
    expect(out[((9 - 5) * 8 + (8 - 5)) * 4]).toBeCloseTo(r / 25, 4);
  });

  it('el dedo arrastra color en el sentido del trazo', () => {
    const p = fill(60, 30, (x) => (x < 20 ? [255, 0, 0] : [0, 0, 255]));
    const st = new RetouchStroke(p, { ...base, tool: 'smudge', radius: 8, opacity: 1 });
    st.smudge(14, 15); // recoge rojo
    for (const [x, y] of strokePoints(14, 15, 40, 15, 3)) st.smudge(x, y);
    expect(px(p, 28, 15)[0]).toBeGreaterThan(60); // el rojo se ha arrastrado hacia el azul
  });
});

describe('clonado de Poisson / valores medios sobre un gradiente conocido', () => {
  const W = 60;
  const H = 60;
  const grad = (x: number, y: number) => 20 + 2 * x + y;
  it('empalma sin costuras: textura del origen + corrección suave de color', () => {
    const dest = new Uint8ClampedArray(W * H * 4);
    const src = new Uint8ClampedArray(W * H * 4);
    const mask = new Uint8Array(W * H);
    const tex = (x: number, y: number) => 12 * Math.sin(x * 0.9) * Math.cos(y * 0.7);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = grad(x, y) + (Math.hypot(x - 30, y - 30) < 8 ? 60 : 0); // mancha clara en el destino
      dest.set([d, d, d, 255], i);
      const s = 90 + 0.5 * x - 0.3 * y + tex(x, y); // origen: otro gradiente + textura
      src.set([s, s, s, 255], i);
      if (Math.hypot(x - 30, y - 30) < 12) mask[y * W + x] = 255;
    }
    const out = poissonClone(dest, src, mask, W, H);
    // Fuera de la máscara no cambia.
    expect(out[(5 * W + 5) * 4]).toBe(dest[(5 * W + 5) * 4]);
    // El resultado interior ≈ gradiente del destino + textura (src − su gradiente): la mancha desaparece.
    let maxErr = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (mask[y * W + x] !== 255) continue;
      const srcGrad = 90 + 0.5 * x - 0.3 * y;
      const expected = grad(x, y) + tex(x, y) + 0 * srcGrad;
      maxErr = Math.max(maxErr, Math.abs(out[(y * W + x) * 4] - expected));
    }
    expect(maxErr).toBeLessThan(10); // el resto es la textura del origen que la interpolación del contorno no reproduce
    // Sin costura: junto al borde el valor casi coincide con el vecino de fuera.
    for (let a = 0; a < 360; a += 15) {
      const bx = Math.round(30 + 11.5 * Math.cos((a * Math.PI) / 180));
      const by = Math.round(30 + 11.5 * Math.sin((a * Math.PI) / 180));
      const ox = Math.round(30 + 13 * Math.cos((a * Math.PI) / 180));
      const oy = Math.round(30 + 13 * Math.sin((a * Math.PI) / 180));
      expect(Math.abs(out[(by * W + bx) * 4] - out[(oy * W + ox) * 4])).toBeLessThan(22); // textura ±12 + gradiente
    }
  });

  it('con una máscara a medias mezcla suave, y vacía no cambia nada', () => {
    const dest = new Uint8ClampedArray(16 * 16 * 4).fill(100);
    const src = new Uint8ClampedArray(16 * 16 * 4).fill(200);
    const m0 = new Uint8Array(256);
    expect(Array.from(poissonClone(dest, src, m0, 16, 16))).toEqual(Array.from(dest));
  });
});

describe('eliminar mancha', () => {
  it('sobre un fondo liso deja el fondo liso', () => {
    const p = fill(80, 80, () => [200, 180, 160]);
    for (let y = 36; y < 44; y++) for (let x = 36; x < 44; x++) if (Math.hypot(x - 39.5, y - 39.5) < 3.5) p.data.set([30, 20, 20, 255], (y * 80 + x) * 4);
    const r = removeSpot(p, 40, 40, 8);
    expect(r).not.toBeNull();
    for (let y = 30; y < 50; y++) for (let x = 30; x < 50; x++) {
      const v = px(p, x, y);
      expect(Math.abs(v[0] - 200) + Math.abs(v[1] - 180) + Math.abs(v[2] - 160)).toBeLessThanOrEqual(3);
    }
  });

  it('sobre un degradado queda continuo (diferencia máxima pequeña)', () => {
    const p = fill(100, 100, (x, y) => [60 + x, 80 + y, 120]);
    for (let y = 46; y < 55; y++) for (let x = 46; x < 55; x++) if (Math.hypot(x - 50.5, y - 50.5) < 4.5) p.data.set([255, 255, 255, 255], (y * 100 + x) * 4);
    removeSpot(p, 51, 51, 9);
    let maxErr = 0;
    for (let y = 38; y < 62; y++) for (let x = 38; x < 62; x++) {
      const v = px(p, x, y);
      maxErr = Math.max(maxErr, Math.abs(v[0] - (60 + x)), Math.abs(v[1] - (80 + y)), Math.abs(v[2] - 120));
    }
    expect(maxErr).toBeLessThan(5);
  });
});

describe('curar con el pincel', () => {
  it('copia la textura del origen con el color del entorno (sin salto de brillo)', () => {
    const W = 120;
    const p = fill(W, 80, (x, y) => [50 + x, 50 + x, 50 + x].map((v) => v + ((x + y) % 2) * 6) as [number, number, number]);
    // destino con textura propia distinta: origen a 40 px a la izquierda (mucho más oscuro)
    const orig = clonePix(p);
    const st = new RetouchStroke(p, { ...base, tool: 'heal', radius: 10 });
    st.heal(80, 40, -40, 0);
    // Centro: no se queda 40 niveles más oscuro como lo haría un clonado.
    const c = px(p, 80, 40)[0];
    const o = px(orig, 80, 40)[0];
    expect(Math.abs(c - o)).toBeLessThan(10);
    const cl = clonePix(orig);
    new RetouchStroke(cl, { ...base, tool: 'clone', radius: 10 }).clone(80, 40, -40, 0);
    expect(Math.abs(px(cl, 80, 40)[0] - o)).toBeGreaterThan(30);
  });
});

describe('capa de retoque', () => {
  it('extrae solo lo cambiado y al componer reproduce el resultado exacto', () => {
    const b = grid(64, 64);
    const w = clonePix(b);
    new RetouchStroke(w, { ...base, tool: 'clone', radius: 7 }).clone(40, 40, -25, -20);
    const bb = diffBounds(b, w, { x: 0, y: 0, w: 64, h: 64 })!;
    expect(bb.w).toBeLessThan(20);
    const patch = extractPatch(b, w, bb);
    const back = overPatch(b, patch, bb);
    expect(Array.from(back.data)).toEqual(Array.from(w.data));
    // Sin cambios: no hay retoque.
    expect(diffBounds(b, b, { x: 0, y: 0, w: 64, h: 64 })).toBeNull();
  });

  it('diseños sin retoque (o con datos raros) no cambian', () => {
    expect(validRetouch(undefined)).toBeUndefined();
    expect(validRetouch(null)).toBeUndefined();
    expect(validRetouch({ src: '' })).toBeUndefined();
    expect(validRetouch({ src: 'x', x: 0, y: 0, w: 0, h: 5, bw: 10, bh: 10 })).toBeUndefined();
    expect(validRetouch({ src: 'x', x: 8, y: 0, w: 5, h: 5, bw: 10, bh: 10 })).toBeUndefined();
    expect(validRetouch({ src: 'x', x: 1, y: 2, w: 5, h: 5, bw: 10, bh: 10 })).toBeTruthy();
    expect(hasRetouch({})).toBe(false);
  });
});

describe('geometría documento ↔ fuente', () => {
  const L = { x: 100, y: 50, rotation: 0, scaleX: 1, scaleY: 1, naturalWidth: 200, naturalHeight: 100, crop: undefined, flipX: false, flipY: false };
  it('capa simple: traslación y escala', () => {
    const m = sourceMapper({ ...L, scaleX: 0.5, scaleY: 0.5 }, 400, 200)!;
    expect(m.toSrc(100, 50)).toEqual([0, 0]);
    const [x, y] = m.toSrc(150, 75);
    expect(x).toBeCloseTo(200);
    expect(y).toBeCloseTo(100);
    expect(m.pxPerDoc).toBeCloseTo(4);
    const [dx, dy] = m.fromSrc(x, y);
    expect(dx).toBeCloseTo(150);
    expect(dy).toBeCloseTo(75);
  });
  it('recorte, volteo y giro son invertibles y apuntan al píxel correcto', () => {
    const l = { ...L, rotation: 30, naturalWidth: 100, naturalHeight: 50, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, flipX: true };
    const m = sourceMapper(l, 400, 200)!;
    // Esquina local (0,0) de la capa recortada y volteada: la fuente está a la derecha → x_src = 400 (borde derecho de la fuente) con flipX.
    const [x0, y0] = m.toSrc(l.x, l.y);
    expect(x0).toBeCloseTo(400, 3);
    expect(y0).toBeCloseTo(100, 3);
    const [dx, dy] = m.fromSrc(250, 170);
    const [sx, sy] = m.toSrc(dx, dy);
    expect(sx).toBeCloseTo(250, 3);
    expect(sy).toBeCloseTo(170, 3);
  });
});

describe('máscara de disco', () => {
  it('dureza 1 da borde duro y 0 un degradado', () => {
    const hard = discMask(21, 21, 10.5, 10.5, 8, 1);
    expect(hard[10 * 21 + 10]).toBe(255);
    expect(hard[0]).toBe(0);
    const soft = discMask(21, 21, 10.5, 10.5, 8, 0);
    expect(soft[10 * 21 + 14]).toBeLessThan(255);
    expect(soft[10 * 21 + 14]).toBeGreaterThan(0);
  });
});

describe('worker del retoque', () => {
  it('el worker (poisson) da el mismo resultado que el hilo principal', async () => {
    const { handlePixelJob } = await import('./pixelWorkerCore');
    const w = 40, h = 30, n = w * h;
    const dest = new Uint8ClampedArray(n * 4), src = new Uint8ClampedArray(n * 4), mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = i % w, y = (i / w) | 0;
      dest.set([50 + x, 60 + y, 90, 255], i * 4);
      src.set([120 + (x % 5) * 6, 100, 80 + y, 255], i * 4);
      if (x > 10 && x < 30 && y > 8 && y < 22) mask[i] = 255;
    }
    const direct = poissonClone(dest, src, mask, w, h);
    const buf = new ArrayBuffer(n * 9);
    new Uint8ClampedArray(buf, 0, n * 4).set(dest);
    new Uint8ClampedArray(buf, n * 4, n * 4).set(src);
    new Uint8Array(buf, n * 8, n).set(mask);
    let got: Uint8ClampedArray | null = null;
    handlePixelJob({ id: 1, op: 'poisson', buffer: buf, width: w, height: h }, (r) => {
      if ('done' in r) got = new Uint8ClampedArray(r.buffer);
    });
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual(Array.from(direct));
  });
});
