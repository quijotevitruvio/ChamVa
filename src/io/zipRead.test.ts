import { describe, expect, it } from 'vitest';
import { makeZip } from './zip';
import { isZip, readZip } from './zipRead';

const enc = new TextEncoder();

describe('zipRead', () => {
  it('ida y vuelta con makeZip', () => {
    const zip = makeZip([
      { name: 'a.txt', data: enc.encode('hola') },
      { name: 'imagenes/ñandú.bin', data: new Uint8Array([0, 1, 2, 255]) },
      { name: 'vacio', data: new Uint8Array(0) },
    ]);
    expect(isZip(zip)).toBe(true);
    const r = readZip(zip);
    expect(r.map((e) => e.name)).toEqual(['a.txt', 'imagenes/ñandú.bin', 'vacio']);
    expect(Array.from(r[1].data)).toEqual([0, 1, 2, 255]);
    expect(new TextDecoder().decode(r[0].data)).toBe('hola');
    expect(r[2].data.length).toBe(0);
  });
  it('ZIP vacío', () => {
    const z = makeZip([]);
    expect(isZip(z)).toBe(true);
    expect(readZip(z)).toEqual([]);
  });
  it('detecta JSON y basura', () => {
    expect(isZip(enc.encode('{"kind":1}'))).toBe(false);
    expect(() => readZip(enc.encode('no soy zip'))).toThrow();
  });
  it('detecta datos corruptos por CRC', () => {
    const zip = makeZip([{ name: 'a', data: enc.encode('abcdef') }]);
    zip[30 + 1 + 2] ^= 0xff; // dentro de los datos
    expect(() => readZip(zip)).toThrow(/CRC/);
  });
});
