import { describe, expect, it } from 'vitest';
import { TEXTURE_KINDS, generateTexture } from './proceduralTextures';

describe('texturas procedurales', () => {
  for (const k of TEXTURE_KINDS) {
    it(`${k.id}: determinista, opaca y con variación`, () => {
      const a = generateTexture(k.id, 64, 48, 5, 1);
      const b = generateTexture(k.id, 64, 48, 5, 1);
      expect(a).toEqual(b);
      expect(a.length).toBe(64 * 48 * 4);
      let min = 255;
      let max = 0;
      for (let i = 0; i < a.length; i += 4) {
        expect(a[i + 3]).toBe(255);
        min = Math.min(min, a[i]);
        max = Math.max(max, a[i]);
      }
      expect(max).toBeGreaterThan(min);
    });
  }
  it('la semilla cambia el resultado', () => {
    expect(generateTexture('film', 32, 32, 1)).not.toEqual(generateTexture('film', 32, 32, 2));
  });
});
