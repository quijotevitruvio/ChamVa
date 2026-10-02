import { describe, expect, it } from 'vitest';
import { PAPER_SIZES } from '../editor/core/units';
import {
  applyPaper, changeDpi, changeUnit, commitField, fieldText, sizeLabel, summary, swapOrientation,
  type SizeValue,
} from './sizeFieldsLogic';

const a4: SizeValue = { width: 2480, height: 3508, unit: 'cm', dpi: 300 };

describe('SizeFields (lógica)', () => {
  it('cambiar la unidad mantiene los píxeles y convierte el número', () => {
    const v = changeUnit({ ...a4, unit: 'px' }, 'cm');
    expect(v.width).toBe(2480);
    expect(fieldText(v, 'width', 'es')).toBe('21');
    expect(fieldText(v, 'height', 'es')).toBe('29,7');
    expect(fieldText(changeUnit(v, 'in'), 'width', 'en-US')).toBe('8.267');
  });
  it('cambiar el dpi mantiene los cm y recalcula los px', () => {
    const v = changeDpi(a4, 150);
    expect(v).toMatchObject({ width: 1240, height: 1754, dpi: 150, unit: 'cm' });
    expect(fieldText(v, 'width', 'es')).toBe('21');
  });
  it('con unidad px el dpi solo cambia el dpi', () => {
    expect(changeDpi({ width: 1080, height: 1080, unit: 'px', dpi: 96 }, 300)).toEqual({
      width: 1080, height: 1080, unit: 'px', dpi: 300,
    });
  });
  it('commitField valida, convierte y respeta el candado', () => {
    expect(commitField(a4, 'width', '10,5', false)).toMatchObject({ width: 1240, height: 3508 });
    expect(commitField(a4, 'width', '10,5', true)).toMatchObject({ width: 1240, height: 1754 });
    expect(commitField(a4, 'width', 'hola', true)).toBeNull();
    expect(commitField(a4, 'width', '0', true)).toBeNull();
    expect(commitField(a4, 'width', '', true)).toBeNull();
    expect(commitField(a4, 'width', '8.5in', false)).toMatchObject({ width: 2550, unit: 'in' });
  });
  it('nunca produce NaN ni 0', () => {
    const v = commitField(a4, 'width', '0,001', true)!;
    expect(v.width).toBe(16);
    expect(Number.isFinite(v.height) && v.height >= 16).toBe(true);
    expect(commitField(a4, 'width', '99999', false)!.width).toBe(8000);
  });
  it('papel y orientación', () => {
    const p = PAPER_SIZES.find((x) => x.id === 'a4')!;
    expect(applyPaper({ width: 100, height: 100, unit: 'px', dpi: 300 }, p)).toMatchObject({
      width: 2480, height: 3508, unit: 'mm',
    });
    expect(swapOrientation(a4)).toMatchObject({ width: 3508, height: 2480 });
  });
  it('resumen y etiqueta', () => {
    expect(summary(a4, 'es')).toBe('= 2480 × 3508 px · 21 × 29,7 cm a 300 dpi');
    expect(sizeLabel({ width: 2480, height: 3508, unit: 'cm', dpi: 300 }, 'es')).toBe('21 × 29,7 cm');
    expect(sizeLabel({ width: 1080, height: 1080 })).toBe('1080×1080');
    expect(sizeLabel({ width: 1080, height: 1080, unit: 'px', dpi: 96 })).toBe('1080×1080');
  });
});
