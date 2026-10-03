// Vista previa multipista (V3): un reloj maestro, un <video>/<audio> por clip activo o próximo y un
// canvas donde se compone lo que hay en el instante t.
//
//  - Imagen: `composeFrame` (video/engine/compose.ts), la MISMA función que la exportación.
//  - Audio: AudioWorklet con ClipChain/MasterChain de dsp.ts (filtros, compuerta, eco, volumen,
//    EQ, compresor y limitador), el mismo código que mezcla la exportación (ver previewAudio.ts).
//  - Reloj: el del audio (AudioContext, menos la latencia de salida) manda; el video se pinta al
//    instante que marca y los fotogramas que no dé tiempo a pintar se descartan, no se retrasa el audio.
//  - Precarga: el planificador (preview/preloadPlanner.ts) prepara el clip siguiente (pre-seek y
//    arranque unos ms antes del corte) y reutiliza el elemento si el clip continúa al anterior.
//  - Scrubbing: caché LRU de fotogramas reducidos (ImageBitmap); se muestra al instante el más
//    cercano y se refina cuando el elemento llega al instante exacto.
//  - Calidad: lado corto 720/540/360 px, automática según el tiempo por fotograma.
import * as VM from '../../video/model';
import { composeFrame, type ComposedFrame, type StillImage } from '../../video/engine/compose';
import { OVERLAY_FONT, overlayFontPx, type Fit } from '../../video/engine/timeline';
import { outputSize, type Aspect, type Quality } from '../../video/engine/formats';
import type { MediaCache } from './mediaCache';
import { NearestCache } from './preview/frameCache';
import { FrameStats } from './preview/frameStats';
import { PREVIEW_SAMPLE_RATE, PreviewAudioGraph, type ClipStrip } from './preview/previewAudio';
import { driftCorrection, pickReleases, planPreload, type PlanItem } from './preview/preloadPlanner';
import { QualityController, isQualityMode, type QualityMode } from './preview/quality';

interface Entry {
  clipId: string;
  el: HTMLVideoElement | HTMLAudioElement;
  mediaId: string;
  strip: ClipStrip | null;
  /** clave de la última colocación previa (para no repetir el pre-seek) */
  armed: string;
  lastUsed: number;
  vfc: number;
  baseRate: number;
  onSeeked: () => void;
}

export interface EngineHooks {
  cache: MediaCache;
  /** el reproductor llegó al final del proyecto */
  onEnded?: () => void;
}

export interface PreviewMetrics {
  fps: number;
  workMs: number;
  dropped: number;
  droppedRatio: number;
  presented: number;
  shortSide: number;
  mode: QualityMode;
  /** «vista previa reducida»: la calidad Auto bajó sola */
  reduced: boolean;
  elements: number;
  cachedFrames: number;
  cachedKB: number;
  audioStrips: number;
  workletOk: boolean;
  videoFrames: number;
  /** fotogramas de reproducción en los que alguna capa no tenía fotograma vivo (se usó caché o se saltó) */
  stalled: number;
}

/** Reloj de pruebas: ms monótonos (sustituye a AudioContext/performance.now). */
type ClockFn = () => number;

const PREVIEW_FPS = 30;
const MAX_ELEMENTS = 10;
const CACHE_BYTES = 32 << 20;
const CACHE_LONG_SIDE = 640;
const LS_QUALITY = 'chamva.video.previewQuality';
const LS_DEBUG = 'chamva.video.previewDebug';

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento */
  }
};

export function audioFadeAlpha(c: VM.Clip, t: number): number {
  const local = t - c.start;
  const dur = VM.clipDuration(c);
  let a = 1;
  if (c.audioFadeIn > 0 && local < c.audioFadeIn) a = local / c.audioFadeIn;
  if (c.audioFadeOut > 0 && dur - local < c.audioFadeOut) a = Math.min(a, (dur - local) / c.audioFadeOut);
  return Math.max(0, Math.min(1, a));
}

export class PreviewEngine {
  private project: VM.VideoProject = VM.createProject();
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private entries = new Map<string, Entry>();
  private t = 0;
  private playing = false;
  private starting = false;
  private baseT = 0;
  private baseClock = 0;
  private raf = 0;
  private drawRaf = 0;
  private timeListeners = new Set<() => void>();
  private stateListeners = new Set<() => void>();
  private statsListeners = new Set<() => void>();
  private aspect: Aspect = '16:9';
  private fit: Fit = 'contain';
  private measure: CanvasRenderingContext2D | null = null;
  /** generación: sube en dispose() para descartar trabajo asíncrono pendiente */
  private gen = 0;
  // calidad y estadísticas
  private quality: QualityController;
  private stats = new FrameStats(PREVIEW_FPS);
  private size: { width: number; height: number };
  private statsAt = 0;
  private statsVersion = 0;
  private videoFrames = 0;
  private stalls = 0;
  private stalledNow = false;
  private _debug = false;
  // caché de fotogramas
  private frameCache = new NearestCache<ImageBitmap>(CACHE_BYTES, (b) => b.close());
  private storing = 0;
  // audio
  private audio: PreviewAudioGraph | null = null;
  private audioCtx: AudioContext | null = null;
  private recDest: MediaStreamAudioDestinationNode | null = null;
  // reloj (sustituible en pruebas)
  private clockOverride: ClockFn | null = null;
  /** fotogramas dibujados (diagnóstico / pruebas de rendimiento) */
  frames = 0;

  constructor(private hooks: EngineHooks) {
    const saved = lsGet(LS_QUALITY);
    this.quality = new QualityController(isQualityMode(saved) ? saved : 'auto', { fps: PREVIEW_FPS });
    this._debug = lsGet(LS_DEBUG) === '1';
    this.size = outputSize(this.aspect, this.quality.shortSide as Quality);
  }

  setOnEnded(fn: (() => void) | null) {
    this.hooks.onEnded = fn ?? undefined;
  }

  // ---------- estado observable ----------
  get time() {
    return this.t;
  }
  get isPlaying() {
    return this.playing || this.starting;
  }
  subscribeTime = (fn: () => void) => {
    this.timeListeners.add(fn);
    return () => void this.timeListeners.delete(fn);
  };
  subscribeState = (fn: () => void) => {
    this.stateListeners.add(fn);
    return () => void this.stateListeners.delete(fn);
  };
  subscribeStats = (fn: () => void) => {
    this.statsListeners.add(fn);
    return () => void this.statsListeners.delete(fn);
  };
  getTime = () => this.t;
  getPlaying = () => this.playing || this.starting;
  getStatsVersion = () => this.statsVersion;
  private setT(t: number) {
    this.t = t;
    this.timeListeners.forEach((f) => f());
  }
  private emitState() {
    this.stateListeners.forEach((f) => f());
  }
  private emitStats() {
    this.statsVersion++;
    this.statsListeners.forEach((f) => f());
  }

  get duration() {
    return VM.projectDuration(this.project);
  }

  // ---------- calidad e indicadores ----------
  get qualityMode(): QualityMode {
    return this.quality.mode;
  }
  setQualityMode(m: QualityMode) {
    if (m === this.quality.mode) return;
    this.quality.setMode(m);
    lsSet(LS_QUALITY, m);
    this.applyQuality();
  }
  get debug() {
    return this._debug;
  }
  setDebug(on: boolean) {
    this._debug = on;
    lsSet(LS_DEBUG, on ? '1' : '0');
    this.emitStats();
  }
  /** «vista previa reducida» (la calidad Auto bajó sola) */
  get reduced() {
    return this.quality.reducedByAuto;
  }

  metrics(): PreviewMetrics {
    const wl = this.audio?.workletOk ?? false;
    return {
      fps: this.stats.fps(this.wallNow()),
      workMs: this.stats.avgWorkMs(),
      dropped: this.stats.dropped,
      droppedRatio: this.stats.droppedRatio,
      presented: this.stats.presented,
      shortSide: this.quality.shortSide,
      mode: this.quality.mode,
      reduced: this.quality.reducedByAuto,
      elements: this.entries.size,
      cachedFrames: this.frameCache.size,
      cachedKB: Math.round(this.frameCache.totalWeight / 1024),
      audioStrips: this.audio?.stripCount ?? 0,
      workletOk: wl,
      videoFrames: this.videoFrames,
      stalled: this.stalls,
    };
  }

  private applyQuality() {
    const next = outputSize(this.aspect, this.quality.shortSide as Quality);
    const changed = next.width !== this.size.width || next.height !== this.size.height;
    this.size = next;
    this.applySize();
    if (changed) {
      this.emitState();
      this.draw(); // sincrónico: el lienzo se vació al cambiar de tamaño
    }
    this.emitStats();
  }

  // ---------- configuración ----------
  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') ?? null;
    this.applySize();
    if (canvas) this.draw();
  }

  setFormat(aspect: Aspect, fit: Fit) {
    this.aspect = aspect;
    this.fit = fit;
    this.size = outputSize(aspect, this.quality.shortSide as Quality);
    this.applySize();
    this.draw();
  }
  get frameSize() {
    return this.size;
  }
  private applySize() {
    if (!this.canvas) return;
    if (this.canvas.width !== this.size.width) this.canvas.width = this.size.width;
    if (this.canvas.height !== this.size.height) this.canvas.height = this.size.height;
  }

  setProject(p: VM.VideoProject) {
    if (p === this.project) return;
    this.project = p;
    // fuera los elementos de clips que ya no existen (si no continúan en otro clip) y las miniaturas de medios que ya no están
    for (const [id, e] of this.entries) {
      if (!VM.findClip(p, id)) {
        this.release(e);
        this.entries.delete(id);
      }
    }
    for (const g of this.frameCache.groups()) if (!p.media[g]) this.frameCache.dropGroup(g);
    this.applyMaster();
    const d = this.duration;
    if (!this.playing) {
      if (this.t > d) this.setT(d);
      this.sync(this.t, false);
      this.requestDraw();
    }
  }

  // ---------- reloj ----------
  private wallNow() {
    return this.clockOverride ? this.clockOverride() : performance.now();
  }
  /** ms del reloj maestro: el del audio (menos la latencia de salida) si corre; si no, el de pared */
  private clockMs(): number {
    if (this.clockOverride) return this.clockOverride();
    const ac = this.audioCtx;
    if (ac && ac.state === 'running') {
      const lat = (ac.outputLatency || 0) + (ac.baseLatency || 0);
      return Math.max(0, ac.currentTime - lat) * 1000;
    }
    return performance.now();
  }
  /** Para pruebas con el panel oculto (sin rAF): reloj y pasos manuales. */
  setClockSource(fn: ClockFn | null) {
    this.clockOverride = fn;
  }

  // ---------- reproducción ----------
  play() {
    if (this.playing || this.starting) return;
    const d = this.duration;
    if (d <= 0) return;
    if (this.t >= d - 0.02) this.setT(0);
    const a = this.ensureAudio();
    void this.audioCtx?.resume();
    if (a && !a.isReady) {
      // los AudioWorklet aún se cargan: sin ellos el sonido saldría sin procesar
      this.starting = true;
      this.emitState();
      void a.ready.finally(() => {
        if (!this.starting) return;
        this.starting = false;
        this.begin();
      });
      return;
    }
    this.begin();
  }

  private begin() {
    this.playing = true;
    this.baseT = this.t;
    this.baseClock = this.clockMs();
    this.stats.resetGap();
    this.emitState();
    this.sync(this.t, true);
    this.schedule();
  }

  pause() {
    if (this.starting) {
      this.starting = false;
      this.emitState();
    }
    if (!this.playing) return;
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pauseAll();
    this.emitState();
    this.sync(this.t, false);
    // Sin parpadeo: se pinta ya, con el fotograma que tenga cada elemento (o la caché).
    this.draw();
    this.emitStats();
  }

  toggle() {
    if (this.playing || this.starting) this.pause();
    else this.play();
  }

  seek(t: number) {
    const d = this.duration;
    const v = Math.max(0, Math.min(Math.max(d, 0), t));
    this.setT(v);
    this.stats.resetGap();
    if (this.playing) {
      this.baseT = v;
      this.baseClock = this.clockMs();
      this.sync(v, true);
      this.draw();
    } else {
      this.sync(v, false);
      // Scrubbing: lo mejor que haya ya mismo (caché o fotograma actual); se refina al terminar el seek.
      this.draw();
    }
  }

  /** Espera a que los elementos visibles lleguen al instante actual y pinta el fotograma exacto. */
  async settle(timeoutMs = 3000): Promise<boolean> {
    const t0 = performance.now();
    const ready = () => {
      const { visual } = VM.clipsAt(this.project, this.t, this.duration);
      for (const { clip } of visual) {
        if (clip.kind !== 'video') continue;
        const e = this.entries.get(clip.id);
        const v = e?.el as HTMLVideoElement | undefined;
        if (!v) continue;
        if (v.seeking || v.readyState < 2) return false;
      }
      return true;
    };
    while (!ready()) {
      if (performance.now() - t0 > timeoutMs) {
        this.draw();
        return false;
      }
      await new Promise((r) => setTimeout(r, 8));
    }
    this.draw();
    return true;
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.playing) return;
    this.step(now);
    this.schedule();
  };

  /**
   * Un paso de reproducción (lo llama rAF; en pruebas con el panel oculto se llama a mano
   * junto con `setClockSource`). `now` = marca de tiempo en ms para las estadísticas.
   */
  step(now = this.wallNow()) {
    if (!this.playing) return;
    const w0 = performance.now();
    const d = this.duration;
    const t = this.baseT + (this.clockMs() - this.baseClock) / 1000;
    if (t >= d) {
      this.setT(d);
      this.playing = false;
      this.pauseAll();
      this.emitState();
      this.sync(d, false);
      this.draw();
      this.emitStats();
      this.hooks.onEnded?.();
      return;
    }
    this.setT(Math.max(0, t));
    this.sync(this.t, true);
    this.stalledNow = false;
    this.draw();
    if (this.stalledNow) this.stalls++;
    const work = performance.now() - w0;
    this.stats.onPresent(now, work);
    if (this.quality.record(work)) this.applyQuality();
    if (now - this.statsAt > 500) {
      this.statsAt = now;
      this.emitStats();
    }
  }

  requestDraw = () => {
    if (this.drawRaf || this.playing) return;
    this.drawRaf = requestAnimationFrame(() => {
      this.drawRaf = 0;
      this.draw();
    });
  };

  // ---------- elementos de medios ----------
  private nowS() {
    return this.wallNow() / 1000;
  }

  private entryFor(clip: VM.Clip, continuesFrom?: string): Entry | null {
    let e = this.entries.get(clip.id);
    const m = clip.mediaId ? this.project.media[clip.mediaId] : undefined;
    if (!m || !m.blob || m.missing) return null;
    if (e && e.mediaId !== m.id) {
      this.release(e);
      this.entries.delete(clip.id);
      e = undefined;
    }
    if (e) return e;
    // Corte sin tirón: el clip continúa al anterior (mismo archivo y punto) → se reutiliza su elemento.
    const prev = continuesFrom ? this.entries.get(continuesFrom) : undefined;
    if (prev && prev.mediaId === m.id && prev.clipId !== clip.id) {
      this.entries.delete(prev.clipId);
      prev.clipId = clip.id;
      prev.armed = '';
      this.entries.set(clip.id, prev);
      return prev;
    }
    const el = document.createElement(clip.kind === 'audio' ? 'audio' : 'video') as HTMLVideoElement | HTMLAudioElement;
    el.preload = 'auto';
    el.muted = false;
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    el.src = this.hooks.cache.urlOf(m);
    const onSeeked = () => {
      this.maybeStore(m.id, el);
      this.requestDraw();
    };
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('loadeddata', onSeeked);
    e = { clipId: clip.id, el, mediaId: m.id, strip: null, armed: '', lastUsed: this.nowS(), vfc: 0, baseRate: 1, onSeeked };
    this.entries.set(clip.id, e);
    if (el instanceof HTMLVideoElement && typeof el.requestVideoFrameCallback === 'function') this.watchFrames(e, el);
    this.connect(e, clip);
    return e;
  }

  /** requestVideoFrameCallback: cuenta fotogramas realmente presentados y repinta en pausa al llegar el exacto. */
  private watchFrames(e: Entry, el: HTMLVideoElement) {
    const cb = () => {
      this.videoFrames++;
      if (!this.playing) this.requestDraw();
      e.vfc = el.requestVideoFrameCallback(cb);
    };
    e.vfc = el.requestVideoFrameCallback(cb);
  }

  private release(e: Entry) {
    e.el.pause();
    e.el.removeEventListener('seeked', e.onSeeked);
    e.el.removeEventListener('loadeddata', e.onSeeked);
    if (e.vfc && e.el instanceof HTMLVideoElement && typeof e.el.cancelVideoFrameCallback === 'function') e.el.cancelVideoFrameCallback(e.vfc);
    e.vfc = 0;
    e.strip?.dispose();
    e.strip = null;
    e.el.removeAttribute('src');
    e.el.load();
  }

  private pauseAll() {
    for (const e of this.entries.values()) if (!e.el.paused) e.el.pause();
  }

  private setRate(e: Entry, r: number) {
    const rate = Math.max(0.0625, Math.min(16, r));
    if (e.el.playbackRate !== rate) e.el.playbackRate = rate;
  }

  /** Pone en hora los elementos según t. `playing`: reproduce; si no, solo coloca los fotogramas visibles. */
  private sync(t: number, playing: boolean) {
    const now = this.nowS();
    const items = planPreload(this.project, t, { horizon: 2, lead: 0.15 });
    const planned = new Set<string>();
    const fps = PREVIEW_FPS;
    for (const it of items) {
      if (!playing && !(it.visible && it.active)) continue;
      // el siguiente clip continúa al que suena: no hace falta preparar otro elemento
      if (!it.active && it.continuesFrom && this.entries.has(it.continuesFrom)) continue;
      const clip = it.clip;
      const e = this.entryFor(clip, it.active ? it.continuesFrom : undefined);
      if (!e) continue;
      planned.add(e.clipId);
      e.lastUsed = now;
      const speed = Math.max(0.0625, Math.min(16, clip.speed || 1));
      e.baseRate = speed;
      this.connect(e, clip);
      if (!playing) {
        // Pausa / scrubbing: elemento quieto en el fotograma exacto.
        if (!e.el.paused) e.el.pause();
        this.setRate(e, speed);
        // +0,5 ms: la misma tolerancia que el decodificador de la exportación (un instante justo en el borde de un
        // fotograma no debe caer en el anterior por redondeo)
        if (Math.abs(e.el.currentTime - it.seekTo) > 0.5 / fps) e.el.currentTime = it.seekTo + 0.0005;
        continue;
      }
      if (it.play) {
        if (e.el.paused) {
          if (Math.abs(e.el.currentTime - it.seekTo) > 0.05) e.el.currentTime = it.seekTo;
          this.setRate(e, speed);
          void e.el.play().catch(() => {});
        } else if (!e.el.seeking && e.el.readyState >= 2) {
          const c = driftCorrection(e.el.currentTime - it.seekTo, speed);
          if (c.seekBy !== undefined) {
            e.el.currentTime = it.seekTo;
            this.setRate(e, speed);
          } else this.setRate(e, c.rate);
        }
        e.strip?.setFade(it.active && it.audible ? audioFadeAlpha(clip, t) : 0);
      } else {
        // Precarga: pre-seek una sola vez al primer fotograma; en silencio.
        const key = `${clip.id}:${it.seekTo.toFixed(3)}`;
        if (e.armed !== key) {
          e.armed = key;
          if (!e.el.paused) e.el.pause();
          this.setRate(e, speed);
          if (Math.abs(e.el.currentTime - it.seekTo) > 0.05) e.el.currentTime = it.seekTo;
        }
        e.strip?.setFade(0);
      }
      if (e.strip && (it.active || it.play)) e.strip.setFx(VM.clipAudioFx(clip));
    }
    // El resto: en pausa y silencio; se sueltan los que llevan tiempo sin usarse o exceden el tope.
    for (const e of this.entries.values()) {
      if (planned.has(e.clipId)) continue;
      if (!e.el.paused) e.el.pause();
      e.strip?.setFade(0);
    }
    const drop = pickReleases([...this.entries.values()].map((e) => ({ clipId: e.clipId, lastUsed: e.lastUsed })), planned, MAX_ELEMENTS, now);
    for (const id of drop) {
      const e = this.entries.get(id);
      if (!e) continue;
      this.release(e);
      this.entries.delete(id);
    }
  }

  // ---------- audio ----------
  ensureAudio(): PreviewAudioGraph | null {
    if (this.audio) return this.audio;
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    let ac: AudioContext;
    try {
      ac = new AC({ sampleRate: PREVIEW_SAMPLE_RATE }); // 48 kHz, como la exportación
    } catch {
      ac = new AC();
    }
    const rec = ac.createMediaStreamDestination();
    const g = new PreviewAudioGraph(ac, { eq: this.project.eq, normalize: this.project.normalize });
    g.out.connect(rec);
    this.audioCtx = ac;
    this.audio = g;
    this.recDest = rec;
    void g.ready.then(() => {
      if (this.audio !== g) return;
      for (const e of this.entries.values()) this.connect(e);
    });
    return g;
  }

  /** Flujo de audio de la mezcla (para grabar la vista previa si no hay WebCodecs). */
  get audioStream(): MediaStream | null {
    this.ensureAudio();
    return this.recDest?.stream ?? null;
  }

  private applyMaster() {
    this.audio?.setMaster({ eq: this.project.eq, normalize: this.project.normalize });
  }

  /** Conecta el elemento a su cadena de audio (una sola vez; createMediaElementSource solo admite una). */
  private connect(e: Entry, clip?: VM.Clip) {
    const g = this.audio;
    if (!g || !g.isReady || e.strip) return;
    const c = clip ?? VM.findClip(this.project, e.clipId)?.clip;
    if (!c) return;
    try {
      const src = (g.ctx as AudioContext).createMediaElementSource(e.el);
      e.strip = g.addSource(src, VM.clipAudioFx(c));
    } catch {
      /* el elemento ya estaba conectado */
    }
  }

  // ---------- caché de fotogramas ----------
  /** Guarda una copia reducida del fotograma actual de un elemento (para el scrubbing). */
  private maybeStore(mediaId: string, el: HTMLVideoElement | HTMLAudioElement) {
    if (!(el instanceof HTMLVideoElement) || !el.videoWidth || el.readyState < 2 || el.seeking) return;
    const ct = el.currentTime;
    const near = this.frameCache.nearest(mediaId, ct, this.playing ? 0.5 : 0.5 / PREVIEW_FPS);
    if (near || this.storing >= 2 || typeof createImageBitmap !== 'function') return;
    const k = Math.min(1, CACHE_LONG_SIDE / Math.max(el.videoWidth, el.videoHeight));
    const w = Math.max(2, Math.round(el.videoWidth * k));
    const h = Math.max(2, Math.round(el.videoHeight * k));
    this.storing++;
    const gen = this.gen;
    createImageBitmap(el, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
      .then((bmp) => {
        if (gen !== this.gen) return bmp.close();
        this.frameCache.put(mediaId, ct, bmp, w * h * 4);
      })
      .catch(() => {})
      .finally(() => this.storing--);
  }

  // ---------- dibujo ----------
  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    this.drawFrame(ctx, this.canvas.width, this.canvas.height, this.t);
    this.frames++;
  }

  /** Fotograma de video de un clip en t: el del elemento si está en hora; si no, el más cercano de la caché. */
  private videoFor(clip: VM.Clip, t: number): ComposedFrame | null {
    const e = this.entries.get(clip.id);
    const v = e?.el as HTMLVideoElement | undefined;
    const want = VM.sourceTimeAt(clip, t);
    const live: ComposedFrame | null = v && v.videoWidth && v.readyState >= 2 ? { image: v, width: v.videoWidth, height: v.videoHeight, rotation: 0 } : null;
    const mid = clip.mediaId;
    if (this.playing && (!live || !v || v.seeking)) this.stalledNow = true;
    if (live && v) {
      const exact = !v.seeking && Math.abs(v.currentTime - want) <= 0.75 / PREVIEW_FPS;
      if (this.playing && !v.seeking) {
        // En reproducción manda el fotograma vivo; de paso se guardan unos pocos para el scrubbing.
        if (mid) this.maybeStore(mid, v);
        return live;
      }
      if (exact) {
        if (mid) this.maybeStore(mid, v);
        return live;
      }
      // Scrubbing: el elemento aún no llegó. Si la caché tiene un fotograma más cercano, ese.
      const near = mid ? this.frameCache.nearest(mid, want, 1.5) : null;
      if (near && near.dist < Math.abs(v.currentTime - want)) return { image: near.value, width: near.value.width, height: near.value.height, rotation: 0 };
      return live;
    }
    const near = mid ? this.frameCache.nearest(mid, want, 1.5) : null;
    return near ? { image: near.value, width: near.value.width, height: near.value.height, rotation: 0 } : null;
  }

  /** Compone el instante t en cualquier contexto (también el de la grabación de respaldo) con la misma función que la exportación. */
  drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const p = this.project;
    const dur = VM.projectDuration(p);
    composeFrame(ctx, p, t, dur, w, h, this.fit, {
      video: (clip) => this.videoFor(clip, t),
      image: (clip) => {
        const m = clip.mediaId ? p.media[clip.mediaId] : undefined;
        const img = this.hooks.cache.imageOf(m);
        return img && img.complete && img.naturalWidth ? (img as StillImage) : null;
      },
    });
  }

  /** Tamaños de origen de un clip visual para las manijas (px de su fuente, y texto medido). */
  dimsFor(clip: VM.Clip): { w: number; h: number; textW?: number; fontPx?: number } | null {
    if (clip.kind === 'video') {
      const v = this.entries.get(clip.id)?.el as HTMLVideoElement | undefined;
      if (v?.videoWidth) return { w: v.videoWidth, h: v.videoHeight };
      const m = clip.mediaId ? this.project.media[clip.mediaId] : undefined;
      return m ? { w: 16, h: 9 } : null;
    }
    if (clip.kind === 'image') {
      const m = clip.mediaId ? this.project.media[clip.mediaId] : undefined;
      const img = this.hooks.cache.imageOf(m);
      return img?.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : { w: 4, h: 3 };
    }
    const { width: W, height: H } = this.size;
    const fontPx = overlayFontPx(clip.size ?? 60, W, H);
    this.measure ??= document.createElement('canvas').getContext('2d');
    if (!this.measure) return { w: 0, h: 0, textW: fontPx * (clip.text?.length ?? 4) * 0.6, fontPx };
    this.measure.font = `bold ${fontPx}px ${OVERLAY_FONT}`;
    return { w: 0, h: 0, textW: this.measure.measureText(clip.text ?? '').width, fontPx };
  }

  get fitMode(): Fit {
    return this.fit;
  }
  get aspectId(): Aspect {
    return this.aspect;
  }

  /** Planificación vigente (diagnóstico y pruebas). */
  planAt(t: number): PlanItem[] {
    return planPreload(this.project, t, { horizon: 2, lead: 0.15 });
  }

  /** Libera elementos, nodos de audio, fotogramas en caché y contextos. Se puede reutilizar el motor después. */
  dispose() {
    this.gen++;
    this.playing = false;
    this.starting = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.drawRaf) cancelAnimationFrame(this.drawRaf);
    this.raf = 0;
    this.drawRaf = 0;
    for (const e of this.entries.values()) this.release(e);
    this.entries.clear();
    this.frameCache.clear();
    this.audio?.dispose();
    this.audio = null;
    this.recDest = null;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.timeListeners.clear();
    this.stateListeners.clear();
    this.statsListeners.clear();
    this.stats.reset();
    this.stalls = 0;
  }
}
