// Vista previa multipista: un reloj, un <video>/<audio> por clip activo y un canvas
// donde se compone lo que hay en el instante t con las MISMAS funciones de dibujo
// que la exportación (drawVideoClip / drawStillClip). El audio pasa por Web Audio
// (filtro «Voz», volumen, fundidos, EQ y normalizar).
//
// Límites conocidos (la vista previa fluida y fiel es el tramo V3): no hay
// pre-decodificación del clip siguiente (solo un «pre-posicionado» del segundo
// anterior), y la compuerta de ruido solo suena al exportar.
import * as VM from '../../video/model';
import { drawStillClip, drawVideoClip } from '../../video/engine/compose';
import { OVERLAY_FONT, overlayFontPx, type Fit } from '../../video/engine/timeline';
import { outputSize, type Aspect, type Quality } from '../../video/engine/formats';
import type { MediaCache } from './mediaCache';

interface Entry {
  clipId: string;
  el: HTMLVideoElement | HTMLAudioElement;
  mediaId: string;
  chain?: Chain;
}

interface Chain {
  hp: BiquadFilterNode;
  lp: BiquadFilterNode;
  gain: GainNode;
  echo: GainNode;
  fx: string;
}

export interface EngineHooks {
  cache: MediaCache;
  /** el reproductor llegó al final del proyecto */
  onEnded?: () => void;
}

const PREVIEW_SHORT_SIDE = 540;
const DRIFT = 0.3;

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
  private baseT = 0;
  private baseWall = 0;
  private raf = 0;
  private drawRaf = 0;
  private timeListeners = new Set<() => void>();
  private stateListeners = new Set<() => void>();
  private aspect: Aspect = '16:9';
  private fit: Fit = 'contain';
  private size = outputSize('16:9', PREVIEW_SHORT_SIDE as Quality);
  private measure: CanvasRenderingContext2D | null = null;
  // audio
  private ac: AudioContext | null = null;
  private mix: GainNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private comp: DynamicsCompressorNode | null = null;
  private recDest: MediaStreamAudioDestinationNode | null = null;
  /** fotogramas dibujados (diagnóstico / pruebas de rendimiento) */
  frames = 0;

  constructor(private hooks: EngineHooks) {}

  setOnEnded(fn: (() => void) | null) {
    this.hooks.onEnded = fn ?? undefined;
  }

  // ---------- estado observable ----------
  get time() {
    return this.t;
  }
  get isPlaying() {
    return this.playing;
  }
  subscribeTime = (fn: () => void) => {
    this.timeListeners.add(fn);
    return () => void this.timeListeners.delete(fn);
  };
  subscribeState = (fn: () => void) => {
    this.stateListeners.add(fn);
    return () => void this.stateListeners.delete(fn);
  };
  getTime = () => this.t;
  getPlaying = () => this.playing;
  private setT(t: number) {
    this.t = t;
    this.timeListeners.forEach((f) => f());
  }
  private emitState() {
    this.stateListeners.forEach((f) => f());
  }

  get duration() {
    return VM.projectDuration(this.project);
  }

  // ---------- configuración ----------
  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') ?? null;
    this.applySize();
    this.requestDraw();
  }

  setFormat(aspect: Aspect, fit: Fit) {
    this.aspect = aspect;
    this.fit = fit;
    this.size = outputSize(aspect, PREVIEW_SHORT_SIDE as Quality);
    this.applySize();
    this.requestDraw();
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
    // fuera los elementos de clips que ya no existen
    for (const [id, e] of this.entries) {
      if (!VM.findClip(p, id)) {
        this.release(e);
        this.entries.delete(id);
      }
    }
    this.applyMaster();
    const d = this.duration;
    if (!this.playing) {
      if (this.t > d) this.setT(d);
      this.sync(this.t, false);
      this.requestDraw();
    }
  }

  // ---------- reproducción ----------
  play() {
    if (this.playing) return;
    const d = this.duration;
    if (d <= 0) return;
    if (this.t >= d - 0.02) this.setT(0);
    this.ensureAudio();
    void this.ac?.resume();
    this.playing = true;
    this.baseT = this.t;
    this.baseWall = performance.now();
    this.emitState();
    this.schedule();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.emitState();
    this.pauseAll();
    this.sync(this.t, false);
    this.requestDraw();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const d = this.duration;
    const v = Math.max(0, Math.min(Math.max(d, 0), t));
    this.setT(v);
    if (this.playing) {
      this.baseT = v;
      this.baseWall = performance.now();
    } else {
      this.sync(v, false);
      this.requestDraw();
    }
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.playing) return;
    const d = this.duration;
    let t = this.baseT + (now - this.baseWall) / 1000;
    if (t >= d) {
      this.setT(d);
      this.playing = false;
      this.pauseAll();
      this.emitState();
      this.sync(d, false);
      this.draw();
      this.hooks.onEnded?.();
      return;
    }
    t = Math.max(0, t);
    this.setT(t);
    this.sync(t, true);
    this.draw();
    this.schedule();
  };

  requestDraw = () => {
    if (this.drawRaf || this.playing) return;
    this.drawRaf = requestAnimationFrame(() => {
      this.drawRaf = 0;
      this.draw();
    });
  };

  // ---------- elementos de medios ----------
  private entryFor(clip: VM.Clip): Entry | null {
    let e = this.entries.get(clip.id);
    const m = clip.mediaId ? this.project.media[clip.mediaId] : undefined;
    if (!m || !m.blob || m.missing) return null;
    if (e && e.mediaId !== m.id) {
      this.release(e);
      this.entries.delete(clip.id);
      e = undefined;
    }
    if (e) return e;
    const el = document.createElement(clip.kind === 'audio' ? 'audio' : 'video') as HTMLVideoElement | HTMLAudioElement;
    el.preload = 'auto';
    el.muted = false;
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    el.src = this.hooks.cache.urlOf(m);
    el.addEventListener('seeked', this.requestDraw);
    el.addEventListener('loadeddata', this.requestDraw);
    e = { clipId: clip.id, el, mediaId: m.id };
    this.entries.set(clip.id, e);
    if (this.ac) this.connect(e);
    return e;
  }

  private release(e: Entry) {
    e.el.pause();
    e.el.removeEventListener('seeked', this.requestDraw);
    e.el.removeEventListener('loadeddata', this.requestDraw);
    try {
      e.chain?.gain.disconnect();
    } catch {
      /* ya desconectado */
    }
    e.el.removeAttribute('src');
    e.el.load();
  }

  private pauseAll() {
    for (const e of this.entries.values()) if (!e.el.paused) e.el.pause();
  }

  /** Pone en hora los elementos según t. `playing`: reproduce; si no, solo coloca los fotogramas visibles. */
  private sync(t: number, playing: boolean) {
    const p = this.project;
    const dur = VM.projectDuration(p);
    const { visual, audible } = VM.clipsAt(p, t, dur);
    const needed = new Map<string, { clip: VM.Clip; audible: boolean; visual: boolean }>();
    for (const v of visual) if (v.clip.kind === 'video') needed.set(v.clip.id, { clip: v.clip, audible: false, visual: true });
    for (const a of audible) {
      const prev = needed.get(a.clip.id);
      needed.set(a.clip.id, { clip: a.clip, audible: true, visual: prev?.visual ?? false });
    }
    for (const n of needed.values()) {
      if (!playing && !n.visual) continue;
      const e = this.entryFor(n.clip);
      if (!e) continue;
      const want = VM.sourceTimeAt(n.clip, t);
      const rate = Math.max(0.0625, Math.min(16, n.clip.speed || 1));
      if (e.el.playbackRate !== rate) e.el.playbackRate = rate;
      if (playing) {
        if (e.el.paused) {
          if (Math.abs(e.el.currentTime - want) > 0.05) e.el.currentTime = want;
          void e.el.play().catch(() => {});
        } else if (Math.abs(e.el.currentTime - want) > DRIFT) e.el.currentTime = want;
        this.setGain(e, n.clip, n.audible ? n.clip.volume * audioFadeAlpha(n.clip, t) : 0);
      } else {
        if (!e.el.paused) e.el.pause();
        if (Math.abs(e.el.currentTime - want) > 0.03) e.el.currentTime = want;
      }
    }
    for (const e of this.entries.values()) if (!needed.has(e.clipId) && !e.el.paused) e.el.pause();
    if (playing) this.preroll(t, needed);
  }

  /** Pre-posiciona (en pausa) los clips que empiezan en el próximo segundo. */
  private preroll(t: number, needed: Map<string, unknown>) {
    for (const tr of this.project.tracks)
      for (const c of tr.clips) {
        if (c.kind !== 'video' && c.kind !== 'audio') continue;
        if (c.start <= t || c.start > t + 1 || needed.has(c.id)) continue;
        const e = this.entryFor(c);
        if (e && e.el.paused && Math.abs(e.el.currentTime - c.inP) > 0.05) e.el.currentTime = c.inP;
      }
  }

  // ---------- audio ----------
  ensureAudio(): AudioContext | null {
    if (this.ac) return this.ac;
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ac = new AC();
    const mix = ac.createGain();
    const eq = [120, 1000, 6000].map((f) => {
      const b = ac.createBiquadFilter();
      b.type = 'peaking';
      b.frequency.value = f;
      b.Q.value = 1;
      return b;
    });
    const comp = ac.createDynamicsCompressor();
    const rec = ac.createMediaStreamDestination();
    mix.connect(eq[0]);
    eq[0].connect(eq[1]);
    eq[1].connect(eq[2]);
    eq[2].connect(comp);
    comp.connect(ac.destination);
    comp.connect(rec);
    this.ac = ac;
    this.mix = mix;
    this.eqNodes = eq;
    this.comp = comp;
    this.recDest = rec;
    this.applyMaster();
    for (const e of this.entries.values()) this.connect(e);
    return ac;
  }

  /** Flujo de audio de la mezcla (para grabar la vista previa si no hay WebCodecs). */
  get audioStream(): MediaStream | null {
    this.ensureAudio();
    return this.recDest?.stream ?? null;
  }

  private applyMaster() {
    if (!this.ac) return;
    const { low, mid, high } = this.project.eq;
    [low, mid, high].forEach((g, i) => (this.eqNodes[i].gain.value = g));
    const n = this.project.normalize;
    this.comp!.threshold.value = n ? -24 : 0;
    this.comp!.ratio.value = n ? 4 : 1;
    this.comp!.knee.value = n ? 30 : 0;
  }

  private connect(e: Entry) {
    const ac = this.ac;
    if (!ac || !this.mix || e.chain) return;
    try {
      const src = ac.createMediaElementSource(e.el);
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      const gain = ac.createGain();
      const echo = ac.createGain();
      echo.gain.value = 0;
      const delay = ac.createDelay(1);
      delay.delayTime.value = 0.28;
      const fb = ac.createGain();
      fb.gain.value = 0.35;
      src.connect(hp);
      hp.connect(lp);
      lp.connect(gain);
      gain.connect(this.mix);
      gain.connect(echo);
      echo.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(this.mix);
      e.chain = { hp, lp, gain, echo, fx: '' };
    } catch {
      /* el elemento ya estaba conectado */
    }
  }

  private setGain(e: Entry, clip: VM.Clip, g: number) {
    if (!e.chain) {
      this.connect(e);
      if (!e.chain) return;
    }
    const c = e.chain;
    const fx = VM.clipAudioFx(clip);
    const key = `${fx.hp}|${fx.lp}|${fx.echo}`;
    if (c.fx !== key) {
      c.hp.frequency.value = fx.hp;
      c.lp.frequency.value = fx.lp;
      c.echo.gain.value = fx.echo;
      c.fx = key;
    }
    c.gain.gain.value = Math.max(0, g);
  }

  // ---------- dibujo ----------
  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    this.drawFrame(ctx, this.canvas.width, this.canvas.height, this.t);
    this.frames++;
  }

  /** Compone el instante t en cualquier contexto (también el de la grabación de respaldo). */
  drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const p = this.project;
    const dur = VM.projectDuration(p);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const { visual } = VM.clipsAt(p, t, dur);
    for (const { clip } of visual) {
      const alpha = VM.clipFadeAlpha(clip, t, dur);
      if (clip.kind === 'video') {
        const e = this.entries.get(clip.id);
        const v = e?.el as HTMLVideoElement | undefined;
        if (v && v.videoWidth && v.readyState >= 2) drawVideoClip(ctx, v, v.videoWidth, v.videoHeight, w, h, this.fit, 0, clip, alpha);
      } else if (clip.kind === 'image') {
        const m = clip.mediaId ? p.media[clip.mediaId] : undefined;
        const img = this.hooks.cache.imageOf(m);
        drawStillClip(ctx, w, h, clip, img && img.complete && img.naturalWidth ? img : null, alpha);
      } else drawStillClip(ctx, w, h, clip, null, alpha);
    }
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

  dispose() {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.drawRaf) cancelAnimationFrame(this.drawRaf);
    for (const e of this.entries.values()) this.release(e);
    this.entries.clear();
    void this.ac?.close().catch(() => {});
    this.ac = null;
    this.timeListeners.clear();
    this.stateListeners.clear();
  }
}
