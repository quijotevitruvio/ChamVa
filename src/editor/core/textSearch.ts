// Buscar y reemplazar en capas de texto, contador y tiempo de lectura. Puro.
import type { Layer, TextLayer } from './types';
import { remapSpans, type TextSpan } from './richText';

export interface SearchOptions {
  matchCase?: boolean; // distingue mayúsculas Y acentos
  wholeWord?: boolean;
}

export interface Match {
  start: number;
  end: number;
}

// Pliega una unidad UTF-16 a minúscula y sin acento SIN cambiar la longitud del
// texto, para que los índices del texto plegado valgan en el original.
function foldUnit(ch: string): string {
  const base = ch.normalize('NFD')[0] ?? ch;
  return base.toLowerCase()[0] ?? base;
}
function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += foldUnit(s[i]);
  return out;
}

const WORD = /[\p{L}\p{N}_]/u;
const isWordChar = (c: string | undefined) => !!c && WORD.test(c);

export function findMatches(text: string, query: string, opts: SearchOptions = {}): Match[] {
  if (!query) return [];
  const hay = opts.matchCase ? text : fold(text);
  const needle = opts.matchCase ? query : fold(query);
  const out: Match[] = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    const end = i + needle.length;
    if (opts.wholeWord && (isWordChar(text[i - 1]) || isWordChar(text[end]))) {
      from = i + 1;
      continue;
    }
    out.push({ start: i, end });
    from = end;
  }
  return out;
}

export interface LayerMatch extends Match {
  layerId: string;
  index: number; // posición de la coincidencia dentro de su capa
}

export function findInLayers(layers: Layer[], query: string, opts: SearchOptions = {}): LayerMatch[] {
  const out: LayerMatch[] = [];
  for (const l of layers) {
    if (l.type !== 'text') continue;
    findMatches(l.text, query, opts).forEach((m, index) => out.push({ ...m, layerId: l.id, index }));
  }
  return out;
}

export interface Replaced {
  text: string;
  spans: TextSpan[] | undefined;
  count: number;
}

// Sustituye coincidencias conservando el estilo por palabra (spans). `only`
// limita el reemplazo a la coincidencia n-ésima de la capa. Se va de la última a
// la primera para que los índices anteriores sigan valiendo.
export function replaceInText(
  text: string,
  spans: TextSpan[] | undefined,
  query: string,
  replacement: string,
  opts: SearchOptions = {},
  only?: number,
): Replaced {
  const ms = findMatches(text, query, opts);
  let cur = text;
  let curSpans = spans;
  let count = 0;
  for (let k = ms.length - 1; k >= 0; k--) {
    if (only !== undefined && k !== only) continue;
    const m = ms[k];
    const next = cur.slice(0, m.start) + replacement + cur.slice(m.end);
    curSpans = remapSpans(curSpans, cur, next);
    cur = next;
    count++;
  }
  return { text: cur, spans: curSpans, count };
}

export function replaceInLayer(
  l: TextLayer,
  query: string,
  replacement: string,
  opts: SearchOptions = {},
  only?: number,
): Replaced {
  return replaceInText(l.text, l.spans, query, replacement, opts, only);
}

// ---- contador de palabras y tiempo de lectura ----

export interface TextStats {
  words: number;
  chars: number;
  charsNoSpaces: number;
  readingSeconds: number;
}

export const WORDS_PER_MINUTE = 200;

export function textStats(text: string): TextStats {
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length;
  return {
    words,
    chars: text.length,
    charsNoSpaces: text.replace(/\s/g, '').length,
    readingSeconds: Math.round((words / WORDS_PER_MINUTE) * 60),
  };
}

export function formatReadingTime(seconds: number): string {
  if (seconds <= 0) return '0 s';
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}
