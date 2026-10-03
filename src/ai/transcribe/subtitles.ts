// Segmentos de la transcripción → subtítulos de V4 (puro). El resultado son `Cue` (src/video/title/srt.ts):
// texto con saltos de línea y `words` con tiempos RELATIVOS al inicio del subtítulo (karaoke), listos para
// `replaceCues` (pista `subtitle`) o para exportar a SRT/VTT.
import type { Cue } from '../../video/title/srt';
import { joinWords, type AsrSegment, type AsrWord } from './windows';

export interface SubtitleLayout {
  /** caracteres por línea (def. 42, la norma habitual de subtítulos) */
  maxChars?: number;
  /** líneas por subtítulo (def. 2) */
  maxLines?: number;
  /** duración máxima de un subtítulo (s, def. 6) */
  maxDur?: number;
  /** duración mínima (s, def. 0,8): se alarga sin pisar al siguiente */
  minDur?: number;
}

/** Reparte palabras en líneas de ≤ maxChars (voraz). Una palabra más larga que la línea va sola. */
function greedyLines(words: string[], maxChars: number): string[][] {
  const lines: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    if (cur.length && joinWords([...cur, w]).length > maxChars) {
      lines.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Texto en ≤ maxLines líneas equilibradas (como en el cine: la línea más larga lo más corta posible). */
export function layoutLines(words: string[], maxChars: number, maxLines: number): string {
  const one = joinWords(words);
  if (one.length <= maxChars || maxLines <= 1 || words.length < 2) return one;
  if (maxLines === 2) {
    let best = -1;
    let bestW = Infinity;
    for (let k = 1; k < words.length; k++) {
      const a = joinWords(words.slice(0, k)).length;
      const b = joinWords(words.slice(k)).length;
      const w = Math.max(a, b);
      if (a <= maxChars && b <= maxChars && w < bestW) {
        bestW = w;
        best = k;
      }
    }
    if (best > 0) return joinWords(words.slice(0, best)) + '\n' + joinWords(words.slice(best));
  }
  return greedyLines(words, maxChars)
    .map((l) => joinWords(l))
    .join('\n');
}

const fits = (words: string[], maxChars: number, maxLines: number) => greedyLines(words, maxChars).length <= maxLines;

/**
 * Convierte segmentos en subtítulos: cada subtítulo cabe en `maxLines` × `maxChars` y dura ≤ `maxDur`.
 * Dentro de un segmento se prefiere cortar tras una coma o punto y coma cuando el subtítulo ya va lleno a más
 * de la mitad. Los subtítulos no se solapan y duran al menos `minDur` (si hay hueco).
 */
export function segmentsToSubtitles(segments: AsrSegment[], o: SubtitleLayout = {}): Cue[] {
  const maxChars = Math.max(8, o.maxChars ?? 42);
  const maxLines = Math.max(1, o.maxLines ?? 2);
  const maxDur = Math.max(0.5, o.maxDur ?? 6);
  const minDur = Math.max(0, o.minDur ?? 0.8);
  const groups: AsrWord[][] = [];
  for (const seg of segments) {
    const ws = seg.words.filter((w) => w.w.trim());
    let cur: AsrWord[] = [];
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const next = [...cur, w];
      const tooLong = cur.length > 0 && (!fits(next.map((x) => x.w), maxChars, maxLines) || w.t1 - cur[0].t0 > maxDur);
      if (tooLong) {
        // ¿hay una coma reciente donde cortar mejor?
        let cut = cur.length;
        for (let k = cur.length - 1; k >= Math.ceil(cur.length / 2); k--) {
          if (/[,;:]$/.test(cur[k].w)) {
            cut = k + 1;
            break;
          }
        }
        groups.push(cur.slice(0, cut));
        cur = [...cur.slice(cut), w];
      } else cur = next;
    }
    if (cur.length) groups.push(cur);
  }
  const cues: Cue[] = groups.map((g) => {
    const start = r3(g[0].t0);
    const end = r3(Math.max(g[g.length - 1].t1, start + 0.05));
    return {
      start,
      end,
      text: layoutLines(
        g.map((w) => w.w),
        maxChars,
        maxLines,
      ),
      words: g.map((w) => ({ text: w.w, start: r3(Math.max(0, w.t0 - start)), end: r3(Math.max(0, w.t1 - start)) })),
    };
  });
  // duración mínima sin pisar al siguiente; y nunca solapes
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const nextStart = cues[i + 1]?.start ?? Infinity;
    if (c.end > nextStart) c.end = nextStart;
    if (c.end - c.start < minDur) c.end = r3(Math.min(nextStart, c.start + minDur));
  }
  return cues;
}

/** Texto plano de toda la transcripción (un segmento por línea). */
export function segmentsToText(segments: AsrSegment[]): string {
  return segments.map((s) => s.text).join('\n');
}

/** «m:ss» o «h:mm:ss» (para progreso y estimaciones). */
export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** «43 MB», «1,2 GB» (tamaños de descarga). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  const mb = n / 1e6;
  if (mb < 1000) return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} MB`;
  return `${(mb / 1000).toFixed(1).replace('.', ',')} GB`;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
