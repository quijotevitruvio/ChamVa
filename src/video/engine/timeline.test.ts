import { describe, expect, it } from 'vitest';
import {
  buildSegments,
  fadeAlpha,
  fitRect,
  frameCount,
  overlayFontPx,
  segmentIndexAt,
  sourceTimeAt,
  totalDuration,
} from './timeline';

const clip = (inP: number, outP: number, speed = 1, fadeIn = 0, fadeOut = 0) => ({ inP, outP, speed, fadeIn, fadeOut });

describe('línea de tiempo', () => {
  it('clips en secuencia con recorte y velocidad', () => {
    const segs = buildSegments([clip(1, 4), clip(0, 4, 2), clip(2, 3, 0.5)]);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 3],
      [3, 5],
      [5, 7],
    ]);
    expect(totalDuration(segs)).toBe(7);
    expect(segmentIndexAt(segs, 0)).toBe(0);
    expect(segmentIndexAt(segs, 3)).toBe(1);
    expect(segmentIndexAt(segs, 6.99)).toBe(2);
    expect(segmentIndexAt(segs, 7)).toBe(2); // final: el último
  });

  it('tiempo del archivo de origen en t (velocidad incluida, sin pasarse del final)', () => {
    const segs = buildSegments([clip(1, 4), clip(0, 4, 2)]);
    expect(sourceTimeAt(segs[0], 0)).toBe(1);
    expect(sourceTimeAt(segs[0], 1.5)).toBe(2.5);
    expect(sourceTimeAt(segs[1], 4)).toBe(2); // 1 s en el tramo × 2
    expect(sourceTimeAt(segs[1], 5)).toBeCloseTo(3.999, 6);
  });

  it('número de fotogramas tolerante al redondeo (5,9 s × 30 = 177)', () => {
    expect(frameCount(5.9, 30)).toBe(177);
    expect(frameCount(3, 30)).toBe(90);
    expect(frameCount(3.01, 30)).toBe(91);
    expect(frameCount(1 / 3, 60)).toBe(20);
  });

  it('fundidos de entrada y salida', () => {
    const [s] = buildSegments([clip(0, 4, 1, 1, 2)]);
    expect(fadeAlpha(s, 0)).toBe(0);
    expect(fadeAlpha(s, 0.5)).toBeCloseTo(0.5);
    expect(fadeAlpha(s, 1.5)).toBe(1);
    expect(fadeAlpha(s, 3)).toBeCloseTo(0.5);
  });

  it('tamaño de texto idéntico en WebM y MP4 y proporcional a la salida', () => {
    // Antes: WebM = size px tal cual, MP4 = size × alto/720 → a 1080p 60 px vs 90 px.
    expect(overlayFontPx(60, 1920, 1080)).toBe(90);
    expect(overlayFontPx(60, 1280, 720)).toBe(60);
    // 9:16: referencia al lado corto (no se sale por los lados)
    expect(overlayFontPx(60, 1080, 1920)).toBe(90);
    expect(overlayFontPx(60, 3840, 2160)).toBe(180);
  });

  it('encaje contain/cover y rotación de móvil', () => {
    expect(fitRect(1920, 1080, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    // 16:9 dentro de 9:16 con bandas
    const c = fitRect(1920, 1080, 1080, 1920, 'contain');
    expect(c.w).toBe(1080);
    expect(c.h).toBeCloseTo(607.5);
    // cover: rellena y recorta
    const v = fitRect(1920, 1080, 1080, 1920, 'cover');
    expect(v.h).toBe(1920);
    expect(v.w).toBeCloseTo(3413.33, 1);
    // video vertical grabado en horizontal + rotación 90 → ocupa 9:16 entero
    expect(fitRect(1920, 1080, 1080, 1920, 'contain', 90)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });
});
