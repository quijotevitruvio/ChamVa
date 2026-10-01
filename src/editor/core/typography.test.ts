import { describe, expect, it } from 'vitest';
import type { TextLayer } from './types';
import { applyKerning, fitFontSize, layoutText, nextTabStop, usesTypography, type MeasureRun } from './typography';
import {
  styledLines,
  runFont,
  applySpanStyle,
  scriptTarget,
  resolveCharStyles,
  compressCharStyles,
  baseStyle,
  remapSpans,
} from './richText';
import { measureStyledText } from './styledText';
import { changeCase, convertFractions, defaultFields, fieldsForDoc } from './textMacros';

const layer = (text: string, extra: Partial<TextLayer> = {}): TextLayer =>
  ({
    id: 't',
    type: 'text',
    name: 't',
    text,
    fontFamily: 'Arial',
    fontSize: 20,
    fill: '#ffffff',
    align: 'left',
    bold: false,
    italic: false,
    textTransform: 'none',
    letterSpacing: 0,
    strokeColor: '#000',
    strokeWidth: 0,
    shadow: false,
    shadowColor: '#000',
    shadowBlur: 0,
    shadowX: 0,
    shadowY: 0,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    ...extra,
  }) as TextLayer;

// Medida falsa: cada carácter ocupa media vez el tamaño de la fuente.
const sizeOfFont = (f: string) => Number(/([\d.]+)px/.exec(f)![1]);
const measure: MeasureRun = (l, run) => run.text.length * sizeOfFont(runFont(l, run)) * 0.5;
const fakeCtx = () => {
  const c: any = {
    font: '',
    letterSpacing: '',
    measureText(t: string) {
      return { width: t.length * sizeOfFont(c.font) * 0.5 };
    },
  };
  return c as CanvasRenderingContext2D;
};

describe('regresión: texto sin opciones nuevas', () => {
  // Copia literal de la medida de antes de la tipografía avanzada.
  const legacy = (ctx: CanvasRenderingContext2D, l: TextLayer) => {
    const lines = styledLines(l);
    const runWidths = lines.map((line) =>
      line.map((run) => {
        ctx.font = runFont(l, run);
        return ctx.measureText(run.text).width;
      }),
    );
    const widths = runWidths.map((ws) => ws.reduce((a, b) => a + b, 0));
    const boxW = Math.max(0, ...widths);
    const textH = lines.length * l.fontSize * (l.lineHeight ?? 1);
    const pad = l.textEffect === 'background' ? l.fontSize * 0.3 : 0;
    return { lines, runWidths, widths, boxW, textH, width: boxW + pad * 2, height: textH + pad * 2, pad };
  };
  const cases: TextLayer[] = [
    layer('Hola mundo'),
    layer('Línea uno\nLínea dos más larga\n\nfin', { lineHeight: 1.3, align: 'center' }),
    layer('Negrita y color', {
      spans: [
        { start: 0, end: 7, bold: true },
        { start: 10, end: 15, color: '#ff0000', underline: true },
      ],
    }),
    layer('uno\ndos\ntres', { listStyle: 'number', textTransform: 'caps' }),
    layer('Fondo y eco', { textEffect: 'background', letterSpacing: 2, fontSize: 33 }),
    layer('Eco', { textEffect: 'echo', bold: true, italic: true }),
  ];
  cases.forEach((l, i) => {
    it(`caso ${i}: mide igual que antes`, () => {
      expect(usesTypography(l)).toBe(false);
      const a = legacy(fakeCtx(), l);
      const b = measureStyledText(fakeCtx(), l);
      expect(b.lines).toEqual(a.lines);
      expect(b.runWidths).toEqual(a.runWidths);
      expect(b.widths).toEqual(a.widths);
      expect(b.boxW).toBe(a.boxW);
      expect(b.textH).toBe(a.textH);
      expect(b.width).toBe(a.width);
      expect(b.height).toBe(a.height);
      expect(b.pad).toBe(a.pad);
      expect(b.ys).toEqual(b.lines.map((_, k) => k * l.fontSize * (l.lineHeight ?? 1)));
      expect(b.xs.every((x) => x === 0)).toBe(true);
      expect(b.aw.every((x) => x === a.boxW)).toBe(true);
    });
  });
});

describe('autoajuste', () => {
  it('fitFontSize es monótono y respeta mín/máx', () => {
    const fits = (limit: number) => (s: number) => s <= limit;
    expect(fitFontSize(fits(30), 6, 100)).toBeLessThanOrEqual(30);
    expect(fitFontSize(fits(30), 6, 100)).toBeGreaterThan(29);
    expect(fitFontSize(fits(1000), 6, 100)).toBe(100);
    expect(fitFontSize(fits(2), 6, 100)).toBe(6);
    let prev = 0;
    for (const lim of [10, 20, 30, 40, 50, 60]) {
      const v = fitFontSize(fits(lim), 6, 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it('un texto largo se reduce hasta caber; uno corto no pasa de fitMax', () => {
    const long = layer('palabra '.repeat(40), { boxWidth: 300, boxHeight: 100, autoFit: true, fontSize: 60 });
    const lay = layoutText(long, measure);
    expect(lay.layer.fontSize).toBeLessThan(60);
    expect(lay.contentH).toBeLessThanOrEqual(100 + 0.01);
    const grown = layoutText({ ...long, fontSize: 60, text: 'hola', fitMax: 80 }, measure);
    expect(grown.layer.fontSize).toBeLessThanOrEqual(80);
    expect(grown.layer.fontSize).toBeGreaterThanOrEqual(60);
    const tiny = layoutText({ ...long, text: 'palabra '.repeat(4000), fitMin: 12 }, measure);
    expect(tiny.layer.fontSize).toBe(12);
  });
  it('más espacio nunca da un tamaño menor', () => {
    const base = layer('palabra '.repeat(60), { boxWidth: 200, autoFit: true, fontSize: 80 });
    let prev = 0;
    for (const h of [40, 80, 160, 320, 640]) {
      const s = layoutText({ ...base, boxHeight: h }, measure).layer.fontSize;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe('caja, sangría y párrafos', () => {
  it('salta de línea por palabras dentro del ancho', () => {
    const lay = layoutText(layer('aaaa bbbb cccc dddd', { boxWidth: 90 }), measure); // 10 px por letra
    expect(lay.lines.map((l) => l.map((r) => r.text).join(''))).toEqual(['aaaa bbbb', 'cccc dddd']);
    expect(lay.widths.every((w) => w <= 90)).toBe(true);
  });
  it('sangría solo en la primera línea de cada párrafo', () => {
    const lay = layoutText(layer('uno dos\ntres cuatro', { boxWidth: 400, indent: 30 }), measure);
    expect(lay.xs).toEqual([30, 30]);
    const wrapped = layoutText(layer('aaaa bbbb cccc', { boxWidth: 100, indent: 30 }), measure);
    expect(wrapped.xs[0]).toBe(30);
    expect(wrapped.xs[1]).toBe(0);
  });
  it('espacio entre párrafos separa solo entre párrafos', () => {
    const lay = layoutText(layer('a\nb\nc', { paragraphSpacing: 10 }), measure);
    expect(lay.ys).toEqual([0, 30, 60]);
    expect(lay.contentH).toBe(80);
  });
  it('las líneas de un mismo párrafo envuelto no llevan espacio extra', () => {
    const lay = layoutText(layer('aaaa bbbb cccc', { boxWidth: 50, paragraphSpacing: 10 }), measure);
    expect(lay.ys).toEqual([0, 20, 40]);
  });
});

describe('capitular', () => {
  it('quita la primera letra, sangra las N líneas y reserva altura', () => {
    const lay = layoutText(layer('Hola mundo cruel', { boxWidth: 100, dropCap: 'first', dropCapLines: 3 }), measure);
    expect(lay.drops).toHaveLength(1);
    expect(lay.drops[0].run.text).toBe('H');
    expect(lay.lines[0][0].text.startsWith('ola')).toBe(true);
    expect(lay.xs[0]).toBeGreaterThan(0);
    expect(lay.contentH).toBeGreaterThanOrEqual(3 * 20);
  });
  it('«all» pone una por párrafo, «first» solo la primera', () => {
    const t = 'Uno\nDos';
    expect(layoutText(layer(t, { dropCap: 'all' }), measure).drops).toHaveLength(2);
    expect(layoutText(layer(t, { dropCap: 'first' }), measure).drops).toHaveLength(1);
  });
});

describe('columnas', () => {
  const text = Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n');
  it('con altura de caja reparte las líneas llenando cada columna', () => {
    const lay = layoutText(layer(text, { boxWidth: 210, boxHeight: 80, columns: 3, columnGap: 15 }), measure);
    // 4 líneas por columna (20 px) → 3 columnas de 60 px de ancho
    expect(lay.xs.slice(0, 4).every((x) => x === 0)).toBe(true);
    expect(lay.xs.slice(4, 8).every((x) => x === 75)).toBe(true);
    expect(lay.xs.slice(8).every((x) => x === 150)).toBe(true);
    expect(lay.ys.slice(4, 8)).toEqual([0, 20, 40, 60]);
  });
  it('sin altura reparte en columnas equilibradas', () => {
    const lay = layoutText(layer(text, { boxWidth: 210, columns: 2, columnGap: 10 }), measure);
    expect(lay.xs.filter((x) => x === 0).length).toBe(6);
    expect(lay.contentH).toBe(120);
  });
  it('el ancho de cada línea no pasa del de la columna', () => {
    const lay = layoutText(
      layer('aa bb cc dd ee ff gg hh', { boxWidth: 130, columns: 2, columnGap: 10, boxHeight: 60 }),
      measure,
    );
    expect(lay.widths.every((w) => w <= 60 + 0.01)).toBe(true);
  });
});

describe('tabulaciones', () => {
  it('avanza a la siguiente parada (def. cada 4 em)', () => {
    expect(nextTabStop(0, undefined, 20)).toBe(80);
    expect(nextTabStop(30, undefined, 20)).toBe(80);
    expect(nextTabStop(80, undefined, 20)).toBe(160);
    expect(nextTabStop(10, [50, 120], 20)).toBe(50);
    expect(nextTabStop(60, [50, 120], 20)).toBe(120);
    expect(nextTabStop(130, [50, 120], 20)).toBe(160);
  });
  it('la tabulación ocupa hasta la parada y trae el relleno de puntos', () => {
    const lay = layoutText(layer('Cap 1\t12', { tabLeader: 'dots', tabStops: [200] }), measure);
    const runs = lay.lines[0];
    const i = runs.findIndex((r) => r.tab);
    expect(runs[i].leader).toBe('.');
    const before = lay.runWidths[0].slice(0, i).reduce((a, b) => a + b, 0);
    expect(before + lay.runWidths[0][i]).toBe(200);
  });
});

describe('kerning', () => {
  it('parte el tramo en la pareja y aplica dx', () => {
    const runs = applyKerning(
      [{ text: 'AVION', bold: false, italic: false, underline: false, color: '#fff' }],
      { AV: -3 },
    );
    expect(runs.map((r) => r.text)).toEqual(['A', 'VION']);
    expect(runs[1].dx).toBe(-3);
  });
  it('encoge la línea en el valor del ajuste', () => {
    const a = layoutText(layer('AVION', { kerning: { AV: -3 } }), measure);
    const b = layoutText(layer('AVION'), measure);
    expect(a.widths[0]).toBe(b.widths[0] - 3);
  });
});

describe('sup/sub y fracciones', () => {
  it('un tramo con script se mide con fuente menor', () => {
    const l = layer('x2', { spans: [{ start: 1, end: 2, script: 'sup' }] });
    const lay = layoutText(l, measure);
    expect(lay.runWidths[0][1]).toBeLessThan(lay.runWidths[0][0]);
    expect(usesTypography(l)).toBe(true);
  });
  it('applySpanStyle y scriptTarget alternan', () => {
    const l = layer('H2O');
    const spans = applySpanStyle(l, 1, 2, { script: 'sub' });
    expect(spans).toEqual([{ start: 1, end: 2, script: 'sub' }]);
    const l2 = { ...l, spans };
    expect(scriptTarget(l2, 1, 2, 'sub')).toBe('none');
    expect(scriptTarget(l2, 0, 3, 'sub')).toBe('sub');
    expect(scriptTarget(l2, 1, 2, 'sup')).toBe('sup');
    expect(applySpanStyle(l2, 1, 2, { script: 'none' })).toEqual([]);
    expect(resolveCharStyles(l2)[1].script).toBe('sub');
    expect(remapSpans(spans, 'H2O', 'H22O')?.[0]).toMatchObject({ script: 'sub' });
    expect(compressCharStyles(resolveCharStyles(l2), baseStyle(l))).toEqual(spans);
  });
  it('convierte 1/2 y 3/4 en fracciones Unicode sin tocar fechas ni 11/2', () => {
    expect(convertFractions('1/2 taza y 3/4 de sal')).toBe('½ taza y ¾ de sal');
    expect(convertFractions('11/2 y 1/20 y 5/2/2024')).toBe('11/2 y 1/20 y 5/2/2024');
    const lay = styledLines(layer('1/2 y 3/4', { fractions: true }));
    expect(lay[0].map((r) => r.text).join('')).toBe('½ y ¾');
    expect(styledLines(layer('1/2')).flat().map((r) => r.text).join('')).toBe('1/2');
  });
});

describe('mayúsculas', () => {
  const t = 'hola MUNDO. esto es una PRUEBA';
  it('cada modo', () => {
    expect(changeCase(t, 'upper')).toBe('HOLA MUNDO. ESTO ES UNA PRUEBA');
    expect(changeCase(t, 'lower')).toBe('hola mundo. esto es una prueba');
    expect(changeCase(t, 'title')).toBe('Hola Mundo. Esto Es Una Prueba');
    expect(changeCase(t, 'sentence')).toBe('Hola mundo. Esto es una prueba');
    expect(changeCase('abcd', 'alternate')).toBe('aBcD');
  });
  it('solo el rango y sin cambiar el largo', () => {
    expect(changeCase('hola mundo', 'upper', 5, 10)).toBe('hola MUNDO');
    expect(changeCase('straße', 'upper')).toHaveLength(6);
  });
});

describe('campos dinámicos', () => {
  const f = defaultFields({ pagina: '3', total: '7', diseno: 'Mi folleto' }, new Date(2026, 9, 1, 8, 5));
  it('valores por defecto', () => {
    expect(f.fecha).toBe('01/10/2026');
    expect(f.hora).toBe('08:05');
  });
  it('se sustituyen al dibujar y respetan el estilo', () => {
    const l = layer('Pág. {{pagina}} de {{total}} - {{diseno}} {{nada}}', {
      spans: [{ start: 5, end: 15, bold: true }],
    });
    const lines = styledLines(l, { fields: f });
    expect(lines[0].map((r) => r.text).join('')).toBe('Pág. 3 de 7 - Mi folleto {{nada}}');
    expect(lines[0].some((r) => r.bold && r.text === '3')).toBe(true);
    expect(l.text).toContain('{{pagina}}'); // el texto guardado no cambia
  });
  it('fieldsForDoc usa la posición real de la página', () => {
    const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const v = fieldsForDoc({ id: 'b', name: 'X' }, pages);
    expect([v.pagina, v.total, v.diseno]).toEqual(['2', '3', 'X']);
    const solo = fieldsForDoc({ id: 'zzz' }, pages);
    expect([solo.pagina, solo.total]).toEqual(['1', '1']);
  });
});

describe('regresión: opciones de tipografía SIN caja de ancho fijo', () => {
  // Sin boxWidth el ancho de columna es Infinity; 0 * Infinity = NaN dejaba el texto sin dibujar.
  const casos: [string, Partial<TextLayer>, string][] = [
    ['subíndice', { spans: [{ start: 1, end: 2, script: 'sub' }] }, 'H2O'],
    ['kerning', { kerning: { AV: -6 } }, 'AVA'],
    ['fracciones', { fractions: true }, '1/2 y 3/4'],
    ['tabulación', { tabLeader: 'dots' }, 'Capítulo\t12'],
    ['sangría', { indent: 20 }, 'Hola mundo'],
    ['campos', {}, 'Página {{pagina}} de {{total}}'],
  ];
  for (const [nombre, extra, texto] of casos) {
    it(`${nombre}: ancho finito y positivo`, () => {
      const m = measureStyledText(fakeCtx(), layer(texto, extra));
      expect(Number.isFinite(m.width)).toBe(true);
      expect(m.width).toBeGreaterThan(0);
      expect(Number.isFinite(m.boxW)).toBe(true);
      for (const a of m.aw) expect(Number.isFinite(a)).toBe(true);
    });
  }
});
