// Invertir un clip de video SIN agotar la memoria (V8).
//
// Un decodificador solo avanza, así que para ir hacia atrás se decodifica por GOP (de un fotograma clave al siguiente) y
// se sirven los fotogramas en orden inverso. Un GOP entero no cabe en memoria si es largo (1080p: ~3 MB por fotograma ×
// 250), así que de cada pasada solo se conservan los `maxHeld` fotogramas más altos por debajo del pedido, que es lo que
// se va a necesitar a continuación; cuando la ventana se agota se vuelve a decodificar el GOP desde su clave para sacar la
// ventana de debajo. Coste: GOP·(1 + GOP/maxHeld) decodificaciones por GOP; memoria: maxHeld fotogramas (más los de la
// cola del decodificador), da igual lo largo que sea el clip.
//
// `ReverseFrameCore` es genérico (fotogramas falsos en las pruebas); `ReverseFrameSource` lo conecta a WebCodecs.
import { BlobReader } from './byteReader';
import { type SampleTable, type VideoTrackInfo } from './demux';
import type { DrawableFrame, FrameSource } from './videoSource';

/** Presupuesto de memoria de fotogramas retenidos (bytes aproximados, YUV 4:2:0). */
export const REVERSE_BUDGET_BYTES = 96 << 20;
export const REVERSE_MIN_HELD = 3;
export const REVERSE_MAX_HELD = 24;

/** Cuántos fotogramas se retienen por pasada según el tamaño del fotograma. */
export function heldFramesFor(width: number, height: number): number {
  const bytes = Math.max(1, width * height * 1.5);
  return Math.max(REVERSE_MIN_HELD, Math.min(REVERSE_MAX_HELD, Math.floor(REVERSE_BUDGET_BYTES / bytes)));
}

/** Límites de invertir (avisos y tope). */
export const REVERSE_WARN_SECONDS = 300;
export const REVERSE_MAX_SECONDS = 3600;
export const REVERSE_WARN_GOP = 250;

export interface ReverseCheck {
  ok: boolean;
  /** avisos en español para el usuario (vacío = nada que decir) */
  warnings: string[];
}

/** ¿Se puede invertir un tramo de `seconds` s de archivo con GOP de `gopFrames` fotogramas como máximo? */
export function reverseCheck(seconds: number, gopFrames = 0, width = 1920, height = 1080): ReverseCheck {
  const warnings: string[] = [];
  if (seconds > REVERSE_MAX_SECONDS) return { ok: false, warnings: [`Invertir un tramo de más de ${REVERSE_MAX_SECONDS / 60} minutos no está permitido: recórtalo antes.`] };
  if (seconds > REVERSE_WARN_SECONDS) warnings.push(`Invertir ${Math.round(seconds / 60)} min de video es lento: se decodifica por bloques y la exportación tardará bastante más.`);
  if (gopFrames > REVERSE_WARN_GOP) {
    const k = heldFramesFor(width, height);
    warnings.push(`Este video tiene fotogramas clave muy separados (${gopFrames} fotogramas): invertirlo costará ~${Math.ceil(gopFrames / k)} veces más decodificación.`);
  }
  return { ok: true, warnings };
}

/** Mayor longitud de GOP (en fotogramas) de una tabla de muestras. */
export function maxGopFrames(s: Pick<SampleTable, 'count' | 'key'>): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < s.count; i++) {
    if (s.key[i]) run = 0;
    run++;
    if (run > best) best = run;
  }
  return best;
}

export interface ReverseStats {
  /** fotogramas decodificados en total */
  decoded: number;
  /** máximo de fotogramas vivos a la vez (retenidos + en tránsito) */
  peakAlive: number;
  /** pasadas de decodificación */
  passes: number;
}

/** Diagnóstico global (banco de pruebas): máximo de fotogramas vivos y decodificados entre todas las fuentes invertidas cerradas. */
export const reverseDebug = { peakAlive: 0, decoded: 0, passes: 0, sources: 0 };

type GopDecode<F> = (i0: number, i1: number, onFrame: (ptsSec: number, f: F) => void) => Promise<void>;

interface Held<F> {
  pts: number;
  f: F;
  dead: boolean;
  /** la adopción (copia fuera del decodificador) está en curso */
  adopting: boolean;
}

/**
 * Núcleo independiente del decodificador: decide qué GOP decodificar y qué fotogramas conservar.
 * `adopt` (opcional) saca el fotograma retenido del grupo del decodificador (copiándolo a un ImageBitmap): los decodificadores
 * de WebCodecs se atascan si se retienen muchos VideoFrame, y aquí se retiene una ventana entera.
 */
export class ReverseFrameCore<F> {
  readonly stats: ReverseStats = { decoded: 0, peakAlive: 0, passes: 0 };
  /** muestras en orden de presentación */
  private order: Int32Array;
  private sortedPts: Float64Array;
  private gopOf: Int32Array;
  private gopStart: number[] = [];
  private held: Held<F>[] = []; // ascendente por pts
  private pending: Promise<void>[] = [];
  private alive = 0;
  private closed = false;

  constructor(
    private samples: Pick<SampleTable, 'count' | 'pts' | 'key'>,
    private decode: GopDecode<F>,
    private closeFrame: (f: F) => void,
    private maxHeld: number,
    private adopt?: (f: F) => Promise<F>,
  ) {
    const n = samples.count;
    this.order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => samples.pts[a] - samples.pts[b]);
    this.sortedPts = new Float64Array(n);
    for (let i = 0; i < n; i++) this.sortedPts[i] = samples.pts[this.order[i]];
    this.gopOf = new Int32Array(n);
    let g = -1;
    for (let i = 0; i < n; i++) {
      if (samples.key[i] || g < 0) {
        g++;
        this.gopStart.push(i);
      }
      this.gopOf[i] = g;
    }
  }

  get heldCount(): number {
    return this.held.length;
  }

  private drop(h: Held<F>) {
    h.dead = true;
    this.alive--;
    if (!h.adopting) this.closeFrame(h.f); // si se está adoptando, la adopción cierra la copia al terminar
  }

  /** Fotograma visible en el instante `t` (s del archivo): el último con pts ≤ t (+0,5 ms, como el decodificador de la exportación). */
  async frameAt(t: number): Promise<{ pts: number; f: F } | null> {
    const n = this.samples.count;
    if (!n || this.closed) return null;
    const tol = t + 0.0005;
    // índice (en orden de presentación) del último con pts ≤ tol; si t es anterior a todo, el primero
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.sortedPts[m] <= tol) lo = m;
      else hi = m - 1;
    }
    const sample = this.order[lo];
    const target = this.sortedPts[lo];
    const hit = this.held.find((h) => Math.abs(h.pts - target) < 1e-6);
    if (hit) return hit;
    const g = this.gopOf[sample];
    const i0 = this.gopStart[g];
    const i1 = g + 1 < this.gopStart.length ? this.gopStart[g + 1] : n;
    // lo que había se suelta ANTES de decodificar: la memoria no sube por encima de la ventana
    for (const h of this.held) this.drop(h);
    this.held = [];
    this.stats.passes++;
    const K = this.maxHeld;
    // ventana que se necesita: los K fotogramas más altos del GOP que no pasan de `target` (se sabe por la tabla de muestras)
    const cands: number[] = [];
    for (let i = i0; i < i1; i++) if (this.samples.pts[i] <= target + 1e-6) cands.push(this.samples.pts[i]);
    cands.sort((a, b) => b - a);
    const lowCut = cands[Math.min(K, cands.length) - 1] ?? target;
    this.pending = [];
    await this.decode(i0, i1, (pts, f) => {
      this.alive++;
      this.stats.decoded++;
      if (this.alive > this.stats.peakAlive) this.stats.peakAlive = this.alive;
      const h: Held<F> = { pts, f, dead: false, adopting: false };
      if (pts > target + 1e-6 || pts < lowCut - 1e-6 || this.closed) {
        this.alive--;
        this.closeFrame(f);
        return;
      }
      let k = this.held.length;
      while (k > 0 && this.held[k - 1].pts > pts) k--;
      this.held.splice(k, 0, h);
      if (this.held.length > K) this.drop(this.held.shift()!);
      if (this.adopt && !h.dead) {
        h.adopting = true;
        this.pending.push(
          this.adopt(f).then((nf) => {
            h.adopting = false;
            if (h.dead) this.closeFrame(nf);
            else h.f = nf;
          }),
        );
      }
    });
    await Promise.all(this.pending);
    this.pending = [];
    return this.held.find((h) => Math.abs(h.pts - target) < 1e-6) ?? this.held[this.held.length - 1] ?? null;
  }

  close() {
    this.closed = true;
    for (const h of this.held) this.drop(h);
    this.held = [];
  }

  /** Conversiones en curso (para el control de flujo del decodificador). */
  get converting(): number {
    return this.held.filter((h) => h.adopting).length;
  }
}

/** Fotograma retenido de la fuente real: el bitmap (o el VideoFrame mientras se copia). */
interface RealFrame {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Configuración de decodificador para invertir: software primero (no se atasca reteniendo fotogramas). */
async function reverseConfig(cfg: VideoDecoderConfig): Promise<VideoDecoderConfig> {
  try {
    const sw = { ...cfg, hardwareAcceleration: 'prefer-software' as const };
    if ((await VideoDecoder.isConfigSupported(sw)).supported) return sw;
  } catch {
    /* se usa la dada */
  }
  return cfg;
}

const STALL_MS = 20000;
const STALL_MSG = 'El decodificador de video se atascó al invertir el clip';

/** Invertir con WebCodecs: una pasada de VideoDecoder por GOP (o ventana de GOP). */
export class ReverseFrameSource implements FrameSource {
  private core: ReverseFrameCore<RealFrame>;
  private reader: BlobReader;
  private config: Promise<VideoDecoderConfig>;
  lastTime = Infinity;

  constructor(
    private track: VideoTrackInfo,
    blob: Blob,
    config: VideoDecoderConfig,
    maxHeld = heldFramesFor(track.codedWidth || 1920, track.codedHeight || 1080),
  ) {
    this.reader = new BlobReader(blob, 8 << 20);
    this.config = reverseConfig(config);
    this.core = new ReverseFrameCore<RealFrame>(
      track.samples,
      (a, b, on) => this.decodeRange(a, b, on),
      (f) => f.close(),
      maxHeld,
      async (f) => {
        // copia a ImageBitmap y suelta el VideoFrame (el decodificador sigue con su grupo libre)
        const vf = f.image as VideoFrame;
        try {
          const bmp = await createImageBitmap(vf);
          return { image: bmp, width: f.width, height: f.height, close: () => bmp.close() };
        } finally {
          vf.close();
        }
      },
    );
  }

  get stats(): ReverseStats {
    return this.core.stats;
  }

  private async decodeRange(i0: number, i1: number, onFrame: (pts: number, f: RealFrame) => void): Promise<void> {
    let error: Error | null = null;
    let wake: (() => void) | null = null;
    const decoder = new VideoDecoder({
      output: (f) => onFrame(f.timestamp / 1e6, { image: f, width: f.displayWidth, height: f.displayHeight, close: () => f.close() }),
      error: (e) => {
        error = e instanceof Error ? e : new Error(String(e));
        wake?.();
      },
    });
    decoder.configure(await this.config);
    decoder.addEventListener?.('dequeue', () => wake?.());
    const s = this.track.samples;
    try {
      for (let i = i0; i < i1; i++) {
        if (error) throw error;
        const data = await this.reader.read(s.offset[i], s.size[i]);
        decoder.decode(new EncodedVideoChunk({ type: s.key[i] ? 'key' : 'delta', timestamp: Math.round(s.pts[i] * 1e6), duration: s.dur[i] ? Math.round(s.dur[i] * 1e6) : undefined, data }));
        const t0 = performance.now();
        while ((decoder.decodeQueueSize > 6 || this.core.converting > 4) && !error) {
          if (performance.now() - t0 > STALL_MS) throw new Error(STALL_MSG);
          await new Promise<void>((res) => ((wake = res), setTimeout(res, 20)));
        }
      }
      await Promise.race([decoder.flush(), new Promise((_, rej) => setTimeout(() => rej(new Error(STALL_MSG)), STALL_MS))]);
      if (error) throw error;
    } finally {
      try {
        if (decoder.state !== 'closed') decoder.close();
      } catch {
        /* noop */
      }
    }
  }

  async frameAt(t: number): Promise<DrawableFrame | null> {
    this.lastTime = t;
    const r = await this.core.frameAt(t);
    if (!r) return null;
    return { image: r.f.image, width: r.f.width, height: r.f.height, rotation: this.track.rotation };
  }

  close() {
    const st = this.core.stats;
    reverseDebug.peakAlive = Math.max(reverseDebug.peakAlive, st.peakAlive);
    reverseDebug.decoded += st.decoded;
    reverseDebug.passes += st.passes;
    reverseDebug.sources++;
    this.core.close();
  }
}
