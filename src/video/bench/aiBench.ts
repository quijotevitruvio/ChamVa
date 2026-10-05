// Banco de V9 (página de desarrollo: /dev/ai-bench.html): quitar fondo por fotograma y estabilización con el motor REAL
// (`computeMatte` / `computeStabilization`, `composeFrame` vía `renderProject` y `PreviewEngine`), sobre clips sintéticos
// generados aquí con WebCodecs (nunca descargados) cuya verdad se conoce. Todo cuelga de window.__ai.
//
//   __ai.matte({ engine: 'sim' | 'modnet', mode })  máscara por fotograma (IoU, parpadeo), fondo de color exacto,
//                                                   tiempo por fotograma, memoria, vista previa = exportación
//   __ai.stab()                                      clip tembloroso con temblor conocido: reducción medida
//   __ai.download()                                  descarga MODNet (25,9 MB, Apache-2.0) para el banco
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import * as VM from '../model';
import { renderProject } from '../engine/render';
import { BlobPartsSink } from '../engine/sink';
import { PreviewEngine } from '../../ui/video/previewEngine';
import { MediaCache } from '../../ui/video/mediaCache';
import { addFx } from '../fx/clipOps';
import { makeFx } from '../fx/effects';
import { matteCache, matteKey, motionCache } from '../ai/cache';
import { computeMatte, computeStabilization, createModnetEngine, estimateClipMatte, type MatteEngine } from '../ai/analyze';
import { aiCoverageNotices, aiNoticesAt, finalMask } from '../ai/aiFrame';
import { MATTE_FPS, inferSize, maskIoU, temporalFlicker, temporalSmooth, type MatteMode } from '../ai/matteMath';
import { estimateMotion, jitterRms, trajectory, type Motion } from '../ai/stabMath';
import { downloadMatteModel, matteDownloadPlan } from '../ai/models';
import { browserStorageEnv } from '../../ai/transcribe/store';

const out = document.getElementById('out')!;
const log = (s: string) => {
  out.textContent += s + '\n';
};
const SW = 640; // tamaño del clip sintético
const SH = 360;
const FPS = 30;

async function encode(n: number, draw: (ctx: CanvasRenderingContext2D, i: number) => void, w = SW, h = SH): Promise<Blob> {
  const target = new ArrayBufferTarget();
  const mux = new Muxer({ target, video: { codec: 'avc', width: w, height: h }, fastStart: 'in-memory' });
  let err: unknown = null;
  const ve = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: (e) => (err = e) });
  ve.configure({ codec: 'avc1.42001f', width: w, height: h, bitrate: w * h * 8, framerate: FPS, avc: { format: 'avc' } });
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  for (let i = 0; i < n; i++) {
    if (err) throw err;
    draw(ctx, i);
    const f = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    ve.encode(f, { keyFrame: i % 30 === 0 });
    f.close();
    while (ve.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
  }
  await ve.flush();
  ve.close();
  mux.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

// ---------- clip con sujeto sobre fondo conocido ----------
/** Fondo conocido (habitación: degradado, «cuadro» y «mueble»). */
function drawRoom(g: CanvasRenderingContext2D, w: number, h: number) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#c9d3dc');
  gr.addColorStop(0.62, '#aab6c2');
  gr.addColorStop(0.63, '#7a644e');
  gr.addColorStop(1, '#5d4a39');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#e8e2d0';
  g.fillRect(w * 0.08, h * 0.12, w * 0.18, h * 0.22);
  g.fillStyle = '#4b6c8f';
  g.fillRect(w * 0.1, h * 0.15, w * 0.14, h * 0.16);
  g.fillStyle = '#3a2f26';
  g.fillRect(w * 0.72, h * 0.45, w * 0.22, h * 0.25);
}
/** Persona estilizada (cabeza, cuello, torso con hombros, brazos) centrada en cx; s = altura relativa. `solid` = solo silueta blanca. */
function drawPerson(g: CanvasRenderingContext2D, _w: number, h: number, cx: number, solid: boolean) {
  const H = h * 0.9;
  const top = h - H;
  const skin = solid ? '#fff' : '#d9a27c';
  const shirt = solid ? '#fff' : '#b8322f';
  const hair = solid ? '#fff' : '#2b1a10';
  // torso con hombros
  g.fillStyle = shirt;
  g.beginPath();
  g.moveTo(cx - H * 0.26, h);
  g.lineTo(cx - H * 0.24, top + H * 0.42);
  g.quadraticCurveTo(cx - H * 0.22, top + H * 0.33, cx - H * 0.08, top + H * 0.31);
  g.lineTo(cx + H * 0.08, top + H * 0.31);
  g.quadraticCurveTo(cx + H * 0.22, top + H * 0.33, cx + H * 0.24, top + H * 0.42);
  g.lineTo(cx + H * 0.26, h);
  g.closePath();
  g.fill();
  // cuello
  g.fillStyle = skin;
  g.fillRect(cx - H * 0.045, top + H * 0.22, H * 0.09, H * 0.11);
  // cabeza y pelo
  g.beginPath();
  g.ellipse(cx, top + H * 0.15, H * 0.1, H * 0.13, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = hair;
  g.beginPath();
  g.ellipse(cx, top + H * 0.09, H * 0.105, H * 0.075, 0, Math.PI, Math.PI * 2);
  g.fill();
  if (!solid) {
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(cx - H * 0.035, top + H * 0.15, H * 0.01, 0, Math.PI * 2);
    g.arc(cx + H * 0.035, top + H * 0.15, H * 0.01, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#8a4a3a';
    g.lineWidth = H * 0.008;
    g.beginPath();
    g.arc(cx, top + H * 0.19, H * 0.03, 0.2, Math.PI - 0.2);
    g.stroke();
  }
}
const personX = (i: number, w: number) => w * (0.3 + 0.4 * (0.5 - 0.5 * Math.cos((Math.PI * i) / 89)));

let personClip: { blob: Blob; n: number } | null = null;
async function getPersonClip() {
  if (personClip) return personClip;
  const n = 90;
  const blob = await encode(n, (g, i) => {
    drawRoom(g, SW, SH);
    drawPerson(g, SW, SH, personX(i, SW), false);
  });
  return (personClip = { blob, n });
}
/** Verdad conocida del fotograma i a w×h (0/255). */
function truthMask(i: number, w: number, h: number): Uint8Array {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  drawPerson(g, w, h, personX(i, w), true);
  const d = g.getImageData(0, 0, w, h).data;
  const m = new Uint8Array(w * h);
  for (let k = 0; k < m.length; k++) m[k] = d[k * 4] >= 128 ? 255 : 0;
  return m;
}
/** Fondo conocido a w×h (RGBA). */
function roomPixels(w: number, h: number): Uint8ClampedArray {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  drawRoom(g, w, h);
  return g.getImageData(0, 0, w, h).data;
}

/** Motor simulado: resta del fondo conocido (con ruido temporal en el borde, como un modelo real que «hierve»). */
function simEngine(noisy = true): MatteEngine {
  let bg: Uint8ClampedArray | null = null;
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return {
    id: 'sim',
    async infer(img) {
      if (!bg || bg.length !== img.data.length) bg = roomPixels(img.width, img.height);
      const n = img.width * img.height;
      const m = new Uint8Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const d = Math.abs(img.data[j] - bg[j]) + Math.abs(img.data[j + 1] - bg[j + 1]) + Math.abs(img.data[j + 2] - bg[j + 2]);
        let v = Math.max(0, Math.min(255, (d - 30) * 4));
        if (!noisy) {
          /* sin ruido */
        } else if (v > 0 && v < 255) v = Math.max(0, Math.min(255, v + (rnd() - 0.5) * 160));
        else if (rnd() < 0.004) v = 255 - v; // algún píxel suelto equivocado
        m[i] = v;
      }
      return m;
    },
    close() {},
  };
}

let cache: MediaCache | null = null;
let engine: PreviewEngine | null = null;
function ensureEngine() {
  if (engine) return engine;
  cache = new MediaCache();
  engine = new PreviewEngine({ cache });
  engine.attach(document.getElementById('cv') as HTMLCanvasElement);
  engine.setFormat('16:9', 'contain');
  engine.setQualityMode('high');
  return engine;
}

async function exportTap(p: VM.VideoProject, idx: number[], w = SW, h = SH) {
  const want = new Set(idx);
  const frames = new Map<number, ImageData>();
  const notices: string[] = [];
  const t0 = performance.now();
  const res = await renderProject(p, {
    container: 'mp4',
    sizes: [{ width: w, height: h, label: 'banco' }],
    fps: FPS,
    sink: new BlobPartsSink('video/mp4'),
    onNotice: (m) => notices.push(m),
    tap: { frame: (i, ctx) => want.has(i) && frames.set(i, ctx.getImageData(0, 0, w, h)) },
  });
  return { res, frames, notices, ms: performance.now() - t0 };
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

async function previewVsExport(p: VM.VideoProject, idx: number[], ex: Map<number, ImageData>) {
  const e = ensureEngine();
  e.setProject(p);
  const g = document.createElement('canvas');
  g.width = SW;
  g.height = SH;
  const gc = g.getContext('2d', { alpha: false, willReadFrequently: true })!;
  const rows: { t: number; settled: boolean; meanAbs: number; pctBig: number }[] = [];
  for (const i of idx) {
    const t = i / FPS;
    e.seek(t);
    const settled = await e.settle(5000);
    await new Promise((r) => setTimeout(r, 80));
    e.drawFrame(gc, SW, SH, t);
    const d = diffImages(gc.getImageData(0, 0, SW, SH).data, ex.get(i)!.data);
    rows.push({ t, settled, meanAbs: +d.meanAbs.toFixed(3), pctBig: +d.pctBig.toFixed(3) });
  }
  return rows;
}

const heap = () => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576;

const ai = {
  /** Descarga MODNet para el banco (equivale a aceptar el diálogo con el tamaño exacto). */
  async download() {
    const env = browserStorageEnv();
    const plan = await matteDownloadPlan(env);
    log(`MODNet: faltan ${plan.bytesNeeded} B (${(plan.bytesNeeded / 1048576).toFixed(1)} MB)`);
    const t0 = performance.now();
    const st = await downloadMatteModel(env, { consent: { ...plan.consent, accepted: true }, onProgress: (r) => (out.dataset.dl = r.toFixed(3)) });
    return { ...st, bytesPlanned: plan.bytesNeeded, ms: Math.round(performance.now() - t0) };
  },

  async matte(o: { engine?: 'sim' | 'modnet'; mode?: MatteMode; color?: string; noise?: boolean } = {}) {
    const mode = o.mode ?? 'fast';
    const color = o.color ?? '#00ff00';
    const pc = await getPersonClip();
    let p = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
    p = VM.addMedia(p, { id: 'pm', kind: 'video', name: 'persona', duration: pc.n / FPS, blob: pc.blob });
    p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'c', mediaId: 'pm', start: 0, inP: 0, outP: pc.n / FPS }));
    p = addFx(p, 'c', makeFx('bgremove', { id: 'bg', p: { mode, bg: 'color', color, feather: 2, smooth: 0.6 } }));
    matteCache.clear();
    const noticesBefore = aiNoticesAt(p, 1);
    const est = estimateClipMatte(p, 'c', SW, SH, mode);
    const h0 = heap();
    const eng: MatteEngine & { loadMs?: number } = o.engine === 'modnet' ? await createModnetEngine() : simEngine(o.noise !== false);
    const prog: number[] = [];
    let lastEta = NaN;
    const r = await computeMatte(p, 'c', { engine: eng, mode, onProgress: (x) => (prog.push(x.ratio), (lastEta = x.eta ?? NaN)) });
    const again = await computeMatte(p, 'c', { engine: eng, mode }); // repetir no recalcula
    eng.close();
    const h1 = heap();
    // --- máscaras contra la verdad ---
    const key = matteKey('pm', mode);
    const tr = matteCache.peek(key)!;
    const ious: number[] = [];
    const iousRaw: number[] = [];
    const truths: Uint8Array[] = [];
    const raws: Uint8Array[] = [];
    const fins: Uint8Array[] = [];
    const tsms: Uint8Array[] = [];
    const m = { mode, bg: 'color' as const, color, bgMedia: '', feather: 2, choke: 0, smooth: 0.6, blur: 0 };
    for (let i = 0; i < pc.n; i++) {
      const t = truthMask(i, tr.w, tr.h);
      const raw = tr.frames.get(i)!;
      const fin = finalMask(matteCache, key, i / MATTE_FPS, m)!.data;
      truths.push(t);
      raws.push(raw);
      fins.push(fin);
      tsms.push(temporalSmooth((k) => tr.frames.get(k), i, m.smooth)!);
      iousRaw.push(maskIoU(raw, t));
      ious.push(maskIoU(fin, t));
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    // --- cancelación ---
    matteCache.clear(key);
    const ac = new AbortController();
    let cancelled = false;
    const eng2: MatteEngine = o.engine === 'modnet' ? await createModnetEngine() : simEngine();
    try {
      await computeMatte(p, 'c', { engine: eng2, mode, signal: ac.signal, onProgress: (x) => x.done >= 10 && ac.abort() });
    } catch (e) {
      cancelled = (e as Error).name === 'AbortError';
    }
    const afterCancel = matteCache.peek(key)?.frames.size ?? 0;
    await computeMatte(p, 'c', { engine: eng2, mode }); // continúa: solo lo que falta
    eng2.close();
    // --- exportación con fondo de color: píxeles de fondo exactos ---
    const idx = [0, 30, 45, 60, 89];
    const ex = await exportTap(p, idx);
    const [cr, cg, cb] = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
    let sure = 0;
    let exact = 0;
    let subjOk = 0;
    let subj = 0;
    let m0 = 0;
    let m0exact = 0;
    for (const i of idx) {
      const d = ex.frames.get(i)!.data;
      const t = truthMask(i, SW, SH);
      // propiedad del motor: donde la máscara final es 0 (también sus vecinos), el píxel exportado es EXACTAMENTE el color
      const fm = fins[i];
      for (let y = 0; y < SH; y++)
        for (let x = 0; x < SW; x++) {
          const mx = Math.floor((x * tr.w) / SW);
          const my = Math.floor((y * tr.h) / SH);
          let zero = true;
          for (let dy = -1; dy <= 1 && zero; dy++)
            for (let dx = -1; dx <= 1 && zero; dx++) {
              const yy = Math.max(0, Math.min(tr.h - 1, my + dy));
              const xx = Math.max(0, Math.min(tr.w - 1, mx + dx));
              if (fm[yy * tr.w + xx] !== 0) zero = false;
            }
          if (!zero) continue;
          m0++;
          const k = (y * SW + x) * 4;
          if (d[k] === cr && d[k + 1] === cg && d[k + 2] === cb) m0exact++;
        }
      // fondo «seguro»: a más de 6 px de la silueta (fuera del borde difuminado y del error del modelo en el contorno)
      const far = new Uint8Array(SW * SH);
      const R = 6;
      for (let y = 0; y < SH; y++)
        for (let x = 0; x < SW; x++) {
          let near = false;
          for (let dy = -R; dy <= R && !near; dy += 2) for (let dx = -R; dx <= R && !near; dx += 2) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < SH && xx >= 0 && xx < SW && t[yy * SW + xx]) near = true;
          }
          far[y * SW + x] = near ? 0 : 1;
        }
      for (let k = 0; k < SW * SH; k++) {
        if (far[k]) {
          sure++;
          if (d[k * 4] === cr && d[k * 4 + 1] === cg && d[k * 4 + 2] === cb) exact++;
        } else if (t[k]) {
          subj++;
          if (!(Math.abs(d[k * 4] - cr) < 8 && Math.abs(d[k * 4 + 1] - cg) < 8 && Math.abs(d[k * 4 + 2] - cb) < 8)) subjOk++;
        }
      }
    }
    const pve = await previewVsExport(p, idx, ex.frames);
    // sin caché: la vista previa avisa y la exportación también
    matteCache.clear();
    const noticeMissing = aiNoticesAt(p, 1);
    const exportNotice = aiCoverageNotices(p);
    return {
      engine: eng.id,
      mode,
      inference: inferSize(SW, SH, mode),
      estimate: est && { frames: est.frames, seconds: +est.seconds.toFixed(1), cacheMB: +(est.cacheBytes / 1048576).toFixed(1), peakMB: +(est.peakBytes / 1048576).toFixed(0) },
      loadMs: Math.round(eng.loadMs ?? 0),
      computed: r.computed,
      msPerFrame: +r.msPerFrame.toFixed(1),
      totalMs: Math.round(r.ms),
      progressMonotonic: prog.every((v, i) => !i || v >= prog[i - 1]) && prog[prog.length - 1] === 1,
      lastEta,
      repeatComputed: again.computed,
      repeatMs: Math.round(again.ms),
      cancelled,
      framesWhenCancelled: afterCancel,
      heapMB: { before: +h0.toFixed(1), after: +h1.toFixed(1) },
      cacheMB: +((tr.w * tr.h * pc.n) / 1048576).toFixed(2),
      iou: { rawMean: +mean(iousRaw).toFixed(4), rawMin: +Math.min(...iousRaw).toFixed(4), finalMean: +mean(ious).toFixed(4), finalMin: +Math.min(...ious).toFixed(4) },
      flicker: { raw: +temporalFlicker(raws, truths).toFixed(3), temporal: +temporalFlicker(tsms, truths).toFixed(3), final: +temporalFlicker(fins, truths).toFixed(3) },
      background: { surePx: sure, exactPct: +((100 * exact) / sure).toFixed(4), mask0Px: m0, exactWhereMask0Pct: +((100 * m0exact) / m0).toFixed(4) },
      subjectKeptPct: +((100 * subjOk) / subj).toFixed(2),
      exportNotices: ex.notices,
      exportMs: Math.round(ex.ms),
      previewVsExport: pve,
      worstMean: Math.max(...pve.map((x) => x.meanAbs)),
      noticeBefore: noticesBefore,
      noticeMissing,
      exportNoticeMissing: exportNotice,
    };
  },

  async stab(o: { smooth?: number; maxZoom?: number } = {}) {
    // mundo texturado más grande que la vista; cámara = paneo suave + temblor conocido (traslación y algo de giro)
    const n = 120;
    const world = document.createElement('canvas');
    world.width = SW * 2;
    world.height = SH * 2;
    const wg = world.getContext('2d')!;
    const gr = wg.createLinearGradient(0, 0, world.width, world.height);
    gr.addColorStop(0, '#264653');
    gr.addColorStop(0.5, '#e9c46a');
    gr.addColorStop(1, '#e76f51');
    wg.fillStyle = gr;
    wg.fillRect(0, 0, world.width, world.height);
    let s = 3;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < 900; k++) {
      wg.fillStyle = `hsl(${Math.floor(rnd() * 360)},${50 + rnd() * 40}%,${25 + rnd() * 55}%)`;
      wg.fillRect(rnd() * world.width, rnd() * world.height, 6 + rnd() * 40, 6 + rnd() * 40);
    }
    const jit: { x: number; y: number; a: number }[] = [];
    for (let i = 0; i < n; i++) jit.push({ x: (rnd() - 0.5) * 14, y: (rnd() - 0.5) * 10, a: (rnd() - 0.5) * 0.012 });
    const cam = (i: number) => ({ x: SW * 0.5 + i * 1.2 + jit[i].x, y: SH * 0.5 + jit[i].y, a: jit[i].a });
    const blob = await encode(n, (g, i) => {
      const c = cam(i);
      g.save();
      g.translate(SW / 2, SH / 2);
      g.rotate(-c.a);
      g.translate(-SW / 2 - c.x, -SH / 2 - c.y);
      g.drawImage(world, 0, 0);
      g.restore();
    });
    let p = VM.addTrack(VM.createProject(), 'video', { id: 'V' });
    p = VM.addMedia(p, { id: 'sm', kind: 'video', name: 'tembloroso', duration: n / FPS, blob });
    p = VM.addClip(p, 'V', VM.makeClip('video', { id: 's', mediaId: 'sm', start: 0, inP: 0, outP: n / FPS }));
    motionCache.clear();
    const t0 = performance.now();
    const r = await computeStabilization(p, 's', {});
    const again = await computeStabilization(p, 's', {});
    // movimiento medido vs verdad (el contenido se mueve al revés que la cámara)
    const tr = motionCache.peek('stab|sm')!;
    const k = tr.w / SW;
    let errSum = 0;
    for (let i = 1; i < n; i++) {
      const m = tr.motion.get(i)!;
      errSum += Math.hypot(m.dx / k + (cam(i).x - cam(i - 1).x), m.dy / k + (cam(i).y - cam(i - 1).y));
    }
    const ps = addFx(p, 's', makeFx('stabilize', { id: 'st', p: { smooth: o.smooth ?? 1, maxZoom: o.maxZoom ?? 1.2, rotation: 'on' } }));
    const all = Array.from({ length: n }, (_, i) => i);
    const exRaw = await exportTap(p, all);
    const exSt = await exportTap(ps, all);
    // temblor medido en la SALIDA: movimiento entre fotogramas exportados consecutivos (mismo estimador)
    const gray = (d: ImageData): { w: number; h: number; d: Float32Array } => {
      const w = 320;
      const h = 180;
      const cv = document.createElement('canvas');
      cv.width = SW;
      cv.height = SH;
      cv.getContext('2d')!.putImageData(d, 0, 0);
      const c2 = document.createElement('canvas');
      c2.width = w;
      c2.height = h;
      const g2 = c2.getContext('2d', { willReadFrequently: true })!;
      g2.drawImage(cv, 0, 0, w, h);
      const px = g2.getImageData(0, 0, w, h).data;
      const g = new Float32Array(w * h);
      for (let q = 0; q < g.length; q++) g[q] = px[q * 4] * 0.299 + px[q * 4 + 1] * 0.587 + px[q * 4 + 2] * 0.114;
      return { w, h, d: g };
    };
    const pathOf = (frames: Map<number, ImageData>) => {
      const ms: Motion[] = [{ dx: 0, dy: 0, da: 0, ds: 0, ok: true }];
      let prev = gray(frames.get(0)!);
      for (let i = 1; i < n; i++) {
        const cur = gray(frames.get(i)!);
        ms.push(estimateMotion(prev, cur));
        prev = cur;
      }
      return trajectory((i) => ms[i], 0, n - 1);
    };
    const a = pathOf(exRaw.frames);
    const b = pathOf(exSt.frames);
    const jr = (x: Float64Array) => jitterRms(x, 8);
    const before = Math.hypot(jr(a.x), jr(a.y));
    const after = Math.hypot(jr(b.x), jr(b.y));
    const rotBefore = jr(a.a);
    const rotAfter = jr(b.a);
    const pveIdx = [10, 40, 80, 110];
    const pve = await previewVsExport(ps, pveIdx, exSt.frames);
    return {
      frames: n,
      analysisMs: Math.round(r.ms),
      msPerFrame: +(r.ms / n).toFixed(2),
      analysisSize: `${r.w}×${r.h}`,
      repeatComputed: again.computed,
      motionErrPx: +(errSum / (n - 1)).toFixed(3),
      jitterPx: { before: +before.toFixed(3), after: +after.toFixed(3), reductionPct: +(100 * (1 - after / before)).toFixed(1) },
      rotJitterRad: { before: +rotBefore.toFixed(5), after: +rotAfter.toFixed(5) },
      exportMs: { raw: Math.round(exRaw.ms), stabilized: Math.round(exSt.ms) },
      previewVsExport: pve,
      worstMean: Math.max(...pve.map((x) => x.meanAbs)),
      totalMs: Math.round(performance.now() - t0),
    };
  },
};

Object.assign(window as unknown as Record<string, unknown>, { __ai: ai });
log('Banco de V9 listo: window.__ai.matte({engine:"sim"|"modnet", mode:"fast"|"quality"}), stab(), download()');
