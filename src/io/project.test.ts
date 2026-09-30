import { describe, expect, it } from 'vitest';
import { parseProject } from './project';

const doc = (id: string) => ({
  id,
  name: 'Prueba',
  width: 100,
  height: 50,
  background: { type: 'solid', color: '#fff' },
  layers: [],
  version: 2,
});

describe('parseProject', () => {
  it('lee un proyecto multipágina', () => {
    const p = parseProject(
      JSON.stringify({ kind: 'chamva-project', version: 2, pageIndex: 1, pages: [doc('a'), doc('b')] }),
    );
    expect(p.pages.map((d) => d.id)).toEqual(['a', 'b']);
    expect(p.pageIndex).toBe(1);
  });

  it('acepta el formato antiguo (un solo documento)', () => {
    const p = parseProject(JSON.stringify(doc('solo')));
    expect(p.pages).toHaveLength(1);
    expect(p.pageIndex).toBe(0);
  });

  it('normaliza fondos antiguos (string → solid) y ausentes (→ transparent)', () => {
    const old = { ...doc('x'), background: '#ff0000' };
    expect(parseProject(JSON.stringify(old)).pages[0].background).toEqual({
      type: 'solid',
      color: '#ff0000',
    });
    const none = { ...doc('y'), background: undefined };
    expect(parseProject(JSON.stringify(none)).pages[0].background).toEqual({ type: 'transparent' });
  });

  it('rechaza archivos que no son proyectos', () => {
    expect(() => parseProject('{"hola":1}')).toThrow();
    expect(() => parseProject('no es json')).toThrow();
  });
});
