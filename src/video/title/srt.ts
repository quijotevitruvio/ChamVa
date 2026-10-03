// Lectura y escritura de subtítulos: SRT, WebVTT y TXT con tiempos (puro, sin DOM).
//
// Lectura tolerante: BOM, CRLF / CR / LF, índices que faltan o están mal, coma o punto decimal, 1 a 9 decimales,
// horas opcionales (VTT), ajustes tras el tiempo de VTT («align:start»), bloques NOTE / STYLE / REGION,
// etiquetas (<i>, <b>, <font>, <c.clase>, <v Nombre>, {\an8}) y entidades (&amp;…). Los tiempos por palabra de
// VTT (<00:00:01.200>) se conservan en `words`. Los solapes se conservan tal cual (`resolveOverlaps` los arregla).
// Escritura: a milisegundos, sin horas en VTT solo si no hacen falta no se intenta: siempre HH:MM:SS.
import type { WordTime } from '../model/types';

export interface Cue {
  /** s */
  start: number;
  end: number;
  /** líneas separadas por \n, sin etiquetas */
  text: string;
  /** tiempo de cada palabra (s, relativo a `start`), si el archivo lo traía */
  words?: WordTime[];
}

export type SubFormat = 'srt' | 'vtt' | 'txt';

export interface ParseResult {
  cues: Cue[];
  format: SubFormat;
  warnings: string[];
}

// ---------------- tiempos ----------------

const TS = String.raw`(?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,9})?`;
const TIMING_RE = new RegExp(String.raw`^\s*(${TS})\s*-->\s*(${TS})(.*)$`);

/** «01:02:03,500», «02:03.5», «1:02:03» → segundos. null si no es un tiempo. */
export function parseTimestamp(s: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,9}))?\s*$/.exec(s);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const mi = Number(m[2]);
  const sec = Number(m[3]);
  if (mi > 59 || sec > 59) return null;
  const frac = m[4] ? Number('0.' + m[4]) : 0;
  return h * 3600 + mi * 60 + sec + frac;
}

/** Segundos → «HH:MM:SS,mmm» (o con punto). Redondea a milisegundos. */
export function formatTimestamp(sec: number, sep: ',' | '.' = ','): string {
  const ms = Math.max(0, Math.round((Number.isFinite(sec) ? sec : 0) * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

// ---------------- limpieza de texto ----------------

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&lrm;': '', '&rlm;': '' };
const decodeEntities = (s: string) =>
  s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|lrm|rlm);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, dec, hex) => {
    if (dec || hex) {
      const cp = dec ? Number(dec) : parseInt(hex, 16);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[m.toLowerCase()] ?? m;
  });

/** Quita etiquetas HTML/VTT y códigos {\an8} de ASS, decodifica entidades y recorta cada línea. */
export function cleanCueText(raw: string): string {
  const noTags = raw.replace(/\{\\[^}]*\}/g, '').replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d+>/g, '');
  return decodeEntities(noTags)
    .split('\n')
    .map((l) => l.replace(/[ \t\xa0]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** Palabras con tiempo a partir de las marcas <hh:mm:ss.mmm> de un cue de VTT (null si no hay). */
function inlineWords(raw: string, cueStart: number, cueEnd: number): WordTime[] | null {
  if (!/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d+>/.test(raw)) return null;
  const parts = raw.split(/<(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)>/);
  // parts: [texto0, marca1, texto1, marca2, texto2, …]
  const segs: { t0: number; text: string }[] = [{ t0: cueStart, text: parts[0] }];
  for (let i = 1; i < parts.length; i += 2) {
    const t = parseTimestamp(parts[i]);
    segs.push({ t0: t ?? cueStart, text: parts[i + 1] ?? '' });
  }
  const words: WordTime[] = [];
  segs.forEach((seg, k) => {
    const t1 = k + 1 < segs.length ? segs[k + 1].t0 : cueEnd;
    const ws = cleanCueText(seg.text.replace(/\n/g, ' ')).split(/\s+/).filter(Boolean);
    const total = ws.reduce((a, w) => a + Array.from(w).length + 1, 0) || 1;
    let acc = 0;
    for (const w of ws) {
      const a = acc / total;
      acc += Array.from(w).length + 1;
      words.push({ text: w, start: seg.t0 - cueStart + a * (t1 - seg.t0), end: seg.t0 - cueStart + (acc / total) * (t1 - seg.t0) });
    }
  });
  return words.length ? words : null;
}

// ---------------- SRT / VTT ----------------

const normalizeSource = (src: string) => src.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

function parseCueBlocks(src: string, vtt: boolean): { cues: Cue[]; warnings: string[] } {
  const lines = normalizeSource(src).split('\n');
  const cues: Cue[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let fixed = 0;
  let i = 0;
  const isBlank = (l: string | undefined) => l === undefined || l.trim() === '';
  while (i < lines.length) {
    const line = lines[i];
    // bloques que no son subtítulos (VTT)
    if (vtt && (i === 0 || isBlank(lines[i - 1])) && /^(NOTE|STYLE|REGION)(\s|$)/.test(line)) {
      while (i < lines.length && !isBlank(lines[i])) i++;
      continue;
    }
    const m = TIMING_RE.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const start = parseTimestamp(m[1]);
    let end = parseTimestamp(m[2]);
    if (start === null || end === null) {
      skipped++;
      i++;
      continue;
    }
    const body: string[] = [];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !TIMING_RE.test(lines[i])) {
      // un índice suelto justo antes de otro cue (SRT sin línea en blanco) no es texto
      if (/^\s*\d+\s*$/.test(lines[i]) && i + 1 < lines.length && TIMING_RE.test(lines[i + 1])) break;
      body.push(lines[i]);
      i++;
    }
    const rawText = body.join('\n');
    const text = cleanCueText(rawText);
    if (!text) {
      skipped++;
      continue;
    }
    if (end <= start) {
      end = start + 1;
      fixed++;
    }
    const cue: Cue = { start, end, text };
    if (vtt) {
      const w = inlineWords(rawText, start, end);
      if (w) cue.words = w;
    }
    cues.push(cue);
  }
  if (skipped) warnings.push(`${skipped} subtítulo(s) sin texto o con tiempo ilegible se omitieron`);
  if (fixed) warnings.push(`${fixed} subtítulo(s) con el final antes del inicio se corrigieron (1 s)`);
  return { cues, warnings };
}

// ---------------- TXT con tiempos ----------------

const TXT_RANGE = new RegExp(String.raw`^\s*\[?\s*(${TS})\s*(?:-->|-|–|—|->)\s*(${TS})\s*\]?\s*[:\t |-]?\s*(.*)$`);
const TXT_START = new RegExp(String.raw`^\s*\[\s*(${TS})\s*\]\s*(.*)$|^\s*(${TS})\s*[:\t |-]\s*(.+)$`);

function parseTxt(src: string): { cues: Cue[]; warnings: string[] } {
  const warnings: string[] = [];
  const cues: Cue[] = [];
  const open: boolean[] = []; // el cue no tenía final: se completa con el inicio del siguiente
  for (const raw of normalizeSource(src).split('\n')) {
    if (raw.trim() === '') continue;
    const r = TXT_RANGE.exec(raw);
    if (r) {
      const s = parseTimestamp(r[1]);
      const e = parseTimestamp(r[2]);
      if (s !== null && e !== null) {
        cues.push({ start: s, end: e > s ? e : s + 1, text: cleanCueText(r[3]) });
        open.push(false);
        continue;
      }
    }
    const st = TXT_START.exec(raw);
    if (st) {
      const s = parseTimestamp(st[1] ?? st[3]);
      if (s !== null) {
        cues.push({ start: s, end: s, text: cleanCueText(st[2] ?? st[4] ?? '') });
        open.push(true);
        continue;
      }
    }
    const last = cues[cues.length - 1];
    if (last) last.text = [last.text, cleanCueText(raw)].filter(Boolean).join('\n');
    else warnings.push('Se omitió texto anterior al primer tiempo');
  }
  for (let k = 0; k < cues.length; k++) {
    if (!open[k]) continue;
    const next = cues[k + 1];
    cues[k].end = next && next.start > cues[k].start ? next.start : cues[k].start + 2.5;
  }
  return { cues: cues.filter((c) => c.text), warnings };
}

// ---------------- API ----------------

/** Línea de tiempo de SRT/VTT: «a --> b» sin texto detrás (solo ajustes tipo «align:start» en VTT). */
const isTimingLine = (l: string) => {
  const m = TIMING_RE.exec(l);
  return !!m && /^\s*(?:[a-z]+:\S+\s*)*$/i.test(m[3]);
};

/** Detecta el formato por el contenido. */
export function detectFormat(src: string): SubFormat {
  const s = normalizeSource(src).trimStart();
  if (/^WEBVTT/.test(s)) return 'vtt';
  return s.split('\n').some(isTimingLine) ? 'srt' : 'txt';
}

/** Lee SRT, VTT o TXT con tiempos (formato por el contenido o `hint`). Ordena por inicio (estable). */
export function parseSubtitles(src: string, hint?: SubFormat): ParseResult {
  const format = hint ?? detectFormat(src);
  const r = format === 'txt' ? parseTxt(src) : parseCueBlocks(src, format === 'vtt');
  const sorted = r.cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.start - b.c.start || a.i - b.i).map((x) => x.c);
  const warnings = [...r.warnings];
  let overlaps = 0;
  for (let k = 1; k < sorted.length; k++) if (sorted[k].start < sorted[k - 1].end - 1e-6) overlaps++;
  if (overlaps) warnings.push(`${overlaps} subtítulo(s) se solapan con el anterior`);
  if (!sorted.length) warnings.push('No se encontró ningún subtítulo en el archivo');
  return { cues: sorted, format, warnings };
}

export const parseSrt = (src: string) => parseSubtitles(src, 'srt');
export const parseVtt = (src: string) => parseSubtitles(src, 'vtt');

const cueLines = (c: Cue) => c.text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '').join('\n');

export function serializeSrt(cues: Cue[], o: { eol?: '\n' | '\r\n' } = {}): string {
  const eol = o.eol ?? '\n';
  const out = cues.map((c, i) => `${i + 1}\n${formatTimestamp(c.start, ',')} --> ${formatTimestamp(c.end, ',')}\n${cueLines(c)}`).join('\n\n');
  return (out ? out + '\n' : '').replace(/\n/g, eol);
}

export function serializeVtt(cues: Cue[], o: { eol?: '\n' | '\r\n' } = {}): string {
  const eol = o.eol ?? '\n';
  const body = cues
    .map((c) => {
      let text = cueLines(c);
      if (c.words?.length && !text.includes('\n')) {
        text = c.words.map((w, i) => (i === 0 ? w.text : `<${formatTimestamp(c.start + w.start, '.')}>${w.text}`)).join(' ');
      }
      return `${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}\n${text}`;
    })
    .join('\n\n');
  return ('WEBVTT\n\n' + body + (body ? '\n' : '')).replace(/\n/g, eol);
}

/** TXT con tiempos: «[HH:MM:SS.mmm --> HH:MM:SS.mmm] texto»; las líneas siguientes sin tiempo son del mismo subtítulo. */
export function serializeTxt(cues: Cue[], o: { eol?: '\n' | '\r\n' } = {}): string {
  const eol = o.eol ?? '\n';
  const out = cues.map((c) => {
    const [first, ...rest] = cueLines(c).split('\n');
    return [`[${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}] ${first ?? ''}`, ...rest].join('\n');
  });
  return (out.length ? out.join('\n') + '\n' : '').replace(/\n/g, eol);
}

export function serializeSubtitles(cues: Cue[], format: SubFormat, o: { eol?: '\n' | '\r\n' } = {}): string {
  return format === 'vtt' ? serializeVtt(cues, o) : format === 'txt' ? serializeTxt(cues, o) : serializeSrt(cues, o);
}

/**
 * Quita los solapes: el final de cada subtítulo se recorta al inicio del siguiente. Si así quedara
 * con menos de `minDur` s, se respeta `minDur` y el siguiente empieza donde acaba (no se pierde ninguno).
 */
export function resolveOverlaps(cues: Cue[], minDur = 0.05): { cues: Cue[]; changed: number } {
  const out = cues.map((c) => ({ ...c }));
  let changed = 0;
  for (let k = 0; k + 1 < out.length; k++) {
    const a = out[k];
    const b = out[k + 1];
    if (a.end > b.start + 1e-9) {
      changed++;
      const e = Math.max(b.start, a.start + minDur);
      a.end = e;
      if (b.start < e) {
        b.end += e - b.start;
        b.start = e;
      }
      if (a.words) delete a.words;
    }
  }
  return { cues: out, changed };
}

/** Extensión y tipo MIME de cada formato. */
export const SUB_FILE: Record<SubFormat, { ext: string; mime: string }> = {
  srt: { ext: 'srt', mime: 'application/x-subrip' },
  vtt: { ext: 'vtt', mime: 'text/vtt' },
  txt: { ext: 'txt', mime: 'text/plain' },
};

/**
 * Bytes de un archivo de subtítulos → texto. UTF-8 (con o sin BOM) o UTF-16 con BOM; si no es UTF-8 válido
 * (los SRT «ANSI» de Windows en español), se lee como Windows-1252 para no perder acentos ni eñes.
 */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
