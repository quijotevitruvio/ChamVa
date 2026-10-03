// Karaoke: qué palabra está activa en cada instante (puro).
import type { Karaoke, WordTime } from '../model/types';

export interface WordSpan {
  text: string;
  /** posición en el texto (índices UTF-16): [from, to) */
  from: number;
  to: number;
}

/** Palabras de un texto (separadas por espacios y saltos de línea) con su posición. */
export function splitWords(text: string): WordSpan[] {
  const out: WordSpan[] = [];
  const re = /\S+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ text: m[0], from: m.index, to: m.index + m[0].length });
  return out;
}

/**
 * Tiempo de cada palabra, relativo al inicio del clip. Si el clip trae `words` con el mismo número de palabras
 * que el texto actual, se usan; si no (texto editado, o sin tiempos), el tiempo `dur` se reparte entre las
 * palabras en proporción a sus letras.
 */
export function wordTimings(text: string, dur: number, words?: WordTime[]): WordTime[] {
  const spans = splitWords(text);
  if (words && words.length === spans.length && spans.length > 0) return spans.map((s, i) => ({ text: s.text, start: words[i].start, end: words[i].end }));
  const total = spans.reduce((a, s) => a + Array.from(s.text).length + 1, 0) || 1;
  let acc = 0;
  return spans.map((s) => {
    const w = Array.from(s.text).length + 1;
    const start = (acc / total) * dur;
    acc += w;
    return { text: s.text, start, end: (acc / total) * dur };
  });
}

/** Índice de la palabra activa en lt (-1 = ninguna todavía). Tras la última palabra sigue la última. */
export function activeWordIndex(times: WordTime[], lt: number): number {
  let idx = -1;
  for (let i = 0; i < times.length; i++) {
    if (lt >= times[i].start) idx = i;
    else break;
  }
  return idx;
}

export interface WordKaraoke {
  /** es la palabra que se está diciendo ahora */
  active: boolean;
  /** ya se dijo (y el karaoke pide conservar el color) */
  spoken: boolean;
  /** color distinto del normal */
  colored: boolean;
  /** multiplicador de escala (1 = normal), suavizado 0,08 s al entrar y al salir */
  scale: number;
}

const RAMP = 0.08;

export function wordKaraoke(k: Karaoke, times: WordTime[], i: number, lt: number): WordKaraoke {
  const w = times[i];
  if (!w) return { active: false, spoken: false, colored: false, scale: 1 };
  const next = times[i + 1];
  // La palabra sigue activa hasta que empieza la siguiente (los huecos entre palabras no apagan el resaltado)
  const end = next ? Math.max(w.end, next.start) : Math.max(w.end, w.start);
  const active = lt >= w.start && lt < end + (next ? 0 : 1e-9);
  const spoken = !active && lt >= end;
  let amount = 0;
  if (active) amount = Math.min(1, (lt - w.start) / RAMP, (end - lt) / RAMP);
  return {
    active,
    spoken,
    colored: active || (k.keep && spoken),
    scale: 1 + (k.scale - 1) * Math.max(0, amount),
  };
}
