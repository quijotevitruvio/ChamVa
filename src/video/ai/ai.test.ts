// V9: pruebas de lo puro (máscaras, caché, estabilización, estimaciones) y del consentimiento de descarga.
import { describe, expect, it } from 'vitest';
import { CacheFullError, MaskCache, MotionCache, matteKey, stabKey } from './cache';
import { EtaMeter, estimateMatte, inferSize, maskIoU, refineMask, temporalFlicker, temporalSmooth } from './matteMath';
import { estimateMotion, estimateStab, gaussianSmooth, jitterRms, stabCorrections, trajectory, zoomFor, type Motion } from './stabMath';
import { MATTE_MODEL, downloadMatteModel, matteDownloadPlan, matteFileUrl, matteModelBytes, matteModelStatus } from './models';
import { aiCoverage, aiCoverageNotices, aiParamsOf, hasAiFx } from './aiFrame';
import { AI_FX, AI_FX_DEFS, FX_CATEGORIES, makeFx } from '../fx/effects';
import { sanitizeFxList } from '../fx/sanitize';
import * as VM from '../model';
import type { StorageEnv } from '../../ai/transcribe/store';
import type { Gray } from '../reframe/tracker';

// ---------- utilidades ----------
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** Disco de radio r en (cx, cy) sobre w×h (0/255). */
function disc(w: number, h: number, cx: number, cy: number, r: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 255;
  return m;
}

/** Textura procedimental continua (para mover con subpíxel y girar). */
const tex = (x: number, y: number) =>
  128 + 40 * Math.sin(x * 0.21 + Math.cos(y * 0.13) * 2) + 35 * Math.cos(y * 0.17 - x * 0.05) + 25 * Math.sin((x + y) * 0.37) + 20 * Math.sin(x * 0.9) * Math.cos(y * 0.7);

/** Fotograma de la textura con el contenido desplazado (dx, dy) y girado `a` alrededor del centro. */
function frame(w: number, h: number, dx: number, dy: number, a = 0): Gray {
  const d = new Float32Array(w * h);
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // punto del contenido que acaba en (x, y): inverso de q = R·(p − c) + c + d
      const qx = x - w / 2 - dx;
      const qy = y - h / 2 - dy;
      const px = c * qx + s * qy + w / 2;
      const py = -s * qx + c * qy + h / 2;
      d[y * w + x] = tex(px, py);
    }
  return { w, h, d };
}

// ---------- quitar fondo: máscaras ----------
describe('V9 · resolución de inferencia y estimación', () => {
  it('múltiplos de 32 con el lado corto del modo', () => {
    expect(inferSize(1920, 1080, 'quality')).toEqual({ w: 896, h: 512 });
    expect(inferSize(1920, 1080, 'fast')).toEqual({ w: 448, h: 256 });
    expect(inferSize(1080, 1920, 'fast')).toEqual({ w: 256, h: 448 });
    const s = inferSize(4000, 500, 'fast');
    expect(s.w % 32).toBe(0);
    expect(s.w).toBeLessThanOrEqual(512);
  });
  it('estima fotogramas, tiempo y memoria, descontando lo ya calculado', () => {
    const e = estimateMatte({ seconds: 10, srcW: 1920, srcH: 1080, mode: 'fast', msPerFrame: 100 });
    expect(e.frames).toBe(301);
    expect(e.seconds).toBeCloseTo(30.1, 5);
    expect(e.cacheBytes).toBe(301 * 448 * 256);
    expect(e.peakBytes).toBeGreaterThan(e.cacheBytes);
    const e2 = estimateMatte({ seconds: 10, srcW: 1920, srcH: 1080, mode: 'fast', msPerFrame: 100, cached: 300 });
    expect(e2.frames).toBe(1);
    const long = estimateMatte({ seconds: 3600, srcW: 1920, srcH: 1080, mode: 'quality' });
    expect(long.warnings.length).toBe(2); // tiempo y memoria
  });
  it('el ETA converge al ritmo real', () => {
    const m = new EtaMeter(100);
    let left = 0;
    for (let i = 0; i < 50; i++) left = m.tick(200);
    expect(left).toBeCloseTo(10, 5); // 50 restantes × 200 ms
  });
});

describe('V9 · coherencia temporal y borde', () => {
  const W = 64;
  const H = 48;
  it('el suavizado temporal baja el parpadeo de una máscara quieta con ruido', () => {
    seed = 7;
    const truth = disc(W, H, 32, 24, 12);
    const noisy: Uint8Array[] = [];
    for (let t = 0; t < 20; t++) noisy.push(truth.map((v) => Math.max(0, Math.min(255, v + Math.round((rnd() - 0.5) * 120)))));
    const sm = noisy.map((_, i) => temporalSmooth((k) => noisy[k], i, 0.8)!);
    const f0 = temporalFlicker(noisy);
    const f1 = temporalFlicker(sm);
    expect(f1).toBeLessThan(f0 * 0.6);
    // fuerza 0 = la máscara del modelo tal cual
    expect(temporalSmooth((k) => noisy[k], 3, 0)).toBe(noisy[3]);
  });
  it('no deja estela en lo que se mueve de verdad (IoU con la verdad ≥ 0,9)', () => {
    const truths = Array.from({ length: 12 }, (_, t) => disc(W, H, 12 + t * 3, 24, 9));
    for (let i = 1; i < 11; i++) {
      const sm = temporalSmooth((k) => truths[k], i, 1)!;
      expect(maskIoU(sm, truths[i])).toBeGreaterThanOrEqual(0.9);
    }
  });
  it('el borde difumina sin tocar lo que está lejos (0 y 255 exactos)', () => {
    const m = disc(W, H, 32, 24, 14);
    const r = refineMask(m, W, H, 4);
    expect(r[0]).toBe(0);
    expect(r[24 * W + 32]).toBe(255);
    let soft = 0;
    for (const v of r) if (v > 0 && v < 255) soft++;
    expect(soft).toBeGreaterThan(40);
    expect(r).not.toBe(m);
    // contraer reduce el área, expandir la agranda
    const area = (x: Uint8Array) => x.reduce((s, v) => s + (v >= 128 ? 1 : 0), 0);
    const blur = refineMask(m, W, H, 6);
    expect(area(refineMask(m, W, H, 6, 0.4))).toBeLessThan(area(blur));
    expect(area(refineMask(m, W, H, 6, -0.4))).toBeGreaterThan(area(blur));
  });
  it('IoU y parpadeo con verdad', () => {
    const a = disc(W, H, 20, 20, 8);
    expect(maskIoU(a, a)).toBe(1);
    expect(maskIoU(a, disc(W, H, 44, 30, 8))).toBe(0);
    expect(temporalFlicker([a, a, a], [a, a, a])).toBe(0);
  });
});

describe('V9 · caché de máscaras por clave y fotograma', () => {
  it('guarda, busca con ±1 fotograma y cuenta lo que falta', () => {
    const c = new MaskCache(1 << 20);
    const k = matteKey('m1', 'fast');
    expect(k).not.toBe(matteKey('m1', 'quality'));
    c.track(k, 4, 4, 30);
    for (const i of [0, 1, 2, 5]) c.put(k, i, new Uint8Array(16).fill(i));
    expect(c.lookup(k, 1 / 30)?.idx).toBe(1);
    expect(c.lookup(k, 4 / 30)?.idx).toBe(5); // vecino
    expect(c.lookup(k, 8 / 30)).toBeNull();
    const cov = c.coverage(k, 0, 7 / 30, 30);
    expect(cov).toEqual({ have: 4, total: 8, missing: [[3 / 30, 4 / 30], [6 / 30, 7 / 30]] });
    const v = c.version;
    c.put(k, 6, new Uint8Array(16));
    expect(c.version).toBeGreaterThan(v);
    expect(() => c.put(k, 9, new Uint8Array(3))).toThrow();
  });
  it('cambiar el tamaño vacía la pista; el tope suelta otras pistas y si no cabe avisa', () => {
    const c = new MaskCache(100);
    c.track('a', 5, 5, 30);
    c.put('a', 0, new Uint8Array(25));
    c.put('a', 1, new Uint8Array(25));
    c.track('b', 5, 5, 30);
    c.put('b', 0, new Uint8Array(25));
    c.put('b', 1, new Uint8Array(25));
    c.put('b', 2, new Uint8Array(25)); // suelta «a» entera
    expect(c.peek('a')).toBeUndefined();
    expect(c.bytes).toBe(75);
    c.put('b', 3, new Uint8Array(25));
    expect(() => c.put('b', 4, new Uint8Array(25))).toThrow(CacheFullError);
    c.track('b', 4, 4, 30);
    expect(c.peek('b')!.frames.size).toBe(0);
  });
});

// ---------- estabilización ----------
describe('V9 · movimiento entre fotogramas', () => {
  const W = 192;
  const H = 108;
  it('recupera traslaciones conocidas (subpíxel)', () => {
    for (const [dx, dy] of [[0, 0], [3, -2], [-7.5, 4.25], [12, 9]]) {
      const m = estimateMotion(frame(W, H, 0, 0), frame(W, H, dx, dy));
      expect(m.ok).toBe(true);
      expect(Math.abs(m.dx - dx)).toBeLessThan(0.35);
      expect(Math.abs(m.dy - dy)).toBeLessThan(0.35);
    }
  });
  it('recupera un giro pequeño', () => {
    const m = estimateMotion(frame(W, H, 0, 0), frame(W, H, 1, 0, 0.02));
    expect(Math.abs(m.da - 0.02)).toBeLessThan(0.006);
    expect(Math.abs(m.dx - 1)).toBeLessThan(0.6);
  });
  it('un sujeto que se mueve no arrastra la cámara (atípicos)', () => {
    const a = frame(W, H, 0, 0);
    const b = frame(W, H, 2, 1);
    // un «sujeto» (bloque) que se mueve 10 px a la derecha por su cuenta
    for (let y = 30; y < 70; y++) for (let x = 80; x < 115; x++) {
      a.d[y * W + x] = 255 * ((x >> 2) & 1);
      b.d[y * W + x + 10] = 255 * ((x >> 2) & 1);
    }
    const m = estimateMotion(a, b);
    expect(Math.abs(m.dx - 2)).toBeLessThan(0.6);
    expect(Math.abs(m.dy - 1)).toBeLessThan(0.6);
  });
});

describe('V9 · trayectoria, suavizado y recorte', () => {
  it('el suavizado conserva una tendencia lineal (sin zoom ni tirón en los extremos)', () => {
    const lin = Array.from({ length: 50 }, (_, i) => 3 + 2 * i);
    const s = gaussianSmooth(lin, 6);
    for (let i = 0; i < 50; i++) expect(s[i]).toBeCloseTo(lin[i], 6);
  });
  it('reduce un temblor conocido ≥ 80 % sobre un paneo', () => {
    seed = 99;
    const n = 150;
    const motions: Motion[] = [];
    const real: number[] = [];
    let jPrev = 0;
    for (let i = 0; i < n; i++) {
      const j = (rnd() - 0.5) * 8; // ±4 px de temblor
      const pan = 1.5; // px/fotograma
      motions.push({ dx: i ? pan + j - jPrev : 0, dy: i ? (j - jPrev) * 0.5 : 0, da: 0, ds: 0, ok: true });
      jPrev = j;
      real.push(i * pan + j);
    }
    const tr = trajectory((i) => motions[i], 0, n - 1);
    expect(tr.x[n - 1]).toBeCloseTo(real[n - 1] - real[0], 6);
    const c = stabCorrections((i) => motions[i], 0, n - 1, { fps: 30, w: 320, h: 180, smooth: 1, maxZoom: 1.5 });
    const after = Array.from(tr.x, (x, i) => x + c.cx[i] * 320);
    const before = jitterRms(tr.x);
    const red = 1 - jitterRms(after) / before;
    expect(before).toBeGreaterThan(1.5);
    expect(red).toBeGreaterThanOrEqual(0.8);
    expect(c.zoom).toBeGreaterThan(1);
    expect(c.zoom).toBeLessThan(1.1);
    expect(c.clamped).toBe(false);
  });
  it('con tope de recorte limita la corrección y lo dice', () => {
    const motions: Motion[] = Array.from({ length: 60 }, (_, i) => ({ dx: i % 2 ? 30 : -30, dy: 0, da: 0, ds: 0, ok: true }));
    const c = stabCorrections((i) => motions[i], 0, 59, { fps: 30, w: 320, h: 180, smooth: 1, maxZoom: 1.05 });
    expect(c.zoom).toBeCloseTo(1.05, 9);
    expect(c.clamped).toBe(true);
    for (const v of c.cx) expect(Math.abs(v)).toBeLessThanOrEqual(0.025 + 1e-9);
  });
  it('zoom necesario y estimación', () => {
    expect(zoomFor(0, 0, 0)).toBe(1);
    expect(zoomFor(0.05, 0, 0)).toBeCloseTo(1.1, 9);
    expect(zoomFor(0, 0, 0.01, 16 / 9)).toBeGreaterThan(1.01);
    expect(estimateStab(10).frames).toBe(301);
    // un movimiento no fiable cuenta como 0
    const tr = trajectory((i) => ({ dx: 5, dy: 0, da: 0, ds: 0, ok: i !== 2 }), 0, 3);
    expect(Array.from(tr.x)).toEqual([0, 5, 5, 10]);
  });
  it('caché de movimiento por medio', () => {
    const c = new MotionCache();
    c.track(stabKey('m'), 320, 180, 30);
    c.put(stabKey('m'), 0, { dx: 0, dy: 0, da: 0, ds: 0, ok: true });
    expect(c.peek(stabKey('m'))!.motion.size).toBe(1);
    c.track(stabKey('m'), 160, 90, 30);
    expect(c.peek(stabKey('m'))!.motion.size).toBe(0);
  });
});

// ---------- modelo de proyecto ----------
describe('V9 · efectos de origen en el modelo v2 (aditivos)', () => {
  it('no aparecen en las categorías de la interfaz de V6 y se sanean de forma idempotente', () => {
    expect(FX_CATEGORIES).not.toContain('IA');
    expect([...AI_FX]).toEqual(['bgremove', 'stabilize']);
    const list = [makeFx('bgremove', { id: 'bg', p: { bg: 'color', color: '#ff0000' } }), makeFx('stabilize', { id: 'st' })];
    const once = sanitizeFxList(JSON.parse(JSON.stringify(list)));
    expect(sanitizeFxList(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(once![0].p!.bg).toBe('color');
    expect(AI_FX_DEFS.every((d) => d.category === 'IA')).toBe(true);
  });
  it('parámetros efectivos, cobertura y avisos', () => {
    let p = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
    p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'a.mp4', duration: 4 });
    const clip = VM.makeClip('video', { id: 'c', mediaId: 'm', outP: 1, fx: [makeFx('bgremove', { id: 'bg', p: { mode: 'fast', feather: 3 } })] });
    p = VM.addClip(p, 'V', clip);
    const c = VM.findClip(p, 'c')!.clip;
    expect(hasAiFx(c)).toBe(true);
    expect(aiParamsOf(c, 0).matte).toMatchObject({ mode: 'fast', feather: 3, bg: 'transparent' });
    const masks = new MaskCache();
    const k = matteKey('m', 'fast');
    masks.track(k, 2, 2, 30);
    for (let i = 0; i <= 15; i++) masks.put(k, i, new Uint8Array(4));
    const cov = aiCoverage(p, masks, new MotionCache());
    expect(cov).toEqual([{ clipId: 'c', kind: 'bgremove', have: 16, total: 31, missing: [[16 / 30, 1]] }]);
    expect(aiCoverageNotices(p, masks, new MotionCache())[0]).toMatch(/52 %/);
    for (let i = 16; i <= 30; i++) masks.put(k, i, new Uint8Array(4));
    expect(aiCoverageNotices(p, masks, new MotionCache())).toEqual([]);
    // apagado = sin efecto
    expect(hasAiFx({ ...c, fx: [{ ...c.fx![0], on: false }] })).toBe(false);
  });
});

// ---------- descarga con consentimiento ----------
function fakeEnv(o: { offline?: boolean } = {}) {
  const cache = new Map<string, Blob>();
  const parts = new Map<string, Blob[]>();
  const urls: string[] = [];
  const env: StorageEnv = {
    cache: {
      match: async (k) => (cache.has(k) ? new Response(cache.get(k)!, { headers: { 'content-length': String(cache.get(k)!.size) } }) : undefined),
      put: async (k, r) => void cache.set(k, await r.blob()),
      delete: async (k) => cache.delete(k),
    },
    parts: { get: async (k) => [...(parts.get(k) ?? [])], append: async (k, _i, b) => void (parts.set(k, [...(parts.get(k) ?? []), b])), clear: async (k) => void parts.delete(k) },
    fetch: async (url) => {
      urls.push(url);
      if (o.offline) throw new TypeError('Failed to fetch');
      return new Response(new Uint8Array(10), { status: 200 });
    },
    sha1: async () => '0',
  };
  return { env, cache, urls };
}

describe('V9 · modelo MODNet fijado y descarga con permiso', () => {
  it('manifiesto fijado a un commit, Apache-2.0, 25,9 MB', () => {
    expect(MATTE_MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(MATTE_MODEL.license).toBe('Apache-2.0');
    expect(matteModelBytes()).toBe(83 + 365 + 25888640);
    expect(matteFileUrl('onnx/model.onnx')).toBe(`https://huggingface.co/Xenova/modnet/resolve/${MATTE_MODEL.revision}/onnx/model.onnx`);
  });
  it('sin consentimiento no descarga nada; el plan dice el tamaño exacto', async () => {
    const { env, urls } = fakeEnv();
    const plan = await matteDownloadPlan(env);
    expect(plan.consent).toEqual({ model: 'modnet', bytes: matteModelBytes() });
    await expect(downloadMatteModel(env, { consent: null })).rejects.toThrow(/permiso/);
    await expect(downloadMatteModel(env, { consent: { model: 'modnet', bytes: 10, accepted: true } })).rejects.toThrow(/permiso/);
    expect(urls).toEqual([]);
  });
  it('con consentimiento solo pide las URL del manifiesto y verifica (lo dañado se borra)', async () => {
    const { env, urls } = fakeEnv();
    const plan = await matteDownloadPlan(env);
    await expect(downloadMatteModel(env, { consent: { ...plan.consent, accepted: true } })).rejects.toThrow();
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(MATTE_MODEL.files.map((f) => matteFileUrl(f.path))).toContain(u);
    expect((await matteModelStatus(env)).installed).toBe(false);
  });
  it('instalado si la caché tiene cada archivo con su tamaño', async () => {
    const { env, cache } = fakeEnv();
    for (const f of MATTE_MODEL.files) cache.set(matteFileUrl(f.path), new Blob([new Uint8Array(f.size)]));
    expect((await matteModelStatus(env)).installed).toBe(true);
    expect((await downloadMatteModel(env, { consent: null })).installed).toBe(true); // nada que bajar
  });
});
