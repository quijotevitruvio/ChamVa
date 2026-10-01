import { describe, expect, it } from 'vitest';
import { hasTextGradient, runUsesGradient, sortedStops, textCanvasGradient, textGradientId } from './textGradient';
import { drawStyledText } from './styledText';
import { drawCurvedText } from './curvedText';
import type { Gradient, TextLayer } from './types';

const G: Gradient = { angle: 0, kind: 'linear', stops: [{ offset: 1, color: '#0000ff' }, { offset: 0, color: '#ff0000' }] };

function layer(over: Partial<TextLayer> = {}): TextLayer {
  return {
    id: 't1', type: 'text', name: 't', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
    visible: true, locked: false, blendMode: 'normal',
    text: 'Hola', fontFamily: 'Arial', fontSize: 20, fill: '#000000', align: 'left', bold: false, italic: false,
    textTransform: 'none', letterSpacing: 0, strokeColor: '#000', strokeWidth: 0, shadow: false,
    shadowColor: '#000', shadowBlur: 0, shadowX: 0, shadowY: 0,
    ...over,
  } as TextLayer;
}

// ctx falso que registra los fillStyle usados al llamar a fillText.
function fakeCtx() {
  const fills: unknown[] = [];
  const grads: { kind: string; args: number[]; stops: [number, string][] }[] = [];
  const mk = (kind: string, args: number[]) => {
    const g = { kind, args, stops: [] as [number, string][], addColorStop(o: number, c: string) { g.stops.push([o, c]); } };
    grads.push(g);
    return g;
  };
  const ctx: any = {
    fillStyle: '', font: '', letterSpacing: '',
    measureText: (t: string) => ({ width: t.length * 10 }),
    createLinearGradient: (...a: number[]) => mk('linear', a),
    createRadialGradient: (...a: number[]) => mk('radial', a),
    fillText() { fills.push(ctx.fillStyle); }, strokeText() {}, fillRect() {}, fill() {}, beginPath() {}, roundRect() {},
    save() {}, restore() {}, translate() {}, rotate() {},
  };
  return { ctx: ctx as CanvasRenderingContext2D, fills, grads };
}

describe('textGradient (lógica pura)', () => {
  it('detecta degradado y color base', () => {
    expect(hasTextGradient(layer())).toBe(false);
    expect(hasTextGradient(layer({ fillGradient: G }))).toBe(true);
    const l = layer({ fillGradient: G, fill: '#FFF' });
    expect(runUsesGradient(l, '#ffffff')).toBe(true);
    expect(runUsesGradient(l, '#123456')).toBe(false);
    expect(runUsesGradient(layer(), '#000000')).toBe(false);
  });
  it('ordena paradas', () => {
    expect(sortedStops(G).map((s) => s.offset)).toEqual([0, 1]);
  });
  it('id válido por capa', () => {
    expect(textGradientId('a b/c')).toBe('tg-abc');
  });
  it('radial y lineal sobre el cuadro', () => {
    const { ctx, grads } = fakeCtx();
    textCanvasGradient(ctx, G, 100, 40);
    textCanvasGradient(ctx, { ...G, kind: 'radial' }, 100, 40);
    expect(grads[0].kind).toBe('linear');
    expect(grads[1].args.slice(0, 2)).toEqual([50, 20]);
  });
});

describe('dibujo de texto', () => {
  it('sin degradado: color sólido como antes', () => {
    const { ctx, fills, grads } = fakeCtx();
    drawStyledText(ctx, layer());
    expect(fills).toEqual(['#000000']);
    expect(grads.length).toBe(0);
  });
  it('con degradado: CanvasGradient del cuadro medido', () => {
    const { ctx, fills, grads } = fakeCtx();
    drawStyledText(ctx, layer({ fillGradient: G }));
    expect(grads.length).toBe(1);
    expect(fills[0]).toBe(grads[0]);
  });
  it('span con color propio mantiene su color', () => {
    const { ctx, fills, grads } = fakeCtx();
    drawStyledText(ctx, layer({ fillGradient: G, spans: [{ start: 0, end: 2, color: '#00ff00' }] }));
    expect(fills).toEqual(['#00ff00', grads[0]]);
  });
  it('texto curvo con degradado', () => {
    const { ctx, fills, grads } = fakeCtx();
    drawCurvedText(ctx, layer({ fillGradient: G, curve: 90 }), 100, 50);
    expect(fills.length).toBe(4);
    expect(grads.length).toBe(4);
    const { ctx: c2, fills: f2 } = fakeCtx();
    drawCurvedText(c2, layer({ curve: 90 }), 100, 50);
    expect(f2).toEqual(['#000000', '#000000', '#000000', '#000000']);
  });
});
