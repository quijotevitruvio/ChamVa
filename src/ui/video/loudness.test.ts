import { describe, expect, it } from 'vitest';
import { setClipAudio, setProjectAudio, setTrackMix } from '../../video/audio/mixOps';
import { codecCorrection } from '../../video/engine/codecProbe';
import * as VM from '../../video/model';
import { audioSignature } from './loudness';

const base = () => {
  let p = VM.createProject();
  p = VM.addTrack(p, 'video', { id: 'V' });
  p = VM.addTrack(p, 'audio', { id: 'A' });
  p = VM.addMedia(p, { id: 'm', kind: 'audio', name: 'm', duration: 10, blob: new Blob(['x']) });
  p = VM.addClip(p, 'V', VM.makeClip('text', { id: 't', start: 0, outP: 8, text: 'hola' }));
  p = VM.addClip(p, 'A', VM.makeClip('audio', { id: 'a', mediaId: 'm', start: 0, inP: 0, outP: 6 }));
  return p;
};

describe('huella de audio (cuándo hay que volver a medir la sonoridad)', () => {
  it('cambia con lo que cambia el sonido', () => {
    const p = base();
    const s = audioSignature(p);
    expect(audioSignature(setClipAudio(p, 'a', { gainDb: 3 }))).not.toBe(s);
    expect(audioSignature(setClipAudio(p, 'a', { denoise: 0.5 }))).not.toBe(s);
    expect(audioSignature(setClipAudio(p, 'a', { eq: [{ type: 'peak', f: 1000, g: 3, q: 1 }] }))).not.toBe(s);
    expect(audioSignature(setTrackMix(p, 'A', { gainDb: -3 }))).not.toBe(s);
    expect(audioSignature(setTrackMix(p, 'A', { duck: { on: true } }))).not.toBe(s);
    expect(audioSignature(setProjectAudio(p, { xfade: 0.2 }))).not.toBe(s);
    expect(audioSignature(VM.updateTrack(p, 'A', { muted: true }))).not.toBe(s);
    expect(audioSignature(VM.updateClip(p, 'a', { volume: 0.5 }))).not.toBe(s);
    expect(audioSignature(VM.updateProject(p, { normalize: true }))).not.toBe(s);
  });

  it('no cambia con lo que no suena: imagen, texto, transformación, nombres', () => {
    const p = base();
    const s = audioSignature(p);
    expect(audioSignature(VM.updateClip(p, 't', { text: 'otro', transform: { x: 0.2 } }))).toBe(s);
    expect(audioSignature(VM.updateTrack(p, 'V', { name: 'Capa' }))).toBe(s);
    expect(audioSignature(setProjectAudio(p, { showBeats: true, beatSnap: true }))).toBe(s);
  });
});

describe('compensación del códec con pérdida', () => {
  it('objetivo − medida, acotada a ±2 dB y 0 si es despreciable o no se pudo medir', () => {
    expect(codecCorrection(-14, { integrated: -14.55, truePeak: -2 })).toBeCloseTo(0.55, 6);
    expect(codecCorrection(-14, { integrated: -13.7, truePeak: -2 })).toBeCloseTo(-0.3, 6);
    expect(codecCorrection(-14, { integrated: -20, truePeak: -2 })).toBe(2);
    expect(codecCorrection(-14, { integrated: -14.03, truePeak: -2 })).toBe(0);
    expect(codecCorrection(-14, null)).toBe(0);
    expect(codecCorrection(-14, { integrated: -Infinity, truePeak: -2 })).toBe(0);
  });
});
