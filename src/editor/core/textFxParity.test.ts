// Paridad: un texto SIN campos de efectos nuevos se mide y se dibuja con las mismas
// llamadas al contexto 2D que antes de existir textFx. La instantánea se generó con
// el código anterior a los efectos; cualquier cambio en el dibujo normal la rompe.
import { describe, expect, it } from 'vitest';
import { drawStyledText, measureStyledText } from './styledText';
import { drawCurvedText, measureCurved } from './curvedText';
import type { TextLayer } from './types';

function recorder() {
  const log: string[] = [];
  let font = '16px Arial';
  const ctx: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'measureText') {
          return (s: string) => {
            log.push(`measureText(${JSON.stringify(s)})`);
            const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
            return { width: s.length * px * 0.5 };
          };
        }
        if (prop === 'font') return font;
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
          return (...a: unknown[]) => {
            log.push(`${prop}(${a.map((v) => Number(v).toFixed(2)).join(',')})`);
            return { addColorStop: (o: number, c: string) => log.push(`stop(${o},${c})`) };
          };
        return (...a: unknown[]) => log.push(`${prop}(${a.map((v) => (typeof v === 'number' ? v.toFixed(3) : String(v))).join(',')})`);
      },
      set(_t, prop: string, v: unknown) {
        if (prop === 'font') font = String(v);
        log.push(`set ${prop}=${typeof v === 'number' ? v.toFixed(3) : String(v)}`);
        return true;
      },
    },
  );
  return { ctx: ctx as CanvasRenderingContext2D, log };
}

const base: TextLayer = {
  id: 't1', type: 'text', name: 't', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, visible: true, locked: false,
  blendMode: 'normal',
  text: 'Hola mundo\nSegunda línea', fontFamily: 'Arial', fontSize: 40, fill: '#112233', align: 'center', bold: true, italic: false,
  textTransform: 'none', letterSpacing: 1, strokeColor: '#ff0000', strokeWidth: 0, shadow: false, shadowColor: '#000', shadowBlur: 4,
  shadowX: 2, shadowY: 2,
} as unknown as TextLayer;

const variants: Record<string, TextLayer> = {
  plano: base,
  contorno_sombra: { ...base, strokeWidth: 3, shadow: true },
  eco: { ...base, textEffect: 'echo', effectColor: '#00ff00' },
  fondo: { ...base, textEffect: 'background', effectColor: '#000000', underline: true },
  degradado: { ...base, fillGradient: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] } as any },
  spans: { ...base, spans: [{ start: 0, end: 4, color: '#00ff00', italic: true }] },
  caja: { ...base, boxWidth: 200, boxHeight: 150, columns: 2 },
};

describe('paridad del dibujo sin efectos nuevos', () => {
  for (const [name, layer] of Object.entries(variants)) {
    it(`recto: ${name}`, () => {
      const { ctx, log } = recorder();
      const m = measureStyledText(ctx, layer);
      drawStyledText(ctx, layer);
      expect({ w: m.width, h: m.height, log }).toMatchSnapshot();
    });
  }
  it('curvo', () => {
    const { ctx, log } = recorder();
    const l = { ...base, curve: 120, strokeWidth: 2 };
    const m = measureCurved(ctx, l);
    drawCurvedText(ctx, l, m.width, m.height);
    expect({ w: m.width, h: m.height, log }).toMatchSnapshot();
  });
});
