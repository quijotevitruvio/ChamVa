import { describe, it, expect } from 'vitest';
import { classifyImportError, summarizeImport, importFailureMessage } from './importErrors';

describe('classifyImportError', () => {
  it('HEIC', () => expect(classifyImportError({ name: 'a.HEIC', type: '' })).toBe('Formato HEIC no soportado todavía'));
  it('TIFF', () => expect(classifyImportError({ name: 'a.tif', type: 'image/tiff' })).toContain('TIFF'));
  it('no es imagen', () => expect(classifyImportError({ name: 'a.txt', type: 'text/plain' })).toBe('El archivo no es una imagen'));
  it('corrupto', () =>
    expect(classifyImportError({ name: 'a.png', type: 'image/png' }, new Error('No se pudo decodificar la imagen'))).toBe(
      'No se pudo leer la imagen: archivo dañado',
    ));
});

describe('resumen', () => {
  it('3 importadas, 1 falló', () => expect(summarizeImport(3, 1)).toBe('3 importadas, 1 falló'));
  it('todo bien: null', () => expect(summarizeImport(2, 0)).toBeNull());
  it('mensaje completo', () =>
    expect(importFailureMessage(3, [{ name: 'x.heic', reason: 'Formato HEIC no soportado todavía' }])).toBe(
      '3 importadas, 1 falló. x.heic: Formato HEIC no soportado todavía',
    ));
  it('un solo archivo fallido sin resumen', () =>
    expect(importFailureMessage(0, [{ name: 'x.png', reason: 'r' }])).toBe('x.png: r'));
});
