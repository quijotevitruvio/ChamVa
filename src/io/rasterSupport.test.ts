// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { resolveBlobFormat, formatOfMime, supportsFormat } from './rasterSupport';

describe('resolveBlobFormat', () => {
  it('sin degradación cuando el tipo coincide', () => {
    expect(resolveBlobFormat('image/webp', 'webp')).toEqual({ format: 'webp', degraded: false, message: null });
  });
  it('AVIF que llega como PNG se detecta y avisa en español', () => {
    const r = resolveBlobFormat('image/png', 'avif');
    expect(r.degraded).toBe(true);
    expect(r.format).toBe('png');
    expect(r.message).toBe('Este equipo no puede exportar AVIF; se guardó como PNG.');
  });
  it('WebP que llega como PNG', () => {
    expect(resolveBlobFormat('image/png', 'webp').message).toContain('WebP');
  });
  it('tipo desconocido se asume el pedido', () => {
    expect(formatOfMime('', 'jpeg')).toBe('jpeg');
  });
});

describe('supportsFormat con toBlob simulado', () => {
  it('false si toBlob devuelve otro tipo; true si coincide', async () => {
    const orig = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ fillRect() {} })) as never;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string) {
      cb(new Blob(['x'], { type: type === 'image/avif' ? 'image/png' : type }));
    } as never;
    expect(await supportsFormat('avif')).toBe(false);
    expect(await supportsFormat('webp')).toBe(true);
    HTMLCanvasElement.prototype.toBlob = orig;
  });
});
