// V9b: lógica pura de la interfaz de IA: rango pendiente, textos de aviso, banda del clip, vista previa del recorte,
// claves y límites de la persistencia, y la cola de trabajos con consentimiento (con motores simulados).
import { describe, expect, it } from 'vitest';
import * as VM from '../model';
import { makeFx } from '../fx/effects';
import { MaskCache, MotionCache, matteKey, stabKey } from './cache';
import { aiStatusByClip, formatDownload, bandText, coveragePct, estimateText, exportPending, exportPromptText, noticeItemsAt, rangeCoverage, scopeRange, stabPreview } from './aiPlan';
import { aiCoverage } from './aiFrame';
import { AiPersist, DEFAULT_BUDGET_MB, MemoryAiStore, clampBudgetMB, fingerprintKey, kindOfKey, matteStoreKey, parseSettings, planEviction, stabStoreKey } from './persist';
import { JobController, type JobDeps } from './jobs';

function project(fx = [makeFx('bgremove', { id: 'bg', p: { mode: 'fast' } })]) {
  let p = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
  p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'a.mp4', duration: 10 });
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'c', mediaId: 'm', inP: 2, outP: 6, name: 'Entrevista', fx }));
  return p;
}
const fill = (cache: MaskCache, key: string, from: number, to: number) => {
  cache.track(key, 2, 2, 30);
  for (let i = from; i <= to; i++) cache.put(key, i, new Uint8Array(4));
};

describe('V9b · cobertura y banda del clip', () => {
  it('el 100 % solo si está todo (99,6 % no redondea a 100)', () => {
    expect(coveragePct(0, 0)).toBe(100);
    expect(coveragePct(997, 1000)).toBe(99);
    expect(coveragePct(1000, 1000)).toBe(100);
    expect(coveragePct(0, 50)).toBe(0);
  });
  it('estado por clip: el peor de sus efectos y su texto', () => {
    const p = project([makeFx('bgremove', { id: 'bg', p: { mode: 'fast' } }), makeFx('stabilize', { id: 'st' })]);
    const masks = new MaskCache();
    fill(masks, matteKey('m', 'fast'), 60, 180); // todo el tramo 2..6 s = 121 fotogramas
    const st = aiStatusByClip(aiCoverage(p, masks, new MotionCache())).get('c')!;
    expect(st.parts.find((x) => x.kind === 'bgremove')!.pct).toBe(100);
    expect(st.pct).toBe(0);
    expect(st.complete).toBe(false);
    expect(bandText(st)).toBe('IA 0 %');
    const mo = new MotionCache();
    mo.track(stabKey('m'), 8, 8, 30);
    for (let i = 60; i <= 180; i++) mo.put(stabKey('m'), i, { dx: 0, dy: 0, da: 0, ds: 0, ok: true });
    const all = aiStatusByClip(aiCoverage(p, masks, mo)).get('c')!;
    expect(all.complete).toBe(true);
    expect(bandText(all)).toBe('IA calculada 100 %');
  });
});

describe('V9b · rango a calcular (clip completo o entre marcas) y lo que falta', () => {
  it('clip completo = el tramo del archivo que usa el clip', () => {
    const r = scopeRange(project(), 'c', 'clip', { in: null, out: null });
    expect(r).toMatchObject({ ok: true, range: [2, 6] });
  });
  it('entre marcas: pasa de la línea de tiempo al archivo y se recorta al clip', () => {
    const p = project(); // el clip empieza en 0 y dura 4 s: línea de tiempo 0..4 = archivo 2..6
    const r = scopeRange(p, 'c', 'marks', { in: 1, out: 2.5 });
    expect(r.ok && r.range[0]).toBeCloseTo(3, 6);
    expect(r.ok && r.range[1]).toBeCloseTo(4.5, 6);
    const wide = scopeRange(p, 'c', 'marks', { in: -5, out: 99 });
    expect(wide.ok && wide.range).toEqual([2, 6]);
  });
  it('sin marcas o fuera del clip: motivo claro, no un rango vacío', () => {
    const p = project();
    expect(scopeRange(p, 'c', 'marks', { in: null, out: null })).toMatchObject({ ok: false });
    expect(scopeRange(p, 'c', 'marks', { in: 50, out: 60 })).toMatchObject({ ok: false });
    expect(scopeRange(p, 'nada', 'clip', { in: null, out: null })).toMatchObject({ ok: false });
  });
  it('cobertura del rango elegido: lo ya calculado no cuenta como pendiente', () => {
    const p = project();
    const masks = new MaskCache();
    fill(masks, matteKey('m', 'fast'), 60, 100);
    const cov = rangeCoverage(p, 'c', 'bgremove', [2, 3.5], masks)!;
    expect(cov.have).toBe(41);
    expect(cov.total).toBe(46);
    expect(cov.missing).toEqual([[101 / 30, 3.5]]);
    expect(rangeCoverage(p, 'c', 'stabilize', [2, 3], masks)).toBeNull(); // el clip no tiene ese efecto
  });
});

describe('V9b · textos de aviso', () => {
  it('vista previa: dice qué falta, cuánto lleva y qué se ve', () => {
    const p = project();
    const masks = new MaskCache();
    fill(masks, matteKey('m', 'fast'), 60, 100);
    const none = noticeItemsAt(p, 3.5, masks, new MotionCache());
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ clipId: 'c', kind: 'bgremove' });
    expect(none[0].text).toMatch(/Quitar fondo/);
    expect(none[0].text).toMatch(/calculado el 33 % del clip/);
    expect(noticeItemsAt(p, 3.5, new MaskCache(), new MotionCache())[0].text).not.toMatch(/\(/); // sin nada calculado, sin paréntesis
    expect(none[0].text).toMatch(/original/);
    expect(noticeItemsAt(p, 0.2, masks, new MotionCache())).toHaveLength(0); // 2,2 s del archivo: calculado
  });
  it('exportación: «El 60 % del clip … no está calculado: ¿calcular antes de exportar?»', () => {
    const p = project();
    const masks = new MaskCache();
    fill(masks, matteKey('m', 'fast'), 60, 120); // 61 de 121 = 50 %
    const items = exportPending(p, masks, new MotionCache());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Entrevista', pct: 50, missingPct: 50, kind: 'bgremove' });
    expect(exportPromptText(items)).toBe('El 50 % del clip «Entrevista» no está calculado (quitar fondo): ¿calcular antes de exportar?');
    fill(masks, matteKey('m', 'fast'), 60, 180);
    expect(exportPending(p, masks, new MotionCache())).toEqual([]);
    expect(exportPromptText([])).toBe('');
  });
  it('varios efectos pendientes: una sola pregunta', () => {
    const p = project([makeFx('bgremove', { id: 'bg', p: { mode: 'fast' } }), makeFx('stabilize', { id: 'st' })]);
    expect(exportPromptText(exportPending(p, new MaskCache(), new MotionCache()))).toMatch(/^Hay 2 efectos de IA sin calcular/);
  });
  it('estimación legible', () => {
    expect(estimateText({ frames: 0, seconds: 0, cacheBytes: 0, peakBytes: 0 })).toMatch(/ya está calculado/);
    expect(estimateText({ frames: 121, seconds: 90, cacheBytes: 121 * 448 * 256, peakBytes: 600e6 })).toMatch(/121 fotogramas · tarda unos 1 min 30 s/);
    expect(estimateText({ frames: 91, seconds: 0.8, cacheBytes: 91 * 64, peakBytes: 91 * 64 })).toBe('91 fotogramas · tarda unos 1 s'); // estabilizar: sin memoria
  });
});

describe('V9b · tamaño de la descarga', () => {
  it('con un decimal, sin redondear 25,9 MB a 26 MB', () => {
    expect(formatDownload(25889088)).toBe('25,9 MB');
    expect(formatDownload(448)).toBe('0,0 MB');
    expect(formatDownload(1_500_000_000)).toBe('1,50 GB');
  });
});

describe('V9b · estabilización: vista previa del recorte', () => {
  const shaky = () => {
    const mo = new MotionCache();
    mo.track(stabKey('m'), 100, 100, 30);
    for (let i = 0; i <= 90; i++) mo.put(stabKey('m'), i, { dx: Math.sin(i * 1.7) * 3, dy: Math.cos(i * 2.1) * 2, da: 0, ds: 0, ok: true });
    return mo;
  };
  it('mide recorte y reducción del temblor; más suavizado = más recorte', () => {
    const mo = shaky();
    const lo = stabPreview(mo, 'm', [0, 3], { smooth: 0.2, maxZoom: 1.5, rotation: true })!;
    const hi = stabPreview(mo, 'm', [0, 3], { smooth: 2.5, maxZoom: 1.5, rotation: true })!;
    expect(lo.reduction).toBeGreaterThan(0);
    expect(hi.cropPct).toBeGreaterThanOrEqual(lo.cropPct);
    expect(hi.zoom).toBeGreaterThanOrEqual(1);
    expect(hi.path.length).toBeGreaterThan(5);
  });
  it('el tope de recorte limita la corrección y lo dice', () => {
    const p = stabPreview(shaky(), 'm', [0, 3], { smooth: 2.5, maxZoom: 1, rotation: true })!;
    expect(p.zoom).toBe(1);
    expect(p.cropPct).toBe(0);
    expect(p.clamped).toBe(true);
  });
  it('sin movimiento medido, no hay vista previa', () => {
    expect(stabPreview(new MotionCache(), 'm', [0, 3], { smooth: 1, maxZoom: 1.2, rotation: true })).toBeNull();
  });
});

describe('V9b · persistencia: claves, ajustes y límite de espacio', () => {
  it('la clave lleva el medio (huella) y los parámetros de cálculo, no el id de sesión', () => {
    const fp = fingerprintKey(1234, 10.0004, 'abc');
    expect(fp).toBe('1234-10000-abc');
    expect(matteStoreKey(fp, 'fast')).toBe('matte|modnet|fast|1234-10000-abc');
    expect(matteStoreKey(fp, 'quality')).not.toBe(matteStoreKey(fp, 'fast'));
    expect(stabStoreKey(fp)).toBe('stab|1234-10000-abc');
    expect(kindOfKey(stabStoreKey(fp))).toBe('stab');
    expect(kindOfKey(matteStoreKey(fp, 'fast'))).toBe('matte');
  });
  it('ajustes: por defecto activos con 512 MB; valores raros se corrigen', () => {
    expect(parseSettings(null)).toEqual({ enabled: true, budgetMB: DEFAULT_BUDGET_MB });
    expect(parseSettings('{"enabled":false,"budgetMB":100}')).toEqual({ enabled: false, budgetMB: 100 });
    expect(parseSettings('{"budgetMB":1}').budgetMB).toBe(64);
    expect(parseSettings('{"budgetMB":999999}').budgetMB).toBe(8192);
    expect(parseSettings('no es json')).toEqual({ enabled: true, budgetMB: DEFAULT_BUDGET_MB });
    expect(clampBudgetMB(NaN)).toBe(DEFAULT_BUDGET_MB);
  });
  it('desalojo: suelta primero lo menos usado y nunca la pista que se guarda', () => {
    const m = [
      { key: 'a', bytes: 40, used: 3 },
      { key: 'b', bytes: 40, used: 1 },
      { key: 'c', bytes: 40, used: 2 },
    ];
    expect(planEviction(m, 30, 130, 'zz')).toEqual({ drop: ['b'], fits: true });
    expect(planEviction(m, 30, 100, 'zz').drop).toEqual(['b', 'c']);
    expect(planEviction(m, 0, 130, 'zz').drop).toEqual([]);
    expect(planEviction(m, 100, 100, 'b')).toEqual({ drop: [], fits: false }); // ella sola no cabe
    expect(planEviction(m, 10, 50, 'b').drop).not.toContain('b');
  });
});

describe('V9b · persistencia: guardar, recuperar, límite y borrado', () => {
  const settings = (enabled = true, budgetMB = 512) => () => ({ enabled, budgetMB });
  it('lo guardado vuelve a la caché en memoria (reabrir no recalcula) y solo se escribe lo nuevo', async () => {
    const store = new MemoryAiStore();
    const ps = new AiPersist(store, settings(), () => 1);
    const a = new MaskCache();
    const k = matteKey('m', 'fast');
    fill(a, k, 0, 9);
    expect(await ps.saveMatte('matte|modnet|fast|FP', 'a.mp4', k, a)).toBe(true);
    expect(store.frames.get('matte|modnet|fast|FP')!.size).toBe(10);
    for (let i = 10; i <= 14; i++) a.put(k, i, new Uint8Array(4));
    await ps.saveMatte('matte|modnet|fast|FP', 'a.mp4', k, a);
    expect((await store.getMeta('matte|modnet|fast|FP'))!.count).toBe(15);
    // «otra sesión»: caché vacía y otro id de medio
    const b = new MaskCache();
    const k2 = matteKey('otro-id', 'fast');
    expect(await ps.restoreMatte('matte|modnet|fast|FP', k2, b)).toBe(15);
    expect(b.coverage(k2, 0, 14 / 30, 30).have).toBe(15);
    expect(await ps.restoreMatte('matte|modnet|fast|FP', k2, b)).toBe(0); // ya está
    expect(await ps.restoreMatte('matte|modnet|quality|FP', matteKey('otro-id', 'quality'), b)).toBe(0); // otro modo: nada
  });
  it('movimiento de estabilización: ida y vuelta', async () => {
    const ps = new AiPersist(new MemoryAiStore(), settings(), () => 1);
    const a = new MotionCache();
    a.track(stabKey('m'), 8, 8, 30);
    for (let i = 0; i < 20; i++) a.put(stabKey('m'), i, { dx: i, dy: 0, da: 0, ds: 0, ok: true });
    expect(await ps.saveStab('stab|FP', 'a.mp4', stabKey('m'), a)).toBe(true);
    const b = new MotionCache();
    expect(await ps.restoreStab('stab|FP', stabKey('z'), b)).toBe(20);
    expect(b.peek(stabKey('z'))!.motion.get(7)!.dx).toBe(7);
  });
  it('apagado: no guarda ni recupera nada', async () => {
    const store = new MemoryAiStore();
    const ps = new AiPersist(store, settings(false), () => 1);
    const a = new MaskCache();
    fill(a, 'k', 0, 3);
    expect(await ps.saveMatte('s', 'n', 'k', a)).toBe(false);
    expect(store.meta.size).toBe(0);
    expect(await ps.restoreMatte('s', 'k', new MaskCache())).toBe(0);
  });
  it('límite de espacio: suelta lo menos usado; lo que no cabe ni vacío no se guarda', async () => {
    const store = new MemoryAiStore();
    let now = 0;
    const ps = new AiPersist(store, () => ({ enabled: true, budgetMB: 64 }), () => ++now);
    const big = (n: number) => {
      const c = new MaskCache(2 ** 40);
      c.track('k', 1024, 1024, 30); // 1 MB por fotograma
      for (let i = 0; i < n; i++) c.put('k', i, new Uint8Array(1024 * 1024));
      return c;
    };
    expect(await ps.saveMatte('A', 'a', 'k', big(30))).toBe(true); // 30 MB
    expect(await ps.saveMatte('B', 'b', 'k', big(30))).toBe(true); // 60 MB
    expect(await ps.saveMatte('C', 'c', 'k', big(30))).toBe(true); // hay que soltar A (la menos usada)
    expect([...store.meta.keys()].sort()).toEqual(['B', 'C']);
    expect(await ps.saveMatte('D', 'd', 'k', big(70))).toBe(false); // 70 MB > 64 MB
    expect([...store.meta.keys()].sort()).toEqual(['B', 'C']);
    const st = await ps.stats();
    expect(st.tracks).toBe(2);
    expect(st.bytes).toBe(60 * 1048576);
    await ps.deleteAll();
    expect((await ps.stats()).tracks).toBe(0);
  });
  it('bajar el límite suelta lo que ya no cabe', async () => {
    const store = new MemoryAiStore();
    let mb = 512;
    const ps = new AiPersist(store, () => ({ enabled: true, budgetMB: mb }), () => 1);
    for (const k of ['a', 'b']) {
      const c = new MaskCache(2 ** 40);
      c.track('k', 1024, 1024, 30);
      for (let i = 0; i < 40; i++) c.put('k', i, new Uint8Array(1024 * 1024));
      await ps.saveMatte(k, k, 'k', c);
    }
    mb = 64;
    expect(await ps.enforceBudget()).toBe(1);
    expect(store.meta.size).toBe(1);
  });
});

describe('V9b · cola de trabajos: consentimiento, cancelar y reanudar', () => {
  function deps(o: { installed?: boolean } = {}) {
    const calls = { download: 0, engine: 0, matte: [] as string[], stab: 0, persisted: 0, closed: 0 };
    let installed = o.installed ?? true;
    const p = project();
    const d: JobDeps = {
      getProject: () => p,
      matteStatus: async () => ({ installed, bytesTotal: 100, bytesHave: installed ? 100 : 0, bytesNeeded: installed ? 0 : 100 }),
      matteDownloadPlan: async () => ({ installed, bytesTotal: 100, bytesHave: 0, bytesNeeded: 100, fits: true, consent: { model: 'modnet', bytes: 100 } }),
      downloadMatteModel: async (x) => {
        calls.download++;
        expect(x.consent.accepted).toBe(true);
        x.onProgress(1);
        installed = true;
        return { installed: true, bytesTotal: 100, bytesHave: 100, bytesNeeded: 0 };
      },
      createEngine: async () => (calls.engine++, { id: 'sim', infer: async () => new Uint8Array(4), close: () => void calls.closed++ }),
      computeMatte: async (_p, id, job) => {
        calls.matte.push(id);
        job.onProgress?.({ stage: 'Quitando el fondo', done: 5, total: 10, ratio: 0.5, eta: 12 });
        if (job.signal?.aborted) throw new DOMException('x', 'AbortError');
        return { key: 'k', computed: 10, skipped: 0, total: 10, ms: 100, msPerFrame: 10, inW: 2, inH: 2 };
      },
      computeStabilization: async () => (calls.stab++, { computed: 7, total: 7, ms: 5 }),
      modeOf: () => 'fast',
      persist: async () => void calls.persisted++,
    };
    return { d, calls, set: (v: boolean) => (installed = v) };
  }

  it('sin el modelo, espera el consentimiento con el tamaño exacto y NO descarga hasta aceptar', async () => {
    const { d, calls } = deps({ installed: false });
    const jc = new JobController(d);
    const run = jc.start([{ clipId: 'c', kind: 'bgremove' }]);
    await new Promise((r) => setTimeout(r, 5));
    expect(jc.getState().phase).toBe('consent');
    expect(jc.getState().consent).toMatchObject({ bytes: 100, fits: true });
    expect(calls.download).toBe(0);
    expect(calls.engine).toBe(0);
    jc.acceptConsent();
    expect(await run).toBe(true);
    expect(calls.download).toBe(1);
    expect(jc.getState().phase).toBe('done');
    expect(calls.persisted).toBe(1);
    expect(calls.closed).toBe(1);
  });
  it('rechazar el consentimiento no descarga ni calcula', async () => {
    const { d, calls } = deps({ installed: false });
    const jc = new JobController(d);
    const run = jc.start([{ clipId: 'c', kind: 'bgremove' }]);
    await new Promise((r) => setTimeout(r, 5));
    jc.declineConsent();
    expect(await run).toBe(false);
    expect(jc.getState().phase).toBe('cancelled');
    expect(calls.download + calls.engine + calls.matte.length).toBe(0);
  });
  it('estabilizar no necesita el modelo (ni consentimiento)', async () => {
    const { d, calls } = deps({ installed: false });
    const jc = new JobController(d);
    expect(await jc.start([{ clipId: 'c', kind: 'stabilize' }])).toBe(true);
    expect(calls.stab).toBe(1);
    expect(calls.download).toBe(0);
  });
  it('progreso con tiempo restante y tiempo medido por modo', async () => {
    const { d } = deps();
    const jc = new JobController(d);
    const seen: number[] = [];
    jc.subscribe(() => jc.getState().eta !== undefined && seen.push(jc.getState().eta!));
    await jc.start([{ clipId: 'c', kind: 'bgremove' }]);
    expect(seen).toContain(12);
    expect(jc.measured.fast).toBe(10);
  });
  it('cancelar a mitad conserva lo calculado, guarda y se puede reanudar', async () => {
    const { d, calls } = deps();
    const jc = new JobController({
      ...d,
      computeMatte: async (_p, _id, job) => {
        job.onProgress?.({ stage: 's', done: 1, total: 10, ratio: 0.1 });
        jc.cancel();
        throw new DOMException('x', 'AbortError');
      },
    });
    expect(await jc.start([{ clipId: 'c', kind: 'bgremove' }])).toBe(false);
    expect(jc.getState().phase).toBe('cancelled');
    expect(jc.getState().message).toMatch(/continúa solo con lo que falta/);
    expect(jc.getState().cancelling).toBe(false);
    expect(calls.persisted).toBe(1);
    jc.setDeps(d);
    expect(await jc.start([{ clipId: 'c', kind: 'bgremove' }])).toBe(true);
  });
  it('un fallo se muestra con su mensaje; no arranca otra cola mientras hay una en marcha', async () => {
    const { d } = deps();
    let release: () => void = () => {};
    const jc = new JobController({ ...d, computeMatte: () => new Promise((_, rej) => (release = () => rej(new Error('Se acabó la memoria')))) });
    const run = jc.start([{ clipId: 'c', kind: 'bgremove' }]);
    await new Promise((r) => setTimeout(r, 5));
    expect(await jc.start([{ clipId: 'c', kind: 'stabilize' }])).toBe(false);
    expect(jc.involves('c')).toBe(true);
    release();
    await run;
    expect(jc.getState()).toMatchObject({ phase: 'error', error: 'Se acabó la memoria' });
    jc.dismiss();
    expect(jc.getState().phase).toBe('idle');
  });
});
