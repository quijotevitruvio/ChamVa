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
