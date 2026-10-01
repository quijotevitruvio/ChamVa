import { describe, expect, it } from 'vitest';
import { finalSize, formatBytes, isTooLargeToPreview } from './exportPreview';

describe('formatBytes', () => {
  it('formatea B, KB y MB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(25.5 * 1024 * 1024)).toBe('25.5 MB');
  });
  it('entradas inválidas', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});

describe('finalSize', () => {
  it('aplica la escala', () => {
    expect(finalSize({ width: 1080, height: 1920 }, 2)).toEqual({
      width: 2160,
      height: 3840,
      pixels: 2160 * 3840,
    });
  });
  it('redondea y nunca baja de 1', () => {
    expect(finalSize({ width: 0.2, height: 10.4 }, 1)).toEqual({ width: 1, height: 10, pixels: 10 });
  });
  it('detecta lienzos enormes', () => {
    expect(isTooLargeToPreview(finalSize({ width: 5000, height: 4000 }, 1).pixels)).toBe(true);
    expect(isTooLargeToPreview(finalSize({ width: 1080, height: 1080 }, 3).pixels)).toBe(false);
  });
});
