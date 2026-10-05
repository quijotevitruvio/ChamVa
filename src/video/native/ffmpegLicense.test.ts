import { describe, expect, it } from 'vitest';
import { FFMPEG_NOT_INCLUDED, installLine } from './FfmpegLicenseSection';
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
  it('v0.9.0: el aviso de «no incluido» no afirma ninguna licencia ni da rutas o hashes', () => {
    expect(FFMPEG_NOT_INCLUDED).toBe('La conversión con FFmpeg nativo no está incluida en esta versión; llegará en una próxima actualización.');
    expect(FFMPEG_NOT_INCLUDED).not.toMatch(/GPL|https?:|sha-?256|\.exe/i);
  });
});
