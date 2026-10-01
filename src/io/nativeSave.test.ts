import { describe, expect, it } from 'vitest';
import { dirOf, joinPath } from './nativeSave';

const B = '\\';

describe('nativeSave rutas', () => {
  it('dirOf y joinPath', () => {
    const win = ['C:', 'Users', 'a'].join(B);
    expect(dirOf(win + B + 'x.png')).toBe(win);
    expect(dirOf('/home/a/x.png')).toBe('/home/a');
    expect(joinPath(null, 'x.png')).toBe('x.png');
    expect(joinPath(win, 'x.png')).toBe(win + B + 'x.png');
    expect(joinPath('/home/a', 'x.png')).toBe('/home/a/x.png');
  });
});
