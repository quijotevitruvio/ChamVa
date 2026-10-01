import { describe, expect, it } from 'vitest';
import { FONT_FAMILIES } from './types';
import {
  FONT_PAIR_DEFS,
  PRESET_CATEGORIES,
  TEXT_PRESET_DEFS,
  buildFontPairProps,
  buildTextLayerProps,
  estimateTextBox,
} from './textPresets';

// Fuentes empaquetadas con solo peso 400: pedir negrita sería negrita sintética.
const REGULAR_ONLY = ['Anton', 'Bebas Neue', 'Lobster', 'Pacifico'];

const DOCS = [
  { width: 1080, height: 1080 },
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 400, height: 300 },
  { width: 4000, height: 3000 },
];

describe('textPresets', () => {
  it('hay al menos 20 presets, con ids únicos y categorías conocidas', () => {
    expect(TEXT_PRESET_DEFS.length).toBeGreaterThanOrEqual(20);
    const ids = TEXT_PRESET_DEFS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of TEXT_PRESET_DEFS) expect(PRESET_CATEGORIES).toContain(p.category);
    for (const c of PRESET_CATEGORIES) {
      expect(TEXT_PRESET_DEFS.some((p) => p.category === c)).toBe(true);
    }
  });

  it('todas las fuentes existen y no piden negrita donde no hay peso 700', () => {
    for (const p of TEXT_PRESET_DEFS) {
      expect(FONT_FAMILIES, p.id).toContain(p.style.fontFamily);
      if (REGULAR_ONLY.includes(p.style.fontFamily!)) expect(p.style.bold, p.id).toBeFalsy();
    }
  });

  it('pares de fuentes: 8-10, ids únicos, fuentes reales', () => {
    expect(FONT_PAIR_DEFS.length).toBeGreaterThanOrEqual(8);
    expect(FONT_PAIR_DEFS.length).toBeLessThanOrEqual(10);
    expect(new Set(FONT_PAIR_DEFS.map((p) => p.id)).size).toBe(FONT_PAIR_DEFS.length);
    for (const p of FONT_PAIR_DEFS) {
      for (const part of [p.title, p.body]) {
        expect(FONT_FAMILIES, p.id).toContain(part.fontFamily);
        if (REGULAR_ONLY.includes(part.fontFamily)) expect(part.bold, p.id).toBe(false);
      }
    }
  });

  it('el escalado respeta límites: cabe en el lienzo y queda centrado', () => {
    for (const doc of DOCS) {
      for (const p of TEXT_PRESET_DEFS) {
        const props = buildTextLayerProps(p, doc);
        const box = estimateTextBox(props);
        expect(props.fontSize!, `${p.id} ${doc.width}`).toBeGreaterThanOrEqual(8);
        expect(props.fontSize!).toBeLessThanOrEqual(600);
        // Cabe en el 90 % del ancho salvo que se haya llegado al tamaño mínimo.
        if (props.fontSize! > 8) expect(box.width).toBeLessThanOrEqual(doc.width * 0.9 + 1);
        expect(Math.abs(props.x! + box.width / 2 - doc.width / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(props.y! + box.height / 2 - doc.height / 2)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('un título grande ocupa una fracción razonable del ancho', () => {
    const p = TEXT_PRESET_DEFS.find((x) => x.id === 'titulo-impacto')!;
    const doc = { width: 1080, height: 1080 };
    const props = buildTextLayerProps(p, doc);
    const frac = estimateTextBox(props).width / doc.width;
    expect(frac).toBeGreaterThan(0.3);
    expect(frac).toBeLessThanOrEqual(0.9);
  });

  it('el tamaño crece con el lienzo', () => {
    const p = TEXT_PRESET_DEFS.find((x) => x.id === 'minimal-subrayado')!;
    const small = buildTextLayerProps(p, { width: 540, height: 540 }).fontSize!;
    const big = buildTextLayerProps(p, { width: 2160, height: 2160 }).fontSize!;
    expect(big).toBeGreaterThan(small);
  });

  it('par de fuentes: título arriba, cuerpo debajo sin solaparse', () => {
    for (const doc of DOCS) {
      for (const pair of FONT_PAIR_DEFS) {
        const [t, b] = buildFontPairProps(pair, doc);
        const tb = estimateTextBox(t);
        expect(b.y!, pair.id).toBeGreaterThanOrEqual(t.y! + tb.height);
        expect(t.y!).toBeGreaterThanOrEqual(0);
        expect(b.y! + estimateTextBox(b).height).toBeLessThanOrEqual(doc.height + 1);
      }
    }
  });
});
