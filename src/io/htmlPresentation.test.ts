import { describe, expect, it } from 'vitest';
import { buildPresentationHtml } from './htmlPresentation';

describe('buildPresentationHtml', () => {
  it('es un solo documento, escapa el título y no deja cerrar el script', () => {
    const html = buildPresentationHtml('A <b> & "c"', [
      { src: 'data:image/jpeg;base64,AAA', notes: 'x </script><script>alert(1)</script>' },
      { src: 'data:image/jpeg;base64,BBB' },
    ]);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(html.match(/<\/script>/g)?.length).toBe(1);
    expect(html).toContain('data:image/jpeg;base64,AAA');
    expect(html).toContain('data:image/jpeg;base64,BBB');
    expect(html).not.toMatch(/https?:\/\//); // sin red
  });
  it('el JSON de datos se puede evaluar', () => {
    const html = buildPresentationHtml('t', [{ src: 'data:image/png;base64,Q', notes: 'a\nb' }]);
    const m = /var S=(\[.*?\]),k=0/s.exec(html)!;
    const arr = JSON.parse(m[1]);
    expect(arr).toEqual([{ s: 'data:image/png;base64,Q', a: '', n: 'a\nb' }]);
  });
});
