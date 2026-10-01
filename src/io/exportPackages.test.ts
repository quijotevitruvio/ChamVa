import { describe, expect, it } from 'vitest';
import {
  buildIcoFromPngs,
  cssSafeName,
  faviconHtml,
  iconPlan,
  siteWebmanifest,
  sliceRects,
  spriteCss,
  spriteJson,
  spriteLayout,
  uniformLines,
  uniqueNames,
} from './exportPackages';
import { makeZip } from './zip';

describe('iconPlan', () => {
  it('Android: 5 densidades + Play Store, en carpetas mipmap', () => {
    const p = iconPlan(['android']);
    expect(p.map((x) => x.size)).toEqual([48, 72, 96, 144, 192, 512]);
    expect(p[0].path).toBe('android/mipmap-mdpi/ic_launcher.png');
  });
  it('iOS: de 20 a 1024 y opacos', () => {
    const p = iconPlan(['ios']);
    expect(p[0].size).toBe(20);
    expect(p[p.length - 1].size).toBe(1024);
    expect(p.every((x) => x.opaque)).toBe(true);
  });
  it('macOS: iconset con 10 PNG', () => {
    const p = iconPlan(['macos']);
    expect(p).toHaveLength(10);
    expect(p.every((x) => x.path.startsWith('macos/icon.iconset/'))).toBe(true);
  });
  it('PWA: 192/512 y sus versiones maskable', () => {
    const p = iconPlan(['pwa']);
    expect(p.filter((x) => x.maskable).map((x) => x.size)).toEqual([192, 512]);
  });
  it('rutas únicas', () => {
    const p = iconPlan(['android', 'ios', 'windows', 'macos', 'pwa']);
    expect(new Set(p.map((x) => x.path)).size).toBe(p.length);
  });
});

describe('estructura de ZIP', () => {
  it('el ZIP con carpetas se escribe con las rutas pedidas', () => {
    const zip = makeZip([
      { name: 'android/mipmap-mdpi/ic_launcher.png', data: new Uint8Array([1, 2, 3]) },
      { name: 'LEEME.txt', data: new TextEncoder().encode('hola') },
    ]);
    const text = new TextDecoder('latin1').decode(zip);
    expect(text).toContain('android/mipmap-mdpi/ic_launcher.png');
    expect(text).toContain('LEEME.txt');
    expect(zip[0]).toBe(0x50); // «PK»
    expect(zip[1]).toBe(0x4b);
  });
});

describe('ICO', () => {
  it('cabecera, número de entradas y offsets', () => {
    const a = new Uint8Array(10).fill(1);
    const b = new Uint8Array(20).fill(2);
    const ico = buildIcoFromPngs([
      { size: 16, data: a },
      { size: 256, data: b },
    ]);
    const v = new DataView(ico.buffer);
    expect(v.getUint16(2, true)).toBe(1);
    expect(v.getUint16(4, true)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[6 + 16]).toBe(0); // 256 se guarda como 0
    expect(v.getUint32(6 + 12, true)).toBe(6 + 32);
    expect(v.getUint32(6 + 16 + 12, true)).toBe(6 + 32 + 10);
    expect(ico.length).toBe(6 + 32 + 30);
  });
});

describe('favicon', () => {
  it('el bloque HTML enlaza todos los archivos', () => {
    const h = faviconHtml('#112233');
    expect(h).toContain('favicon.ico');
    expect(h).toContain('apple-touch-icon.png');
    expect(h).toContain('site.webmanifest');
    expect(h).toContain('#112233');
  });
  it('el manifiesto es JSON válido con 2 iconos', () => {
    const m = JSON.parse(siteWebmanifest('Mi app'));
    expect(m.name).toBe('Mi app');
    expect(m.icons).toHaveLength(2);
  });
});

describe('sprites', () => {
  const items = [
    { name: 'a', w: 10, h: 10 },
    { name: 'b', w: 20, h: 10 },
    { name: 'c', w: 10, h: 30 },
  ];
  it('cuadrícula de 2 columnas con separación', () => {
    const l = spriteLayout(items, 'grid', 2, 4);
    // celda 20×30
    expect(l.width).toBe(44);
    expect(l.height).toBe(64);
    expect(l.frames[1]).toEqual({ name: 'b', x: 24, y: 0, w: 20, h: 10 });
    expect(l.frames[2]).toEqual({ name: 'c', x: 0, y: 34, w: 10, h: 30 });
  });
  it('tira horizontal y vertical', () => {
    const h = spriteLayout(items, 'strip-h', 9, 0);
    expect(h.height).toBe(30);
    expect(h.width).toBe(60);
    const v = spriteLayout(items, 'strip-v', 9, 0);
    expect(v.width).toBe(20);
    expect(v.height).toBe(90);
  });
  it('JSON y CSS con las coordenadas', () => {
    const l = spriteLayout(items, 'strip-h', 1, 0);
    const j = JSON.parse(spriteJson(l));
    expect(j.meta.size).toEqual({ w: 60, h: 30 });
    expect(j.frames.b).toEqual({ x: 20, y: 0, w: 20, h: 10 });
    expect(spriteCss(l)).toContain('.sprite-b { width: 20px; height: 10px; background-position: -20px 0px; }');
  });
  it('nombres únicos y seguros', () => {
    expect(uniqueNames(['x', 'x', 'y', 'x'])).toEqual(['x', 'x-2', 'y', 'x-3']);
    expect(cssSafeName('Botón Grande!')).toBe('boton-grande');
  });
});

describe('rebanadas', () => {
  it('una línea vertical y otra horizontal dan 4 rectángulos numerados', () => {
    const r = sliceRects(100, 60, [40], [20]);
    expect(r).toHaveLength(4);
    expect(r[0]).toEqual({ x: 0, y: 0, w: 40, h: 20, name: '01' });
    expect(r[3]).toEqual({ x: 40, y: 20, w: 60, h: 40, name: '04' });
  });
  it('ignora líneas en el borde, fuera o repetidas', () => {
    expect(sliceRects(100, 100, [0, 100, 150, 50, 50], [])).toHaveLength(2);
  });
  it('las rebanadas cubren todo el lienzo', () => {
    const r = sliceRects(97, 53, [10, 33, 70], [7, 40]);
    expect(r.reduce((a, s) => a + s.w * s.h, 0)).toBe(97 * 53);
  });
  it('cuadrícula uniforme N×M', () => {
    const { xs, ys } = uniformLines(300, 200, 3, 2);
    expect(xs).toEqual([100, 200]);
    expect(ys).toEqual([100]);
    expect(sliceRects(300, 200, xs, ys)).toHaveLength(6);
  });
});
