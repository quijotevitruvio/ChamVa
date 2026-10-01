import { describe, it, expect } from 'vitest';
import { thumbSize, needsThumb, orphanThumbKeys, thumbKey } from './thumbs';

describe('thumbs (parte pura)', () => {
  it('reduce conservando la proporción', () => {
    expect(thumbSize(1024, 512)).toEqual({ width: 256, height: 128 });
    expect(thumbSize(300, 900)).toEqual({ width: 85, height: 256 });
  });
  it('no agranda', () => {
    expect(thumbSize(100, 50)).toEqual({ width: 100, height: 50 });
  });
  it('entradas inválidas', () => {
    expect(thumbSize(0, 10)).toEqual({ width: 1, height: 1 });
  });
  it('needsThumb', () => {
    expect(needsThumb(256, 100)).toBe(false);
    expect(needsThumb(257, 10)).toBe(true);
  });
  it('orphanThumbKeys solo devuelve miniaturas sin subida', () => {
    const keys = [thumbKey('a'), thumbKey('b'), 'asset:xyz', 'design:1'];
    expect(orphanThumbKeys(keys, ['a'])).toEqual([thumbKey('b')]);
  });
});
