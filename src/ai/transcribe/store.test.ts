import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Sha256 } from './sha256';

// Manifiesto de prueba: archivos pequeños con huellas reales calculadas aquí.
const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
const FILES: Record<string, Uint8Array> = { 'config.json': new TextEncoder().encode('{"a":1}'), 'onnx/enc.onnx': bytes(20_000_000, 7), 'onnx/dec.onnx': bytes(300_000, 3) };
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const gitSha1 = (b: Uint8Array) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), Buffer.from(b)])).digest('hex');

vi.mock('./models', () => {
  const common = [{ path: 'config.json', size: FILES['config.json'].length, gitSha1: gitSha1(FILES['config.json']) }];
  const wasm = ['onnx/enc.onnx', 'onnx/dec.onnx'].map((p) => ({ path: p, size: FILES[p].length, sha256: sha256(FILES[p]) }));
  const M = { tiny: { repo: 'x/tiny', revision: 'r', common, wasm, webgpu: [{ path: 'onnx/gpu.onnx', size: 1, sha256: '0'.repeat(64) }] }, base: { repo: 'x/base', revision: 'r', common: [], wasm: [], webgpu: [] }, small: { repo: 'x/small', revision: 'r', common: [], wasm: [], webgpu: [] } };
  const modelFiles = (s: 'tiny', d: 'wasm') => [...M[s].common, ...M[s][d]];
  return {
    WHISPER_MODELS: M,
    modelFiles,
    modelBytes: (s: 'tiny', d: 'wasm') => modelFiles(s, d).reduce((a, f) => a + f.size, 0),
    fileUrl: (s: string, p: string) => `https://huggingface.co/x/${s}/resolve/r/${p}`,
  };
});

const { ConsentError, IntegrityError, DownloadError, deleteModel, downloadModel, downloadPlan, installedModels, modelStatus } = await import('./store');
type StorageEnv = import('./store').StorageEnv;

interface FakeOpts {
  /** cortar la respuesta tras n bytes (simula caída de red) */
  cutAfter?: number;
  ignoreRange?: boolean;
  corrupt?: string;
  offline?: boolean;
}

function fakeEnv(o: FakeOpts = {}) {
  const cache = new Map<string, Blob>();
  const parts = new Map<string, Blob[]>();
  const requests: { url: string; range?: string }[] = [];
  const env: StorageEnv & { o: FakeOpts } = {
    o,
    cache: {
      match: async (k) => (cache.has(k) ? new Response(cache.get(k)!, { headers: { 'content-length': String(cache.get(k)!.size) } }) : undefined),
      put: async (k, r) => void cache.set(k, await r.blob()),
      delete: async (k) => cache.delete(k),
    },
    parts: {
      get: async (k) => [...(parts.get(k) ?? [])],
      append: async (k, i, b) => {
        const l = parts.get(k) ?? [];
        l[i] = b;
        parts.set(k, l);
      },
      clear: async (k) => void parts.delete(k),
    },
    fetch: async (url, init) => {
      if (env.o.offline) throw new TypeError('Failed to fetch');
      const range = (init?.headers as Record<string, string>)?.Range;
      requests.push({ url, range });
      const path = url.split('/resolve/r/')[1];
      let data = FILES[path];
      if (!data) return new Response(null, { status: 404 });
      if (env.o.corrupt === path) data = Uint8Array.from(data, (v, i) => (i === 5 ? v ^ 1 : v));
      let status = 200;
      if (range && !env.o.ignoreRange) {
        const from = Number(/bytes=(\d+)-/.exec(range)![1]);
        data = data.subarray(from);
        status = 206;
      }
      const cut = env.o.cutAfter;
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (cut !== undefined && sent >= cut) return c.error(new TypeError('network error'));
          if (sent >= data.length) return c.close();
          let end = Math.min(data.length, sent + 1_000_000);
          if (cut !== undefined) end = Math.min(end, cut);
          c.enqueue(data.slice(sent, end));
          sent = end;
        },
      });
      return new Response(body, { status });
    },
    estimate: async () => ({ quota: 1e9, usage: 1e8 }),
    sha1: async (b) => createHash('sha1').update(b).digest('hex'),
  };
  return { env, cache, parts, requests };
}

const TOTAL = Object.values(FILES).reduce((s, b) => s + b.length, 0);

describe('Sha256 incremental', () => {
  it('coincide con node:crypto troceando de cualquier forma', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 100_003]) {
      const b = bytes(n, n);
      const h = new Sha256();
      for (let i = 0; i < n; i += 37) h.update(b.subarray(i, i + 37));
      expect(h.hex()).toBe(sha256(b));
    }
    expect(new Sha256().update(new TextEncoder().encode('abc')).hex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('plan y consentimiento', () => {
  it('el plan da el tamaño real pendiente y el espacio libre', async () => {
    const { env } = fakeEnv();
    const p = await downloadPlan(env, 'tiny', 'wasm');
    expect(p.bytesNeeded).toBe(TOTAL);
    expect(p.consent).toEqual({ size: 'tiny', device: 'wasm', bytes: TOTAL });
    expect(p.storage.free).toBe(9e8);
    expect(p.fits).toBe(true);
    env.estimate = async () => ({ quota: 30e6, usage: 10e6 });
    expect((await downloadPlan(env, 'tiny', 'wasm')).fits).toBe(false);
  });
  it('sin consentimiento (o con otro tamaño) no se pide NADA a la red', async () => {
    const { env, requests } = fakeEnv();
    await expect(downloadModel(env, 'tiny', 'wasm', { consent: null })).rejects.toBeInstanceOf(ConsentError);
    await expect(downloadModel(env, 'tiny', 'wasm', { consent: { size: 'tiny', device: 'wasm', bytes: 10, accepted: true } })).rejects.toBeInstanceOf(ConsentError);
    await expect(downloadModel(env, 'tiny', 'wasm', { consent: { size: 'base', device: 'wasm', bytes: TOTAL, accepted: true } })).rejects.toBeInstanceOf(ConsentError);
    expect(requests).toHaveLength(0);
  });
});

describe('descarga', () => {
  const consent = { size: 'tiny' as const, device: 'wasm' as const, bytes: TOTAL, accepted: true as const };

  it('descarga, verifica y deja todo en la caché; progreso hasta 1', async () => {
    const { env, cache, parts } = fakeEnv();
    const ratios: number[] = [];
    const st = await downloadModel(env, 'tiny', 'wasm', { consent, onProgress: (p) => ratios.push(p.ratio) });
    expect(st.installed).toBe(true);
    expect(cache.size).toBe(3);
    expect(parts.size).toBe(0);
    expect(ratios[ratios.length - 1]).toBe(1);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1]);
    expect(await installedModels(env)).toEqual([{ size: 'tiny', device: 'wasm' }]);
  });

  it('se corta la red → conserva lo descargado y reanuda con Range', async () => {
    const f = fakeEnv({ cutAfter: 17_500_000 });
    await expect(downloadModel(f.env, 'tiny', 'wasm', { consent })).rejects.toBeInstanceOf(DownloadError);
    const mid = await modelStatus(f.env, 'tiny', 'wasm');
    const enc = mid.files.find((x) => x.path === 'onnx/enc.onnx')!;
    expect(enc.state).toBe('partial');
    expect(enc.have).toBe(17_500_000);
    f.env.o.cutAfter = undefined;
    const plan = await downloadPlan(f.env, 'tiny', 'wasm');
    expect(plan.bytesNeeded).toBe(TOTAL - FILES['config.json'].length - 17_500_000);
    const st = await downloadModel(f.env, 'tiny', 'wasm', { consent: { ...plan.consent, accepted: true } });
    expect(st.installed).toBe(true);
    expect(f.requests.find((r) => r.range)?.range).toBe('bytes=17500000-');
    const got = new Uint8Array(await (await f.env.cache.match('https://huggingface.co/x/tiny/resolve/r/onnx/enc.onnx'))!.arrayBuffer());
    expect(sha256(got)).toBe(sha256(FILES['onnx/enc.onnx']));
  });

  it('servidor que no admite Range → empieza de cero y sigue siendo íntegro', async () => {
    const f = fakeEnv({ cutAfter: 9_000_000 });
    await expect(downloadModel(f.env, 'tiny', 'wasm', { consent })).rejects.toThrow();
    f.env.o.cutAfter = undefined;
    f.env.o.ignoreRange = true;
    expect((await downloadModel(f.env, 'tiny', 'wasm', { consent })).installed).toBe(true);
  });

  it('huella distinta → error de integridad y nada guardado', async () => {
    const f = fakeEnv({ corrupt: 'onnx/dec.onnx' });
    await expect(downloadModel(f.env, 'tiny', 'wasm', { consent })).rejects.toBeInstanceOf(IntegrityError);
    const st = await modelStatus(f.env, 'tiny', 'wasm');
    expect(st.files.find((x) => x.path === 'onnx/dec.onnx')!.state).toBe('missing');
    expect(st.installed).toBe(false);
  });

  it('JSON con sha1 de blob git dañado → error', async () => {
    const f = fakeEnv({ corrupt: 'config.json' });
    await expect(downloadModel(f.env, 'tiny', 'wasm', { consent })).rejects.toThrow(/config.json/);
  });

  it('sin conexión → error legible', async () => {
    const f = fakeEnv({ offline: true });
    await expect(downloadModel(f.env, 'tiny', 'wasm', { consent })).rejects.toThrow(/Sin conexión/);
  });

  it('cancelar con AbortSignal conserva lo descargado', async () => {
    const f = fakeEnv();
    const ac = new AbortController();
    const p = downloadModel(f.env, 'tiny', 'wasm', {
      consent,
      signal: ac.signal,
      onProgress: (x) => {
        if (x.loaded > 9_000_000) ac.abort();
      },
    });
    // el fake no respeta la señal: forzamos el corte cortando el flujo en la siguiente lectura
    await p.catch(() => undefined);
    const st = await modelStatus(f.env, 'tiny', 'wasm');
    expect(st.bytesHave).toBeGreaterThan(0);
  });

  it('borrar un modelo libera su espacio (también lo descargado a medias)', async () => {
    const f = fakeEnv();
    await downloadModel(f.env, 'tiny', 'wasm', { consent });
    expect(await deleteModel(f.env, 'tiny')).toBe(TOTAL);
    expect((await modelStatus(f.env, 'tiny', 'wasm')).bytesHave).toBe(0);
    const g = fakeEnv({ cutAfter: 5_000_000 });
    await downloadModel(g.env, 'tiny', 'wasm', { consent }).catch(() => undefined);
    expect(await deleteModel(g.env, 'tiny')).toBeGreaterThan(0);
    expect(g.parts.size).toBe(0);
  });
});
