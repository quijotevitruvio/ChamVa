import { describe, expect, it } from 'vitest';
import * as VM from '../model';
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_TITLE_STYLE } from '../title/style';
import { parseSrt } from '../title/srt';
import { replaceCues, setSubtitleStyle } from '../title/subtitles';
import { composeFrame } from './compose';
import { drawTitleClip, layoutTitle, measureTitleClip } from './titleDraw';

interface Draw {
  op: 'fill' | 'stroke';
  text: string;
  x: number;
  y: number;
  scale: number;
  alpha: number;
  fill: string;
}

/** Contexto 2D de pega: matriz de transformación, pila de estados y medida de texto de 0,5 em por carácter. */
function fakeCtx() {
  const draws: Draw[] = [];
  const boxes: { alpha: number; w: number; h: number; color: string }[] = [];
  let m = [1, 0, 0, 1, 0, 0]; // a b c d e f
  const stack: { m: number[]; s: Record<string, unknown> }[] = [];
  const s: Record<string, unknown> = { font: '10px sans-serif', fillStyle: '#000', globalAlpha: 1, letterSpacing: '0px', textBaseline: 'alphabetic', textAlign: 'start' };
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(s.font))?.[1] ?? 10);
  const mul = (n: number[]) => {
    const [a, b, c, d, e, f] = m;
    m = [a * n[0] + c * n[1], b * n[0] + d * n[1], a * n[2] + c * n[3], b * n[2] + d * n[3], a * n[4] + c * n[5] + e, b * n[4] + d * n[5] + f];
  };
  const api: Record<string, unknown> = {
    save: () => stack.push({ m: [...m], s: { ...s } }),
    restore: () => {
      const t = stack.pop();
      if (t) {
        m = t.m;
        Object.assign(s, t.s);
      }
    },
    translate: (x: number, y: number) => mul([1, 0, 0, 1, x, y]),
    scale: (x: number, y: number) => mul([x, 0, 0, y, 0, 0]),
    rotate: (r: number) => mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]),
    measureText: (t: string) => ({ width: Array.from(t).length * px() * 0.5 }),
    fillText: (t: string, x: number, y: number) => draws.push({ op: 'fill', text: t, x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5], scale: m[0], alpha: s.globalAlpha as number, fill: String(s.fillStyle) }),
    strokeText: (t: string, x: number, y: number) => draws.push({ op: 'stroke', text: t, x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5], scale: m[0], alpha: s.globalAlpha as number, fill: String(s.strokeStyle) }),
    fillRect: () => {},
    beginPath: () => {},
    roundRect: (_x: number, _y: number, w: number, h: number) => boxes.push({ alpha: s.globalAlpha as number, w, h, color: String(s.fillStyle) }),
    rect: () => {},
    fill: () => {},
    arcTo: () => {},
    moveTo: () => {},
    closePath: () => {},
  };
  const ctx = new Proxy(api, {
    get: (_t, k: string) => (k in api ? api[k] : s[k]),
    set: (_t, k: string, v) => {
      s[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, draws, boxes };
}

const W = 1280;
const H = 720;
const fills = (d: Draw[]) => d.filter((x) => x.op === 'fill' && x.text.trim() !== '');

const title = (o: Partial<VM.Clip> = {}) => VM.makeClip('text', { id: 't', text: 'Hola mundo cruel', start: 2, outP: 4, tstyle: { ...DEFAULT_TITLE_STYLE, shadow: false }, ...o });

describe('drawTitleClip: qué camino toma', () => {
  it('el texto de V1 (sin estilo) no lo toma: se dibuja como siempre', () => {
    const { ctx, draws } = fakeCtx();
    expect(drawTitleClip(ctx, W, H, VM.makeClip('text', { text: 'x', outP: 3 }), 1, 10, 1)).toBe(false);
    expect(draws).toEqual([]);
  });
  it('un título con estilo, sí', () => {
    const { ctx, draws } = fakeCtx();
    expect(drawTitleClip(ctx, W, H, title(), 3, 10, 1)).toBe(true);
    expect(fills(draws).length).toBeGreaterThan(0);
  });
  it('un subtítulo sin estilo de pista no dibuja nada pero no cae al camino de V1', () => {
    const { ctx, draws } = fakeCtx();
    expect(drawTitleClip(ctx, W, H, VM.makeClip('subtitle', { text: 'x', outP: 3 }), 1, 10, 1)).toBe(true);
    expect(draws).toEqual([]);
  });
  it('el texto vacío no dibuja', () => {
    const { ctx, draws } = fakeCtx();
    drawTitleClip(ctx, W, H, title({ text: '  ' }), 3, 10, 1);
    expect(draws).toEqual([]);
  });
});

describe('animación de entrada y salida en el tiempo', () => {
  const clip = title({ anim: { in: 'fade', out: 'fade', inDur: 1, outDur: 1 } });
  const alphaAt = (t: number) => {
    const { ctx, draws } = fakeCtx();
    drawTitleClip(ctx, W, H, clip, t, 10, 1);
    return fills(draws).length ? Math.max(...fills(draws).map((d) => d.alpha)) : 0;
  };
  it('aparece, se mantiene y desaparece', () => {
    expect(alphaAt(2)).toBe(0); // justo al empezar: invisible
    expect(alphaAt(2.3)).toBeGreaterThan(0.3);
    expect(alphaAt(2.3)).toBeLessThan(1);
    expect(alphaAt(3.2)).toBe(1);
    expect(alphaAt(4.5)).toBe(1);
    expect(alphaAt(5.8)).toBeLessThan(1);
    expect(alphaAt(5.8)).toBeGreaterThan(0);
    expect(alphaAt(6)).toBe(0); // en el final exacto ya se retiró
  });
  it('la entrada «subir» mueve el texto y acaba en su sitio', () => {
    const c = title({ anim: { in: 'slideUp', inDur: 1 } });
    const y = (t: number) => {
      const { ctx, draws } = fakeCtx();
      drawTitleClip(ctx, W, H, c, t, 10, 1);
      return fills(draws)[0]?.y ?? NaN;
    };
    const rest = y(4);
    expect(y(2.1)).toBeGreaterThan(rest); // más abajo al principio
    expect(y(2.5)).toBeGreaterThan(rest);
    expect(y(2.5)).toBeLessThan(y(2.1));
    expect(y(3)).toBeCloseTo(rest, 6);
  });
  it('la escala de «pop» crece y la rotación del énfasis oscila', () => {
    const c = title({ anim: { in: 'scale', inDur: 1 } });
    const sc = (t: number) => {
      const { ctx, draws } = fakeCtx();
      drawTitleClip(ctx, W, H, c, t, 10, 1);
      return fills(draws)[0]?.scale ?? 0;
    };
    expect(sc(2.2)).toBeLessThan(sc(2.8));
    expect(sc(3)).toBeCloseTo(1, 6);
    const e = title({ anim: { emphasis: 'pulse', emphasisSpeed: 1 } });
    const at = (t: number) => {
      const { ctx, draws } = fakeCtx();
      drawTitleClip(ctx, W, H, e, t, 10, 1);
      return fills(draws)[0].scale;
    };
    expect(at(2.25)).toBeGreaterThan(1.05);
    expect(at(2.75)).toBeLessThan(0.95);
    expect(at(2)).toBeCloseTo(1, 6);
  });
  it('es determinista: el mismo instante da las mismas llamadas', () => {
    const run = () => {
      const { ctx, draws } = fakeCtx();
      drawTitleClip(ctx, W, H, title({ anim: { in: 'bounce', unit: 'letter', inDur: 1, emphasis: 'wiggle' } }), 2.37, 10, 1);
      return draws;
    };
    expect(run()).toEqual(run());
  });
});

describe('por palabra y por letra', () => {
  it('máquina de escribir: aparecen letras de una en una', () => {
    const c = title({ text: 'ABCDEFGH', anim: { in: 'typewriter', inDur: 1 } });
    const shown = (t: number) => {
      const { ctx, draws } = fakeCtx();
      drawTitleClip(ctx, W, H, c, t, 10, 1);
      return fills(draws).map((d) => d.text).join('');
    };
    expect(shown(2)).toBe('');
    expect(shown(2.2)).toBe('AB');
    expect(shown(2.5)).toBe('ABCD');
    expect(shown(3)).toBe('ABCDEFGH');
    expect(shown(7)).toBe('ABCDEFGH');
  });
  it('palabra a palabra: la primera va por delante de la última', () => {
    const c = title({ text: 'uno dos tres cuatro', anim: { in: 'fade', unit: 'word', inDur: 1, stagger: 0.7 } });
    const { ctx, draws } = fakeCtx();
    drawTitleClip(ctx, W, H, c, 2.6, 10, 1);
    const f = fills(draws);
    expect(f.map((d) => d.text)).toEqual(['uno', 'dos', 'tres', 'cuatro']);
    expect(f[0].alpha).toBeGreaterThan(f[3].alpha);
  });
  it('en reposo, por palabra y de una pieza ocupan lo mismo (misma caja)', () => {
    const whole = fakeCtx();
    const parts = fakeCtx();
    drawTitleClip(whole.ctx, W, H, title({ text: 'uno dos tres' }), 4, 10, 1);
    drawTitleClip(parts.ctx, W, H, title({ text: 'uno dos tres', anim: { in: 'fade', unit: 'word', inDur: 0.2 } }), 4, 10, 1);
    const x0 = fills(whole.draws)[0].x;
    expect(fills(parts.draws)[0].x).toBeCloseTo(x0, 6);
    expect(fills(parts.draws).map((d) => d.text)).toEqual(['uno', 'dos', 'tres']);
  });
});

describe('karaoke', () => {
  const k = { color: '#ffd84d', scale: 1.2, keep: false };
  const clip = title({ text: 'uno dos tres', outP: 3, start: 0, tstyle: { ...DEFAULT_TITLE_STYLE, shadow: false, fill: '#ffffff' }, anim: { karaoke: k }, words: [
    { text: 'uno', start: 0, end: 1 },
    { text: 'dos', start: 1, end: 2 },
    { text: 'tres', start: 2, end: 3 },
  ] });
  const at = (t: number) => {
    const { ctx, draws } = fakeCtx();
    drawTitleClip(ctx, W, H, clip, t, 10, 1);
    return fills(draws);
  };
  it('la palabra activa cambia de color y de escala con el tiempo', () => {
    expect(at(0.5).map((d) => d.fill)).toEqual(['#ffd84d', '#ffffff', '#ffffff']);
    expect(at(1.5).map((d) => d.fill)).toEqual(['#ffffff', '#ffd84d', '#ffffff']);
    expect(at(2.5).map((d) => d.fill)).toEqual(['#ffffff', '#ffffff', '#ffd84d']);
    expect(at(1.5)[1].scale).toBeCloseTo(1.2, 6);
    expect(at(1.5)[0].scale).toBe(1);
  });
  it('keep: las dichas se quedan en el color', () => {
    const c2 = { ...clip, anim: { karaoke: { ...k, keep: true } } };
    const { ctx, draws } = fakeCtx();
    drawTitleClip(ctx, W, H, c2, 2.5, 10, 1);
    expect(fills(draws).map((d) => d.fill)).toEqual(['#ffd84d', '#ffd84d', '#ffd84d']);
  });
  it('la palabra activa empuja a las vecinas: el espacio entre palabras no cambia y la línea sigue centrada', () => {
    const px = 96 * (H / 1080);
    const space = px * 0.5; // medida de pega: 0,5 em por carácter
    for (const t of [0.5, 1.5, 2.5]) {
      const f = at(t);
      for (let i = 0; i + 1 < f.length; i++) {
        const right = f[i].x + f[i].scale * f[i].text.length * px * 0.5;
        expect(f[i + 1].x - right).toBeCloseTo(space, 5);
      }
      const left = f[0].x;
      const right = f[2].x + f[2].scale * f[2].text.length * px * 0.5;
      expect((left + right) / 2).toBeCloseTo(W / 2, 4); // centrada con cualquier palabra activa
    }
  });
});

describe('subtítulos', () => {
  const sub = { ...DEFAULT_SUBTITLE_STYLE, style: { ...DEFAULT_SUBTITLE_STYLE.style, strokeWidth: 0 } };
  const cue = (text: string) => VM.makeClip('subtitle', { id: 's', text, start: 0, outP: 3 });
  const lines = (text: string, s = sub) => {
    const { ctx, draws } = fakeCtx();
    drawTitleClip(ctx, W, H, cue(text), 1, 10, 1, s);
    return fills(draws);
  };
  it('abajo por defecto: el texto queda en el tercio inferior, centrado', () => {
    const f = lines('Hola mundo');
    expect(f).toHaveLength(1);
    expect(f[0].y).toBeGreaterThan(H * 0.8);
    expect(f[0].y).toBeLessThan(H);
    // centrado: el centro del texto está en el centro del ancho
    expect(f[0].x + (Array.from(f[0].text).length * 52 * (H / 1080) * 0.5) / 2).toBeCloseTo(W / 2, 0);
  });
  it('arriba y en el centro', () => {
    expect(lines('Hola', { ...sub, position: 'top' })[0].y).toBeLessThan(H * 0.2);
    const mid = lines('Hola', { ...sub, position: 'middle' })[0].y;
    expect(mid).toBeGreaterThan(H * 0.4);
    expect(mid).toBeLessThan(H * 0.6);
  });
  it('un texto largo salta de línea por ancho y no pasa de 2 líneas', () => {
    const long = 'Esta es una frase bastante larga para comprobar que el subtítulo salta de línea sola';
    const f = lines(long);
    const ys = new Set(f.map((d) => Math.round(d.y)));
    expect(ys.size).toBe(2);
    expect(f.map((d) => d.text).join(' ')).toBe(long.split('\n')[0]); // línea a línea, todas las palabras
    const lay = fakeCtx();
    const l = layoutTitle(lay.ctx, long, sub.style, W, H, { maxLines: 2 });
    expect(l.lines.length).toBeLessThanOrEqual(2);
    expect(l.width).toBeLessThanOrEqual(W * 0.86 + 1);
  });
  it('con más líneas el bloque crece hacia arriba (el borde de abajo no se mueve)', () => {
    const bottom = (text: string) => Math.max(...lines(text).map((d) => d.y));
    expect(bottom('Corto')).toBeCloseTo(bottom('Una frase larga que ocupa dos renglones completos de este video de prueba'), -1);
  });
  it('mide la caja para las manijas', () => {
    const { ctx } = fakeCtx();
    const m = measureTitleClip(ctx, cue('Hola'), W, H, sub)!;
    expect(m.width).toBeGreaterThan(0);
    expect(m.fontPx).toBeCloseTo(52 * (H / 1080), 6);
  });
  it('fundido del estilo y karaoke de la pista', () => {
    const s2 = { ...sub, fade: 0.5, karaoke: { color: '#0f0', scale: 1, keep: false } };
    const f0 = lines('uno dos', s2);
    expect(f0.length).toBe(2);
    const { ctx, draws } = fakeCtx();
    drawTitleClip(ctx, W, H, cue('uno dos'), 0.1, 10, 1, s2);
    expect(fills(draws)[0].alpha).toBeLessThan(1);
  });
});

describe('composeFrame con títulos y subtítulos', () => {
  const build = () => {
    let p = VM.createProject();
    p = VM.addTrack(p, 'video', { id: 'V' });
    p = VM.addClip(p, 'V', VM.makeClip('text', { id: 'bg', text: ' ', start: 0, outP: 10 }));
    p = VM.addTrack(p, 'video', { id: 'T' });
    p = VM.addClip(p, 'T', title({ anim: { in: 'fade', out: 'fade' } }));
    p = VM.addTrack(p, 'subtitle', { id: 'S' });
    p = replaceCues(p, 'S', parseSrt('1\n00:00:01,000 --> 00:00:03,000\nPrimero\n\n2\n00:00:05,000 --> 00:00:07,000\nSegundo\n').cues, { ids: ['c1', 'c2'] }).p;
    return p;
  };
  const textsAt = (p: VM.VideoProject, t: number) => {
    const { ctx, draws } = fakeCtx();
    composeFrame(ctx, p, t, VM.projectDuration(p), W, H, 'contain', { video: () => null, image: () => null });
    return fills(draws).map((d) => d.text).join('');
  };
  it('cada texto aparece y desaparece en su momento', () => {
    const p = build();
    expect(VM.projectDuration(p)).toBe(10);
    expect(textsAt(p, 0.5)).toBe('');
    expect(textsAt(p, 1.5)).toBe('Primero');
    expect(textsAt(p, 2)).toBe('Primero'); // el título entra con un fundido: en su primer instante aún no se ve
    expect(textsAt(p, 2.5)).toContain('Hola');
    expect(textsAt(p, 3.5)).toContain('Hola');
    expect(textsAt(p, 3.5)).not.toContain('Primero');
    expect(textsAt(p, 5.5)).toContain('Segundo');
    expect(textsAt(p, 7.5)).not.toContain('Segundo');
    expect(textsAt(p, 6.99)).toContain('Segundo');
    expect(textsAt(p, 7)).not.toContain('Segundo');
  });
  it('pista oculta: no se dibuja (exportar sin subtítulos incrustados)', () => {
    const p = VM.updateTrack(build(), 'S', { hidden: true });
    expect(textsAt(p, 1.5)).toBe('');
    expect(textsAt(p, 3.5)).toContain('Hola');
  });
  it('el estilo global cambia todos los subtítulos de la pista', () => {
    let p = build();
    const y = (t: number) => {
      const { ctx, draws } = fakeCtx();
      composeFrame(ctx, p, t, 10, W, H, 'contain', { video: () => null, image: () => null });
      return fills(draws).find((d) => d.text === 'Primero' || d.text === 'Segundo')!.y;
    };
    const before = [y(1.5), y(5.5)];
    p = setSubtitleStyle(p, 'S', { position: 'top' });
    const after = [y(1.5), y(5.5)];
    expect(before.every((v) => v > H / 2)).toBe(true);
    expect(after.every((v) => v < H / 2)).toBe(true);
  });
  it('un subtítulo va encima de un título', () => {
    let p = build();
    p = replaceCues(p, 'S', [{ start: 3, end: 4, text: 'Encima' }]).p;
    const { ctx, draws } = fakeCtx();
    composeFrame(ctx, p, 3.5, 10, W, H, 'contain', { video: () => null, image: () => null });
    const order = fills(draws).map((d) => d.text);
    expect(order.indexOf('Encima')).toBeGreaterThan(order.indexOf('Hola'));
  });
});
