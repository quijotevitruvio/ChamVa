// Banco de pruebas del motor de video (página de desarrollo: /dev/video-bench.html).
// Cada caso genera clips sintéticos, exporta con el motor REAL (render.ts) y
// comprueba el resultado con <video>/decodeAudioData y con el decodificador.
// Resultados en window.__bench (para automatizarlo desde el navegador).
import { renderVideo, type RenderClip, type RenderResult } from '../engine/render';
import { BlobPartsSink } from '../engine/sink';
import { ASPECTS, QUALITIES, lowerQuality, outputSize, type Aspect, type Container, type Quality } from '../engine/formats';
import { buildSegments, sourceTimeAt, segmentIndexAt, type RenderOverlay } from '../engine/timeline';
import { LIMIT_CEILING } from '../engine/dsp';
import { renderMp4 as legacyRenderMp4 } from './legacyRender';
import { colorAt, makeSynthClip, type SynthClip, type SynthOptions } from './synth';
import { colorClose, lum, probeAudio, probeFramesDecoder, probeWithElement } from './analyze';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
interface CaseResult {
  id: string;
  title: string;
  checks: Check[];
  metrics: Record<string, number | string>;
  error?: string;
  ms: number;
}

const results: CaseResult[] = [];
const statusEl = document.getElementById('status')!;
const tableEl = document.getElementById('results')!;
const log = (s: string) => {
  statusEl.textContent = s;
  (window as any).__bench.status = s;
};

const fxNone = { volume: 1, hp: 20, lp: 20000, echo: 0, gate: false };
const clipOf = (c: SynthClip, over: Partial<RenderClip> = {}): RenderClip => ({
  blob: c.blob,
  url: c.url,
  inP: 0,
  outP: c.opts.seconds,
  speed: 1,
  fadeIn: 0,
  fadeOut: 0,
  ...fxNone,
  ...over,
});

const cache = new Map<string, Promise<SynthClip>>();
function synth(key: string, o: SynthOptions) {
  if (!cache.has(key)) cache.set(key, makeSynthClip(o));
  return cache.get(key)!;
}

function sizesFor(aspect: Aspect, q: Quality) {
  const out: { width: number; height: number; label: string }[] = [];
  for (let x: Quality | null = q; x; x = lowerQuality(x)) {
    const s = outputSize(aspect, x);
    out.push({ ...s, label: `${s.width}×${s.height}` });
  }
  return out;
}

async function exportWith(o: {
  container?: Container;
  aspect?: Aspect;
  quality?: Quality;
  fps?: number;
  video: RenderClip[];
  audio?: RenderClip[];
  overlays?: RenderOverlay[];
  normalize?: boolean;
  signal?: AbortSignal;
}): Promise<{ res: RenderResult; blob: Blob; heapPeakMB: number; heapStartMB: number }> {
  const container = o.container ?? 'mp4';
  const sink = new BlobPartsSink(container === 'mp4' ? 'video/mp4' : 'video/webm');
  const mem = (performance as any).memory;
  const heapStart = mem ? mem.usedJSHeapSize : 0;
  let heapPeak = heapStart;
  const timer = setInterval(() => {
    if (mem) heapPeak = Math.max(heapPeak, mem.usedJSHeapSize);
  }, 100);
  try {
    const res = await renderVideo({
      container,
      sizes: sizesFor(o.aspect ?? '16:9', o.quality ?? 720),
      fps: o.fps ?? 30,
      videoClips: o.video,
      audioClips: o.audio ?? [],
      overlays: o.overlays ?? [],
      eq: { low: 0, mid: 0, high: 0 },
      normalize: !!o.normalize,
      sink,
      signal: o.signal,
      onProgress: (p) => p.frame % 30 === 0 && log(`exportando… ${Math.round(p.ratio * 100)} %`),
    });
    return { res, blob: res.blob!, heapPeakMB: (heapPeak - heapStart) / 2 ** 20, heapStartMB: heapStart / 2 ** 20 };
  } finally {
    clearInterval(timer);
  }
}

/** Tiempo de origen esperado (y nº de fotograma) en el instante t de la línea de tiempo. */
function expectedFrame(clips: { clip: RenderClip; synth: SynthClip }[], t: number) {
  const segs = buildSegments(clips.map((c) => c.clip));
  const si = segmentIndexAt(segs, t);
  const s = sourceTimeAt(segs[si], t);
  const ft = clips[si].synth.frameTimes;
  let k = 0;
  while (k + 1 < ft.length && ft[k + 1] <= s + 5e-4) k++;
  return { index: k, srcTime: s, synth: clips[si].synth };
}

function check(list: Check[], name: string, ok: boolean, detail: string) {
  list.push({ name, ok, detail });
}

// ---------------- casos ----------------

type Case = { id: string; title: string; run: (c: Check[], m: Record<string, number | string>) => Promise<void> };

const audit = async () =>
  Promise.all([
    synth('auditA', { container: 'webm', width: 640, height: 360, fps: 30, seconds: 3, colorOffset: 0 }),
    synth('auditB', { container: 'webm', width: 640, height: 360, fps: 30, seconds: 3, colorOffset: 1 }),
  ]);
const textOverlay: RenderOverlay = { kind: 'text', text: 'HOLA', color: '#ffffff', size: 60, xf: 0.37, yf: 0.17, start: 0, end: 9999 };

const CASES: Case[] = [
  {
    id: 'audit',
    title: 'Auditoría: 2 WebM 640×360 (VP8+Opus) + texto → MP4 720p30 · antes vs. después',
    run: async (c, m) => {
      const [a, b] = await audit();
      const clips = [clipOf(a), clipOf(b)];
      // antes: motor anterior (seek en <video> + OfflineAudioContext + todo en RAM)
      const t0 = performance.now();
      const legacy = await legacyRenderMp4({
        width: 1280,
        height: 720,
        fps: 30,
        videoClips: clips.map((x) => ({ ...x })),
        audioClips: [],
        overlays: [textOverlay as any],
        eq: { low: 0, mid: 0, high: 0 },
        normalize: false,
      });
      const legacyMs = performance.now() - t0;
      const { res, blob } = await exportWith({ video: clips, overlays: [textOverlay] });
      m['antes (s)'] = +(legacyMs / 1000).toFixed(2);
      m['después (s)'] = +(res.elapsedMs / 1000).toFixed(2);
      m['×tiempo real después'] = +(res.duration / (res.elapsedMs / 1000)).toFixed(2);
      m['MB'] = +(blob.size / 2 ** 20).toFixed(2);
      const el = await probeWithElement(blob, [0, 0.1, 1.5, 4.5]);
      const legacyEl = await probeWithElement(legacy, [0.1]);
      check(c, 'duración 6 s ±1 fotograma', Math.abs(el.duration - 6) <= 1 / 30 + 0.03, `${el.duration.toFixed(3)} s`);
      check(c, 'resolución 1280×720', el.width === 1280 && el.height === 720, `${el.width}×${el.height}`);
      check(c, 'primer fotograma no negro (t=0 y t=0,1)', el.frames[0].meanLum > 40 && el.frames[1].meanLum > 40, `lum ${el.frames[0].meanLum.toFixed(0)}, ${el.frames[1].meanLum.toFixed(0)} (antes en t=0,1: ${legacyEl.frames[0].meanLum.toFixed(0)})`);
      check(c, 'color de cada clip', colorClose(el.frames[2].sample, colorAt(1.5, 0)) && colorClose(el.frames[3].sample, colorAt(1.5, 1)), JSON.stringify([el.frames[2].sample, el.frames[3].sample]));
      const au = await probeAudio(blob);
      check(c, 'audio presente y pico < 1,0', !!au && au.peak < 1 && au.duration > 5.8, au ? `pico ${au.peak.toFixed(3)}, ${au.duration.toFixed(2)} s` : 'sin audio');
    },
  },
  {
    id: 'h264-1080',
    title: 'MP4 H.264+AAC 1280×720 10 s → MP4 1080p30 (velocidad, fotograma exacto, sincronía bip–destello)',
    run: async (c, m) => {
      const s = await synth('h264', { container: 'mp4', width: 1280, height: 720, fps: 30, seconds: 10, beepsAt: [2, 5.5, 8] });
      const clip = clipOf(s);
      const t0 = performance.now();
      const legacy = await legacyRenderMp4({ width: 1920, height: 1080, fps: 30, videoClips: [clip], audioClips: [], overlays: [], eq: { low: 0, mid: 0, high: 0 }, normalize: false });
      const legacyMs = performance.now() - t0;
      void legacy;
      const { res, blob } = await exportWith({ video: [clip], quality: 1080 });
      m['antes (s)'] = +(legacyMs / 1000).toFixed(2);
      m['después (s)'] = +(res.elapsedMs / 1000).toFixed(2);
      m['×tiempo real antes'] = +(10 / (legacyMs / 1000)).toFixed(2);
      m['×tiempo real después'] = +(10 / (res.elapsedMs / 1000)).toFixed(2);
      m['códec'] = res.videoCodec + ' + ' + res.audioCodec;
      const times = [0, 1.0, 3.3, 6.6, 9.9];
      const dec = await probeFramesDecoder(blob, times.map((t) => t + 0.001));
      check(c, 'resolución 1920×1080', dec.width === 1920 && dec.height === 1080, `${dec.width}×${dec.height}`);
      check(c, 'fotogramas = 300', dec.count === 300, String(dec.count));
      const bad = dec.frames.filter((f, i) => f.code !== expectedFrame([{ clip, synth: s }], times[i]).index);
      check(c, 'fotograma en t conocido coincide (código binario)', !bad.length, dec.frames.map((f) => f.code).join(','));
      // sincronía: destello (vídeo) vs. bip (audio)
      const flashT: number[] = [];
      const scan = await probeFramesDecoder(blob, Array.from({ length: 300 }, (_, i) => i / 30 + 0.001));
      scan.frames.forEach((f) => f.meanLum > 240 && flashT.push(f.t - 0.001));
      const au = await probeAudio(blob);
      const offs = au ? flashT.map((ft) => Math.min(...au.onsets.map((o) => Math.abs(o - ft)))) : [];
      m['desfase bip–destello (ms)'] = offs.map((o) => Math.round(o * 1000)).join(' / ');
      check(c, 'destellos en 2 / 5,5 / 8 s', flashT.length === 3, flashT.map((x) => x.toFixed(3)).join(', '));
      check(c, 'desfase bip–destello < 1 fotograma', offs.length === 3 && offs.every((o) => o < 1 / 30), m['desfase bip–destello (ms)'] as string);
      check(c, 'pico de audio < 1,0', !!au && au.peak < 1, au ? au.peak.toFixed(3) : '-');
    },
  },
  {
    id: 'vfr',
    title: 'Fotogramas variables (1/24 y 1/40 s alternos) → MP4 720p30',
    run: async (c) => {
      const s = await synth('vfr', { container: 'mp4', width: 640, height: 360, fps: 30, seconds: 4, vfr: true });
      const clip = clipOf(s);
      const { blob } = await exportWith({ video: [clip] });
      const times = Array.from({ length: 40 }, (_, i) => (i * 3) / 30);
      const dec = await probeFramesDecoder(blob, times.map((t) => t + 0.001));
      const wrong = dec.frames.filter((f, i) => f.code !== expectedFrame([{ clip, synth: s }], times[i]).index);
      check(c, '40 fotogramas muestreados = fotograma de origen esperado', !wrong.length, `${wrong.length} distintos; ej. ${wrong.slice(0, 3).map((w) => w.t.toFixed(2) + '→' + w.code).join(' ')}`);
    },
  },
  {
    id: 'split',
    title: 'Clip dividido en 3 + velocidad 2× + recorte → fotogramas exactos y audio una sola lectura',
    run: async (c) => {
      const s = await synth('h264', { container: 'mp4', width: 1280, height: 720, fps: 30, seconds: 10, beepsAt: [2, 5.5, 8] });
      const clips = [clipOf(s, { inP: 0.5, outP: 2 }), clipOf(s, { inP: 2, outP: 6, speed: 2 }), clipOf(s, { inP: 7, outP: 9.5 })];
      const { res, blob } = await exportWith({ video: clips });
      const pairs = clips.map((clip) => ({ clip, synth: s }));
      const times = [0, 1.4, 1.6, 2.5, 3.4, 3.6, 5.9];
      const dec = await probeFramesDecoder(blob, times.map((t) => t + 0.001));
      const exp = times.map((t) => expectedFrame(pairs, t).index);
      check(c, 'duración 1,5 + 2 + 2,5 = 6 s', Math.abs(res.duration - 6) < 1 / 30, res.duration.toFixed(3));
      check(c, 'fotogramas exactos en cada tramo', dec.frames.every((f, i) => f.code === exp[i]), `obtenido ${dec.frames.map((f) => f.code).join(',')} · esperado ${exp.join(',')}`);
    },
  },
  {
    id: 'noaudio',
    title: 'Clip sin audio → MP4 sin pista de audio (no falla)',
    run: async (c) => {
      const s = await synth('noaudio', { container: 'mp4', width: 640, height: 360, fps: 30, seconds: 2, audio: false });
      const { res, blob } = await exportWith({ video: [clipOf(s)] });
      const dec = await probeFramesDecoder(blob, [0.001]);
      check(c, 'video correcto y sin audio', !dec.hasAudio && res.audioCodec === null && dec.frames[0].meanLum > 40, `audio: ${res.audioCodec}`);
    },
  },
  {
    id: 'vertical',
    title: 'Vertical 1080×1920 → 9:16 1080p',
    run: async (c, m) => {
      const s = await synth('vert', { container: 'mp4', width: 1080, height: 1920, fps: 30, seconds: 2 });
      const { res, blob } = await exportWith({ video: [clipOf(s)], aspect: '9:16', quality: 1080 });
      m['s'] = +(res.elapsedMs / 1000).toFixed(2);
      const el = await probeWithElement(blob, [0.5, 1.5]);
      check(c, 'resolución 1080×1920', el.width === 1080 && el.height === 1920, `${el.width}×${el.height}`);
      check(c, 'color y código correctos', colorClose(el.frames[0].sample, colorAt(0.5)) && colorClose(el.frames[1].sample, colorAt(1.5)), JSON.stringify(el.frames.map((f) => f.sample)));
    },
  },
  {
    id: 'rotated',
    title: 'MP4 de móvil con rotación 90° (metadato) → 9:16 720p, igual que lo muestra el navegador',
    run: async (c) => {
      const s = await synth('rot', { container: 'mp4', width: 640, height: 360, fps: 30, seconds: 2, rotation: 90 });
      const src = await probeWithElement(s.blob, [0.5]); // cómo lo ve el navegador
      const { blob } = await exportWith({ video: [clipOf(s)], aspect: '9:16', quality: 720 });
      const out = await probeWithElement(blob, [0.5]);
      const green = (p: { r: number; g: number; b: number }) => p.g > 150 && p.r < 90 && p.b < 90;
      check(c, 'el navegador muestra el origen en vertical', src.width === 360 && src.height === 640, `${src.width}×${src.height}`);
      check(
        c,
        'marca verde en la misma esquina que en el navegador',
        green(src.frames[0].topRight) === green(out.frames[0].topRight) && green(src.frames[0].topLeft) === green(out.frames[0].topLeft) && (green(out.frames[0].topRight) || green(out.frames[0].topLeft)),
        `navegador: TL ${green(src.frames[0].topLeft)} TR ${green(src.frames[0].topRight)} · exportado: TL ${green(out.frames[0].topLeft)} TR ${green(out.frames[0].topRight)}`,
      );
    },
  },
  {
    id: 'hot',
    title: 'Audio fuerte: clip a 0,95 + música a 0,95 + Normalizar → pico < 1,0 (limitador −1 dBFS)',
    run: async (c, m) => {
      const v = await synth('hotv', { container: 'mp4', width: 640, height: 360, fps: 30, seconds: 3, toneAmp: 0.95 });
      const a = await synth('hota', { container: 'webm', width: 320, height: 180, fps: 30, seconds: 3, toneAmp: 0.95 });
      const { res, blob } = await exportWith({ video: [clipOf(v)], audio: [clipOf(a)], normalize: true });
      const au = await probeAudio(blob);
      m['pico antes del limitador'] = +res.peakIn.toFixed(3);
      m['pico tras el limitador'] = +res.peakOut.toFixed(3);
      m['pico del archivo'] = au ? +au.peak.toFixed(3) : '-';
      check(c, 'pico del archivo decodificado < 1,0', !!au && au.peak < 1, String(m['pico del archivo']));
      check(c, 'limitador ≤ −1 dBFS antes de codificar', res.peakOut <= LIMIT_CEILING + 1e-6, res.peakOut.toFixed(4));
    },
  },
  {
    id: 'gate',
    title: '«Reducir ruido» (compuerta) aplicado al exportar',
    run: async (c, m) => {
      const s = await synth('gate', { container: 'webm', width: 320, height: 180, fps: 30, seconds: 4, toneAmp: 0.4, quietAmp: 0.01, quietUntil: 2 });
      const off = await exportWith({ video: [clipOf(s)] });
      const on = await exportWith({ video: [clipOf(s, { hp: 100, lp: 9000, gate: true })] });
      const a1 = await probeAudio(off.blob);
      const a2 = await probeAudio(on.blob);
      const r1 = a1 ? a1.rms(0.5, 1.8) : 0;
      const r2 = a2 ? a2.rms(0.5, 1.8) : 0;
      const v2 = a2 ? a2.rms(2.5, 3.8) : 0;
      m['RMS ruido sin compuerta'] = +r1.toFixed(5);
      m['RMS ruido con compuerta'] = +r2.toFixed(5);
      m['RMS voz con compuerta'] = +v2.toFixed(4);
      check(c, 'ruido atenuado > 20 dB y la voz pasa', r1 > 0 && r2 < r1 / 10 && v2 > 0.2, `${r1.toFixed(5)} → ${r2.toFixed(5)}; voz ${v2.toFixed(3)}`);
    },
  },
  {
    id: 'text',
    title: 'Tamaño de texto idéntico en WebM y MP4 (1080p)',
    run: async (c, m) => {
      const s = await synth('text', { container: 'mp4', width: 1280, height: 720, fps: 30, seconds: 1, colorOffset: 1 });
      const mp4 = await exportWith({ video: [clipOf(s)], overlays: [textOverlay], quality: 1080 });
      const webm = await exportWith({ video: [clipOf(s)], overlays: [textOverlay], quality: 1080, container: 'webm' });
      const a = await probeWithElement(mp4.blob, [0.5]);
      const b = await probeWithElement(webm.blob, [0.5]);
      m['alto texto MP4 (px)'] = a.frames[0].textHeight;
      m['alto texto WebM (px)'] = b.frames[0].textHeight;
      check(c, 'misma altura de texto (±2 px)', a.frames[0].textHeight > 40 && Math.abs(a.frames[0].textHeight - b.frames[0].textHeight) <= 2, `${a.frames[0].textHeight} vs ${b.frames[0].textHeight} px (letra de 90 px)`);
      check(c, 'WebM reproducible: 1920×1080', b.width === 1920 && b.height === 1080, `${b.width}×${b.height}`);
    },
  },
  {
    id: 'formats',
    title: 'Formatos 16:9, 9:16, 1:1, 4:5 × 720p/1080p/4K (isConfigSupported + exportación de 1 s)',
    run: async (c, m) => {
      const s = await synth('fmt', { container: 'mp4', width: 1280, height: 720, fps: 30, seconds: 1 });
      for (const a of ASPECTS)
        for (const q of QUALITIES) {
          const want = outputSize(a.id, q.id);
          try {
            const { res, blob } = await exportWith({ video: [clipOf(s)], aspect: a.id, quality: q.id });
            const el = await probeWithElement(blob, [0.5]);
            const exact = el.width === want.width && el.height === want.height;
            m[`${a.id} ${q.label}`] = `${el.width}×${el.height}${exact ? '' : ' (degradado)'} ${(res.elapsedMs / 1000).toFixed(1)} s`;
            check(c, `${a.id} ${q.label}`, el.width === res.width && el.height === res.height && (exact || res.notices.length > 0), `${el.width}×${el.height} ${res.notices.join(' ')}`);
          } catch (e) {
            check(c, `${a.id} ${q.label}`, false, (e as Error).message);
          }
        }
    },
  },
  {
    id: 'cancel',
    title: 'Cancelar a mitad: rechaza con AbortError y no deja nada',
    run: async (c) => {
      const s = await synth('h264', { container: 'mp4', width: 1280, height: 720, fps: 30, seconds: 10, beepsAt: [2, 5.5, 8] });
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 400);
      const t0 = performance.now();
      let name = '';
      try {
        await exportWith({ video: [clipOf(s)], quality: 1080, signal: ac.signal });
      } catch (e) {
        name = (e as DOMException).name;
      }
      check(c, 'AbortError en < 1,5 s', name === 'AbortError' && performance.now() - t0 < 1500, `${name} tras ${Math.round(performance.now() - t0)} ms`);
    },
  },
  {
    id: 'long',
    title: 'Clip largo (120 s, 640×360) → MP4 1080p30: memoria y velocidad',
    run: async (c, m) => {
      const s = await synth('long', { container: 'mp4', width: 640, height: 360, fps: 30, seconds: 120, beepsAt: [60] });
      m['entrada MB'] = +(s.blob.size / 2 ** 20).toFixed(1);
      const { res, blob, heapPeakMB, heapStartMB } = await exportWith({ video: [clipOf(s)], quality: 1080 });
      m['salida MB'] = +(blob.size / 2 ** 20).toFixed(1);
      m['s'] = +(res.elapsedMs / 1000).toFixed(1);
      m['×tiempo real'] = +(120 / (res.elapsedMs / 1000)).toFixed(2);
      m['pico heap JS sobre el inicio (MB)'] = +heapPeakMB.toFixed(1);
      m['heap al empezar (MB)'] = +heapStartMB.toFixed(1);
      const dec = await probeFramesDecoder(blob, [0.001, 59.5, 119.9]);
      check(c, 'duración 120 s y 3600 fotogramas', Math.abs(res.duration - 120) < 0.05 && dec.count === 3600, `${res.duration} s, ${dec.count}`);
      check(c, 'fotogramas exactos al principio, a mitad y al final', dec.frames.every((f, i) => f.code === Math.round([0, 59.5, 119.9][i] * 30) % 4096), dec.frames.map((f) => f.code).join(','));
      check(c, 'memoria JS acotada (< 150 MB sobre el inicio)', heapPeakMB < 150, `${heapPeakMB.toFixed(1)} MB`);
    },
  },
];

function render() {
  tableEl.innerHTML =
    '<tr><th>Caso</th><th>Comprobaciones</th><th>Medidas</th></tr>' +
    results
      .map(
        (r) =>
          `<tr><td><b>${r.id}</b><br>${r.title}<br><small>${(r.ms / 1000).toFixed(1)} s</small></td><td>${
            r.error ? `<span class="fail">ERROR</span> ${r.error}` : ''
          }${r.checks.map((k) => `<div><span class="${k.ok ? 'ok' : 'fail'}">${k.ok ? '✓' : '✗'}</span> ${k.name} <code>${k.detail}</code></div>`).join('')}</td><td>${Object.entries(r.metrics)
            .map(([k, v]) => `<div>${k}: <b>${v}</b></div>`)
            .join('')}</td></tr>`,
      )
      .join('');
}

async function runCase(id: string) {
  const cs = CASES.find((x) => x.id === id);
  if (!cs) throw new Error('caso desconocido ' + id);
  const r: CaseResult = { id, title: cs.title, checks: [], metrics: {}, ms: 0 };
  const t0 = performance.now();
  log(`ejecutando ${id}…`);
  try {
    await cs.run(r.checks, r.metrics);
  } catch (e) {
    r.error = (e as Error).stack || String(e);
    console.error(e);
  }
  r.ms = performance.now() - t0;
  const i = results.findIndex((x) => x.id === id);
  if (i >= 0) results[i] = r;
  else results.push(r);
  render();
  return r;
}

async function runAll(ids = CASES.map((c) => c.id)) {
  (window as any).__bench.done = false;
  for (const id of ids) await runCase(id);
  const failed = results.filter((r) => r.error || r.checks.some((k) => !k.ok));
  log(`terminado: ${results.length} casos, ${failed.length} con fallos`);
  (window as any).__bench.done = true;
  return results;
}

(window as any).__bench = { runAll, runCase, results, status: 'listo', done: false, cases: CASES.map((c) => c.id), lum };

const ctrl = document.getElementById('controls')!;
const all = document.createElement('button');
all.textContent = 'Ejecutar todo';
all.onclick = () => runAll();
ctrl.appendChild(all);
for (const cs of CASES) {
  const b = document.createElement('button');
  b.textContent = cs.id;
  b.onclick = () => runCase(cs.id);
  ctrl.appendChild(b);
}
log('listo');
