import { describe, expect, it } from 'vitest';
import {
  decodeSvgDataUrl,
  encodeSvgDataUrl,
  extractSvgColors,
  isSvgDataUrl,
  mapByLuminosity,
  parseCssColor,
  replaceSvgColors,
} from './svgRecolor';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
<path fill="#FF0000" d="M0 0h5v5z"/>
<circle fill='rgb(0, 0, 255)' stroke="#fff" r="3"/>
<g style="fill:#00ff00; stroke: black; opacity:.5"><rect fill="none" width="2" height="2"/></g>
<linearGradient id="g"><stop stop-color="#abc"/></linearGradient>
<rect fill="url(#g)"/>
</svg>`;

describe('parseCssColor', () => {
  it('normaliza formatos y descarta no-colores', () => {
    expect(parseCssColor('#FFF')).toBe('#ffffff');
    expect(parseCssColor('#11223344')).toBe('#112233');
    expect(parseCssColor('rgb(255, 128, 0)')).toBe('#ff8000');
    expect(parseCssColor('Red')).toBe('#ff0000');
    expect(parseCssColor('none')).toBeNull();
    expect(parseCssColor('url(#g)')).toBeNull();
    expect(parseCssColor('transparent')).toBeNull();
  });
});

describe('extractSvgColors', () => {
  it('lista colores distintos de atributos y style', () => {
    const c = extractSvgColors(svg);
    expect(c).toEqual(expect.arrayContaining(['#ff0000', '#0000ff', '#ffffff', '#00ff00', '#000000', '#aabbcc']));
    expect(c).toHaveLength(6);
  });
  it('SVG sin colores explícitos = negro implícito', () => {
    expect(extractSvgColors('<svg><path d="M0 0"/></svg>')).toEqual(['#000000']);
  });
});

describe('replaceSvgColors', () => {
  it('sustituye en atributos y en style sin tocar none ni url()', () => {
    const out = replaceSvgColors(svg, { '#ff0000': '#111111', '#0000ff': '#222222', '#00ff00': '#333333', '#000000': '#444444' });
    expect(out).toContain('fill="#111111"');
    expect(out).toContain("fill='#222222'");
    expect(out).toContain('fill:#333333');
    expect(out).toContain('stroke: #444444');
    expect(out).toContain('fill="none"');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('stroke="#fff"'); // no estaba en el mapa
  });
  it('SVG sin colores: añade el fill a la raíz', () => {
    const out = replaceSvgColors('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>', { '#000000': '#e11d48' });
    expect(out).toContain('<svg viewBox="0 0 1 1" fill="#e11d48">');
  });
});

describe('mapByLuminosity', () => {
  it('reparte por orden de luminosidad', () => {
    const m = mapByLuminosity(['#ffffff', '#000000'], ['#eeeeee', '#222222', '#888888']);
    expect(m['#000000']).toBe('#222222');
    expect(m['#ffffff']).toBe('#eeeeee');
  });
  it('un color usa el primero de la paleta', () => {
    expect(mapByLuminosity(['#123456'], ['#e11d48', '#ffffff'])['#123456']).toBe('#e11d48');
  });
  it('paleta vacía = sin mapeo', () => {
    expect(mapByLuminosity(['#000000'], [])).toEqual({});
  });
});

describe('data URLs', () => {
  it('ida y vuelta, con unicode', () => {
    const s = '<svg><text>ñandú</text></svg>';
    const u = encodeSvgDataUrl(s);
    expect(isSvgDataUrl(u)).toBe(true);
    expect(decodeSvgDataUrl(u)).toBe(s);
  });
  it('base64', () => {
    const u = 'data:image/svg+xml;base64,' + btoa('<svg/>');
    expect(decodeSvgDataUrl(u)).toBe('<svg/>');
  });
  it('no-SVG devuelve null', () => {
    expect(decodeSvgDataUrl('data:image/png;base64,AAAA')).toBeNull();
  });
});
