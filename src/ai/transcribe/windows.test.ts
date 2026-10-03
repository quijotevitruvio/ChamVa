import { describe, expect, it } from 'vitest';
import { ASR_RATE, buildSegments, detectSpeech, joinWords, mergeWindowWords, planWindows, refineWordTimes, windowsForAudio, wordsFromChunks, type AsrWindow } from './windows';

/** Audio sintético: tono de 300 Hz en los tramos dados, ruido muy bajo en el resto. */
function synth(dur: number, voiced: [number, number][], rate = ASR_RATE): Float32Array {
  const a = new Float32Array(Math.round(dur * rate));
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let i = 0; i < a.length; i++) a[i] = rnd() * 0.0005;
  for (const [s, e] of voiced) for (let i = Math.round(s * rate); i < Math.round(e * rate); i++) a[i] += 0.3 * Math.sin((2 * Math.PI * 300 * i) / rate);
  return a;
}

describe('detectSpeech', () => {
  it('encuentra los tramos con voz con su relleno', () => {
    const r = detectSpeech(synth(10, [[1, 3], [6, 8.5]]));
    expect(r).toHaveLength(2);
    expect(r[0].start).toBeCloseTo(0.8, 1);
    expect(r[0].end).toBeCloseTo(3.2, 1);
    expect(r[1].start).toBeCloseTo(5.8, 1);
    expect(r[1].end).toBeCloseTo(8.7, 1);
  });
  it('une pausas cortas y descarta chasquidos', () => {
    const r = detectSpeech(synth(6, [[1, 2], [2.2, 3], [5, 5.05]]));
    expect(r).toHaveLength(1);
    expect(r[0].end).toBeCloseTo(3.2, 1);
  });
  it('silencio puro → nada', () => {
    expect(detectSpeech(new Float32Array(ASR_RATE * 3))).toEqual([]);
    expect(windowsForAudio(new Float32Array(ASR_RATE * 3))).toEqual([]);
  });
});

describe('planWindows', () => {
  it('agrupa regiones hasta 30 s y corta en mitad del silencio', () => {
    const w = planWindows([
      { start: 0, end: 10 },
      { start: 12, end: 25 },
      { start: 27, end: 40 },
    ]);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ start: 0, end: 25 });
    expect(w[1]).toMatchObject({ start: 27, end: 40 });
    expect(w[0].coreEnd).toBe(26);
    expect(w[1].coreStart).toBe(26);
    expect(w[0].coreStart).toBe(-Infinity);
    expect(w[1].coreEnd).toBe(Infinity);
  });
  it('una región larga se parte con solape y núcleos que se tocan sin solaparse', () => {
    const w = planWindows([{ start: 0, end: 70 }], { overlap: 2 });
    expect(w.length).toBe(3);
    for (const x of w) expect(x.end - x.start).toBeLessThanOrEqual(30);
    expect(w[0].end).toBe(30);
    expect(w[1].start).toBe(28);
    expect(w[0].coreEnd).toBe(29);
    expect(w[1].coreStart).toBe(29);
    expect(w[2].end).toBe(70);
    // cobertura total sin huecos
    for (let i = 1; i < w.length; i++) expect(w[i].coreStart).toBe(w[i - 1].coreEnd);
  });
  it('ninguna ventana supera el máximo', () => {
    const regs = Array.from({ length: 20 }, (_, i) => ({ start: i * 7, end: i * 7 + 5 }));
    for (const x of planWindows(regs)) expect(x.end - x.start).toBeLessThanOrEqual(30);
  });
});

describe('fusión de palabras entre ventanas', () => {
  const A: AsrWindow = { start: 0, end: 30, coreStart: -Infinity, coreEnd: 29 };
  const B: AsrWindow = { start: 28, end: 50, coreStart: 29, coreEnd: Infinity };
  it('cada palabra del solape sale una sola vez', () => {
    const merged = mergeWindowWords([
      { win: A, words: [{ t0: 27, t1: 27.5, w: 'uno' }, { t0: 28.2, t1: 28.7, w: 'dos' }, { t0: 28.9, t1: 29.4, w: 'tres' }, { t0: 29.5, t1: 29.9, w: 'cua-' }] },
      { win: B, words: [{ t0: 28.25, t1: 28.7, w: 'dos' }, { t0: 28.95, t1: 29.4, w: 'tres,' }, { t0: 29.5, t1: 30, w: 'cuatro' }, { t0: 30.2, t1: 30.6, w: 'cinco' }] },
    ]);
    expect(merged.map((w) => w.w)).toEqual(['uno', 'dos', 'tres,', 'cuatro', 'cinco']);
    for (let i = 1; i < merged.length; i++) expect(merged[i].t0).toBeGreaterThanOrEqual(merged[i - 1].t1);
  });
  it('quita la repetición exacta en la frontera aunque caiga a ambos lados', () => {
    const merged = mergeWindowWords([
      { win: A, words: [{ t0: 28.6, t1: 29.3, w: 'Hola' }] }, // centro 28.95 → A
      { win: B, words: [{ t0: 28.7, t1: 29.5, w: 'hola' }] }, // centro 29.1 → B, pero es la misma
    ]);
    expect(merged).toHaveLength(1);
  });
});

describe('wordsFromChunks', () => {
  it('pasa a tiempos absolutos, arregla finales nulos y quita vacíos', () => {
    const win: AsrWindow = { start: 10, end: 20, coreStart: 10, coreEnd: 20 };
    const w = wordsFromChunks(
      [
        { text: ' Hola', timestamp: [0.5, 0.9] },
        { text: ' ', timestamp: [0.9, 1] },
        { text: ' mundo.', timestamp: [1.0, null] },
        { text: ' fin', timestamp: [12, 13] },
      ],
      win,
    );
    expect(w).toEqual([
      { t0: 10.5, t1: 10.9, w: 'Hola' },
      { t0: 11, t1: 20, w: 'mundo.' },
      { t0: 20, t1: 20, w: 'fin' },
    ]);
  });
});

describe('buildSegments', () => {
  it('corta en fin de frase y en pausas largas', () => {
    const s = buildSegments([
      { t0: 0, t1: 0.4, w: 'Hola' },
      { t0: 0.5, t1: 0.9, w: 'mundo.' },
      { t0: 1, t1: 1.3, w: '¿Qué' },
      { t0: 1.4, t1: 1.8, w: 'tal?' },
      { t0: 4, t1: 4.5, w: 'Adiós' },
    ]);
    expect(s.map((x) => x.text)).toEqual(['Hola mundo.', '¿Qué tal?', 'Adiós']);
    expect(s[1]).toMatchObject({ start: 1, end: 1.8 });
  });
  it('joinWords no deja espacios antes de la puntuación', () => {
    expect(joinWords(['Hola', ',', 'qué', 'tal', '?'])).toBe('Hola, qué tal?');
    expect(joinWords(['¿', 'Vienes', '?'])).toBe('¿Vienes?');
  });
});

describe('refineWordTimes', () => {
  it('lleva el inicio tardío de Whisper al arranque real de la voz y recorta el final en el silencio', () => {
    // voz en [1, 1.5] y [2, 2.6]; Whisper las marca tarde y estiradas
    const pcm = synth(4, [[1, 1.5], [2, 2.6]]);
    const out = refineWordTimes(
      [
        { t0: 1.3, t1: 1.95, w: 'uno' },
        { t0: 2.3, t1: 3.2, w: 'dos' },
      ],
      pcm,
      ASR_RATE,
      { lag: 0.3 },
    );
    expect(out[0].t0).toBeCloseTo(1, 1);
    expect(out[0].t1).toBeCloseTo(1.5, 1);
    expect(out[1].t0).toBeCloseTo(2, 1);
    expect(out[1].t1).toBeCloseTo(2.6, 1);
  });
  it('sin pausas (habla continua) no toca nada', () => {
    const pcm = synth(4, [[0.5, 3.5]]);
    const w = [
      { t0: 1.3, t1: 1.9, w: 'uno' },
      { t0: 1.9, t1: 2.4, w: 'dos' },
    ];
    expect(refineWordTimes(w, pcm)).toEqual(w);
  });
});
