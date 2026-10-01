import { describe, expect, it } from 'vitest';
import {
  buildFileName,
  dateStamp,
  expandTemplate,
  sanitizeFileName,
  uniqueName,
  type NameVars,
} from './fileNameTemplate';

const v: NameVars = {
  nombre: 'Cartel',
  fecha: '2026-10-01',
  pagina: 2,
  n: 3,
  total: 12,
  ancho: 1080,
  alto: 1350,
  escala: '2x',
  formato: 'png',
};

describe('expandTemplate', () => {
  it('sustituye variables', () => {
    expect(expandTemplate('{nombre}-{pagina}-{fecha}', v)).toBe('Cartel-2-2026-10-01');
    expect(expandTemplate('{ancho}x{alto}@{escala}.{formato}', v)).toBe('1080x1350@2x.png');
  });
  it('rellena {n} con ceros según el total', () => {
    expect(expandTemplate('img{n}', v)).toBe('img03');
  });
  it('plantilla vacía = nombre; variable desconocida se deja', () => {
    expect(expandTemplate('  ', v)).toBe('Cartel');
    expect(expandTemplate('{raro}', v)).toBe('{raro}');
  });
});

describe('sanitizeFileName', () => {
  it('quita caracteres prohibidos y puntos finales', () => {
    expect(sanitizeFileName('a/b:c*d?.')).toBe('a_b_c_d_');
    expect(sanitizeFileName('...')).toBe('chamva');
  });
});

describe('buildFileName', () => {
  it('por defecto conserva el comportamiento antiguo', () => {
    const o = { multiPages: false, multiScales: false };
    expect(buildFileName('{nombre}', v, o)).toBe('Cartel');
    expect(buildFileName('{nombre}', v, { ...o, multiPages: true })).toBe('Cartel_pag2');
  });
  it('añade @escala solo si falta', () => {
    const o = { multiPages: false, multiScales: true };
    expect(buildFileName('{nombre}', v, o)).toBe('Cartel@2x');
    expect(buildFileName('{nombre}-{escala}', v, o)).toBe('Cartel-2x');
  });
  it('no repite sufijo de página si la plantilla ya lo tiene', () => {
    expect(buildFileName('{nombre}_{n}', v, { multiPages: true, multiScales: false })).toBe('Cartel_03');
  });
});

describe('uniqueName / dateStamp', () => {
  it('numera duplicados', () => {
    const used = new Set<string>();
    expect(uniqueName('a.png', used)).toBe('a.png');
    expect(uniqueName('A.png', used)).toBe('A (2).png');
    expect(uniqueName('a.png', used)).toBe('a (3).png');
  });
  it('fecha AAAA-MM-DD', () => {
    expect(dateStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
