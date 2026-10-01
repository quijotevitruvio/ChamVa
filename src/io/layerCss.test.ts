import { describe, expect, it } from 'vitest';
import { layerToCss } from './layerCss';
import type { Layer } from '../editor/core/types';

const base = { id: 'a', name: 'Botón Rojo', x: 10.123, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, blendMode: 'normal', visible: true, locked: false };

describe('layerToCss', () => {
  it('forma con degradado, borde, radio, sombra, giro y opacidad', () => {
    const l = {
      ...base,
      type: 'shape',
      shape: 'rect',
      width: 100,
      height: 40,
      fill: '#ff0000',
      fillGradient: { angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] },
      stroke: '#111',
      strokeWidth: 2,
      cornerRadius: 8,
      shadow: true,
      shadowColor: '#0008',
      shadowBlur: 6,
      shadowX: 1,
      shadowY: 2,
      rotation: 15,
      opacity: 0.5,
    } as unknown as Layer;
    const css = layerToCss(l);
    expect(css.startsWith('.boton-rojo {')).toBe(true);
    expect(css).toContain('left: 10.12px;');
    expect(css).toContain('width: 100px;');
    expect(css).toContain('background-image: linear-gradient(90deg');
    expect(css).not.toContain('background-color');
    expect(css).toContain('border: 2px solid #111;');
    expect(css).toContain('border-radius: 8px;');
    expect(css).toContain('box-shadow: 1px 2px 6px #0008;');
    expect(css).toContain('transform: rotate(15deg);');
    expect(css).toContain('opacity: 0.5;');
  });
  it('texto', () => {
    const l = {
      ...base,
      type: 'text',
      text: 'Hola',
      fontFamily: 'Playfair Display',
      fontSize: 40,
      fill: '#222222',
      align: 'center',
      bold: true,
      italic: false,
      textTransform: 'upper',
      letterSpacing: 2,
      strokeColor: '#000',
      strokeWidth: 0,
      shadow: false,
      shadowColor: '#000',
      shadowBlur: 0,
      shadowX: 0,
      shadowY: 0,
    } as unknown as Layer;
    const css = layerToCss(l);
    expect(css).toContain('font-family: "Playfair Display", sans-serif;');
    expect(css).toContain('font-size: 40px;');
    expect(css).toContain('font-weight: 700;');
    expect(css).toContain('text-transform: uppercase;');
    expect(css).toContain('color: #222222;');
    expect(css).not.toContain('text-shadow');
  });
  it('nombre sin letras', () => {
    const l = { ...base, name: '123', type: 'image', naturalWidth: 50, naturalHeight: 20, shadow: false } as unknown as Layer;
    expect(layerToCss(l)).toContain('.capa-123 {');
  });
});
