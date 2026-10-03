import { describe, expect, it } from 'vitest';
import { cleanCueText, decodeSubtitleBytes, detectFormat, formatTimestamp, parseSrt, parseSubtitles, parseTimestamp, parseVtt, resolveOverlaps, serializeSrt, serializeSubtitles, serializeTxt, serializeVtt, type Cue } from './srt';

const SRT = `1
00:00:01,000 --> 00:00:03,500
¿Qué tal, señora Peña?
Hoy hace mucho frío.

2
00:00:04,000 --> 00:00:06,250
Camión, canción, corazón… ¡ñandú!

3
00:01:02,005 --> 00:01:03,999
Último subtítulo.
`;

describe('tiempos', () => {
  it('lee coma y punto, con y sin horas y con 1 a 9 decimales', () => {
    expect(parseTimestamp('00:00:01,500')).toBe(1.5);
    expect(parseTimestamp('00:00:01.500')).toBe(1.5);
    expect(parseTimestamp('01:02.5')).toBe(62.5);
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp('0:00:01,5')).toBe(1.5);
    expect(parseTimestamp('00:00:01,123456')).toBeCloseTo(1.123456, 9);
    expect(parseTimestamp('100:00:00,000')).toBe(360000);
  });
  it('rechaza lo que no es un tiempo', () => {
    expect(parseTimestamp('hola')).toBeNull();
    expect(parseTimestamp('00:61:00')).toBeNull();
    expect(parseTimestamp('00:00:61')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });
  it('escribe a milisegundos con el separador pedido', () => {
    expect(formatTimestamp(3723.4567)).toBe('01:02:03,457');
    expect(formatTimestamp(0.0004, '.')).toBe('00:00:00.000');
    expect(formatTimestamp(59.9996, '.')).toBe('00:01:00.000');
    expect(formatTimestamp(-5)).toBe('00:00:00,000');
    expect(formatTimestamp(NaN)).toBe('00:00:00,000');
  });
});

describe('SRT', () => {
  it('lee un SRT con acentos y eñes', () => {
    const r = parseSrt(SRT);
    expect(r.format).toBe('srt');
    expect(r.warnings).toEqual([]);
    expect(r.cues).toEqual([
      { start: 1, end: 3.5, text: '¿Qué tal, señora Peña?\nHoy hace mucho frío.' },
      { start: 4, end: 6.25, text: 'Camión, canción, corazón… ¡ñandú!' },
      { start: 62.005, end: 63.999, text: 'Último subtítulo.' },
    ]);
  });

  it('ida y vuelta idéntica', () => {
    expect(serializeSrt(parseSrt(SRT).cues)).toBe(SRT);
  });

  it('BOM y CRLF', () => {
    const crlf = '﻿' + SRT.replace(/\n/g, '\r\n');
    const r = parseSubtitles(crlf);
    expect(r.cues).toEqual(parseSrt(SRT).cues);
    expect(serializeSrt(r.cues, { eol: '\r\n' })).toBe(SRT.replace(/\n/g, '\r\n'));
  });

  it('solo CR (Mac antiguo)', () => {
    expect(parseSrt(SRT.replace(/\n/g, '\r')).cues).toHaveLength(3);
  });

  it('puntos decimales, índices que faltan o están mal y varias líneas en blanco', () => {
    const src = '7\n00:00:01.5 --> 00:00:02.25\nUno\n\n\n\n99\n00:00:03,000 --> 00:00:04,000\nDos\n\n00:00:05,000 --> 00:00:06,000\nSin índice';
    const r = parseSrt(src);
    expect(r.cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1.5, 2.25, 'Uno'],
      [3, 4, 'Dos'],
      [5, 6, 'Sin índice'],
    ]);
  });

  it('sin línea en blanco entre subtítulos', () => {
    const src = '1\n00:00:01,000 --> 00:00:02,000\nUno\n2\n00:00:03,000 --> 00:00:04,000\nDos\n';
    expect(parseSrt(src).cues.map((c) => c.text)).toEqual(['Uno', 'Dos']);
  });

  it('quita etiquetas, códigos ASS y decodifica entidades', () => {
    const src = '1\n00:00:01,000 --> 00:00:02,000\n<i>Hola</i> <b>mundo</b>\n<font color="#ff0000">rojo</font> {\\an8}arriba\nTom &amp; Jerry &lt;3 &#241;';
    expect(parseSrt(src).cues[0].text).toBe('Hola mundo\nrojo arriba\nTom & Jerry <3 ñ');
  });

  it('un cue sin texto o con tiempo ilegible se omite con aviso', () => {
    const src = '1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\nBien\n';
    const r = parseSrt(src);
    expect(r.cues).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/omitieron/);
  });

  it('final antes del inicio: se corrige con aviso', () => {
    const r = parseSrt('1\n00:00:05,000 --> 00:00:04,000\nAl revés\n');
    expect(r.cues[0]).toMatchObject({ start: 5, end: 6 });
    expect(r.warnings.join(' ')).toMatch(/corrigieron/);
  });

  it('solapes: se conservan al leer y se avisa; resolveOverlaps los arregla sin perder ninguno', () => {
    const src = '1\n00:00:01,000 --> 00:00:04,000\nA\n\n2\n00:00:03,000 --> 00:00:05,000\nB\n';
    const r = parseSrt(src);
    expect(r.cues).toHaveLength(2);
    expect(r.warnings.join(' ')).toMatch(/solapan/);
    const fixed = resolveOverlaps(r.cues);
    expect(fixed.changed).toBe(1);
    expect(fixed.cues[0].end).toBe(3);
    expect(fixed.cues[1]).toMatchObject({ start: 3, end: 5 });
  });

  it('solape total (el siguiente empieza antes de que el anterior dure lo mínimo)', () => {
    const fixed = resolveOverlaps([
      { start: 1, end: 5, text: 'A' },
      { start: 1.01, end: 2, text: 'B' },
    ]);
    expect(fixed.cues[0].end - fixed.cues[0].start).toBeGreaterThanOrEqual(0.05);
    expect(fixed.cues[1].start).toBeGreaterThanOrEqual(fixed.cues[0].end);
    expect(fixed.cues[1].end).toBeGreaterThan(fixed.cues[1].start);
  });

  it('ordena por inicio (estable)', () => {
    const src = '1\n00:00:05,000 --> 00:00:06,000\nB\n\n2\n00:00:01,000 --> 00:00:02,000\nA\n';
    expect(parseSrt(src).cues.map((c) => c.text)).toEqual(['A', 'B']);
  });

  it('archivo vacío o sin subtítulos', () => {
    expect(parseSrt('').cues).toEqual([]);
    expect(parseSrt('hola, esto no es un SRT').warnings.join(' ')).toMatch(/ningún subtítulo/);
  });

  it('al escribir quita las líneas vacías del texto (romperían el formato)', () => {
    const out = serializeSrt([{ start: 0, end: 1, text: 'A\n\n  \nB' }]);
    expect(out).toBe('1\n00:00:00,000 --> 00:00:01,000\nA\nB\n');
    expect(parseSrt(out).cues[0].text).toBe('A\nB');
  });

  it('lista vacía → archivo vacío', () => {
    expect(serializeSrt([])).toBe('');
  });
});

describe('VTT', () => {
  const VTT = `WEBVTT - Entrevista

NOTE Esto es un comentario
con --> flecha dentro

STYLE
::cue { color: red }

intro
00:01.000 --> 00:03.500 align:start position:10%
<v Ana>¿Qué tal, <i>señora</i> Peña?

00:00:04.000 --> 00:00:06.250
Camión &amp; canción
`;
  it('cabecera, NOTE, STYLE, identificadores, ajustes y horas opcionales', () => {
    const r = parseVtt(VTT);
    expect(r.format).toBe('vtt');
    expect(r.cues).toEqual([
      { start: 1, end: 3.5, text: '¿Qué tal, señora Peña?' },
      { start: 4, end: 6.25, text: 'Camión & canción' },
    ]);
  });
  it('se detecta por la cabecera', () => {
    expect(detectFormat(VTT)).toBe('vtt');
    expect(detectFormat(SRT)).toBe('srt');
  });
  it('ida y vuelta (cabecera y puntos)', () => {
    const cues = parseVtt(VTT).cues;
    const out = serializeVtt(cues);
    expect(out.startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:03.500\n')).toBe(true);
    expect(parseVtt(out).cues).toEqual(cues);
  });
  it('tiempos por palabra <hh:mm:ss.mmm> → words, y vuelta', () => {
    const src = 'WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nHola <00:00:10.500>mundo <00:00:11.000>cruel\n';
    const r = parseVtt(src);
    expect(r.cues[0].text).toBe('Hola mundo cruel');
    expect(r.cues[0].words).toEqual([
      { text: 'Hola', start: 0, end: 0.5 },
      { text: 'mundo', start: 0.5, end: 1 },
      { text: 'cruel', start: 1, end: 2 },
    ]);
    const again = parseVtt(serializeVtt(r.cues));
    expect(again.cues[0].words).toEqual(r.cues[0].words);
  });
  it('VTT con 2 líneas y marcas: no se mezclan palabras en la salida', () => {
    const out = serializeVtt([{ start: 0, end: 1, text: 'A\nB', words: [{ text: 'A', start: 0, end: 0.5 }] }]);
    expect(out).toContain('A\nB');
  });
});

describe('TXT con tiempos', () => {
  it('rango entre corchetes y ida y vuelta, también con varias líneas', () => {
    const cues: Cue[] = [
      { start: 1, end: 3.5, text: 'Primera línea\nsegunda línea' },
      { start: 4, end: 6, text: 'Otro' },
    ];
    const out = serializeTxt(cues);
    expect(out).toBe('[00:00:01.000 --> 00:00:03.500] Primera línea\nsegunda línea\n[00:00:04.000 --> 00:00:06.000] Otro\n');
    const r = parseSubtitles(out);
    expect(r.format).toBe('txt');
    expect(r.cues).toEqual(cues);
  });
  it('estilo LRC: solo inicio; el final es el inicio del siguiente', () => {
    const r = parseSubtitles('[00:01.50] Uno\n[00:04.00] Dos\n[00:09.25] Tres\n');
    expect(r.cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1.5, 4, 'Uno'],
      [4, 9.25, 'Dos'],
      [9.25, 11.75, 'Tres'],
    ]);
  });
  it('rango sin corchetes y texto en la misma línea', () => {
    const r = parseSubtitles('00:00:01,000 --> 00:00:02,000 Hola\n00:00:03,000 - 00:00:04,000: Adiós');
    expect(r.format).toBe('txt');
    expect(r.cues.map((c) => c.text)).toEqual(['Hola', 'Adiós']);
  });
});

describe('detalles', () => {
  it('cleanCueText', () => {
    expect(cleanCueText('  a   b \n\n <u>c</u>  ')).toBe('a b\nc');
    expect(cleanCueText('a < b y c > d')).toBe('a < b y c > d'); // no son etiquetas
    expect(cleanCueText('&#128512;')).toBe('😀');
  });
  it('serializeSubtitles elige el formato', () => {
    const c: Cue[] = [{ start: 0, end: 1, text: 'x' }];
    expect(serializeSubtitles(c, 'srt')).toContain('-->');
    expect(serializeSubtitles(c, 'vtt').startsWith('WEBVTT')).toBe(true);
    expect(serializeSubtitles(c, 'txt').startsWith('[')).toBe(true);
  });
  it('un archivo grande (5000 subtítulos) se lee deprisa y de ida y vuelta', () => {
    const cues: Cue[] = Array.from({ length: 5000 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.5, text: `Línea ${i}\nañada ñu` }));
    const t0 = performance.now();
    const back = parseSrt(serializeSrt(cues)).cues;
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(back).toEqual(cues);
  });
});

describe('decodeSubtitleBytes', () => {
  const enc = (s: string, latin1 = false) => (latin1 ? Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0))) : new TextEncoder().encode(s));
  const text = '¿Qué tal, señora Peña? Camión ¡ñandú!';
  it('UTF-8 con y sin BOM', () => {
    expect(decodeSubtitleBytes(enc(text))).toBe(text);
    expect(parseSubtitles(decodeSubtitleBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('1\n00:00:01,000 --> 00:00:02,000\n' + text)]))).cues[0].text).toBe(text);
  });
  it('ANSI (Windows-1252): no pierde acentos ni eñes', () => {
    expect(decodeSubtitleBytes(enc(text, true))).toBe(text);
  });
  it('UTF-16 con BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, ...Array.from(text).flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])]);
    expect(decodeSubtitleBytes(le)).toBe(text);
    const be = new Uint8Array([0xfe, 0xff, ...Array.from(text).flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255])]);
    expect(decodeSubtitleBytes(be)).toBe(text);
  });
});
