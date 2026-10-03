import { describe, expect, it } from 'vitest';
import { parseSubtitles, serializeSrt } from '../../video/title/srt';
import { formatBytes, formatClock, layoutLines, segmentsToSubtitles } from './subtitles';
import type { AsrSegment, AsrWord } from './windows';

const words = (text: string, t0: number, step = 0.4): AsrWord[] => text.split(' ').map((w, i) => ({ t0: +(t0 + i * step).toFixed(3), t1: +(t0 + i * step + step * 0.8).toFixed(3), w }));
const seg = (ws: AsrWord[]): AsrSegment => ({ start: ws[0].t0, end: ws[ws.length - 1].t1, text: ws.map((w) => w.w).join(' '), words: ws });

describe('segmentsToSubtitles', () => {
  it('un segmento corto → un subtítulo con palabras relativas a su inicio', () => {
    const c = segmentsToSubtitles([seg(words('Hola a todos.', 2))]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ start: 2, text: 'Hola a todos.' });
    expect(c[0].words![0]).toEqual({ text: 'Hola', start: 0, end: 0.32 });
    expect(c[0].words![2].start).toBeCloseTo(0.8, 3);
  });
  it('respeta caracteres por línea, líneas y duración máxima', () => {
    const long = 'esta es una frase bastante larga que no cabe en un solo subtítulo porque tiene demasiadas palabras para dos líneas cortas';
    const c = segmentsToSubtitles([seg(words(long, 0, 0.3))], { maxChars: 20, maxLines: 2, maxDur: 3 });
    expect(c.length).toBeGreaterThan(2);
    for (const x of c) {
      const lines = x.text.split('\n');
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(20);
      expect(x.end - x.start).toBeLessThanOrEqual(3 + 1e-9);
    }
    // no se pierde ni se repite ninguna palabra
    expect(c.flatMap((x) => x.words!.map((w) => w.text)).join(' ')).toBe(long);
    for (let i = 1; i < c.length; i++) expect(c[i].start).toBeGreaterThanOrEqual(c[i - 1].end);
  });
  it('prefiere cortar tras una coma', () => {
    const c = segmentsToSubtitles([seg(words('primero vamos al mercado, después compramos pan y leche', 0, 0.3))], { maxChars: 30, maxLines: 1 });
    expect(c[0].text).toBe('primero vamos al mercado,');
  });
  it('alarga los muy cortos sin pisar al siguiente', () => {
    const c = segmentsToSubtitles([seg([{ t0: 1, t1: 1.2, w: 'Sí.' }]), seg([{ t0: 1.5, t1: 2, w: 'No.' }])], { minDur: 0.8 });
    expect(c[0].end).toBe(1.5);
    expect(c[1].end).toBeCloseTo(2.3, 3);
  });
  it('sale en formato de V4: SRT de ida y vuelta', () => {
    const c = segmentsToSubtitles([seg(words('Buenos días.', 61.5)), seg(words('¿Cómo estás?', 63))]);
    const srt = serializeSrt(c);
    expect(srt).toContain('00:01:01,500 --> ');
    const back = parseSubtitles(srt).cues;
    expect(back.map((x) => x.text)).toEqual(['Buenos días.', '¿Cómo estás?']);
  });
});

describe('layoutLines', () => {
  it('equilibra dos líneas', () => {
    expect(layoutLines('uno dos tres cuatro cinco seis'.split(' '), 20, 2)).toBe('uno dos tres\ncuatro cinco seis');
  });
  it('cabe en una → una línea', () => {
    expect(layoutLines(['hola', 'mundo'], 42, 2)).toBe('hola mundo');
  });
});

describe('formatos', () => {
  it('formatClock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.4)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(NaN)).toBe('0:00');
  });
  it('formatBytes', () => {
    expect(formatBytes(43_622_127)).toBe('44 MB');
    expect(formatBytes(2_769_452)).toBe('2,8 MB');
    expect(formatBytes(1_208_000_000)).toBe('1,2 GB');
  });
});

describe('integración con la pista de subtítulos de V4', () => {
  it('los subtítulos generados entran en una pista `subtitle` con sus palabras', async () => {
    const { createProject } = await import('../../video/model/ops');
    const { ensureSubtitleTrack, replaceCues, cuesOfTrack } = await import('../../video/title/subtitles');
    const cues = segmentsToSubtitles([seg(words('Hola a todos.', 1)), seg(words('Esto es una prueba.', 3))]);
    const { p, id } = ensureSubtitleTrack(createProject());
    const r = replaceCues(p, id, cues);
    const t = r.p.tracks.find((x) => x.id === id)!;
    expect(t.clips).toHaveLength(2);
    expect(t.clips[1]).toMatchObject({ kind: 'subtitle', start: 3, text: 'Esto es una prueba.' });
    expect(cuesOfTrack(t)[0].words!.map((w) => w.text)).toEqual(['Hola', 'a', 'todos.']);
  });
});
