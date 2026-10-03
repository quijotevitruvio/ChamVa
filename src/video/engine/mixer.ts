// Mezclador de la línea de tiempo en streaming: produce el audio final bloque a
// bloque (48 kHz estéreo) a medida que avanza el video. Cada fuente se abre al
// llegar a su tramo y se cierra al salir, así que en memoria solo hay unos
// segundos de audio, no el proyecto entero (antes: OfflineAudioContext con toda
// la duración + cada archivo decodificado completo, una vez por clip).
import { ClipChain, MasterChain, type ClipAudioFx } from './dsp';

/** Fuente de audio ya decodificada que se puede leer remuestreada. */
export interface PcmSource {
  /**
   * Escribe n muestras empezando en el instante `srcStart` (s del archivo) y
   * avanzando `step` s de archivo por muestra de salida (velocidad / 48 kHz).
   * Debe llamarse con tiempos crecientes. Devuelve silencio donde no hay datos.
   */
  read(srcStart: number, step: number, n: number, L: Float32Array, R: Float32Array): Promise<void>;
  close(): void;
}

export interface MixEntry {
  start: number; // s de la línea de tiempo
  end: number;
  inP: number;
  outP: number;
  speed: number;
  fx: ClipAudioFx;
  /** Abre la fuente (null = el archivo no tiene audio). */
  open: () => Promise<PcmSource | null>;
}

interface Active {
  e: MixEntry;
  src: PcmSource | null;
  chain: ClipChain;
}

export class TimelineMixer {
  private pos = 0; // muestra de salida siguiente
  private active = new Map<MixEntry, Active>();
  private done = new Set<MixEntry>();
  private tmpL = new Float32Array(0);
  private tmpR = new Float32Array(0);
  readonly master: MasterChain;
  readonly totalSamples: number;

  constructor(
    private entries: MixEntry[],
    master: { eq: { low: number; mid: number; high: number }; normalize: boolean },
    duration: number,
    readonly sampleRate = 48000,
  ) {
    this.master = new MasterChain(master.eq, master.normalize, sampleRate);
    this.totalSamples = Math.round(duration * sampleRate);
  }

  get position(): number {
    return this.pos;
  }
  get finished(): boolean {
    return this.pos >= this.totalSamples;
  }

  /** Devuelve las siguientes n muestras (o menos al final). */
  async render(n: number): Promise<{ L: Float32Array; R: Float32Array; frames: number; startSample: number }> {
    const sr = this.sampleRate;
    const count = Math.max(0, Math.min(n, this.totalSamples - this.pos));
    const L = new Float32Array(count);
    const R = new Float32Array(count);
    if (this.tmpL.length < count) {
      this.tmpL = new Float32Array(count);
      this.tmpR = new Float32Array(count);
    }
    const t0 = this.pos / sr;
    const t1 = (this.pos + count) / sr;
    for (const e of this.entries) {
      if (this.done.has(e)) continue;
      let a = this.active.get(e);
      const tailEnd = e.end + (a ? a.chain.tail : e.fx.echo > 0 ? 2 : 0);
      if (e.start >= t1) continue; // todavía no empieza
      if (t0 >= tailEnd) {
        // terminó (incluida la cola del eco)
        if (a) {
          a.src?.close();
          this.active.delete(e);
        }
        this.done.add(e);
        continue;
      }
      if (!a) {
        a = { e, src: await e.open(), chain: new ClipChain(e.fx, sr) };
        this.active.set(e, a);
      }
      const tl = this.tmpL.subarray(0, count);
      const tr = this.tmpR.subarray(0, count);
      tl.fill(0);
      tr.fill(0);
      // Tramo del bloque que cae dentro del clip (fuera: silencio, pero la cadena sigue para la cola).
      const firstIn = Math.max(0, Math.ceil(e.start * sr - this.pos - 1e-6));
      const lastIn = Math.min(count, Math.ceil(e.end * sr - this.pos - 1e-6));
      if (a.src && lastIn > firstIn) {
        const step = (e.speed || 1) / sr;
        const tStart = (this.pos + firstIn) / sr;
        const srcStart = e.inP + (tStart - e.start) * (e.speed || 1);
        const k = lastIn - firstIn;
        await a.src.read(srcStart, step, k, tl.subarray(firstIn, lastIn), tr.subarray(firstIn, lastIn));
        // Nada más allá del punto de salida del clip.
        for (let i = firstIn; i < lastIn; i++) {
          const s = srcStart + (i - firstIn) * step;
          if (s >= e.outP) {
            tl[i] = 0;
            tr[i] = 0;
          }
        }
      }
      a.chain.process(tl, tr, count);
      for (let i = 0; i < count; i++) {
        L[i] += tl[i];
        R[i] += tr[i];
      }
    }
    this.master.process(L, R, count);
    const startSample = this.pos;
    this.pos += count;
    return { L, R, frames: count, startSample };
  }

  close() {
    for (const a of this.active.values()) a.src?.close();
    this.active.clear();
  }
}

/** Entradas de mezcla: audio de cada tramo de video + pista de audio en secuencia desde 0. */
export function buildMixEntries<C extends { inP: number; outP: number; speed: number } & ClipAudioFx>(
  videoSegs: { clip: C; start: number; end: number }[],
  audioClips: C[],
  duration: number,
  open: (clip: C) => () => Promise<PcmSource | null>,
): MixEntry[] {
  const out: MixEntry[] = [];
  for (const s of videoSegs)
    out.push({ start: s.start, end: s.end, inP: s.clip.inP, outP: s.clip.outP, speed: s.clip.speed || 1, fx: fxOf(s.clip), open: open(s.clip) });
  let at = 0;
  for (const c of audioClips) {
    if (at >= duration) break;
    const dur = Math.max(0.01, (c.outP - c.inP) / (c.speed || 1));
    out.push({ start: at, end: Math.min(duration, at + dur), inP: c.inP, outP: c.outP, speed: c.speed || 1, fx: fxOf(c), open: open(c) });
    at += dur;
  }
  return out;
}

const fxOf = (c: ClipAudioFx): ClipAudioFx => ({ volume: c.volume, hp: c.hp, lp: c.lp, echo: c.echo, gate: !!c.gate });
