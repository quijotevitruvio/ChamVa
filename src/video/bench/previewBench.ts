// Banco de la vista previa V3 (página de desarrollo: /dev/preview-bench.html). Monta un proyecto de
// 3 pistas de video + 2 de audio con cortes y compara la vista previa REAL (PreviewEngine) con la
// exportación REAL (renderProject): píxeles, audio (RMS/pico), fluidez, scrubbing y fugas.
// Todo cuelga de window.__pv para poder automatizarlo desde el navegador.
import * as VM from '../model';
import { renderProject } from '../engine/render';
import { BlobPartsSink } from '../engine/sink';
import { PreviewEngine } from '../../ui/video/previewEngine';
import { MediaCache } from '../../ui/video/mediaCache';
import { PreviewAudioGraph } from '../../ui/video/preview/previewAudio';
import { makeSynthClip, type SynthClip } from './synth';

const out = document.getElementById('out')!;
const log = (s: string) => {
  out.textContent += s + '\n';
};
const FPS = 30;
const W = 1280;
const H = 720;

interface Built {
  project: VM.VideoProject;
  clips: Record<string, SynthClip>;
}
let built: Built | null = null;
let cache: MediaCache | null = null;
let engine: PreviewEngine | null = null;

async function build(): Promise<Built> {
  if (built) return built;
  const m1 = await makeSynthClip({ container: 'mp4', width: 640, height: 360, fps: 24, seconds: 8, toneAmp: 0.9, quietAmp: 0.01, quietUntil: 2 });
  const m2 = await makeSynthClip({ container: 'mp4', width: 640, height: 360, fps: 24, seconds: 8, toneAmp: 0.9, colorOffset: 2 });
  const m3 = await makeSynthClip({ container: 'mp4', width: 360, height: 640, fps: 30, seconds: 8, toneAmp: 0.2, colorOffset: 4 });
  let p = VM.createProject();
  p = VM.addTrack(p, 'video', { id: 'V0' }); // arriba
  p = VM.addTrack(p, 'video', { id: 'V1' });
  p = VM.addTrack(p, 'video', { id: 'V2' }); // abajo
  p = VM.addTrack(p, 'audio', { id: 'A1' });
  p = VM.addTrack(p, 'audio', { id: 'A2' });
  for (const [id, c] of [['m1', m1], ['m2', m2], ['m3', m3]] as const) p = VM.addMedia(p, { id, kind: 'video', name: id + '.mp4', duration: 8, blob: c.blob });
  p = VM.addMedia(p, { id: 'a1', kind: 'audio', name: 'a1.mp4', duration: 8, blob: m1.blob });
  p = VM.addMedia(p, { id: 'a2', kind: 'audio', name: 'a2.mp4', duration: 8, blob: m2.blob });
  const add = (track: string, c: VM.Clip) => (p = VM.addClip(p, track, c));
  // capa de abajo: m3 (vertical) 0,5–3 y m1 5–8
  add('V2', VM.makeClip('video', { id: 'c1', mediaId: 'm3', start: 0.5, inP: 0, outP: 2.5 }));
  add('V2', VM.makeClip('video', { id: 'c2', mediaId: 'm1', start: 5, inP: 0, outP: 3, volume: 0.7 }));
  // capa media: m2 0–2, continuación (dividido) 2–4, y m1 4–8 (corte a otro archivo)
  add('V1', VM.makeClip('video', { id: 'c3', mediaId: 'm2', start: 0, inP: 0, outP: 2 }));
  add('V1', VM.makeClip('video', { id: 'c4', mediaId: 'm2', start: 2, inP: 2, outP: 4 }));
  add('V1', VM.makeClip('video', { id: 'c5', mediaId: 'm1', start: 4, inP: 2, outP: 6, fadeIn: 0.3 }));
  // capa de arriba: PIP m3 con transformación y opacidad, y un texto
  add('V0', VM.makeClip('video', { id: 'c6', mediaId: 'm3', start: 1, inP: 1, outP: 5, transform: { x: 0.78, y: 0.28, scale: 0.35, rotation: 8, opacity: 0.9 }, fadeOut: 0.5 }));
  add('V0', VM.makeClip('text', { id: 'c7', start: 5.2, inP: 0, outP: 2.5, text: 'Hola', color: '#ffffff', size: 70 }));
  // audio: A1 con compuerta («Reducir ruido») y A2 con eco, ambos fuertes → el limitador actúa al solaparse
  add('A1', VM.makeClip('audio', { id: 'c8', mediaId: 'a1', start: 0, inP: 0, outP: 6, volume: 1.2, effect: 'denoise' }));
  add('A2', VM.makeClip('audio', { id: 'c9', mediaId: 'a2', start: 2, inP: 0, outP: 5, effect: 'echo' }));
  p = { ...p, normalize: true };
  built = { project: p, clips: { m1, m2, m3 } };
  return built;
}

function ensureEngine(canvas?: HTMLCanvasElement) {
  if (engine) return engine;
  cache = new MediaCache();
  engine = new PreviewEngine({ cache });
  const c = canvas ?? (document.getElementById('cv') as HTMLCanvasElement);
  engine.attach(c);
  engine.setFormat('16:9', 'contain');
  engine.setQualityMode('high');
  return engine;
}

function stats(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(s.length * f))] ?? 0;
  return { n: a.length, mean: a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), p50: q(0.5), p95: q(0.95), max: s[s.length - 1] ?? 0 };
}
const maxAbs = (a: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
};
const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;

/** Exporta con el motor real y devuelve los fotogramas pedidos (índices) y el audio mezclado. */
async function exportTap(p: VM.VideoProject, wantFrames: number[], images?: Map<string, HTMLImageElement>) {
  const want = new Set(wantFrames);
  const frames = new Map<number, ImageData>();
  const aL: Float32Array[] = [];
  const aR: Float32Array[] = [];
  const t0 = performance.now();
  const res = await renderProject(p, {
    container: 'mp4',
    sizes: [{ width: W, height: H, label: '720p' }],
    fps: FPS,
    sink: new BlobPartsSink('video/mp4'),
    images,
    tap: {
      frame: (i, ctx) => {
        if (want.has(i)) frames.set(i, ctx.getImageData(0, 0, W, H));
      },
      audio: (L, R, n) => {
        aL.push(L.slice(0, n));
        aR.push(R.slice(0, n));
      },
    },
  });
  const cat = (parts: Float32Array[]) => {
    const o = new Float32Array(parts.reduce((s, x) => s + x.length, 0));
    let k = 0;
    for (const x of parts) (o.set(x, k), (k += x.length));
    return o;
  };
  return { res, frames, L: cat(aL), R: cat(aR), ms: performance.now() - t0 };
}

function diffImages(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let sum = 0;
  let big = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    sum += d;
    if (d > 32) big++;
  }
  return { meanAbs: sum / n, pctBig: (100 * big) / n };
}


/** Renderiza el audio del proyecto con el grafo de la vista previa (AudioWorklet) en un OfflineAudioContext. */
async function previewOffline(project: VM.VideoProject, length: number) {
  const off = new OfflineAudioContext(2, length, 48000);
  const g = new PreviewAudioGraph(off, { eq: project.eq, normalize: project.normalize });
  await g.ready;
  const decoded = new Map<string, AudioBuffer>();
  const ac = new OfflineAudioContext(2, 1, 48000);
  for (const [id, m] of Object.entries(project.media)) if (m.blob && (m.kind === 'audio' || m.kind === 'video')) decoded.set(id, await ac.decodeAudioData(await m.blob.arrayBuffer()));
  const videoDur = VM.projectDuration(project);
  // mismo orden que el motor: video de abajo arriba y luego pistas de audio
  const order: VM.Clip[] = [];
  for (const { track } of VM.videoTracksBottomUp(project)) if (!track.muted) for (const c of track.clips) if (c.kind === 'video') order.push(c);
  for (const t of project.tracks) if (t.kind === 'audio' && !t.muted) order.push(...t.clips);
  for (const c of order) {
    const buf = decoded.get(c.mediaId!);
    if (!buf || c.start >= videoDur) continue;
    const src = off.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = c.speed || 1;
    const strip = g.addSource(src, VM.clipAudioFx(c));
    strip.fade.gain.value = 1;
    const len = Math.min(c.outP - c.inP, (videoDur - c.start) * (c.speed || 1));
    src.start(c.start, c.inP, len);
  }
  const rendered = await off.startRendering();
  const res = { L: rendered.getChannelData(0), R: rendered.getChannelData(1), workletOk: g.workletOk };
  g.dispose();
  return res;
}

const rmsOf = (a: Float32Array, t0: number, t1: number) => {
  let s = 0;
  const i0 = Math.round(t0 * 48000);
  const i1 = Math.min(a.length, Math.round(t1 * 48000));
  for (let i = i0; i < i1; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, i1 - i0));
};

const pv = {
  async build() {
    const b = await build();
    return { duration: VM.projectDuration(b.project), tracks: b.project.tracks.length, clips: b.project.tracks.reduce((s, t) => s + t.clips.length, 0) };
  },

  /** Vista previa vs exportación, fotograma a fotograma en varios instantes. */
  async pixels(times = [0.1, 0.7, 1.4, 2.0, 2.5, 3.3, 3.99, 4.4, 5.6, 6.8, 7.5]) {
    const { project } = await build();
    const e = ensureEngine();
    e.setProject(project);
    const idx = times.map((t) => Math.round(t * FPS));
    const ex = await exportTap(project, idx);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d', { alpha: false })!;
    const rows: Record<string, unknown>[] = [];
    for (let k = 0; k < times.length; k++) {
      const t = idx[k] / FPS;
      e.seek(t);
      const ok = await e.settle(4000);
      await new Promise((r) => setTimeout(r, 60));
      e.draw();
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      e.drawFrame(g, W, H, t);
      const a = g.getImageData(0, 0, W, H).data;
      const b = ex.frames.get(idx[k])!.data;
      const d = diffImages(a, b);
      rows.push({ t, settled: ok, meanAbs: +d.meanAbs.toFixed(3), pctBig: +d.pctBig.toFixed(3) });
    }
    return { exportMs: Math.round(ex.ms), rows, worstMean: Math.max(...rows.map((r) => r.meanAbs as number)), worstPct: Math.max(...rows.map((r) => r.pctBig as number)) };
  },

  /** Audio: grafo de la vista previa (AudioWorklet) en OfflineAudioContext vs mezclador de la exportación. */
  async audio() {
    const { project } = await build();
    const ex = await exportTap(project, []);
    const dur = ex.L.length / 48000;
    const { L, R, workletOk } = await previewOffline(project, ex.L.length);
    const seg = (a: Float32Array, t0: number, t1: number) => {
      let s = 0;
      let pk = 0;
      const i0 = Math.round(t0 * 48000);
      const i1 = Math.min(a.length, Math.round(t1 * 48000));
      for (let i = i0; i < i1; i++) {
        s += a[i] * a[i];
        pk = Math.max(pk, Math.abs(a[i]));
      }
      return { rms: Math.sqrt(s / Math.max(1, i1 - i0)), peak: pk };
    };
    const segs: [string, number, number][] = [['0–2 s (compuerta cerrada)', 0.3, 1.8], ['2–5 s (suma fuerte + eco)', 2.2, 4.8], ['5–7 s', 5.2, 6.8]];
    const rows = segs.map(([name, a, b]) => {
      const e = seg(ex.L, a, b);
      const v = seg(L, a, b);
      return { name, exportRms: +e.rms.toFixed(5), previewRms: +v.rms.toFixed(5), rmsRatio: +(v.rms / Math.max(e.rms, 1e-9)).toFixed(4), exportPeak: +e.peak.toFixed(4), previewPeak: +v.peak.toFixed(4) };
    });
    // correlación y desfase máximo en una ventana central
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = Math.round(2.2 * 48000); i < Math.round(4.8 * 48000); i++) {
      num += ex.L[i] * L[i];
      da += ex.L[i] ** 2;
      db += L[i] ** 2;
    }
    return { duration: dur, rows, corr: +(num / Math.sqrt(da * db)).toFixed(5), ceiling: 0.8913, limiterPeakExport: ex.res.peakOut, limiterPeakIn: ex.res.peakIn, workletOk, previewMaxAbs: Math.max(maxAbs(L), maxAbs(R)) };
  },


  /** Compuerta de ruido aislada: tramo casi mudo (0–2 s) con y sin «Reducir ruido», vista previa vs exportación. */
  async gate() {
    const { clips } = await build();
    const mk = (effect: string) => {
      let p = VM.createProject();
      p = VM.addTrack(p, 'video', { id: 'V' });
      p = VM.addTrack(p, 'audio', { id: 'A' });
      p = VM.addMedia(p, { id: 'a1', kind: 'audio', name: 'a1', duration: 8, blob: clips.m1.blob });
      p = VM.addClip(p, 'V', VM.makeClip('text', { id: 't', start: 0, inP: 0, outP: 4, text: '.', size: 40 }));
      p = VM.addClip(p, 'A', VM.makeClip('audio', { id: 'a', mediaId: 'a1', start: 0, inP: 0, outP: 4, effect }));
      return p;
    };
    const rows: Record<string, number | string>[] = [];
    for (const effect of ['none', 'denoise']) {
      const p = mk(effect);
      const ex = await exportTap(p, []);
      const pr = await previewOffline(p, ex.L.length);
      const quiet = [0.5, 1.8] as const;
      const loud = [2.5, 3.8] as const;
      rows.push({
        effect,
        exportQuietRms: +rmsOf(ex.L, ...quiet).toFixed(5),
        previewQuietRms: +rmsOf(pr.L, ...quiet).toFixed(5),
        exportLoudRms: +rmsOf(ex.L, ...loud).toFixed(4),
        previewLoudRms: +rmsOf(pr.L, ...loud).toFixed(4),
      });
    }
    return rows;
  },

  /** Reproducción real (rAF) durante `sec` s: fps, tiempo por fotograma, descartes y atascos. */
  async fluency(sec = 8) {
    const { project } = await build();
    const e = ensureEngine();
    e.setProject(project);
    e.setQualityMode('high');
    e.seek(0);
    await e.settle(4000);
    const r0 = await new Promise<number>((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => (++n, performance.now() - t0 < 400 ? requestAnimationFrame(f) : res(n));
      requestAnimationFrame(f);
      setTimeout(() => res(n), 900); // panel oculto: rAF no dispara
    });
    const rafWorks = r0 > 3;
    if (!rafWorks) return { rafWorks, note: 'rAF no dispara (panel oculto): usa pv.simulated()' };
    const f0 = e.frames;
    e.play();
    const works: number[] = [];
    const t0 = performance.now();
    const cutTimes = [2, 4, 5];
    const ends = new Promise<void>((r) => e.setOnEnded(() => r()));
    await Promise.race([ends, new Promise((r) => setTimeout(r, sec * 1000))]);
    const wall = (performance.now() - t0) / 1000;
    const m = e.metrics();
    e.pause();
    void works;
    void cutTimes;
    return { rafWorks, wallSec: +wall.toFixed(2), drawn: e.frames - f0, fps: +((e.frames - f0) / wall).toFixed(1), metrics: m, clock: e.time };
  },

  /** Con reloj simulado (sin rAF): mide el coste real de componer + sincronizar por fotograma. */
  async simulated(sec = 8, fps = 30) {
    const { project } = await build();
    const e = ensureEngine();
    e.setProject(project);
    e.setQualityMode('high');
    e.seek(0);
    await e.settle(4000);
    let clock = performance.now();
    e.setClockSource(() => clock);
    const works: number[] = [];
    e.play();
    await new Promise((r) => setTimeout(r, 50));
    clock = performance.now();
    e.seek(0);
    const n = Math.round(sec * fps);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const w0 = performance.now();
      clock += 1000 / fps;
      e.step(clock);
      works.push(performance.now() - w0);
      // deja pasar el tiempo real de un fotograma para que los elementos avancen de verdad
      const wait = 1000 / fps - (performance.now() - w0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      clock = performance.now();
    }
    e.pause();
    e.setClockSource(null);
    return { frames: n, wallSec: +((performance.now() - t0) / 1000).toFixed(2), work: stats(works), metrics: e.metrics() };
  },

  /** Scrubbing: tiempo de respuesta sincrónico y qué tanto se ve (no negro) al instante. */
  async scrub() {
    const { project } = await build();
    const e = ensureEngine();
    e.setProject(project);
    e.setQualityMode('high');
    const cv = document.getElementById('cv') as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const nonBlack = () => {
      const d = g.getImageData(0, 0, cv.width, cv.height, { colorSpace: 'srgb' }).data;
      let c = 0;
      for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 30) c++;
      return c > 8;
    };
    // calentamiento: recorrer el proyecto parando cada 0,4 s (así se llena la caché)
    for (let t = 0.2; t < 8; t += 0.4) {
      e.seek(t);
      await e.settle(2000);
      await new Promise((r) => setTimeout(r, 30));
    }
    const calls: number[] = [];
    let shown = 0;
    let total = 0;
    const seq: number[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 120; i++) seq.push(rnd() * 7.8);
    const t0 = performance.now();
    for (const t of seq) {
      const w0 = performance.now();
      e.seek(t); // sincrónico: sync + draw con lo mejor disponible
      calls.push(performance.now() - w0);
      total++;
      if (nonBlack()) shown++;
      await new Promise((r) => setTimeout(r, 16));
    }
    const dragSec = (performance.now() - t0) / 1000;
    // refinado: tras soltar, el fotograma exacto llega
    const refine: number[] = [];
    for (const t of [1.3, 3.7, 6.1]) {
      e.seek(t);
      const r0 = performance.now();
      const ok = await e.settle(3000);
      refine.push(ok ? performance.now() - r0 : -1);
    }
    return { seeks: total, instantImagePct: +((100 * shown) / total).toFixed(1), seekCallMs: stats(calls), dragSec: +dragSec.toFixed(2), refineMs: refine, cache: e.metrics().cachedFrames, cacheKB: e.metrics().cachedKB };
  },

  /** Fugas: bucle de reproducción con reloj simulado de `simSec` s; heap y recursos antes/después. */
  async leak(simSec = 300, fps = 30) {
    const { project } = await build();
    const e = ensureEngine();
    e.setProject(project);
    e.setQualityMode('high');
    const dur = VM.projectDuration(project);
    const samples: { simT: number; heapMB: number; elements: number; cached: number; cachedKB: number; strips: number }[] = [];
    const snap = (simT: number) => {
      const m = e.metrics();
      samples.push({ simT, heapMB: +(heap() / 1048576).toFixed(1), elements: m.elements, cached: m.cachedFrames, cachedKB: m.cachedKB, strips: m.audioStrips });
    };
    let clock = performance.now();
    e.setClockSource(() => clock);
    e.seek(0);
    e.play();
    await new Promise((r) => setTimeout(r, 100));
    snap(0);
    let simT = 0;
    let loops = 0;
    const step = 1000 / fps;
    const n = Math.round(simSec * fps);
    for (let i = 1; i <= n; i++) {
      clock += step;
      simT += 1 / fps;
      e.step(clock);
      if (!e.isPlaying) {
        loops++;
        e.seek(0);
        e.play();
      }
      if (i % 30 === 0) {
        (window as unknown as { __leakProg: unknown }).__leakProg = { i, n, simT: +simT.toFixed(1), loops };
        await new Promise((r) => setTimeout(r, 4)); // cede el hilo para decodificación y GC
      }
      if (i % (30 * 30) === 0) snap(+simT.toFixed(0));
    }
    e.pause();
    e.setClockSource(null);
    await new Promise((r) => setTimeout(r, 300));
    snap(+simT.toFixed(0));
    return { simSec, projectDur: dur, loops, samples, first: samples[0], last: samples[samples.length - 1], metrics: e.metrics() };
  },

  /** Libera todo y comprueba que no queda nada (cambio de proyecto / desmontaje). */
  async disposeCheck() {
    const e = ensureEngine();
    const before = e.metrics();
    e.dispose();
    const after = e.metrics();
    engine = null;
    return { before, after };
  },

  /** Primera reproducción con cortes: cuántos fotogramas con capa sin imagen (atascos) en el corte. */
  async cuts() {
    const { project } = await build();
    const e = ensureEngine();
    e.setProject(project);
    const plan = [1.8, 3.8, 4.8].map((t) => ({ t, plan: e.planAt(t).map((i) => ({ id: i.clipId, startsIn: +i.startsIn.toFixed(2), play: i.play, cont: i.continuesFrom ?? null })) }));
    return plan;
  },

  log,
};

(window as unknown as { __pv: typeof pv }).__pv = pv;
log('listo: window.__pv.{build,pixels,audio,fluency,simulated,scrub,leak,disposeCheck}');
