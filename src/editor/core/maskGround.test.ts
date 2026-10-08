import { describe, expect, it } from 'vitest';
import { groundSourceScale } from './maskRender';

describe('groundSourceScale (fuente enmascarada del reflejo/sombra)', () => {
  it('no reduce lo que cabe', () => {
    expect(groundSourceScale(800, 600, 4096)).toBe(1);
    expect(groundSourceScale(4096, 10, 4096)).toBe(1);
  });
  it('reduce por el lado mayor', () => {
    expect(groundSourceScale(8192, 4096, 4096)).toBe(0.5);
    expect(groundSourceScale(1000, 4000, 2000)).toBe(0.5);
  });
  it('tamaños degenerados no dan NaN', () => {
    expect(groundSourceScale(0, 0, 4096)).toBe(1);
  });
});
