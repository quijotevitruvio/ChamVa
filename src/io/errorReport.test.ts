import { describe, expect, it } from 'vitest';
import { buildReport, getConsoleLines, issueUrl, pushConsoleLine, redact, truncateReport } from './errorReport';

describe('redact', () => {
  it('quita correos, rutas de usuario, imágenes y parámetros', () => {
    expect(redact('hola a@b.com')).toBe('hola [correo]');
    expect(redact('C:\\Users\\Ana\\app\\x.js')).toBe('C:\\Users\\<usuario>\\app\\x.js');
    expect(redact('/home/ana/x.js')).toBe('/home/<usuario>/x.js');
    expect(redact('data:image/png;base64,AAAA')).toBe('data:[omitido]');
    expect(redact('https://x.com/a?token=1&b=2')).toBe('https://x.com/a?[…]');
  });
});

describe('buffer de consola', () => {
  it('guarda como mucho 20 líneas y recorta cada una', () => {
    for (let i = 0; i < 30; i++) pushConsoleLine('error ' + i);
    pushConsoleLine('x'.repeat(1000));
    const l = getConsoleLines();
    expect(l.length).toBe(20);
    expect(l[l.length - 1].length).toBeLessThanOrEqual(300);
    expect(l[0]).not.toBe('error 0');
  });
});

describe('informe', () => {
  const base = {
    version: '1.0.0',
    userAgent: 'UA',
    lang: 'es',
    theme: 'dark',
    layers: 3,
    pages: 2,
    errorName: 'TypeError',
    errorMessage: 'falla para yo@correo.com',
    stack: 'at C:\\Users\\Pepe\\x.js:1',
    consoleLines: ['uno'],
  };
  it('no filtra datos personales y trae los campos', () => {
    const r = buildReport(base);
    expect(r).toContain('Versión: 1.0.0');
    expect(r).toContain('3 capa(s)');
    expect(r).not.toContain('yo@correo.com');
    expect(r).not.toContain('Pepe');
  });
  it('trunca para la URL', () => {
    const r = truncateReport('a'.repeat(5000), 1500);
    expect(r.length).toBeLessThanOrEqual(1500);
    const u = issueUrl('https://github.com/o/r/', 'boom', buildReport(base), 1500);
    expect(u.startsWith('https://github.com/o/r/issues/new?title=')).toBe(true);
    expect(decodeURIComponent(u.split('body=')[1]).length).toBeLessThanOrEqual(1500);
  });
});
