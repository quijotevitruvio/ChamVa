import { describe, expect, it } from 'vitest';
import { DEFAULT_WATERMARK, markBox, watermarkActive, watermarkPlacements, type WatermarkCfg } from './watermark';

const cfg = (o: Partial<WatermarkCfg> = {}): WatermarkCfg => ({ ...DEFAULT_WATERMARK, enabled: true, ...o });

describe('watermarkActive', () => {
  it('exige habilitada y con contenido', () => {
    expect(watermarkActive(DEFAULT_WATERMARK)).toBe(false);
    expect(watermarkActive(cfg())).toBe(true);
    expect(watermarkActive(cfg({ text: '  ' }))).toBe(false);
    expect(watermarkActive(cfg({ kind: 'image' }))).toBe(false);
    expect(watermarkActive(cfg({ kind: 'image', imageSrc: 'data:x', imageW: 10, imageH: 5 }))).toBe(true);
  });
});

describe('markBox', () => {
  it('imagen: conserva la proporción', () => {
    const b = markBox(1000, cfg({ kind: 'image', imageSrc: 'x', imageW: 200, imageH: 100, size: 20 }), 100);
    expect(b.w).toBe(200);
    expect(b.h).toBe(100);
  });
  it('texto: el cuerpo se ajusta al ancho pedido', () => {
    const b = markBox(1000, cfg({ size: 20 }), 400); // 400 px de ancho a 100 px de cuerpo
    expect(b.w).toBe(200);
    expect(b.fontSize).toBeCloseTo(50);
  });
});

describe('watermarkPlacements', () => {
  const box = { w: 100, h: 20 };
  it('esquinas y centro respetan el margen', () => {
    const m = (p: WatermarkCfg['position']) =>
      watermarkPlacements(1000, 500, box, cfg({ position: p, margin: 10 })).items[0];
    // margen = 10 % del lado menor = 50
    expect(m('tl')).toEqual({ x: 50, y: 50 });
    expect(m('br')).toEqual({ x: 1000 - 100 - 50, y: 500 - 20 - 50 });
    expect(m('c')).toEqual({ x: 450, y: 240 });
    expect(m('tr')).toEqual({ x: 850, y: 50 });
    expect(m('bl')).toEqual({ x: 50, y: 430 });
    expect(m('tc').x).toBe(450);
    expect(m('ml').y).toBe(240);
  });
  it('mosaico: varias marcas, giradas', () => {
    const p = watermarkPlacements(1000, 500, box, cfg({ position: 'tile' }));
    expect(p.items.length).toBeGreaterThan(10);
    expect(p.angle).toBe(-30);
    expect(p.cx).toBe(500);
  });
});
