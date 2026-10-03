import { describe, expect, it } from 'vitest';
import * as VM from '../model';
import { composeFrame, type ComposedFrame } from '../engine/compose';
import {
  aspectRatio,
  applyReframe,
  clearReframe,
  clampCenter,
  cropSize,
  cropToTransform,
  deadzoneFollow,
  framesFromTrack,
  gaussSmooth,
  geometry,
  medianFilter,
  reduceSeries,
  reframeAt,
  sanitizeReframe,
  transformToCrop,
  type TrackPoint,
} from './math';
import { autoSubject, trackSubject, type Gray, type TrackedFrame } from './tracker';
import type { Clip } from '../model/types';

const SRC = { w: 1920, h: 1080 };
const OUT = { w: 1080, h: 1920 };

describe('geometría del reencuadre 16:9 → 9:16', () => {
  it('el marco más grande tiene toda la altura y 31,6 % del ancho', () => {
    const g = geometry(SRC, OUT);
    const { cw, ch } = cropSize(g, OUT, 1);
    expect(ch).toBeCloseTo(1, 9);
    expect(cw).toBeCloseTo((9 / 16) * (1080 / 1920), 9);
    expect((cw * SRC.w) / (ch * SRC.h)).toBeCloseTo(aspectRatio('9:16'), 9);
  });

  it('marco → transformación → marco es la identidad y el centro cae donde toca', () => {
    const g = geometry(SRC, OUT);
    const c = { cx: 0.3, cy: 0.5, zoom: 1 };
    const tr = cropToTransform(g, OUT, c);
    const back = transformToCrop(g, OUT, tr);
    expect(back.cx).toBeCloseTo(0.3, 3);
    expect(back.zoom).toBeCloseTo(1, 3);
    const px = tr.x * OUT.w + (0.3 - 0.5) * g.dw * tr.scale;
    expect(px).toBeCloseTo(OUT.w / 2, 0);
  });

  it('el centro se limita para que el marco no se salga del origen; el zoom a 1..6', () => {
    const g = geometry(SRC, OUT);
    const k = clampCenter(g, OUT, { cx: -5, cy: 9, zoom: 99 });
    const { cw, ch } = cropSize(g, OUT, k.zoom);
    expect(k.zoom).toBe(6);
    expect(k.cx).toBeCloseTo(cw / 2, 9);
    expect(k.cy).toBeCloseTo(1 - ch / 2, 9);
  });

  it('1:1 y 4:5 también (el marco llena la salida)', () => {
    for (const [o, ar] of [
      [{ w: 1080, h: 1080 }, 1],
      [{ w: 1080, h: 1350 }, 0.8],
    ] as const) {
      const g = geometry(SRC, o);
      const { cw, ch } = cropSize(g, o, 1);
      expect(ch).toBeCloseTo(1, 9);
      expect((cw * SRC.w) / (ch * SRC.h)).toBeCloseTo(ar, 9);
    }
  });

  it('sanitizeReframe es idempotente y limita los valores', () => {
    const r = sanitizeReframe({ aspect: '9:16', cx: 4, cy: -1, zoom: 50, track: [{ t: 2, cx: 0.4, cy: 0.5 }, { t: 1, cx: 0.2, cy: 0.5, zoom: 2 }, { t: 'x' }] })!;
    expect(r.cx).toBe(1);
    expect(r.cy).toBe(0);
    expect(r.zoom).toBe(6);
    expect(r.track!.map((k) => k.t)).toEqual([1, 2]);
    expect(sanitizeReframe(r)).toEqual(r);
    expect(sanitizeReframe({ aspect: '3:2' })).toBeUndefined();
  });
});

describe('reencuadre aplicado al clip: la composición real recorta el marco', () => {
  /** lienzo de mentira: registra dónde se dibuja la imagen (translate/scale/drawImage) */
  function fakeCtx(w: number, h: number) {
    const log: { x: number; y: number; w: number; h: number }[] = [];
    let m = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const ctx = {
      canvas: { width: w, height: h },
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillRect() {},
      save() {
        stack.push(m.slice());
      },
      restore() {
        m = stack.pop() ?? m;
      },
      translate(x: number, y: number) {
        m = [m[0], m[1], m[2], m[3], m[4] + m[0] * x + m[2] * y, m[5] + m[1] * x + m[3] * y];
      },
      scale(sx: number, sy: number) {
        m = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]];
      },
      rotate() {},
      drawImage(_i: unknown, x: number, y: number, dw: number, dh: number) {
        log.push({ x: m[4] + m[0] * x, y: m[5] + m[3] * y, w: dw * m[0], h: dh * m[3] });
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
  }

  it('el punto elegido queda en el centro del fotograma y el marco de seguimiento lo mueve', () => {
    const clip = VM.makeClip('video', { id: 'c', mediaId: 'm', inP: 0, outP: 10 });
    const spec = { aspect: '9:16' as const, cx: 0.5, cy: 0.5, zoom: 1, track: [{ t: 0, cx: 0.25, cy: 0.5 }, { t: 4, cx: 0.75, cy: 0.5 }] };
    const rc = applyReframe(clip, spec, SRC, OUT);
    expect(rc.keys!.x).toHaveLength(2);
    let p = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
    p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'a', duration: 10 });
    p = VM.addClip(p, 'V', rc);
    for (const [t, want] of [
      [0, 0.25],
      [2, 0.5],
      [4, 0.75],
    ] as const) {
      const { ctx, log } = fakeCtx(OUT.w, OUT.h);
      const frame: ComposedFrame = { image: {} as CanvasImageSource, width: SRC.w, height: SRC.h, rotation: 0 };
      composeFrame(ctx, p, t, 10, OUT.w, OUT.h, 'contain', { video: () => frame, image: () => null });
      expect(log).toHaveLength(1);
      const d = log[0];
      // fracción del origen que cae en el centro de la salida
      const frac = (OUT.w / 2 - d.x) / d.w;
      expect(frac).toBeCloseTo(want, 3);
      // el video llena la altura (zoom 1)
      expect(d.h).toBeCloseTo(OUT.h, 0);
    }
  });

  it('sin marcos (fijo) quita los fotogramas x/y/scale; clearReframe restablece y conserva los demás fotogramas', () => {
    const clip = VM.makeClip('video', { id: 'c', mediaId: 'm', inP: 0, outP: 10 });
    const withTrack = applyReframe(clip, { aspect: '9:16', cx: 0.5, cy: 0.5, zoom: 1, track: [{ t: 0, cx: 0.3, cy: 0.5 }, { t: 2, cx: 0.6, cy: 0.5 }] }, SRC, OUT);
    expect(withTrack.keys).toBeDefined();
    const fixed = applyReframe(withTrack, { aspect: '9:16', cx: 0.7, cy: 0.5, zoom: 2 }, SRC, OUT);
    expect(fixed.keys).toBeUndefined();
    expect(fixed.transform.scale).toBeGreaterThan(withTrack.transform.scale);
    const cleared = clearReframe(fixed);
    expect(cleared.reframe).toBeUndefined();
    expect(cleared.transform).toEqual({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 });
    const other = { ...clip, keys: { opacity: [{ t: 0, v: 1 }, { t: 1, v: 0 }] } } as Clip;
    const kept = clearReframe(applyReframe(other, { aspect: '9:16', cx: 0.4, cy: 0.5, zoom: 1, track: [{ t: 0, cx: 0.3, cy: 0.5 }, { t: 2, cx: 0.6, cy: 0.5 }] }, SRC, OUT));
    expect(Object.keys(kept.keys!)).toEqual(['opacity']);
  });

  it('reframeAt interpola y se queda en los extremos', () => {
    const s = { aspect: '9:16' as const, cx: 0.5, cy: 0.5, zoom: 1, track: [{ t: 1, cx: 0.2, cy: 0.4, zoom: 1 }, { t: 3, cx: 0.6, cy: 0.6, zoom: 3 }] };
    expect(reframeAt(s, 0)).toEqual({ cx: 0.2, cy: 0.4, zoom: 1 });
    const mid = reframeAt(s, 2);
    expect(mid.cx).toBeCloseTo(0.4, 9);
    expect(mid.cy).toBeCloseTo(0.5, 9);
    expect(mid.zoom).toBeCloseTo(2, 9);
    expect(reframeAt(s, 9).zoom).toBe(3);
  });
});

describe('suavizado y reducción de los fotogramas del seguimiento', () => {
  it('la mediana quita saltos sueltos; el suavizado gaussiano no retrasa (cero fase)', () => {
    expect(medianFilter([0, 0, 0, 9, 0, 0, 0], 1)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const ramp = Array.from({ length: 41 }, (_, i) => i);
    const sm = gaussSmooth(ramp, 3);
    for (let i = 10; i < 31; i++) expect(sm[i]).toBeCloseTo(i, 6);
    expect(gaussSmooth([5], 3)).toEqual([5]);
  });

  it('zona muerta: el marco no se mueve por temblores pequeños y sigue cuando el sujeto se va', () => {
    const out = deadzoneFollow([0.5, 0.52, 0.48, 0.51, 0.7, 0.9], 0.05);
    expect(out.slice(0, 4).every((v) => Math.abs(v - 0.5) < 1e-9)).toBe(true);
    expect(out[4]).toBeCloseTo(0.65, 9);
    expect(out[5]).toBeCloseTo(0.85, 9);
  });

  it('reducción: una recta se queda en 2 fotogramas; un giro conserva el vértice', () => {
    const t = Array.from({ length: 50 }, (_, i) => i / 10);
    expect(reduceSeries(t, [t.map((x) => 0.2 + 0.1 * x)], 0.001)).toEqual([0, 49]);
    const tri = t.map((x) => (x < 2.5 ? x * 0.2 : 0.5 - (x - 2.5) * 0.2));
    const idx = reduceSeries(t, [tri], 0.005);
    expect(idx.length).toBe(3);
    expect(Math.abs(idx[1] - 25)).toBeLessThanOrEqual(1);
  });

  it('framesFromTrack: pocos fotogramas, dentro de los bordes y ordenados', () => {
    const pts: TrackPoint[] = Array.from({ length: 120 }, (_, i) => ({ t: i / 10, x: 0.1 + 0.8 * (i / 119) + (i % 7 === 0 ? 0.08 : 0), y: 0.5 }));
    const keys = framesFromTrack(pts, 0.3, 1);
    expect(keys.length).toBeLessThan(25);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < keys.length; i++) {
      expect(keys[i].cx).toBeGreaterThanOrEqual(0.15 - 1e-9);
      expect(keys[i].cx).toBeLessThanOrEqual(0.85 + 1e-9);
      expect(keys[i].cy).toBeCloseTo(0.5, 6);
      if (i) expect(keys[i].t).toBeGreaterThan(keys[i - 1].t);
    }
    expect(framesFromTrack([], 0.3, 1)).toEqual([]);
  });
});

// ---------------- seguimiento sobre un clip sintético ----------------

const W = 160;
const H = 90;
const hash = (x: number, y: number, s = 0) => {
  let h = Math.imul(x * 374761393 + y * 668265263 + s * 2246822519, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Fondo con textura fija; un cuadrado de 22 px (con su propia textura) que recorre el fotograma. */
function synthFrames(n: number, o: { noise?: number; hide?: [number, number]; size?: number } = {}) {
  const sz = o.size ?? 22;
  const centers: { x: number; y: number }[] = [];
  const frames: TrackedFrame[] = [];
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    const cx = 25 + p * 110;
    const cy = 45 + Math.sin(p * Math.PI * 2) * 22;
    centers.push({ x: cx, y: cy });
    const d = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = 90 + hash(x >> 1, y >> 1) * 70;
        const hidden = o.hide && i >= o.hide[0] && i < o.hide[1];
        if (!hidden && Math.abs(x - cx) <= sz / 2 && Math.abs(y - cy) <= sz / 2) {
          const u = Math.floor(x - cx + sz);
          const w = Math.floor(y - cy + sz);
          v = ((u >> 2) + (w >> 2)) % 2 ? 235 : 20 + hash(u, w, 7) * 40;
        }
        if (o.noise) v += (hash(x, y, i + 100) - 0.5) * 2 * o.noise;
        d[y * W + x] = Math.max(0, Math.min(255, v));
      }
    frames.push({ t: i / 5, g: { w: W, h: H, d } as Gray });
  }
  return { frames, centers };
}

describe('seguimiento del sujeto (clip sintético con un cuadrado que se mueve)', () => {
  it('lo sigue dentro de ~2,5 px (de 160) con y sin ruido', () => {
    for (const noise of [0, 10]) {
      const { frames, centers } = synthFrames(60, { noise });
      const c0 = centers[0];
      const tr = trackSubject(frames, { cx: c0.x / W, cy: c0.y / H, w: 20 / W, h: 20 / H });
      expect(tr).toHaveLength(60);
      let worst = 0;
      for (let i = 0; i < tr.length; i++) worst = Math.max(worst, Math.hypot(tr[i].x * W - centers[i].x, tr[i].y * H - centers[i].y));
      expect(worst).toBeLessThanOrEqual(2.5);
      expect(Math.min(...tr.map((p) => p.c ?? 0))).toBeGreaterThan(0.45);
    }
  });

  it('si el sujeto desaparece unos fotogramas se marca «perdido» (confianza 0) y lo recupera al volver', () => {
    const { frames, centers } = synthFrames(60, { hide: [20, 24] });
    const tr = trackSubject(frames, { cx: centers[0].x / W, cy: centers[0].y / H, w: 20 / W, h: 20 / H });
    expect(tr.slice(20, 24).some((p) => p.c === 0)).toBe(true);
    const last = tr[59];
    expect(Math.hypot(last.x * W - centers[59].x, last.y * H - centers[59].y)).toBeLessThanOrEqual(4);
  });

  it('cancelar con AbortSignal corta el seguimiento', () => {
    const { frames, centers } = synthFrames(20);
    const ac = new AbortController();
    ac.abort();
    expect(() => trackSubject(frames, { cx: centers[0].x / W, cy: centers[0].y / H, w: 0.12, h: 0.2 }, { signal: ac.signal })).toThrow(/cancelado/);
  });

  it('autoSubject encuentra el sujeto en movimiento sin que se marque; sin movimiento, el centro', () => {
    const { frames, centers } = synthFrames(30);
    const a = autoSubject(frames.slice(0, 12));
    expect(a.confident).toBe(true);
    const near = centers.slice(0, 12).some((c) => Math.hypot(a.box.cx * W - c.x, a.box.cy * H - c.y) < 18);
    expect(near).toBe(true);
    const still = autoSubject([frames[0], frames[0], frames[0]]);
    expect(still.confident).toBe(false);
    expect(still.box.cx).toBe(0.5);
  });

  it('de punta a punta: el marco 9:16 sigue al cuadrado y lo contiene siempre', () => {
    const { frames, centers } = synthFrames(60, { noise: 6 });
    const tr = trackSubject(frames, { cx: centers[0].x / W, cy: centers[0].y / H, w: 20 / W, h: 20 / H });
    const g = geometry({ w: W, h: H }, { w: 90, h: 160 });
    const { cw } = cropSize(g, { w: 90, h: 160 }, 1);
    const keys = framesFromTrack(tr, cw, 1);
    expect(keys.length).toBeLessThan(30);
    const spec = { aspect: '9:16' as const, cx: 0.5, cy: 0.5, zoom: 1, track: keys };
    let inside = 0;
    for (let i = 0; i < 60; i++) {
      const f = reframeAt(spec, frames[i].t);
      if (Math.abs(centers[i].x / W - f.cx) < cw / 2 - 0.01) inside++;
    }
    expect(inside).toBeGreaterThanOrEqual(58);
  });
});
