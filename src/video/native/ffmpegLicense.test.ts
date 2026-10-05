import { describe, expect, it } from 'vitest';
import { FFMPEG_NOT_AVAILABLE, installLine, unavailableText } from './FfmpegLicenseSection';
import type { InstallReport, NativeStatus } from './types';

const st = (install: InstallReport | null) => ({ install }) as NativeStatus;

describe('installLine (copia propia de FFmpeg)', () => {
  it('describe cada resultado de «verificar y omitir»', () => {
    expect(installLine(st({ action: 'skipped', detail: null }))).toMatch(/misma versión, no se copió/);
    expect(installLine(st({ action: 'installed', detail: null }))).toMatch(/SHA-256 verificado/);
    expect(installLine(st({ action: 'repaired', detail: 'se reparó la copia de FFmpeg: avcodec-63.dll cambió desde la instalación' }))).toBe(
      'Copia reparada desde el instalador (avcodec-63.dll cambió desde la instalación).',
    );
    expect(installLine(st({ action: 'failed', detail: 'disco lleno' }))).toMatch(/disco lleno/);
  });
  it('no dice nada sin informe o sin FFmpeg en la plataforma', () => {
    expect(installLine(st(null))).toBeNull();
    expect(installLine(st({ action: 'unavailable', detail: 'esta copia de ChamVa no incluye FFmpeg' }))).toBeNull();
  });
  it('sin FFmpeg en la plataforma: «no disponible», sin licencia, rutas, hashes ni promesas', () => {
    expect(FFMPEG_NOT_AVAILABLE).toBe('La conversión con FFmpeg nativo no está disponible en esta plataforma.');
    expect(FFMPEG_NOT_AVAILABLE).not.toMatch(/GPL|https?:|sha-?256|\.exe|llegará|próxima/i);
  });
});

describe('unavailableText (motivo honesto de «sin FFmpeg»)', () => {
  const s = (o: Partial<NativeStatus>) => ({ included: true, available: false, reason: null, ...o }) as NativeStatus;
  it('web/Android (sin estado) y macOS/Linux (sin build incluido): no disponible en esta plataforma', () => {
    expect(unavailableText(null)).toBe(FFMPEG_NOT_AVAILABLE);
    expect(unavailableText(s({ included: false, reason: 'La conversión con FFmpeg nativo no está disponible en esta plataforma' }))).toBe(FFMPEG_NOT_AVAILABLE);
  });
  it('Windows con FFmpeg: nada si está disponible; si falla, el motivo real y nunca «no incluida»', () => {
    expect(unavailableText(s({ available: true }))).toBeNull();
    const t = unavailableText(s({ reason: 'El FFmpeg del instalador no es el verificado: avcodec-63.dll no coincide con el SHA-256 publicado' }));
    expect(t).toBe('FFmpeg no se puede usar ahora: El FFmpeg del instalador no es el verificado: avcodec-63.dll no coincide con el SHA-256 publicado.');
    expect(t).not.toMatch(/no está incluida|llegará/);
    expect(unavailableText(s({}))).toBe('FFmpeg no se puede usar ahora.');
  });
});
