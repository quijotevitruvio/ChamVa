// Sesión de grabación (parte con DOM): abre pantalla, cámara y micrófono SOLO cuando se llama a `prepare()` (siempre desde
// un clic del usuario), compone «pantalla + cámara en burbuja» en un lienzo, mezcla el audio, graba con `MediaRecorder` y
// SIEMPRE suelta todas las pistas (`track.stop()`) en `dispose()`: ni la luz de la cámara ni el aviso de pantalla compartida
// quedan encendidos al detener, cancelar o cerrar el editor.
import {
  baseMime,
  composeCanvasSize,
  computeLimits,
  drawBubbleComposite,
  levelFromSamples,
  limitState,
  pickMimeType,
  qualityPreset,
  recordErrorMessage,
  type BubbleCfg,
  type ErrorSource,
  type Limits,
  type RecordFps,
  type RecordHeight,
  type RecordMode,
} from './recordCore';

export interface RecordSettings {
  mode: RecordMode;
  height: RecordHeight;
  fps: RecordFps;
  camId?: string;
  micId?: string;
  /** grabar el micrófono (en pantalla, cámara y pantalla+cámara) */
  mic: boolean;
  /** audio del sistema (solo si el navegador lo ofrece al compartir) */
  systemAudio: boolean;
  bubble: BubbleCfg;
  /** pantalla+cámara: la cámara va en su propio clip (se edita después) en vez de en la burbuja del clip único */
  separateCam: boolean;
}

export interface RecordedClip {
  role: 'main' | 'camera';
  blob: Blob;
  mime: string;
  /** s grabados (sin las pausas) */
  duration: number;
  hasVideo: boolean;
}

export interface SupportInfo {
  recorder: boolean;
  getUserMedia: boolean;
  screen: boolean;
  /** por qué no hay captura de pantalla (si no la hay) */
  screenReason?: string;
}

/** Qué puede hacer este entorno (navegador, WebView2 de Tauri, Android). No pide ningún permiso. */
export function detectSupport(): SupportInfo {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const recorder = typeof MediaRecorder !== 'undefined';
  const getUserMedia = !!md && typeof md.getUserMedia === 'function';
  const hasDisplay = !!md && typeof md.getDisplayMedia === 'function';
  const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  let screenReason: string | undefined;
  if (!hasDisplay) screenReason = android ? 'Android no permite grabar la pantalla desde una aplicación web: usa la grabadora de pantalla del sistema e importa el archivo.' : 'Este equipo o esta versión del navegador integrado no ofrece captura de pantalla. Usa la grabadora del sistema (Windows: Win+Alt+R) e importa el archivo.';
  else if (android) screenReason = 'Android no permite grabar la pantalla desde una aplicación web: usa la grabadora de pantalla del sistema e importa el archivo.';
  return { recorder, getUserMedia, screen: hasDisplay && !android, screenReason };
}

export class RecordError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'RecordError';
  }
}

const fail = (e: unknown, src: ErrorSource): never => {
  if (e instanceof RecordError) throw e;
  const r = recordErrorMessage(e, src);
  throw new RecordError(r.message, r.code);
};

const stopStream = (s: MediaStream | null | undefined) => s?.getTracks().forEach((t) => t.stop());

/** Reloj que no se duerme en una pestaña en segundo plano (un Worker): hace falta al compartir otra ventana. */
function makeTicker(fn: () => void, fps: number): { stop: () => void } {
  try {
    const url = URL.createObjectURL(new Blob(['let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}'], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = () => fn();
    w.postMessage(1000 / fps);
    return {
      stop: () => {
        try {
          w.postMessage(0);
          w.terminate();
        } finally {
          URL.revokeObjectURL(url);
        }
      },
    };
  } catch {
    const id = setInterval(fn, 1000 / fps);
    return { stop: () => clearInterval(id) };
  }
}

export interface Tick {
  elapsed: number;
  bytes: number;
  level: number;
  state: 'ok' | 'warn' | 'stop';
}

interface Rec {
  rec: MediaRecorder;
  chunks: Blob[];
  role: 'main' | 'camera';
  hasVideo: boolean;
  mime: string;
}

export class RecordSession {
  /** vista previa en vivo: un `<video>` con este flujo, o, en pantalla+cámara, este lienzo */
  previewStream: MediaStream | null = null;
  previewCanvas: HTMLCanvasElement | null = null;
  limits: Limits = { maxSeconds: 3600, maxBytes: 2 * 1024 ** 3 };
  mime = '';
  /** avisos para la interfaz (p. ej. «sin audio del sistema») */
  notes: string[] = [];
  /** la pantalla dejó de compartirse (botón del navegador «Dejar de compartir») o una pista terminó */
  onEnded: (() => void) | null = null;

  private screen: MediaStream | null = null;
  private cam: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private canvasStream: MediaStream | null = null;
  private mixStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array<ArrayBuffer> | null = null;
  private screenEl: HTMLVideoElement | null = null;
  private camEl: HTMLVideoElement | null = null;
  private ticker: { stop: () => void } | null = null;
  private recs: Rec[] = [];
  private bubble: BubbleCfg;
  private disposed = false;
  private startedAt = 0;
  private acc = 0;
  private pausedAt = 0;
  private recording = false;
  private stopping: Promise<RecordedClip[]> | null = null;

  constructor(public readonly settings: RecordSettings) {
    this.bubble = { ...settings.bubble };
  }

  get prepared() {
    return !!this.previewStream || !!this.previewCanvas;
  }
  get isRecording() {
    return this.recording;
  }
  get isPaused() {
    return this.recording && this.pausedAt > 0;
  }
  /** pistas vivas (para comprobar que no queda ninguna tras `dispose`) */
  liveTracks(): MediaStreamTrack[] {
    return [this.screen, this.cam, this.mic, this.canvasStream, this.mixStream].flatMap((s) => (s ? s.getTracks() : [])).filter((t) => t.readyState === 'live');
  }

  setBubble(b: BubbleCfg) {
    this.bubble = { ...b };
  }

  /** Abre lo que pide el modo. Llamar solo tras un clic del usuario. Si algo falla, suelta todo y lanza `RecordError` con un mensaje legible. */
  async prepare(): Promise<void> {
    const s = this.settings;
    const sup = detectSupport();
    if (!sup.recorder) throw new RecordError('Este navegador no tiene grabación de medios (MediaRecorder).', 'unsupported');
    const q = qualityPreset(s.height, s.fps);
    const needScreen = s.mode === 'screen' || s.mode === 'screen-cam';
    const needCam = s.mode === 'camera' || s.mode === 'screen-cam';
    const needMic = s.mode === 'mic' || s.mic;
    try {
      if (needScreen) {
        if (!sup.screen) throw new RecordError(sup.screenReason ?? 'Captura de pantalla no disponible.', 'unsupported');
        try {
          this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps } }, audio: s.systemAudio });
        } catch (e) {
          fail(e, 'screen');
        }
        this.screen!.getVideoTracks()[0]?.addEventListener('ended', () => this.onEnded?.());
        if (s.systemAudio && !this.screen!.getAudioTracks().length) this.notes.push('El navegador no ofreció el audio del sistema (en Chrome hay que marcar «Compartir audio de la pestaña/del sistema» al elegir qué compartir).');
      }
      if (needCam) {
        if (!sup.getUserMedia) throw new RecordError('Este equipo no permite usar la cámara desde ChamVa.', 'unsupported');
        try {
          this.cam = await navigator.mediaDevices.getUserMedia({
            video: { ...(s.camId ? { deviceId: { exact: s.camId } } : {}), width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps } },
            audio: false,
          });
        } catch (e) {
          fail(e, 'camera');
        }
        this.cam!.getVideoTracks()[0]?.addEventListener('ended', () => this.onEnded?.());
      }
      if (needMic) {
        if (!sup.getUserMedia) throw new RecordError('Este equipo no permite usar el micrófono desde ChamVa.', 'unsupported');
        try {
          this.mic = await navigator.mediaDevices.getUserMedia({ audio: { ...(s.micId ? { deviceId: { exact: s.micId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        } catch (e) {
          fail(e, 'mic');
        }
        this.mic!.getAudioTracks()[0]?.addEventListener('ended', () => this.onEnded?.());
      }
      await this.buildGraph(needScreen && s.systemAudio);
      if (s.mode === 'screen-cam') await this.buildComposite(q.height, q.fps);
      else if (s.mode === 'screen') this.previewStream = this.screen;
      else if (s.mode === 'camera') this.previewStream = this.cam;
      else this.previewStream = this.mic;
      // formato y límites
      const kind = s.mode === 'mic' ? 'audio' : 'video';
      const mime = pickMimeType(typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported ? (m) => MediaRecorder.isTypeSupported(m) : null, kind);
      if (!mime) throw new RecordError('Este navegador no sabe grabar en ningún formato de ' + (kind === 'video' ? 'video' : 'audio') + ' compatible.', 'unsupported');
      this.mime = mime;
      let est: { quota?: number; usage?: number } | null = null;
      try {
        est = (await navigator.storage?.estimate?.()) ?? null;
      } catch {
        /* sin estimación: se usa el tope por defecto */
      }
      const lim = computeLimits(est, kind === 'video' ? q.videoBps + q.audioBps : q.audioBps);
      if (!lim.ok) throw new RecordError(lim.reason, 'quota');
      this.limits = lim.limits;
    } catch (e) {
      this.dispose();
      throw e;
    }
  }

  private async buildGraph(withSystem: boolean) {
    const sources: MediaStream[] = [];
    if (this.mic) sources.push(this.mic);
    if (withSystem && this.screen && this.screen.getAudioTracks().length) sources.push(this.screen);
    if (!sources.length) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new Ctx();
    await this.audioCtx.resume().catch(() => undefined);
    const mix = this.audioCtx.createGain();
    const dest = this.audioCtx.createMediaStreamDestination();
    for (const st of sources) this.audioCtx.createMediaStreamSource(new MediaStream(st.getAudioTracks())).connect(mix);
    mix.connect(dest);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.levelBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    mix.connect(this.analyser);
    this.mixStream = dest.stream;
  }

  private video(stream: MediaStream): HTMLVideoElement {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
    return v;
  }

  private async buildComposite(height: RecordHeight, fps: RecordFps) {
    this.screenEl = this.video(this.screen!);
    this.camEl = this.video(this.cam!);
    const st = this.screen!.getVideoTracks()[0].getSettings();
    const { w, h } = composeCanvasSize(st.width ?? 0, st.height ?? 0, height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const draw = () => {
      const sv = this.screenEl;
      const cv = this.camEl;
      drawBubbleComposite(ctx, w, h, sv && sv.videoWidth ? { el: sv, w: sv.videoWidth, h: sv.videoHeight } : null, cv && cv.videoWidth ? { el: cv, w: cv.videoWidth, h: cv.videoHeight } : null, this.bubble);
    };
    draw();
    this.ticker = makeTicker(draw, fps);
    this.previewCanvas = canvas;
    this.canvasStream = canvas.captureStream(fps);
    // espera al primer fotograma de cada origen para que la grabación no empiece en negro
    await Promise.all([this.screenEl, this.camEl].map((v) => (v!.readyState >= 2 ? Promise.resolve() : new Promise<void>((res) => { v!.onloadeddata = () => res(); setTimeout(res, 2500); }))));
    draw();
  }

  /** Nivel 0..1 del audio que se está grabando (barra del micrófono). */
  level(): number {
    if (!this.analyser || !this.levelBuf) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    return levelFromSamples(this.levelBuf);
  }

  hasAudio(): boolean {
    return !!this.mixStream || (this.settings.mode === 'screen' && !!this.screen?.getAudioTracks().length);
  }

  private makeRec(stream: MediaStream, role: 'main' | 'camera', hasVideo: boolean): Rec {
    const q = qualityPreset(this.settings.height, this.settings.fps);
    const rec = new MediaRecorder(stream, { mimeType: this.mime, ...(hasVideo ? { videoBitsPerSecond: q.videoBps } : {}), audioBitsPerSecond: q.audioBps });
    const r: Rec = { rec, chunks: [], role, hasVideo, mime: rec.mimeType || this.mime };
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) r.chunks.push(e.data);
    };
    return r;
  }

  /** Empieza a grabar (tras la cuenta atrás). */
  start(): void {
    if (this.recording || this.disposed || !this.prepared) return;
    const s = this.settings;
    const audioTracks = this.mixStream ? this.mixStream.getAudioTracks() : s.mode === 'screen' ? (this.screen?.getAudioTracks() ?? []) : [];
    const recs: Rec[] = [];
    if (s.mode === 'mic') {
      recs.push(this.makeRec(new MediaStream(audioTracks), 'main', false));
    } else if (s.mode === 'camera') {
      recs.push(this.makeRec(new MediaStream([...this.cam!.getVideoTracks(), ...audioTracks]), 'main', true));
    } else if (s.mode === 'screen') {
      recs.push(this.makeRec(new MediaStream([...this.screen!.getVideoTracks(), ...audioTracks]), 'main', true));
    } else if (s.separateCam) {
      recs.push(this.makeRec(new MediaStream([...this.screen!.getVideoTracks(), ...audioTracks]), 'main', true));
      recs.push(this.makeRec(new MediaStream(this.cam!.getVideoTracks()), 'camera', true));
    } else {
      recs.push(this.makeRec(new MediaStream([...this.canvasStream!.getVideoTracks(), ...audioTracks]), 'main', true));
    }
    this.recs = recs;
    for (const r of recs) r.rec.start(1000);
    this.startedAt = performance.now();
    this.acc = 0;
    this.pausedAt = 0;
    this.recording = true;
  }

  pause() {
    if (!this.recording || this.pausedAt) return;
    for (const r of this.recs) if (r.rec.state === 'recording') r.rec.pause();
    this.acc += performance.now() - this.startedAt;
    this.pausedAt = performance.now();
  }
  resume() {
    if (!this.recording || !this.pausedAt) return;
    for (const r of this.recs) if (r.rec.state === 'paused') r.rec.resume();
    this.startedAt = performance.now();
    this.pausedAt = 0;
  }

  /** s grabados, sin las pausas */
  elapsed(): number {
    if (!this.recording) return 0;
    return (this.acc + (this.pausedAt ? 0 : performance.now() - this.startedAt)) / 1000;
  }
  bytes(): number {
    return this.recs.reduce((n, r) => n + r.chunks.reduce((m, c) => m + c.size, 0), 0);
  }
  tick(): Tick {
    const elapsed = this.elapsed();
    const bytes = this.bytes();
    return { elapsed, bytes, level: this.level(), state: this.recording ? limitState(elapsed, bytes, this.limits) : 'ok' };
  }

  /** Detiene, junta los trozos y SUELTA todas las pistas. Se puede llamar varias veces (devuelve lo mismo). */
  stop(): Promise<RecordedClip[]> {
    if (this.stopping) return this.stopping;
    const duration = this.elapsed();
    const recs = this.recs;
    this.recording = false;
    this.stopping = (async () => {
      await Promise.all(
        recs.map(
          (r) =>
            new Promise<void>((res) => {
              if (r.rec.state === 'inactive') return res();
              r.rec.onstop = () => res();
              r.rec.onerror = () => res();
              try {
                if (r.rec.state === 'paused') r.rec.resume();
                r.rec.stop();
              } catch {
                res();
              }
            }),
        ),
      );
      const out: RecordedClip[] = recs.filter((r) => r.chunks.length).map((r) => ({ role: r.role, blob: new Blob(r.chunks, { type: baseMime(r.mime) }), mime: r.mime, duration, hasVideo: r.hasVideo }));
      this.dispose();
      return out;
    })();
    return this.stopping;
  }

  /** Suelta TODO (pistas, audio, lienzo, relojes). Idempotente. Descarta lo grabado si no se llamó a `stop()`. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.recording = false;
    for (const r of this.recs) {
      r.rec.ondataavailable = null;
      try {
        if (r.rec.state !== 'inactive') r.rec.stop();
      } catch {
        /* ya parado */
      }
    }
    this.ticker?.stop();
    this.ticker = null;
    for (const v of [this.screenEl, this.camEl]) {
      if (v) {
        v.pause();
        v.srcObject = null;
      }
    }
    this.screenEl = this.camEl = null;
    for (const s of [this.screen, this.cam, this.mic, this.canvasStream, this.mixStream]) stopStream(s);
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.analyser = null;
    this.previewStream = null;
    this.previewCanvas = null;
  }
}

/** Lista de dispositivos (las etiquetas salen vacías hasta que el usuario concede el permiso: no se pide nada aquí). */
export async function listDevices(): Promise<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return { cams: all.filter((d) => d.kind === 'videoinput'), mics: all.filter((d) => d.kind === 'audioinput') };
  } catch {
    return { cams: [], mics: [] };
  }
}
