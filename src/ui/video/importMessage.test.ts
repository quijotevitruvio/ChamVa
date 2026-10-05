import { describe, expect, it } from 'vitest';
import { unreadableFileMessage } from './useVideoProject';

describe('importación sin FFmpeg nativo (v0.9.0)', () => {
  it('un video que no se abre pide convertirlo a MP4 H.264, sin hablar de FFmpeg ni de licencias', () => {
    const m = unreadableFileMessage('IMG_0001.MOV', 'video');
    expect(m).toBe('«IMG_0001.MOV»: este formato no se puede abrir todavía en ChamVa; conviértelo a MP4 H.264 con otro programa.');
    expect(m).not.toMatch(/ffmpeg|gpl|proxy/i);
  });
  it('el audio conserva el mensaje de v0.8.1', () => {
    expect(unreadableFileMessage('a.xyz', 'audio')).toBe('No se pudo leer «a.xyz» (formato no compatible con este navegador).');
  });
});
