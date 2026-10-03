// Troceo del audio para Whisper (puro, sin DOM): detección de voz por energía, ventanas de ≤ 30 s que se cortan
// en silencios, solape cuando no hay silencio donde cortar, y fusión de las palabras de ventanas vecinas sin
// duplicar. No usa ningún modelo de VAD (nada que descargar ni licencia que auditar).
//
// Cada ventana tiene un «núcleo» [coreStart, coreEnd): de su transcripción solo se quedan las palabras cuyo
// centro cae en el núcleo. Los núcleos de ventanas consecutivas se tocan sin solaparse, así que cada palabra
// queda en exactamente una ventana aunque Whisper la haya oído en las dos.

export const ASR_RATE = 16000;
/** Whisper procesa 30 s por pasada. */
export const MAX_WINDOW = 30;

export interface Region {
  start: number;
  end: number;
}

export interface AsrWindow {
  /** s del audio que se le pasa al modelo */
  start: number;
  end: number;
  /** s: tramo del que se aceptan palabras */
  coreStart: number;
  coreEnd: number;
}

export interface AsrWord {
  /** s absolutos */
  t0: number;
  t1: number;
  w: string;
}

export interface AsrSegment {
  start: number;
  end: number;
  text: string;
  words: AsrWord[];
}

export interface VadOptions {
  /** ms por trama de análisis (def. 30) */
  frameMs?: number;
  /** dB por encima del ruido de fondo para considerar voz (def. 12) */
  marginDb?: number;
  /** dBFS mínimo absoluto para ser voz (def. −50) */
  floorDb?: number;
  /** silencios más cortos que esto (s) no separan (def. 0,35) */
  minGap?: number;
  /** regiones de voz más cortas que esto (s) se descartan (def. 0,12) */
  minSpeech?: number;
  /** relleno (s) a cada lado de cada región (def. 0,2) */
  pad?: number;
}

/** Regiones con voz según la energía por tramas (umbral adaptativo al ruido de fondo). */
export function detectSpeech(pcm: Float32Array, rate = ASR_RATE, o: VadOptions = {}): Region[] {
  const frame = Math.max(1, Math.round(((o.frameMs ?? 30) / 1000) * rate));
  const n = Math.floor(pcm.length / frame);
  if (!n) return [];
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * frame, e = j + frame; j < e; j++) s += pcm[j] * pcm[j];
    db[i] = 10 * Math.log10(s / frame + 1e-12);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.1)];
  const thr = Math.max(o.floorDb ?? -50, noise + (o.marginDb ?? 12));
  const fs = frame / rate;
  const raw: Region[] = [];
  let cur: Region | null = null;
  for (let i = 0; i < n; i++) {
    if (db[i] >= thr) {
      if (cur) cur.end = (i + 1) * fs;
      else cur = { start: i * fs, end: (i + 1) * fs };
    } else if (cur) {
      raw.push(cur);
      cur = null;
    }
  }
  if (cur) raw.push(cur);
  const minGap = o.minGap ?? 0.35;
  const merged: Region[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < minGap) last.end = r.end;
    else merged.push({ ...r });
  }
  const dur = pcm.length / rate;
  const pad = o.pad ?? 0.2;
  const out: Region[] = [];
  for (const r of merged) {
    if (r.end - r.start < (o.minSpeech ?? 0.12)) continue;
    const a = Math.max(0, r.start - pad);
    const b = Math.min(dur, r.end + pad);
    const last = out[out.length - 1];
    if (last && a <= last.end) last.end = b;
    else out.push({ start: a, end: b });
  }
  return out;
}

export interface PlanOptions {
  /** s máximos por ventana (def. 30) */
  maxWindow?: number;
  /** s de solape cuando hay que cortar en plena voz (def. 2) */
  overlap?: number;
}

/**
 * Ventanas para transcribir `speech` (regiones de voz ordenadas). Se agrupan regiones mientras quepan en
 * `maxWindow`; el corte entre ventanas cae en mitad del silencio que las separa. Una región más larga que
 * `maxWindow` se parte en ventanas con `overlap` s de solape y el límite de núcleo en mitad del solape.
 * El silencio no se transcribe (Whisper inventa frases en el silencio).
 */
export function planWindows(speech: Region[], o: PlanOptions = {}): AsrWindow[] {
  const maxW = o.maxWindow ?? MAX_WINDOW;
  const ov = Math.min(o.overlap ?? 2, maxW / 4);
  const pieces: Region[] = [];
  // 1) partir las regiones largas
  const longParts = new Map<Region, true>();
  for (const r of speech) {
    if (r.end - r.start <= maxW) {
      pieces.push({ ...r });
      continue;
    }
    const step = maxW - ov;
    for (let s = r.start; s < r.end; s += step) {
      const e = Math.min(r.end, s + maxW);
      const p = { start: s, end: e };
      longParts.set(p, true);
      pieces.push(p);
      if (e >= r.end) break;
    }
  }
  // 2) agrupar piezas cortas consecutivas
  const groups: Region[][] = [];
  for (const p of pieces) {
    const g = groups[groups.length - 1];
    if (g && !longParts.has(p) && !longParts.has(g[g.length - 1]) && p.end - g[0].start <= maxW) g.push(p);
    else groups.push([p]);
  }
  const wins: AsrWindow[] = groups.map((g) => ({ start: g[0].start, end: g[g.length - 1].end, coreStart: g[0].start, coreEnd: g[g.length - 1].end }));
  // 3) límites de núcleo: mitad del hueco (silencio) o mitad del solape
  for (let i = 1; i < wins.length; i++) {
    const a = wins[i - 1];
    const b = wins[i];
    const mid = (a.end + b.start) / 2;
    a.coreEnd = mid;
    b.coreStart = mid;
  }
  if (wins.length) {
    wins[0].coreStart = -Infinity;
    wins[wins.length - 1].coreEnd = Infinity;
  }
  return wins;
}

/** Ventanas a partir del audio entero (VAD + plan). Sin voz detectable → nada que transcribir. */
export function windowsForAudio(pcm: Float32Array, rate = ASR_RATE, o: VadOptions & PlanOptions = {}): AsrWindow[] {
  return planWindows(detectSpeech(pcm, rate, o), o);
}

/**
 * Fusiona las palabras de todas las ventanas (tiempos ya absolutos): se queda con las que tienen el centro en
 * el núcleo de su ventana y, por si el modelo estira una palabra sobre el límite, quita la repetición exacta
 * (mismo texto normalizado y tiempos a < 0,25 s) en la frontera.
 */
export function mergeWindowWords(perWindow: { win: AsrWindow; words: AsrWord[] }[]): AsrWord[] {
  const out: AsrWord[] = [];
  for (const { win, words } of perWindow) {
    for (const w of words) {
      const c = (w.t0 + w.t1) / 2;
      if (c < win.coreStart || c >= win.coreEnd) continue;
      const prev = out[out.length - 1];
      if (prev && norm(prev.w) === norm(w.w) && Math.abs(prev.t0 - w.t0) < 0.25) continue;
      if (prev && w.t0 < prev.t1) {
        // solape leve: no dejar tiempos que retroceden
        const t0 = Math.max(prev.t0, w.t0);
        out.push({ ...w, t0, t1: Math.max(t0, w.t1) });
        prev.t1 = Math.min(prev.t1, t0);
        continue;
      }
      out.push({ ...w });
    }
  }
  return out;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Palabras de Whisper (`chunks` de Transformers.js con `return_timestamps: 'word'`, tiempos relativos a la
 * ventana) → palabras absolutas. Quita vacíos, arregla finales nulos o al revés y recorta a la ventana.
 */
export function wordsFromChunks(chunks: { text: string; timestamp: [number | null, number | null] }[], win: AsrWindow): AsrWord[] {
  const len = win.end - win.start;
  const out: AsrWord[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const w = ch.text.trim();
    if (!w) continue;
    let a = ch.timestamp[0] ?? (out.length ? out[out.length - 1].t1 - win.start : 0);
    let b = ch.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? Math.min(len, a + 0.4);
    a = Math.min(Math.max(0, a), len);
    b = Math.min(Math.max(a, b), len);
    out.push({ t0: round3(win.start + a), t1: round3(win.start + b), w });
  }
  return out;
}

/**
 * Afina los tiempos de Whisper con la energía del audio. Las marcas por palabra de Whisper (alineación DTW sobre
 * la atención cruzada, resolución 20 ms) suelen llegar 0,2–0,4 s TARDE al inicio de cada palabra y estirar la
 * última palabra antes de una pausa. Medido en Chromium (V5a): con este ajuste el error mediano baja a menos
 * de la mitad cuando hay pausas entre palabras; en habla continua (sin silencio) no cambia nada.
 *  - inicio: si entre el inicio de la palabra anterior y el de esta hay un arranque de voz (silencio → voz)
 *    a ≤ `maxShift` s antes, la palabra empieza ahí;
 *  - final: si la voz se apaga antes del final marcado, la palabra acaba al apagarse.
 * `offset` = s del audio donde empieza `pcm` (las palabras van en tiempo absoluto).
 */
export function refineWordTimes(words: AsrWord[], pcm: Float32Array, rate = ASR_RATE, o: { offset?: number; maxShift?: number; marginDb?: number; lag?: number } = {}): AsrWord[] {
  if (!words.length || !pcm.length) return words;
  const off = o.offset ?? 0;
  const maxShift = o.maxShift ?? 0.5;
  // retraso típico de Whisper: entre varios arranques posibles se elige el más cercano a (inicio − lag)
  const lag = o.lag ?? 0.2;
  const hop = Math.round(rate * 0.01); // 10 ms
  const n = Math.floor(pcm.length / hop);
  if (n < 3) return words;
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop, e = j + hop; j < e; j++) s += pcm[j] * pcm[j];
    db[i] = 10 * Math.log10(s / hop + 1e-12);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.1)];
  const peak = sorted[Math.floor(sorted.length * 0.95)];
  // umbral entre el ruido y la voz (si apenas hay contraste, no se toca nada)
  if (peak - noise < 15) return words;
  const thr = Math.max(noise + (o.marginDb ?? 12), peak - 35);
  const voiced = (f: number) => f >= 0 && f < n && db[f] >= thr;
  const frameOf = (t: number) => Math.round((t - off) / 0.01);
  const timeOf = (f: number) => round3(off + f * 0.01);
  const out = words.map((w) => ({ ...w }));
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    const prev = out[i - 1];
    // inicio: arranque de voz más cercano por detrás (o justo delante, 50 ms)
    const lo = Math.max(frameOf(w.t0 - maxShift), prev ? frameOf(prev.t0) + 5 : 0, 1);
    const hi = Math.min(frameOf(w.t0) + 5, n - 1);
    const target = frameOf(w.t0 - lag);
    let onset = -1;
    for (let f = hi; f >= lo; f--) if (voiced(f) && !voiced(f - 1) && (onset < 0 || Math.abs(f - target) < Math.abs(onset - target))) onset = f;
    if (onset >= 0) {
      const t = timeOf(onset);
      if (!prev || t >= prev.t0 + 0.05) {
        w.t0 = t;
        if (prev && prev.t1 > t) prev.t1 = t;
        if (w.t1 < w.t0) w.t1 = w.t0;
      }
    }
    // final: si la voz se apaga dentro de la palabra (tras al menos 60 ms de voz), cortar ahí
    const f0 = Math.max(0, frameOf(w.t0));
    const f1 = Math.min(n - 1, frameOf(w.t1));
    let seenVoice = 0;
    for (let f = f0; f <= f1; f++) {
      if (voiced(f)) seenVoice++;
      else if (seenVoice >= 6) {
        // silencio de al menos 150 ms: la palabra ya terminó
        let k = f;
        while (k <= f1 && !voiced(k)) k++;
        if (k - f >= 15 || k > f1) {
          w.t1 = timeOf(f);
          break;
        }
      }
    }
  }
  return out;
}

export interface SegmentOptions {
  /** un hueco mayor que esto (s) entre palabras empieza segmento (def. 0,8) */
  gap?: number;
  /** duración máxima de un segmento (s, def. 12) */
  maxDur?: number;
}

/** Agrupa las palabras en segmentos (frases): corta en fin de frase, en pausas largas o al pasar `maxDur`. */
export function buildSegments(words: AsrWord[], o: SegmentOptions = {}): AsrSegment[] {
  const gap = o.gap ?? 0.8;
  const maxDur = o.maxDur ?? 12;
  const segs: AsrSegment[] = [];
  let cur: AsrWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    segs.push({ start: cur[0].t0, end: cur[cur.length - 1].t1, text: joinWords(cur.map((w) => w.w)), words: cur });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (w.t0 - last.t1 > gap || w.t1 - cur[0].t0 > maxDur)) flush();
    cur.push(w);
    if (/[.!?…。？！]["»”')\]]*$/.test(w.w)) flush();
  }
  flush();
  return segs;
}

/** Une palabras con espacios, sin espacio antes de la puntuación de cierre. */
export function joinWords(ws: string[]): string {
  return ws
    .join(' ')
    .replace(/\s+([,.;:!?…%)\]»”])/g, '$1')
    .replace(/([¿¡(«“[])\s+/g, '$1')
    .trim();
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
