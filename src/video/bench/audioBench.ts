// Banco de audio de V7 (página de desarrollo: /dev/audio-bench.html). Mide con números reales, en Chromium, lo que
// sale del motor: sonoridad y pico real de archivos exportados (WAV, Opus, AAC) decodificados otra vez, ducking,
// reducción de ruido, fundido cruzado, ritmo, normalización de clip, y la vista previa en vivo (AudioWorklet en un
// OfflineAudioContext) frente a la exportación. Todo cuelga de window.__au.
import * as VM from '../model';
import { analyzeMediaBeats } from '../engine/beatAnalysis';
import { LoudnessMeter, measureLoudness, toDb } from '../audio/loudness';
import { setClipAudio, setProjectAudio, setTrackMix } from '../audio/mixOps';
import { SpectralDenoiser } from '../audio/denoise';
import { analyzeProjectLoudness, audioFormatInfo, measureClipLoudness, mixerFactory, probeAudioFormats, probeProjectAudio, renderAudioOnly, solveProjectLoudness, audioDuration, type AudioFormat } from '../engine/audioExport';
import { crossfadeAbs, masterOf, resolveTrackPlan, xfGain } from '../engine/audioPlan';
import { BlobPartsSink } from '../engine/sink';
import { WavWriter } from '../engine/wav';
import { PreviewAudioGraph } from '../../ui/video/preview/previewAudio';
import { renderProject } from '../engine/render';
import { makeSynthClip } from './synth';

const out = document.getElementById('out')!;
const log = (s: string) => {
  out.textContent += s + '\n';
};
const SR = 48000;

// ---------------- señales sintéticas ----------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sine = (f: number, amp: number, secs: number, on?: (t: number) => boolean) => {
  const n = Math.round(secs * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) if (!on || on(i / SR)) x[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
  return x;
};
/** Voz sintética: armónicos de 140 Hz con formantes y sílabas de 0,35 s con pausas de 0,3 s. */
function voice(seconds: number, amp = 0.18) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  const gate = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ph = t % 0.65;
    const on = ph < 0.35 ? Math.sin((Math.PI * ph) / 0.35) : 0;
    gate[i] = on > 0.05 ? 1 : 0;
    let s = 0;
    const f0 = 140 + 10 * Math.sin(2 * Math.PI * 4 * t);
    for (let h = 1; h <= 24; h++) {
      const f = f0 * h;
      if (f > 4000) break;
      const form = Math.exp(-Math.pow((f - 600) / 400, 2)) + 0.7 * Math.exp(-Math.pow((f - 1700) / 600, 2)) + 0.3 * Math.exp(-Math.pow((f - 3000) / 700, 2));
      s += form * Math.sin(2 * Math.PI * f0 * h * t + h);
    }
    x[i] = amp * on * s;
  }
  return { x, gate };
}
function whiteNoise(n: number, sigma: number, seed: number) {
  const r = rng(seed);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = sigma * (r() + r() + r() - 1.5) * 2;
  return x;
}
function music(seconds: number, amp: number) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  const notes = [220, 277.2, 329.6, 440];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < notes.length; k++) s += Math.sin(2 * Math.PI * notes[k] * t + k) * (0.5 + 0.5 * Math.sin(2 * Math.PI * (0.25 + 0.1 * k) * t));
    x[i] = (amp * s) / notes.length;
  }
  return x;
}
function kick(bpm: number, seconds: number) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  const period = (60 / bpm) * SR;
  const r = rng(3);
  const times: number[] = [];
  for (let b = 0; b * period < n; b++) {
    const s0 = Math.round(b * period);
    times.push(s0 / SR);
    for (let i = 0; i < 0.25 * SR && s0 + i < n; i++) {
      const t = i / SR;
      x[s0 + i] += 0.8 * Math.exp(-t * 22) * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-t * 40)) * t) + 0.2 * Math.exp(-t * 200) * (r() * 2 - 1);
    }
  }
  return { x, times };
}

async function wavBlob(L: Float32Array, R: Float32Array): Promise<Blob> {
  const sink = new BlobPartsSink('audio/wav');
  const w = new WavWriter(sink, L.length, 24);
  w.write(L, R, L.length);
  return (await sink.close())!;
}
async function decode(blob: Blob) {
  const ctx = new OfflineAudioContext(2, 1, SR);
  const b = await ctx.decodeAudioData(await blob.arrayBuffer());
  return { L: b.getChannelData(0), R: b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0), seconds: b.duration };
}
const rms = (x: Float32Array, t0: number, t1: number) => {
  const a = Math.round(t0 * SR);
  const b = Math.min(x.length, Math.round(t1 * SR));
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
/** Amplitud de un tono (correlación con seno y coseno) en [t0, t1). */
const tone = (x: Float32Array, f: number, t0: number, t1: number) => {
  const a = Math.round(t0 * SR);
  const b = Math.min(x.length, Math.round(t1 * SR));
  let c = 0;
  let s = 0;
  for (let i = a; i < b; i++) {
    c += x[i] * Math.cos((2 * Math.PI * f * i) / SR);
    s += x[i] * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return (2 * Math.hypot(c, s)) / Math.max(1, b - a);
};
/** Pico real con un sobremuestreo ×8 de ventana larga (comprobador independiente del medidor del proyecto). */
function truePeak8(x: Float32Array): number {
  const R = 8;
  const H = 24;
  let best = 0;
  for (let i = H; i < x.length - H; i++) {
    for (let p = 1; p < R; p++) {
      const f = p / R;
      let s = 0;
      for (let j = -H + 1; j <= H; j++) {
        const d = j - f;
        s += x[i + j] * (Math.sin(Math.PI * d) / (Math.PI * d)) * (0.5 + 0.5 * Math.cos((Math.PI * d) / (H + 1)));
      }
      if (Math.abs(s) > best) best = Math.abs(s);
    }
    if (Math.abs(x[i]) > best) best = Math.abs(x[i]);
  }
  return best;
}

// ---------------- proyectos ----------------
function addAudio(p: VM.VideoProject, trackId: string, mediaId: string, blob: Blob, dur: number, fields: Partial<VM.Clip> = {}) {
  let q = p;
  if (!q.media[mediaId]) q = VM.addMedia(q, { id: mediaId, kind: 'audio', name: mediaId, duration: dur, blob });
  return VM.addClip(q, trackId, VM.makeClip('audio', { id: `c-${mediaId}-${fields.start ?? 0}`, mediaId, start: 0, inP: 0, outP: dur, ...fields }));
}
async function exportAudio(p: VM.VideoProject, format: AudioFormat) {
  const info = audioFormatInfo(format);
  const sink = new BlobPartsSink(info.mime);
  const t0 = performance.now();
  const r = await renderAudioOnly(p, { format, sink });
  return { r, blob: r.blob!, ms: performance.now() - t0 };
}

const R2 = (v: number, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);

// ---------------- pruebas ----------------
/** Programa de prueba: voz con pausas + música, 14 s. */
async function program() {
  const secs = 14;
  const v = voice(secs);
  const noise = whiteNoise(v.x.length, 0.004, 5);
  const vx = v.x.map((s, i) => s + noise[i]);
  const m = music(secs, 0.35);
  let p = VM.createProject();
  p = VM.addTrack(p, 'audio', { id: 'V', name: 'Voz' });
  p = VM.addTrack(p, 'audio', { id: 'M', name: 'Música' });
  p = addAudio(p, 'V', 'voz', await wavBlob(vx, vx), secs, { id: 'cv' });
  p = addAudio(p, 'M', 'mus', await wavBlob(m, m), secs, { id: 'cm', volume: 0.8 });
  return { p, secs, v, vx, m };
}

async function loudnessTest(targets: number[] = [-14, -16, -23], fmts: AudioFormat[] = ['wav24', 'opus', 'aac']) {
  const { p } = await program();
  const sup = await probeAudioFormats();
  const rows: Record<string, unknown>[] = [];
  for (const target of targets) {
    const q = setProjectAudio(p, { loud: { on: true, target } });
    for (const fmt of fmts) {
      if (!sup[fmt]) {
        rows.push({ target, fmt, skipped: 'sin codificador en este equipo' });
        continue;
      }
      const { r, blob, ms } = await exportAudio(q, fmt);
      const dec = await decode(blob);
      const m = measureLoudness(dec.L, dec.R, SR);
      const tp = toDb(Math.max(truePeak8(dec.L), truePeak8(dec.R)));
      rows.push({
        target,
        fmt,
        bytes: blob.size,
        seconds: R2(dec.seconds, 3),
        lufsFile: R2(m.integrated, 2),
        dTarget: R2(m.integrated - target, 2),
        tpMeter: R2(m.truePeak, 2),
        tpRef8: R2(tp, 2),
        okLufs: Math.abs(m.integrated - target) <= 0.5,
        okTp: tp <= -1,
        encoder: { measuredBefore: R2(r.stats.measuredBefore ?? NaN), gainDb: R2(r.stats.gainDb), passes: r.stats.passes, lufsPre: R2(r.stats.integrated), tp: R2(r.stats.truePeak) },
        ms: Math.round(ms),
      });
    }
  }
  return rows;
}

async function duckingTest(X = 12) {
  const secs = 10;
  const bursts = (t: number) => (t >= 1 && t < 3) || (t >= 6 && t < 8);
  const voz = sine(180, 0.25, secs, bursts);
  const mus = sine(330, 0.12, secs);
  let p = VM.createProject();
  p = VM.addTrack(p, 'audio', { id: 'V', name: 'Voz' });
  p = VM.addTrack(p, 'audio', { id: 'M', name: 'Música' });
  p = addAudio(p, 'V', 'voz', await wavBlob(voz, voz), secs);
  p = addAudio(p, 'M', 'mus', await wavBlob(mus, mus), secs);
  const on = setTrackMix(p, 'M', { duck: { on: true, db: X } });
  const a = await decode((await exportAudio(p, 'wav24')).blob);
  const b = await decode((await exportAudio(on, 'wav24')).blob);
  const rel = (t0: number, t1: number) => R2(toDb(tone(b.L, 330, t0, t1)) - toDb(tone(a.L, 330, t0, t1)));
  const stats = (await exportAudio(on, 'wav24')).r.trackStats;
  return {
    X,
    antes: rel(0.2, 0.9),
    durante1: rel(1.3, 2.9),
    entre: rel(4, 5.8),
    durante2: rel(6.3, 7.9),
    despues: rel(9.2, 9.9),
    minDuckDb: R2(stats.M?.minDuckDb ?? NaN),
    okBaja: rel(1.3, 2.9) <= -X + 0.5 && rel(6.3, 7.9) <= -X + 0.5,
  };
}

async function denoiseTest(amount = 0.7) {
  const secs = 10;
  const v = voice(secs, 0.07); // sin picos: el limitador de la salida no debe intervenir en esta medida
  const n = v.x.length;
  const noise = whiteNoise(n, 0.01, 99);
  const hum = sine(50, 0.004, secs);
  const noisy = new Float32Array(n);
  for (let i = 0; i < n; i++) noisy[i] = v.x[i] + noise[i] + hum[i];
  let p = VM.createProject();
  p = VM.addTrack(p, 'audio', { id: 'A' });
  p = addAudio(p, 'A', 'ruido', await wavBlob(noisy, noisy), secs, { id: 'c1' });
  const q = setClipAudio(p, 'c1', { denoise: amount });
  const dry = await decode((await exportAudio(p, 'wav24')).blob);
  const wet = await decode((await exportAudio(q, 'wav24')).blob);
  // la reducción de ruido retrasa el sonido SpectralDenoiser.LATENCY muestras
  const lat = SpectralDenoiser.LATENCY;
  const margin = Math.round(0.08 * SR);
  let sIn = 0, sOut = 0, c = 0, dot = 0, nv = 0, no = 0, dotN = 0, nn = 0;
  for (let i = 3 * SR; i < n - lat; i++) {
    let quiet = true;
    for (const k of [-margin, 0, margin]) if (v.gate[Math.max(0, Math.min(n - 1, i + k))]) quiet = false;
    const o = wet.L[i + lat];
    if (quiet) {
      sIn += dry.L[i] * dry.L[i];
      sOut += o * o;
      c++;
    } else if (v.gate[i]) {
      dot += v.x[i] * o;
      dotN += v.x[i] * dry.L[i];
      nv += v.x[i] * v.x[i];
      no += o * o;
      nn += dry.L[i] * dry.L[i];
    }
  }
  const reduction = 10 * Math.log10(sIn / c) - 10 * Math.log10(sOut / c);
  return {
    amount,
    reduccionRuidoDb: R2(reduction),
    correlacionConVozLimpia: R2(dot / Math.sqrt(nv * no), 4),
    correlacionSinReducir: R2(dotN / Math.sqrt(nv * nn), 4),
    nivelVozDb: R2(10 * Math.log10(no / nv)),
    okReduccion: reduction >= 10,
    okVoz: dot / Math.sqrt(nv * no) >= dotN / Math.sqrt(nv * nn) - 0.01 && 10 * Math.log10(no / nv) > -1.5, // la voz con ruido ya tenía esa correlación: no se degrada y no pierde nivel
  };
}

async function crossfadeTest() {
  const secs = 6;
  const x = sine(300, 0.3, secs);
  const y = sine(450, 0.3, secs);
  let p = VM.createProject();
  p = VM.addTrack(p, 'audio', { id: 'A' });
  p = addAudio(p, 'A', 'x', await wavBlob(x, x), secs, { id: 'a', start: 0, inP: 1, outP: 4 });
  p = addAudio(p, 'A', 'y', await wavBlob(y, y), secs, { id: 'b', start: 3, inP: 1, outP: 4 });
  const res: Record<string, unknown> = {};
  for (const xf of [0, 0.4]) {
    const q = setProjectAudio(p, { xfade: xf || undefined });
    const o = await decode((await exportAudio(q, 'wav24')).blob);
    const pts = [2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3].map((t) => {
      const a = tone(o.L, 300, t - 0.02, t + 0.02);
      const b = tone(o.L, 450, t - 0.02, t + 0.02);
      return { t, a: R2(a, 3), b: R2(b, 3), potencia: R2((a * a + b * b) / (0.3 * 0.3), 3) };
    });
    res['xfade' + xf] = pts;
  }
  const pot = (res['xfade0.4'] as { potencia: number }[]).map((r) => r.potencia);
  return { ...res, okPotenciaConstante: pot.every((v) => v > 0.8 && v < 1.2), okSinFundido: (res['xfade0'] as { t: number; a: number; b: number }[]).filter((r) => Math.abs(r.t - 3) > 0.05).every((r) => r.a < 0.01 || r.b < 0.01) };
}

async function beatsTest() {
  const { x, times } = kick(120, 24);
  const blob = await wavBlob(x, x);
  const t0 = performance.now();
  const r = await analyzeMediaBeats(blob, { duration: 24 });
  const ms = performance.now() - t0;
  if (!r) return { error: 'sin ritmo' };
  let hits = 0;
  for (const b of r.beats) if (times.some((t) => Math.abs(t - b) <= 0.03)) hits++;
  // marcas en la línea de tiempo con un clip desplazado
  let p = VM.createProject();
  p = VM.addTrack(p, 'audio', { id: 'A' });
  p = addAudio(p, 'A', 'k', blob, 24, { id: 'k', start: 10, inP: 2, outP: 12 });
  p = VM.updateMedia(p, 'k', { beats: r });
  p = setProjectAudio(p, { beatSnap: true, showBeats: true });
  const snap = VM.snapTime(p, 10.26, { threshold: 0.05 });
  return { bpm: r.bpm, pulsos: r.beats.length, golpes: r.onsets?.length, aciertos30ms: R2(hits / r.beats.length, 3), ms: Math.round(ms), snap: { time: R2(snap.time, 3), target: snap.target }, okBpm: Math.abs(r.bpm - 120) < 1.5, okPulsos: hits / r.beats.length > 0.9 };
}

async function clipNormalizeTest(target = -16) {
  const secs = 8;
  const v = voice(secs);
  const x = v.x.map((s) => s * 0.4);
  let p = VM.createProject();
  p = VM.addTrack(p, 'audio', { id: 'A' });
  p = addAudio(p, 'A', 'v', await wavBlob(x, x), secs, { id: 'c1' });
  const m = await measureClipLoudness(p, 'c1');
  if (!m) return { error: 'sin medida' };
  const gain = target - m.integrated;
  const q = setClipAudio(p, 'c1', { gainDb: gain });
  const o = await decode((await exportAudio(q, 'wav24')).blob);
  const res = measureLoudness(o.L, o.R, SR);
  return { target, medido: R2(m.integrated), gainDb: R2(gain), lufsArchivo: R2(res.integrated), delta: R2(res.integrated - target), ok: Math.abs(res.integrated - target) <= 0.3 };
}

async function soloTest() {
  const secs = 4;
  const a = sine(300, 0.2, secs);
  const b = sine(500, 0.2, secs);
  let p = VM.createProject();
  p = VM.addTrack(p, 'audio', { id: 'A' });
  p = VM.addTrack(p, 'audio', { id: 'B' });
  p = addAudio(p, 'A', 'a', await wavBlob(a, a), secs);
  p = addAudio(p, 'B', 'b', await wavBlob(b, b), secs);
  const both = await decode((await exportAudio(p, 'wav24')).blob);
  const solo = await decode((await exportAudio(setTrackMix(p, 'A', { solo: true }), 'wav24')).blob);
  const muted = await decode((await exportAudio(VM.updateTrack(p, 'B', { muted: true }), 'wav24')).blob);
  const pan = await decode((await exportAudio(setTrackMix(p, 'A', { pan: -1 }), 'wav24')).blob);
  return {
    ambas: { t300: R2(tone(both.L, 300, 1, 3), 3), t500: R2(tone(both.L, 500, 1, 3), 3) },
    soloA: { t300: R2(tone(solo.L, 300, 1, 3), 3), t500: R2(tone(solo.L, 500, 1, 3), 3) },
    silenciadaB: { t300: R2(tone(muted.L, 300, 1, 3), 3), t500: R2(tone(muted.L, 500, 1, 3), 3) },
    panIzq: { Ldiv300: R2(tone(pan.L, 300, 1, 3), 3), R300: R2(tone(pan.R, 300, 1, 3), 4) },
    ok: tone(solo.L, 500, 1, 3) < 0.001 && tone(solo.L, 300, 1, 3) > 0.19 && tone(muted.L, 500, 1, 3) < 0.001 && tone(pan.R, 300, 1, 3) < 0.001 && tone(pan.L, 300, 1, 3) > 0.27,
  };
}

/** Vista previa en vivo (AudioWorklet en un OfflineAudioContext) frente a la exportación, con mezclador, ducking, EQ, panorámica y fundido cruzado. */
async function previewVsExport() {
  const secs = 10;
  const v = voice(secs);
  const mus = music(secs, 0.4);
  const mus2 = sine(660, 0.15, secs);
  let p = VM.createProject();
  p = VM.addTrack(p, 'audio', { id: 'V', name: 'Voz' });
  p = VM.addTrack(p, 'audio', { id: 'M', name: 'Música' });
  p = addAudio(p, 'V', 'voz', await wavBlob(v.x, v.x), secs, { id: 'cv', start: 0, inP: 0, outP: 10, effect: 'clean' });
  // música en dos tramos contiguos de archivos distintos → fundido cruzado
  p = addAudio(p, 'M', 'mus', await wavBlob(mus, mus), secs, { id: 'm1', start: 0, inP: 1, outP: 5 });
  p = addAudio(p, 'M', 'mus2', await wavBlob(mus2, mus2), secs, { id: 'm2', start: 4, inP: 1, outP: 7 });
  p = setClipAudio(p, 'cv', { pan: 0.3, eq: [{ type: 'peak', f: 1000, g: 4, q: 1 }, { type: 'highpass', f: 90, g: 0, q: 0.707 }] });
  p = setClipAudio(p, 'm1', { gainDb: -2 });
  p = setTrackMix(p, 'M', { gainDb: -3, pan: -0.4, duck: { on: true, db: 10 }, eq: [{ type: 'lowshelf', f: 120, g: 3, q: 0.7 }] });
  p = setTrackMix(p, 'V', { gainDb: 1.5 });
  p = setProjectAudio(p, { xfade: 0.4, eq: [{ type: 'highshelf', f: 8000, g: -2, q: 0.7 }], loud: { on: true, target: -16 } });
  const duration = audioDuration(p);
  // ganancia de sonoridad: la misma que usa la interfaz (y la exportación)
  const solve = await solveProjectLoudness(p);
  const gain = solve && !solve.silent ? solve.gainDb : 0;
  // --- exportación: el mismo mezclador, alineado ---
  const { openPcm, playable } = await probeProjectAudio(p);
  const { make } = mixerFactory(p, duration, openPcm, playable);
  const m = make(gain);
  const eL = new Float32Array(m.totalSamples);
  const eR = new Float32Array(m.totalSamples);
  while (!m.finished) {
    const b = await m.render(24000);
    eL.set(b.L, b.startSample);
    eR.set(b.R, b.startSample);
  }
  m.close();
  // --- vista previa: grafo real en un OfflineAudioContext ---
  const lat = 134; // retardo del limitador de pico real (la vista previa lo deja)
  const off = new OfflineAudioContext(2, m.totalSamples + lat + 256, SR);
  const g = new PreviewAudioGraph(off, masterOf(p, gain));
  await g.ready;
  const dec = new Map<string, AudioBuffer>();
  const ac = new OfflineAudioContext(2, 1, SR);
  for (const [id, mm] of Object.entries(p.media)) if (mm.blob) dec.set(id, await ac.decodeAudioData(await mm.blob.arrayBuffer()));
  const xf = crossfadeAbs(p);
  const plan = resolveTrackPlan(p);
  let n = 0;
  for (const tr of p.tracks) {
    for (const c of tr.clips) {
      const buf = dec.get(c.mediaId!)!;
      const x = xf.get(c.id);
      const pre = x?.in ? c.start - x.in.w0 : 0;
      const post = x?.out ? x.out.w0 + x.out.len - VM.clipEnd(c) : 0;
      const src = off.createBufferSource();
      src.buffer = buf;
      const strip = g.addSource(src, VM.clipAudioFx(c), tr.id);
      // ganancia de fundido (fundidos del clip × fundido cruzado), muestreada a 1 kHz sobre toda la ventana activa
      const t0 = c.start - pre;
      const dur = VM.clipDuration(c) + pre + post;
      const steps = Math.max(2, Math.ceil(dur * 1000));
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) curve[i] = xfGain(x, t0 + (i / (steps - 1)) * dur);
      strip.fade.gain.value = 0;
      strip.fade.gain.setValueCurveAtTime(curve, t0, dur);
      src.start(t0, c.inP - pre * (c.speed || 1), dur * (c.speed || 1));
      n++;
    }
  }
  g.setTracks(plan);
  g.setMaster(masterOf(p, gain));
  const rendered = await off.startRendering();
  const lL = rendered.getChannelData(0).subarray(lat);
  const lR = rendered.getChannelData(1).subarray(lat);
  g.dispose();
  const N = Math.min(eL.length, lL.length);
  const ratio = (a: Float32Array, b: Float32Array, t0: number, t1: number) => rms(a, t0, t1) / Math.max(1e-12, rms(b, t0, t1));
  let maxDiff = 0;
  let sumDiff2 = 0;
  let sumE2 = 0;
  for (let i = 0; i < N; i++) {
    const d = Math.abs(lL[i] - eL[i]);
    if (d > maxDiff) maxDiff = d;
    sumDiff2 += d * d;
    sumE2 += eL[i] * eL[i];
  }
  const meter = new LoudnessMeter(SR);
  meter.process(eL, eR, eL.length);
  const meterLive = new LoudnessMeter(SR);
  meterLive.process(lL.subarray(0, N), lR.subarray(0, N), N);
  return {
    clips: n,
    gainDbLoud: R2(gain),
    solve: solve ? { measured: R2(solve.measured), result: R2(solve.result), truePeak: R2(solve.truePeak), passes: solve.passes } : null,
    cocienteRmsL: R2(ratio(lL, eL, 0.5, secs - 0.5), 4),
    cocienteRmsR: R2(ratio(lR, eR, 0.5, secs - 0.5), 4),
    cocientePorTramo: [0.5, 2, 4.2, 6, 8].map((t) => R2(ratio(lL, eL, t, t + 1.5), 4)),
    maxDiff: Number(maxDiff.toExponential(2)),
    snrDb: R2(10 * Math.log10(sumE2 / Math.max(1e-30, sumDiff2))),
    lufsExport: R2(meter.integrated()),
    lufsVivo: R2(meterLive.integrated()),
    tpExport: R2(meter.truePeakDb()),
    tpVivo: R2(meterLive.truePeakDb()),
    ok: Math.abs(ratio(lL, eL, 0.5, secs - 0.5) - 1) < 0.02 && Math.abs(ratio(lR, eR, 0.5, secs - 0.5) - 1) < 0.02,
  };
}

async function speedAndPerf() {
  const secs = 60;
  const v = voice(secs);
  const m = music(secs, 0.3);
  let p = VM.createProject();
  p = VM.addTrack(p, 'audio', { id: 'V' });
  p = VM.addTrack(p, 'audio', { id: 'M' });
  p = addAudio(p, 'V', 'v', await wavBlob(v.x, v.x), secs, { id: 'cv' });
  p = addAudio(p, 'M', 'm', await wavBlob(m, m), secs, { id: 'cm' });
  p = setClipAudio(p, 'cv', { denoise: 0.6, eq: [{ type: 'peak', f: 2000, g: 3, q: 1 }] });
  p = setTrackMix(p, 'M', { duck: { on: true, db: 10 } });
  p = setProjectAudio(p, { loud: { on: true, target: -14 } });
  const t0 = performance.now();
  const a = await analyzeProjectLoudness(p);
  const tMeasure = performance.now() - t0;
  const { ms } = await exportAudio(p, 'wav24');
  return { segundosDeAudio: secs, medirMs: Math.round(tMeasure), exportarWav24Ms: Math.round(ms), vecesTiempoReal: R2(secs / (ms / 1000), 1), lufs: R2(a?.integrated ?? NaN) };
}

/** Exportación de VIDEO (MP4 con AAC y WebM con Opus) con normalización a LUFS: mide el audio del archivo exportado. */
async function videoExportTest(target = -16) {
  const clip = await makeSynthClip({ container: 'mp4', width: 640, height: 360, fps: 24, seconds: 8, toneAmp: 0.6 });
  const secs = 8;
  const m = music(secs, 0.3);
  let p = VM.createProject();
  p = VM.addTrack(p, 'video', { id: 'V' });
  p = VM.addTrack(p, 'audio', { id: 'M', name: 'Música' });
  p = VM.addMedia(p, { id: 'clip', kind: 'video', name: 'clip.mp4', duration: secs, blob: clip.blob });
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'v', mediaId: 'clip', start: 0, inP: 0, outP: secs }));
  p = addAudio(p, 'M', 'mus', await wavBlob(m, m), secs, { id: 'cm' });
  p = setProjectAudio(p, { loud: { on: true, target } });
  const rows: Record<string, unknown>[] = [];
  for (const container of ['mp4', 'webm'] as const) {
    const sink = new BlobPartsSink(container === 'mp4' ? 'video/mp4' : 'video/webm');
    const t0 = performance.now();
    const r = await renderProject(p, { container, sizes: [{ width: 640, height: 360, label: '360p' }], fps: 24, sink });
    const dec = await decode(r.blob!);
    const res = measureLoudness(dec.L, dec.R, SR);
    const tp = toDb(Math.max(truePeak8(dec.L), truePeak8(dec.R)));
    rows.push({ container, audioCodec: r.audioCodec, lufsFile: R2(res.integrated, 2), dTarget: R2(res.integrated - target, 2), tpRef8: R2(tp, 2), stats: r.audioStats && { gainDb: R2(r.audioStats.gainDb), passes: r.audioStats.passes, lufsPre: R2(r.audioStats.integrated) }, okLufs: Math.abs(res.integrated - target) <= 0.5, okTp: tp <= -1, ms: Math.round(performance.now() - t0) });
  }
  return rows;
}

const api = {
  videoExport: videoExportTest,
  loudness: loudnessTest,
  ducking: duckingTest,
  denoise: denoiseTest,
  crossfade: crossfadeTest,
  beats: beatsTest,
  clipNormalize: clipNormalizeTest,
  solo: soloTest,
  previewVsExport,
  perf: speedAndPerf,
  formats: probeAudioFormats,
  async all() {
    const res: Record<string, unknown> = {};
    for (const [k, fn] of Object.entries(api)) {
      if (k === 'all' || k === 'perf') continue;
      try {
        res[k] = await (fn as () => Promise<unknown>)();
      } catch (e) {
        res[k] = { error: String(e) };
      }
      log(`${k}: ${JSON.stringify(res[k])}`);
    }
    return res;
  },
};
(window as unknown as { __au: typeof api }).__au = api;

const ctl = document.getElementById('controls')!;
for (const k of Object.keys(api)) {
  const b = document.createElement('button');
  b.textContent = k;
  b.onclick = async () => log(`${k}: ${JSON.stringify(await (api as unknown as Record<string, () => Promise<unknown>>)[k]())}`);
  ctl.appendChild(b);
}
