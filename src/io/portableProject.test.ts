import { describe, expect, it } from 'vitest';
import { makeZip } from './zip';
import { readZip } from './zipRead';
import { buildPortableEntries, packProject, parseDataUrl, portableBytesToJson } from './portableProject';
import type { Doc } from '../editor/core/types';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>');

describe('portableProject', () => {
  it('parseDataUrl base64 y texto', () => {
    expect(parseDataUrl(PNG)?.mime).toBe('image/png');
    expect(parseDataUrl(SVG)?.mime).toBe('image/svg+xml');
    expect(parseDataUrl('https://x/y.png')).toBeNull();
  });
  it('saca las imágenes una sola vez y las restituye idénticas', () => {
    const project = {
      kind: 'chamva-project',
      pageIndex: 0,
      pages: [
        {
          layers: [
            { type: 'image', src: PNG, originalSrc: PNG },
            { type: 'image', src: SVG },
            { type: 'text', text: 'hola' },
          ],
        },
      ],
    };
    const packed = packProject(project);
    expect(packed.images.length).toBe(2);
    expect(packed.json).not.toContain('base64');
    const entries = buildPortableEntries(project.pages as unknown as Doc[], 0);
    expect(entries.map((e) => e.name)).toContain('proyecto.json');
    const back = JSON.parse(portableBytesToJson(makeZip(entries)));
    expect(back.pages[0].layers[0].src).toBe(PNG);
    expect(back.pages[0].layers[0].originalSrc).toBe(PNG);
    expect(back.pages[0].layers[2].text).toBe('hola');
    expect(back.portableSchema).toBeUndefined();
    expect(back.pages[0].layers[1].src).toContain('data:image/svg+xml;base64,');
    expect(readZip(makeZip(entries)).some((e) => e.name === 'LEEME.txt')).toBe(true);
  });
  it('sin proyecto.json falla', () => {
    expect(() => portableBytesToJson(makeZip([{ name: 'x', data: new Uint8Array(1) }]))).toThrow();
  });
});
