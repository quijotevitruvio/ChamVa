// Banco de V8 (página de desarrollo: /dev/speed-bench.html): comprueba con el motor REAL (renderProject, PreviewEngine,
// composeFrame) las curvas de velocidad, invertir, bucle y reencuadre sobre clips sintéticos que llevan el número de
// fotograma pintado en cada imagen (12 casillas) y bips de audio en instantes conocidos. Todo cuelga de window.__sp.
import * as VM from '../model';
import { renderProject, type RenderResult } from '../engine/render';
import { BlobPartsSink } from '../engine/sink';
import { reverseDebug } from '../engine/reverse';
import { PreviewEngine } from '../../ui/video/previewEngine';
import { MediaCache } from '../../ui/video/mediaCache';
import { layersAt, localOfSource, sourceAtLocal } from '../speed/clipTime';
import { applySpeedPreset, freezeFrame, setLoop, setReverse, setSpeedCurve } from '../speed/speedOps';
import type { SpeedCurve } from '../model/types';
import { autoReframe } from '../reframe/auto';
import { reframeAt, cropSize, geometry } from '../reframe/math';
import { setReframe } from '../speed/speedOps';
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { CODE_BITS, colorAt, makeSynthClip } from './synth';

const out = document.getElementById('out')!;
const log = (s: string) => {
  out.textContent += s + '\n';
};
const win = window as unknown as Record<string, unknown>;

const SW = 640;
const SH = 360;
const SFPS = 24;
const FPS = 30;

/** Número de fotograma pintado en la imagen (casillas de la fila inferior). */
function readCode(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  let code = 0;
  for (let bit = 0; bit < CODE_BITS; bit++) {
    const x = Math.round(w * (0.02 + bit * 0.055) + w * 0.025);
    const y = Math.round(h * 0.87);
    const d = ctx.getImageData(x, y, 1, 1).data;
    if ((d[0] + d[1] + d[2]) / 3 > 128) code |= 1 << bit;
  }
  return code;
}

interface Run {
  res: RenderResult;
  codes: number[];
  audio: Float32Array;
  heapPeakMB: number;
  frames: Map<number, ImageData>;
  ms: number;
}

async function run(p: VM.VideoProject, o: { w?: number; h?: number; fps?: number; keep?: number[]; sampleHeap?: boolean } = {}): Promise<Run> {
  const w = o.w ?? SW;
  const h = o.h ?? SH;
  const fps = o.fps ?? FPS;
  const codes: number[] = [];
  const chunks: Float32Array[] = [];
  const keep = new Set(o.keep ?? []);
  const frames = new Map<number, ImageData>();
  let heap = 0;
  const mem = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  const t0 = performance.now();
  const res = await renderProject(p, {
    container: 'mp4',
    sizes: [{ width: w, height: h, label: 'bench' }],
    fps,
    sink: new BlobPartsSink('video/mp4'),
    tap: {
      frame: (i, ctx) => {
        codes.push(readCode(ctx, w, h));
        if (keep.has(i)) frames.set(i, ctx.getImageData(0, 0, w, h));
        if (o.sampleHeap && i % 30 === 0) heap = Math.max(heap, mem());
      },
      audio: (L, _R, n) => {
        chunks.push(L.slice(0, n));
      },
    },
  });
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const audio = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    audio.set(c, off);
    off += c.length;
  }
  return { res, codes, audio, heapPeakMB: Math.round(heap / 1048576), frames, ms: performance.now() - t0 };
}

/** Inicios (s) de los tramos de energía alta (los bips de 1 kHz sobre el tono de 440 Hz). */
function detectBeeps(a: Float32Array, sr = 48000, thr = 0.25): number[] {
  const win10 = Math.round(sr * 0.01);
  const out: number[] = [];
  let was = false;
  for (let i = 0; i + win10 <= a.length; i += win10) {
    let e = 0;
    for (let j = 0; j < win10; j++) e += a[i + j] * a[i + j];
    const on = Math.sqrt(e / win10) > thr;
    if (on && !was) out.push(i / sr);
    was = on;
  }
  return out;
}

const track = (p: VM.VideoProject, id = 'V') => VM.addTrack(p, 'video', { id });
const expectedIndex = (s: number) => Math.floor((s + 0.0005) * SFPS);

let synthCache: Awaited<ReturnType<typeof makeSynthClip>> | null = null;
/** 14 s, 24 fps, con bips de audio en 3, 6, 9 y 12 s de archivo. */
async function getSynth() {
  synthCache ??= await makeSynthClip({ container: 'mp4', width: SW, height: SH, fps: SFPS, seconds: 14, toneAmp: 0.1, beepsAt: [3, 6, 9, 12] });
  return synthCache;
}
const BEEPS = [3, 6, 9, 12];

async function project(c: Partial<VM.Clip>) {
  const s = await getSynth();
  let p = track(VM.createProject());
  p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'synth', duration: 14, blob: s.blob });
  return VM.addClip(p, 'V', VM.makeClip('video', { id: 'c', mediaId: 'm', start: 0, inP: 0, outP: 14, ...c }));
}

/** Compara el fotograma exportado de cada instante con el que debe verse según el mapa de tiempo. */
function checkFrames(r: Run, clip: VM.Clip, fps = FPS) {
  let skipped = 0;
  let bad = 0;
  let worst = 0;
  const first: { i: number; got: number; want: number }[] = [];
  for (let i = 0; i < r.codes.length; i++) {
    const lt = i / fps - clip.start;
    // dentro de un fundido cruzado el fotograma es una mezcla de dos: no se puede leer su número (se comprueba aparte por color)
    if (clip.loop?.xf && layersAt(clip, lt).length === 2) {
      skipped++;
      continue;
    }
    const want = expectedIndex(sourceAtLocal(clip, lt));
    // los fotogramas de los bips son blancos (todas las casillas encendidas = 4095): cuentan como acierto si ese era el fotograma esperado
    const flash = r.codes[i] === 4095 && BEEPS.some((b) => Math.floor(b * SFPS) === want);
    const d = flash ? 0 : Math.abs(r.codes[i] - want);
    if (d > 0) {
      bad++;
      worst = Math.max(worst, d);
      if (first.length < 5) first.push({ i, got: r.codes[i], want });
    }
  }
  return { frames: r.codes.length, bad, worstDiff: worst, skippedInCrossfade: skipped, first };
}

function checkBeeps(r: Run, clip: VM.Clip, beeps: number[], reverse = false) {
  const got = detectBeeps(r.audio);
  const rows = beeps
    .filter((b) => b >= clip.inP && b + 0.1 <= clip.outP)
    .map((b) => {
      const want = clip.start + localOfSource(clip, reverse ? b + 0.1 : b);
      const near = got.reduce((best, g) => (Math.abs(g - want) < Math.abs(best - want) ? g : best), Infinity);
      return { beepAtSource: b, expectedOut: +want.toFixed(3), detected: Number.isFinite(near) ? +near.toFixed(3) : null, errMs: Number.isFinite(near) ? Math.round((near - want) * 1000) : null };
    });
  return { rows, maxErrMs: Math.max(...rows.map((x) => Math.abs(x.errMs ?? 9999))), detectedCount: got.length };
}

const jobs: Record<string, unknown> = {};
function startJob(name: string, fn: () => Promise<unknown>) {
  jobs[name] = { state: 'running' };
  fn().then(
    (v) => (jobs[name] = { state: 'done', value: v }),
    (e) => (jobs[name] = { state: 'error', error: String(e?.stack ?? e) }),
  );
  return name;
}

const sp = {
  jobs,
  start: startJob,

  /** Rampa 0,5×→4×→1× (suave): el fotograma y el bip de cada instante de salida salen del instante de archivo esperado. */
  async ramp() {
    const curve: SpeedCurve = { pts: [{ s: 0, v: 0.5 }, { s: 7, v: 4 }, { s: 14, v: 1 }], smooth: true };
    const p = await project({ curve });
    const clip = VM.findClip(p, 'c')!.clip;
    const r = await run(p);
    return { duration: VM.clipDuration(clip), exportedFrames: r.res.frames, ms: Math.round(r.ms), frames: checkFrames(r, clip), audio: checkBeeps(r, clip, BEEPS), fallback: r.res.fallbackFrames, notices: r.res.notices };
  },

  /** 0,1× y 100×, y un preajuste («Salto») sobre un tramo recortado. */
  async extremes() {
    const result: Record<string, unknown> = {};
    for (const [name, c] of Object.entries({ slow: { inP: 2, outP: 3.5, speed: 0.1 }, fast: { inP: 0, outP: 14, speed: 100 } })) {
      const p = await project(c);
      const clip = VM.findClip(p, 'c')!.clip;
      const r = await run(p);
      result[name] = { duration: VM.clipDuration(clip), frames: checkFrames(r, clip) };
    }
    let p = await project({ inP: 1, outP: 13 });
    p = applySpeedPreset(p, 'c', 'jump');
    const clip = VM.findClip(p, 'c')!.clip;
    const r = await run(p);
    result.jump = { duration: VM.clipDuration(clip), frames: checkFrames(r, clip), audio: checkBeeps(r, clip, BEEPS) };
    return result;
  },

  /** Invertido: los fotogramas salen en orden descendente exacto y los bips suenan al revés. */
  async reverse() {
    const p = await project({ inP: 1, outP: 13, reverse: true });
    const clip = VM.findClip(p, 'c')!.clip;
    const r = await run(p);
    const fr = checkFrames(r, clip);
    let mono = true;
    for (let i = 1; i < r.codes.length; i++) if (r.codes[i] !== 4095 && r.codes[i - 1] !== 4095 && r.codes[i] > r.codes[i - 1]) mono = false;
    return { duration: VM.clipDuration(clip), frames: fr, descendingOrder: mono, firstCodes: r.codes.slice(0, 4), lastCodes: r.codes.slice(-4), audio: checkBeeps(r, clip, BEEPS, true), reverseDebug: { ...reverseDebug } };
  },

  /** Invertido + rampa de velocidad a la vez. */
  async reverseRamp() {
    const curve: SpeedCurve = { pts: [{ s: 0, v: 0.5 }, { s: 14, v: 3 }], smooth: false };
    const p = await project({ curve, reverse: true });
    const clip = VM.findClip(p, 'c')!.clip;
    const r = await run(p);
    return { duration: VM.clipDuration(clip), frames: checkFrames(r, clip), audio: checkBeeps(r, clip, BEEPS, true) };
  },

  /** Bucle (3 pasadas de 3 s, sin y con fundido cruzado): índices que se repiten y mezcla de color en el fundido. */
  async loop() {
    const result: Record<string, unknown> = {};
    for (const xf of [0, 1]) {
      const p = await project({ inP: 2, outP: 5, loop: { n: 3, ...(xf ? { xf } : {}) } });
      const clip = VM.findClip(p, 'c')!.clip;
      const dur = VM.clipDuration(clip);
      const keep = [Math.round(2.5 * FPS), Math.round(5.5 * FPS)];
      const r = await run(p, { keep });
      const row: Record<string, unknown> = { duration: dur, expectedDuration: 9 - 2 * xf, frames: checkFrames(r, clip), audio: checkBeeps(r, clip, [3]) };
      if (xf) {
        // en medio del fundido (pasada 0 → 1 a los 2,5 s): mitad de cada color (el fondo cambia de color cada segundo de archivo)
        const lay = (t: number) => {
          const a = sourceAtLocal({ ...clip, xlayer: true }, t);
          const b = sourceAtLocal(clip, t);
          return { a, b };
        };
        const mids = keep.map((i) => {
          const t = i / FPS;
          const { a, b } = lay(t);
          const ca = colorAt(a);
          const cb = colorAt(b);
          const d = r.frames.get(i)!;
          const x = Math.round(SW * 0.35);
          const y = Math.round(SH * 0.4);
          const k = (y * SW + x) * 4;
          const got = [d.data[k], d.data[k + 1], d.data[k + 2]];
          const want = ca.map((v, q) => Math.round((v + cb[q]) / 2));
          const dmax = Math.max(...got.map((v, q) => Math.abs(v - want[q])));
          return { t, sourceOut: +a.toFixed(3), sourceIn: +b.toFixed(3), got, wantMix: want, maxDiff: dmax, ok: dmax <= 28 };
        });
        row.crossfade = mids;
      }
      result[xf ? 'withCrossfade' : 'plain'] = row;
    }
    return result;
  },

  /** Congelar fotograma: dura lo pedido, siempre el mismo fotograma, sin sonido; el resto del clip sigue donde toca. */
  async freeze() {
    let p = await project({ inP: 0, outP: 6 });
    p = freezeFrame(p, 'c', 2.5, 2, { freeze: 'z', right: 'r' });
    const r = await run(p);
    const frozen = r.codes.slice(Math.round(2.5 * FPS) + 1, Math.round(4.5 * FPS) - 1);
    const clips = p.tracks[0].clips.map((c) => ({ id: c.id, start: +c.start.toFixed(3), dur: +VM.clipDuration(c).toFixed(3) }));
    return { clips, frozenCodes: [...new Set(frozen)], oneFrameOnly: new Set(frozen).size === 1, expectedIndex: expectedIndex(2.5), afterResume: r.codes[Math.round(5 * FPS)], expectedAfter: expectedIndex(3.0) };
  },

  /** MEMORIA ACOTADA: invertir un clip de 30 s y otro de 150 s; el pico de fotogramas vivos y de montón no crece con la duración. */
  async reverseMemory(longSeconds = 150) {
    const result: Record<string, unknown> = {};
    for (const secs of [30, longSeconds]) {
      const s = await makeSynthClip({ container: 'mp4', width: SW, height: SH, fps: SFPS, seconds: secs, audio: false });
      let p = track(VM.createProject());
      p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'long', duration: secs, blob: s.blob });
      p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'c', mediaId: 'm', inP: 0, outP: secs, reverse: true }));
      const clip = VM.findClip(p, 'c')!.clip;
      for (const k of Object.keys(reverseDebug)) (reverseDebug as Record<string, number>)[k] = 0;
      const gc = (globalThis as unknown as { gc?: () => void }).gc;
      gc?.();
      const r = await run(p, { sampleHeap: true });
      const bad = checkFrames(r, clip);
      // la misma exportación SIN invertir: el montón que se lleva el propio archivo de salida en memoria y las listas de la prueba
      const pf = VM.updateClip(p, 'c', { reverse: undefined });
      gc?.();
      const rf = await run(pf, { sampleHeap: true });
      result[`${secs}s`] = {
        forwardHeapPeakMB: rf.heapPeakMB,
        reverseMinusForwardMB: r.heapPeakMB - rf.heapPeakMB,
        forwardExportSeconds: +(rf.ms / 1000).toFixed(1),
        sourceMB: +(s.blob.size / 1048576).toFixed(1),
        exportSeconds: +(r.ms / 1000).toFixed(1),
        outputFrames: r.codes.length,
        wrongFrames: bad.bad,
        peakLiveVideoFrames: reverseDebug.peakAlive,
        decodedFrames: reverseDebug.decoded,
        decodePasses: reverseDebug.passes,
        heapPeakMB: r.heapPeakMB,
      };
    }
    return result;
  },

  /** Vista previa (PreviewEngine.drawFrame) = exportación, píxel a píxel, con curva, invertido y bucle con fundido. */
  async previewVsExport() {
    const cases: Record<string, Partial<VM.Clip>> = {
      plainBaseline: { inP: 1, outP: 13 },
      ramp: { curve: { pts: [{ s: 0, v: 0.5 }, { s: 7, v: 4 }, { s: 14, v: 1 }], smooth: true } },
      reverse: { inP: 1, outP: 13, reverse: true },
      loopXfade: { inP: 2, outP: 5, loop: { n: 3, xf: 1 } },
    };
    const rows: Record<string, unknown> = {};
    const cache = new MediaCache();
    const engine = new PreviewEngine({ cache });
    engine.attach(document.getElementById('cv') as HTMLCanvasElement);
    engine.setFormat('16:9', 'contain');
    engine.setQualityMode('high');
    for (const [name, c] of Object.entries(cases)) {
      const p = await project(c);
      const dur = VM.projectDuration(p);
      const times = [0.3, dur * 0.3, dur * 0.5, dur * 0.8].map((t) => Math.round(Math.min(t, dur - 0.1) * FPS) / FPS);
      const idx = times.map((t) => Math.round(t * FPS));
      const ex = await run(p, { keep: idx });
      engine.setProject(p);
      const g = document.createElement('canvas');
      g.width = SW;
      g.height = SH;
      const gc = g.getContext('2d', { alpha: false, willReadFrequently: true })!;
      const list: Record<string, unknown>[] = [];
      for (let k = 0; k < times.length; k++) {
        engine.seek(times[k]);
        const settled = await engine.settle(6000);
        await new Promise((r) => setTimeout(r, 120));
        gc.fillStyle = '#000';
        gc.fillRect(0, 0, SW, SH);
        engine.drawFrame(gc, SW, SH, times[k]);
        const a = gc.getImageData(0, 0, SW, SH).data;
        const b = ex.frames.get(idx[k])!.data;
        let sum = 0;
        let big = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
          sum += d;
          if (d > 32) big++;
        }
        list.push({ t: times[k], settled, meanAbs: +(sum / (a.length / 4)).toFixed(3), pctBig: +((100 * big) / (a.length / 4)).toFixed(3), previewCode: readCode(gc, SW, SH), exportCode: ex.codes[idx[k]] });
      }
      rows[name] = list;
    }
    engine.dispose();
    return rows;
  },

  /**
   * Reencuadre automático de punta a punta: un cuadrado con textura cruza el fotograma 16:9; se sigue, se pasa a 9:16 y se
   * exporta; en cada fotograma exportado el cuadrado debe seguir dentro del marco, cerca de su centro.
   */
  async track() {
    const secs = 10;
    const W0 = SW;
    const H0 = SH;
    const sq = 44;
    const centre = (t: number) => ({ x: W0 * (0.2 + 0.6 * (t / secs)), y: H0 * (0.5 + 0.22 * Math.sin((t / secs) * Math.PI * 2)) });
    const target = new Mp4Target();
    const mux = new Mp4Muxer({ target, video: { codec: 'avc', width: W0, height: H0 }, fastStart: 'in-memory' });
    let err: unknown = null;
    const ve = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: (e) => (err = e) });
    ve.configure({ codec: 'avc1.42001f', width: W0, height: H0, bitrate: 3_000_000, framerate: SFPS, avc: { format: 'avc' } });
    const cv = document.createElement('canvas');
    cv.width = W0;
    cv.height = H0;
    const g = cv.getContext('2d')!;
    // fondo con textura fija
    const bg = g.createImageData(W0, H0);
    for (let y = 0; y < H0; y++)
      for (let x = 0; x < W0; x++) {
        let h = Math.imul((x >> 2) * 374761393 + (y >> 2) * 668265263, 1274126177);
        h = Math.imul(h ^ (h >>> 13), 1103515245);
        const v = 70 + ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 90;
        const k = (y * W0 + x) * 4;
        bg.data[k] = bg.data[k + 1] = bg.data[k + 2] = v;
        bg.data[k + 3] = 255;
      }
    const n = secs * SFPS;
    for (let i = 0; i < n; i++) {
      g.putImageData(bg, 0, 0);
      const c = centre(i / SFPS);
      for (let a = 0; a < 4; a++)
        for (let b = 0; b < 4; b++) {
          g.fillStyle = (a + b) % 2 ? '#ffffff' : '#101010';
          g.fillRect(c.x - sq / 2 + (a * sq) / 4, c.y - sq / 2 + (b * sq) / 4, sq / 4, sq / 4);
        }
      const f = new VideoFrame(cv, { timestamp: Math.round((i / SFPS) * 1e6), duration: Math.round(1e6 / SFPS) });
      ve.encode(f, { keyFrame: i % 48 === 0 });
      f.close();
      while (ve.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    }
    await ve.flush();
    ve.close();
    if (err) throw err;
    mux.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    const media = { id: 'm', kind: 'video' as const, name: 'cuadrado', duration: secs, blob };
    let p = track(VM.createProject());
    p = VM.addMedia(p, media);
    p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'c', mediaId: 'm', start: 0, inP: 0, outP: secs }));
    const clip = VM.findClip(p, 'c')!.clip;
    const OW = 360;
    const OH = 640;
    const progress: number[] = [];
    const ar = await autoReframe(clip, media, { aspect: '9:16', out: { w: OW, h: OH }, onProgress: (r) => progress.push(Math.round(r * 100)) });
    const geo = geometry(ar.src, { w: OW, h: OH });
    const { cw } = cropSize(geo, { w: OW, h: OH }, 1);
    const spec = { aspect: '9:16' as const, cx: 0.5, cy: 0.5, zoom: 1, track: ar.keys };
    // seguimiento: el marco contiene al sujeto
    let worstOff = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SFPS;
      const f = reframeAt(spec, t);
      worstOff = Math.max(worstOff, Math.abs(centre(t).x / W0 - f.cx) / cw);
    }
    const tracked = setReframe(p, 'c', spec, ar.src, { w: OW, h: OH });
    const fixed = setReframe(p, 'c', { aspect: '9:16', cx: 0.5, cy: 0.5, zoom: 1 }, ar.src, { w: OW, h: OH });
    const sample = [0, 2, 4, 6, 8, 9.5].map((t) => Math.round(t * FPS));
    const visible = async (pp: VM.VideoProject) => {
      const r = await run(pp, { w: OW, h: OH, keep: sample });
      return sample.map((i) => {
        const d = r.frames.get(i)!;
        let nB = 0;
        let sx = 0;
        for (let y = 0; y < OH; y++)
          for (let x = 0; x < OW; x++) {
            const k = (y * OW + x) * 4;
            if (d.data[k] > 215 && d.data[k + 1] > 215 && d.data[k + 2] > 215) {
              nB++;
              sx += x;
            }
          }
        return { frame: i, brightPx: nB, centroidX: nB > 20 ? Math.round(sx / nB) : null };
      });
    };
    const withTrack = await visible(tracked);
    const without = await visible(fixed);
    return {
      keys: ar.keys.length,
      subject: ar.subject,
      confident: ar.confident,
      lost: ar.lost,
      samples: ar.samples,
      trackMs: Math.round(ar.elapsedMs),
      progressSteps: progress.length,
      worstOffsetInCropWidths: +worstOff.toFixed(3),
      subjectInsideCropAlways: worstOff < 0.5,
      exported9x16: { withTracking: withTrack, fixedCenterCrop: without },
      visibleWithTracking: withTrack.filter((r) => r.centroidX !== null).length,
      visibleWithoutTracking: without.filter((r) => r.centroidX !== null).length,
      maxCentroidOffsetPx: Math.max(...withTrack.filter((r) => r.centroidX !== null).map((r) => Math.abs((r.centroidX as number) - OW / 2))),
    };
  },
};

Object.assign(win, { __sp: { ...sp, setReverse, setSpeedCurve, setLoop } });
log('Banco de V8 listo: window.__sp.ramp(), extremes(), reverse(), reverseRamp(), loop(), freeze(), reverseMemory(), previewVsExport(), track()  ·  __sp.start(nombre, () => ...) y __sp.jobs para trabajos largos');
