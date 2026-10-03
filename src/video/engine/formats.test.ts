import { describe, expect, it } from 'vitest';
import { ASPECTS, QUALITIES, avcCodecCandidates, avcLevel, outputSize, videoBitrate, lowerQuality } from './formats';

describe('formatos de salida', () => {
  it('tamaños exactos de 16:9, 9:16, 1:1 y 4:5 en 720p/1080p/4K', () => {
    expect(outputSize('16:9', 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize('16:9', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize('16:9', 2160)).toEqual({ width: 3840, height: 2160 });
    expect(outputSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('1:1', 1080)).toEqual({ width: 1080, height: 1080 });
    expect(outputSize('4:5', 1080)).toEqual({ width: 1080, height: 1350 });
    expect(outputSize('4:5', 720)).toEqual({ width: 720, height: 900 });
  });

  it('todos los lados son pares (H.264 4:2:0) y el corto es la calidad', () => {
    for (const a of ASPECTS)
      for (const q of QUALITIES) {
        const { width, height } = outputSize(a.id, q.id);
        expect(width % 2).toBe(0);
        expect(height % 2).toBe(0);
        expect(Math.min(width, height)).toBe(q.id);
      }
  });

  it('nivel H.264 según tamaño y fps (antes fijo 4.0: 4K no era codificable)', () => {
    expect(avcLevel(1280, 720, 30)).toBe(0x1f); // 3.1
    expect(avcLevel(1920, 1080, 30)).toBe(0x28); // 4.0
    expect(avcLevel(1080, 1920, 30)).toBe(0x28); // vertical también cabe en 4.0
    expect(avcLevel(1920, 1080, 60)).toBe(0x2a); // 4.2
    expect(avcLevel(3840, 2160, 30)).toBe(0x33); // 5.1
    expect(avcLevel(3840, 2160, 60)).toBe(0x34); // 5.2
    expect(avcCodecCandidates(3840, 2160, 30)[0]).toBe('avc1.640033');
  });

  it('la tasa de bits cabe en el nivel elegido', () => {
    for (const [w, h, f] of [
      [1920, 1080, 30],
      [1920, 1080, 60],
      [3840, 2160, 30],
      [1080, 1350, 30],
    ]) {
      const br = videoBitrate(w, h, f);
      expect(avcLevel(w, h, f, br)).not.toBeNull();
    }
    expect(videoBitrate(1920, 1080, 30)).toBeGreaterThan(5_000_000); // antes ~2 Mb/s
  });

  it('degradación 4K → 1080p → 720p → nada', () => {
    expect(lowerQuality(2160)).toBe(1080);
    expect(lowerQuality(1080)).toBe(720);
    expect(lowerQuality(720)).toBeNull();
  });
});
