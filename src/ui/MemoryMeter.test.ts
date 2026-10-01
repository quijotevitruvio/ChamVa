import { describe, expect, it } from 'vitest';
import { estimateDocBytes, formatBytes, imageBytes, memLevel, warnThreshold } from './MemoryMeter';

const img = (src: string, w: number, h: number, extra: object = {}) =>
  ({
    type: 'image',
    src,
    naturalWidth: w,
    naturalHeight: h,
    adjust: {},
    filter: 'none',
    flipX: false,
    flipY: false,
    ...extra,
  }) as never;

describe('MemoryMeter', () => {
  it('bytes de una imagen RGBA', () => {
    expect(imageBytes(1000, 1000)).toBe(4_000_000);
  });
  it('cuenta una vez la misma imagen repetida', () => {
    const one = estimateDocBytes([{ layers: [img('a', 1000, 1000)] }]);
    const two = estimateDocBytes([{ layers: [img('a', 1000, 1000), img('a', 1000, 1000)] }]);
    expect(two - one).toBe(2048);
  });
  it('un ajuste añade la copia procesada acotada a 2048', () => {
    const plain = estimateDocBytes([{ layers: [img('a', 4096, 4096)] }]);
    const adj = estimateDocBytes([{ layers: [img('a', 4096, 4096, { filter: 'bw' })] }]);
    expect(adj - plain).toBe(imageBytes(2048, 2048));
  });
  it('formato legible', () => {
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB');
  });
  it('nivel alto pasado el umbral', () => {
    expect(memLevel({ bytes: 100, source: 'estimada' })).toBe('ok');
    expect(memLevel({ bytes: warnThreshold('estimada'), source: 'estimada' })).toBe('alto');
  });
});
