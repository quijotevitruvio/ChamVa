import { describe, expect, it } from 'vitest';
import { PixelPool, type WorkerLike } from './pixelPool';
import { handlePixelJob, type PixelJobMsg, type PixelReply } from './pixelWorkerCore';
import { runOutlineStage, runPixelStage } from './imageProcessing';
import { applyLens, applyDenoise, applyDehaze } from './photoFix';
import { applyLevels } from './levels';
import { applyCurves } from './curves';
import { applyHslMix } from './hslMixer';
import { applyImageEffects } from './imageEffects';
import {
  applyClarity,
  applyColorOps,
  applyGrain,
  applyInvertThreshold,
  applyOutline,
  applyPixelate,
  applySharpen,
  applyVignette,
} from './imageProcessing';
import { DEFAULT_ADJUST, type ImageAdjust } from './types';

const n = (v: number | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0);

// Foto sintética determinista con degradados, ruido y una zona transparente.
function synth(w = 256, h = 256): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  let s = 12345;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = (x / w) * 255 + rnd() * 30;
      d[i + 1] = (y / h) * 255 + rnd() * 30;
      d[i + 2] = ((x + y) / (w + h)) * 255 + rnd() * 30;
      d[i + 3] = x < 12 && y < 12 ? 0 : x > w - 20 ? 128 : 255;
    }
  return d;
}

// La cadena original (antes de la refactorización), escrita a mano y en el mismo orden.
function legacyChain(d: { data: Uint8ClampedArray; width: number; height: number }, adj: ImageAdjust, scale: number) {
  applyLens(d, n(adj.lensDistortion), n(adj.lensVignette));
  applyDenoise(d, n(adj.denoise), n(adj.denoiseColor));
  applyDehaze(d, n(adj.dehaze), scale);
  applyLevels(d, adj.levels);
  applyCurves(d, adj.curves);
  applyColorOps(d, adj);
  applyHslMix(d, adj.hslMix);
  applySharpen(d, n(adj.sharpen), scale);
  applyClarity(d, n(adj.clarity), scale);
  applyInvertThreshold(d, adj);
  applyImageEffects(d, adj.fx);
  applyPixelate(d, n(adj.pixelate) * scale);
  applyVignette(d, n(adj.vignette));
  applyGrain(d, n(adj.grain));
}

const CASES: Record<string, Partial<ImageAdjust>> = {
  lente: { lensDistortion: 30, lensVignette: 40 },
  'ruido luminancia': { denoise: 60 },
  'ruido color': { denoiseColor: 50 },
  'ruido ambos': { denoise: 30, denoiseColor: 30 },
  neblina: { dehaze: 50 },
  niveles: { levels: { inBlack: 10, gamma: 1.4, inWhite: 240, outBlack: 5, outWhite: 250 } },
  curvas: {
    curves: {
      rgb: [
        [0, 0],
        [128, 160],
        [255, 255],
      ],
      r: [
        [0, 10],
        [255, 245],
      ],
    },
  },
  color: { temperature: 0.3, tint: 0.1, highlights: 0.2, shadows: 0.3, vibrance: 0.4, exposure: 20, hue: 40, sepia: 30 },
  hsl: { hslMix: { red: { h: 20, s: 30, l: -10 }, blue: { s: -40 } } },
  nitidez: { sharpen: 0.7 },
  claridad: { clarity: 50 },
  'invertir y umbral': { invert: true, threshold: 120 },
  halftone: { fx: { htSize: 8, htAngle: 45, htColor: true } },
  boceto: { fx: { sketchMode: 'comic', sketchAmount: 80 } },
  resplandor: { fx: { glowAmount: 50, glowRadius: 30 } },
  tiltshift: { fx: { tiltAmount: 60, tiltPos: 0.5, tiltWidth: 0.2, tiltSat: 30 } },
  glitch: { fx: { glitch: 40, glitchSeed: 7, chroma: 30 } },
  textura: { fx: { texKind: 'film', texAmount: 0.5, texMode: 'overlay', texSeed: 3 } },
  pixelar: { pixelate: 6 },
  viñeta: { vignette: 0.5 },
  grano: { grain: 0.4 },
  combinado: { denoise: 40, dehaze: 30, clarity: 30, sharpen: 0.5, vignette: 0.3, grain: 0.2, temperature: 0.1 },
};

const hash = (b: Uint8ClampedArray) => {
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619) >>> 0;
  return h;
};

// Worker simulado: ejecuta la MISMA lógica del worker real, de forma asíncrona.
function fakeWorker(log?: { created: number; terminated: number }): WorkerLike {
  if (log) log.created++;
  let dead = false;
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    terminate() {
      if (log) log.terminated++;
      dead = true;
    },
    postMessage(msg) {
      setTimeout(() => {
        if (dead) return;
        handlePixelJob(msg as PixelJobMsg, (r: PixelReply) => w.onmessage?.({ data: r }));
      }, 0);
    },
  };
  return w;
}

describe('equivalencia worker vs hilo principal (256x256 sintético)', () => {
  for (const [name, patch] of Object.entries(CASES)) {
    it(`${name}: idéntico bit a bit`, async () => {
      const adj: ImageAdjust = { ...DEFAULT_ADJUST, ...patch };
      const w = 256;
      const h = 256;
      const scale = 0.5;
      // cadena original
      const a = { data: synth(w, h), width: w, height: h };
      legacyChain(a, adj, scale);
      // runPixelStage en el hilo principal
      const b = { data: synth(w, h), width: w, height: h };
      runPixelStage(b, adj, scale);
      expect(hash(b.data)).toBe(hash(a.data));
      // a través del pool (worker simulado, mismo código del worker real)
      const pool = new PixelPool(() => fakeWorker(), 2);
      const src = synth(w, h);
      const out = await pool.run({ op: 'pixels', buffer: src.buffer as ArrayBuffer, width: w, height: h, adj, scale });
      expect(hash(new Uint8ClampedArray(out))).toBe(hash(a.data));
      expect(Buffer.from(new Uint8ClampedArray(out)).equals(Buffer.from(a.data))).toBe(true);
    });
  }

  it('contorno: idéntico', async () => {
    const adj: ImageAdjust = { ...DEFAULT_ADJUST, outline: 6, outlineColor: '#ff8800' };
    const a = { data: synth(), width: 256, height: 256 };
    applyOutline(a, 6 * 0.5, '#ff8800');
    const b = { data: synth(), width: 256, height: 256 };
    runOutlineStage(b, adj, 0.5);
    expect(hash(b.data)).toBe(hash(a.data));
    const pool = new PixelPool(() => fakeWorker(), 1);
    const src = synth();
    const out = await pool.run({ op: 'outline', buffer: src.buffer as ArrayBuffer, width: 256, height: 256, adj, scale: 0.5 });
    expect(hash(new Uint8ClampedArray(out))).toBe(hash(a.data));
  });

  it('el progreso es creciente, termina en 1 y no altera el resultado', () => {
    const adj: ImageAdjust = { ...DEFAULT_ADJUST, denoise: 50, denoiseColor: 50, dehaze: 40, sharpen: 0.5 };
    const seen: number[] = [];
    const labels = new Set<string>();
    const a = { data: synth(128, 128), width: 128, height: 128 };
    runPixelStage(a, adj, 1, (f, l) => {
      seen.push(f);
      labels.add(l);
    });
    const b = { data: synth(128, 128), width: 128, height: 128 };
    runPixelStage(b, adj, 1);
    expect(hash(a.data)).toBe(hash(b.data));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.length).toBeGreaterThan(4); // por tramos, no solo inicio y fin
    expect(labels.has('Reducir ruido')).toBe(true);
  });
});

type Manual = WorkerLike & { sent: PixelJobMsg[]; terminated: boolean };

// Worker controlable a mano para probar cola y cancelación.
function manualWorker(reg: { workers: Manual[] }): Manual {
  const w: Manual = {
    sent: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(m: unknown) {
      w.sent.push(m as PixelJobMsg);
    },
    terminate() {
      w.terminated = true;
    },
  };
  reg.workers.push(w);
  return w;
}

const job = () => ({
  op: 'pixels' as const,
  buffer: new ArrayBuffer(16),
  width: 2,
  height: 2,
  adj: { ...DEFAULT_ADJUST },
  scale: 1,
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe('cola, cancelación y caída segura', () => {
  it('reutiliza el worker y respeta el máximo', async () => {
    const log = { created: 0, terminated: 0 };
    const pool = new PixelPool(() => fakeWorker(log), 1);
    for (let i = 0; i < 4; i++) await pool.run(job());
    expect(log.created).toBe(1);
    const reg = { workers: [] as Manual[] };
    const p2 = new PixelPool(() => manualWorker(reg), 2);
    const ps = [1, 2, 3, 4].map(() => p2.run(job()).catch(() => null));
    expect(reg.workers.length).toBe(2); // el máximo
    expect(p2.pending).toBe(4);
    p2.cancelAll();
    await Promise.all(ps);
    expect(p2.pending).toBe(0);
  });

  it('cancelar un trabajo en cola lo descarta sin ejecutarlo', async () => {
    const reg = { workers: [] as Manual[] };
    const pool = new PixelPool(() => manualWorker(reg), 1);
    const ctrl = new AbortController();
    const running = pool.run(job());
    const queued = pool.run(job(), { signal: ctrl.signal });
    ctrl.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(reg.workers[0].sent.length).toBe(1); // el cancelado nunca llegó al worker
    expect(reg.workers[0].terminated).toBe(false);
    const m = reg.workers[0].sent[0];
    reg.workers[0].onmessage!({ data: { id: m.id, done: true, buffer: m.buffer } });
    await expect(running).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('cancelar el trabajo en curso termina su worker y el siguiente usa otro nuevo', async () => {
    const reg = { workers: [] as Manual[] };
    const pool = new PixelPool(() => manualWorker(reg), 1);
    const ctrl = new AbortController();
    const first = pool.run(job(), { signal: ctrl.signal });
    const second = pool.run(job());
    expect(reg.workers.length).toBe(1);
    ctrl.abort(); // el usuario sigue moviendo el deslizador
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(reg.workers[0].terminated).toBe(true);
    expect(reg.workers.length).toBe(2);
    expect(reg.workers[1].sent.length).toBe(1);
    const m = reg.workers[1].sent[0];
    reg.workers[1].onmessage!({ data: { id: m.id, done: true, buffer: m.buffer } });
    await expect(second).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('la vista previa (prioridad 0) pasa por delante de la exportación (1) en la cola', async () => {
    const reg = { workers: [] as Manual[] };
    const pool = new PixelPool(() => manualWorker(reg), 1);
    const order: string[] = [];
    const busy = pool.run(job(), { priority: 1 });
    const exp = pool.run(job(), { priority: 1 }).then(() => order.push('export'));
    const prev = pool.run(job(), { priority: 0 }).then(() => order.push('preview'));
    const w = reg.workers[0];
    const finish = async () => {
      const m = w.sent[w.sent.length - 1];
      w.onmessage!({ data: { id: m.id, done: true, buffer: m.buffer } });
      await flush();
    };
    await finish(); // termina `busy`
    await finish(); // el siguiente debe ser la vista previa
    await finish();
    await Promise.all([busy, exp, prev]);
    expect(order).toEqual(['preview', 'export']);
  });

  it('informa el progreso y entrega el error del worker', async () => {
    const reg = { workers: [] as Manual[] };
    const pool = new PixelPool(() => manualWorker(reg), 1);
    const seen: number[] = [];
    const p = pool.run(job(), { onProgress: (f) => seen.push(f) });
    const w = reg.workers[0];
    const id = w.sent[0].id;
    w.onmessage!({ data: { id, progress: 0.25, label: 'x' } });
    w.onmessage!({ data: { id, progress: 0.75, label: 'x' } });
    w.onmessage!({ data: { id, error: 'boom' } });
    await expect(p).rejects.toThrow('boom');
    expect(seen).toEqual([0.25, 0.75]);
  });

  it('sin soporte de worker: available() es false y run rechaza para caer al hilo principal', async () => {
    const pool = new PixelPool(() => null, 2);
    await expect(pool.run(job())).rejects.toThrow();
    expect(pool.available()).toBe(false);
    await expect(pool.run(job())).rejects.toThrow();
  });

  it('dos fallos seguidos del worker lo desactivan', async () => {
    const reg = { workers: [] as Manual[] };
    const pool = new PixelPool(() => manualWorker(reg), 1);
    const a = pool.run(job());
    reg.workers[0].onerror!(new Error('x'));
    await expect(a).rejects.toThrow('worker-error');
    expect(pool.available()).toBe(true);
    const b = pool.run(job());
    reg.workers[1].onerror!(new Error('x'));
    await expect(b).rejects.toThrow('worker-error');
    expect(pool.available()).toBe(false);
  });
});
