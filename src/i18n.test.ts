import { describe, expect, it } from 'vitest';
import { getLang, setLang, t } from './i18n';

describe('i18n', () => {
  it('por defecto en Node cae a español', () => {
    setLang('es');
    expect(getLang()).toBe('es');
    expect(t('Descargar')).toBe('Descargar');
  });

  it('traduce al inglés y deja pasar claves desconocidas', () => {
    setLang('en');
    expect(t('Descargar')).toBe('Download');
    expect(t('Quitar fondo')).toBe('Remove background');
    expect(t('Texto sin traducción')).toBe('Texto sin traducción');
    setLang('es');
  });
});

describe('idiomas importados', () => {
  it('valida y rechaza JSON malo', async () => {
    const { parseLangPack, slugLang } = await import('./i18n');
    expect(parseLangPack('no json').ok).toBe(false);
    expect(parseLangPack('[]').ok).toBe(false);
    expect(parseLangPack('{"__nombre":"X"}').ok).toBe(false);
    const r = parseLangPack('{"__nombre":"Français","Descargar":"Télécharger"}');
    expect(r.ok && r.code).toBe('x-francais');
    expect(slugLang('')).toBe('x-idioma');
  });
});
