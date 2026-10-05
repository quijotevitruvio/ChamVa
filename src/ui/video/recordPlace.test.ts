import { describe, expect, it } from 'vitest';
import * as VM from '../../video/model';
import { DEFAULT_BUBBLE } from '../../video/record/recordCore';
import { cameraTransform, nextRecordingNumber, placeRecordings, type RecordedItem } from './recordPlace';

const blob = () => new Blob([new Uint8Array(8)], { type: 'video/webm' });
const item = (role: 'main' | 'camera', o: Partial<RecordedItem> = {}): RecordedItem => ({ role, blob: blob(), mime: 'video/webm;codecs=vp9,opus', duration: 3.02, hasVideo: true, ...o });
let n = 0;
const ids = { media: () => 'm' + ++n, clip: () => 'c' + ++n };

describe('colocar lo grabado', () => {
  it('un clip: medio nuevo, pista nueva, en el cabezal y con la duración medida', () => {
    let p = VM.createProject();
    p = VM.addTrack(p, 'video', { id: 'V', magnet: true });
    p = VM.appendClip(p, 'V', VM.makeClip('image', { id: 'x', outP: 5 }));
    const r = placeRecordings(p, [item('main')], 'screen', 2, DEFAULT_BUBBLE, ids);
    expect(r.clipIds).toHaveLength(1);
    const loc = VM.findClip(r.p, r.clipIds[0])!;
    expect(loc.clip.start).toBeCloseTo(2);
    expect(VM.clipDuration(loc.clip)).toBeCloseTo(3.02);
    expect(loc.track.id).not.toBe('V');
    expect(r.p.tracks[0].id).toBe(loc.track.id); // la pista nueva queda encima
    expect(r.p.media[loc.clip.mediaId!].name).toBe('Grabación de pantalla 1.webm');
    expect(r.p.media[loc.clip.mediaId!].blob).toBeInstanceOf(Blob);
  });
  it('solo micrófono: clip de audio en pista de audio', () => {
    const r = placeRecordings(VM.createProject(), [item('main', { hasVideo: false, mime: 'audio/webm;codecs=opus' })], 'mic', 0, DEFAULT_BUBBLE, ids);
    const loc = VM.findClip(r.p, r.clipIds[0])!;
    expect(loc.clip.kind).toBe('audio');
    expect(loc.track.kind).toBe('audio');
  });
  it('cámara aparte: dos pistas, la cámara encima y pequeña en la esquina, sin sonido', () => {
    const r = placeRecordings(VM.createProject(), [item('camera'), item('main')], 'screen-cam', 1, DEFAULT_BUBBLE, ids);
    expect(r.clipIds).toHaveLength(2);
    const main = VM.findClip(r.p, r.clipIds[0])!;
    const cam = VM.findClip(r.p, r.clipIds[1])!;
    expect(main.clip.transform.scale).toBe(1);
    expect(cam.clip.transform.scale).toBeLessThan(0.5);
    expect(cam.clip.transform.x).toBeGreaterThan(0.5);
    expect(cam.clip.volume).toBe(0);
    expect(r.p.tracks.findIndex((t) => t.id === cam.track.id)).toBeLessThan(r.p.tracks.findIndex((t) => t.id === main.track.id));
    expect(r.p.media[cam.clip.mediaId!].name).toMatch(/^Cámara 1/);
  });
  it('la burbuja aparte siempre cabe en el encuadre', () => {
    for (const px of [0, 1])
      for (const py of [0, 1])
        for (const size of [0.1, 0.5]) {
          const t = cameraTransform({ size, px, py });
          expect(t.x - t.scale / 2).toBeGreaterThanOrEqual(-1e-9);
          expect(t.x + t.scale / 2).toBeLessThanOrEqual(1 + 1e-9);
          expect(t.y + t.scale / 2).toBeLessThanOrEqual(1 + 1e-9);
        }
  });
  it('numera por modo', () => {
    const a = placeRecordings(VM.createProject(), [item('main')], 'screen', 0, DEFAULT_BUBBLE, ids);
    expect(nextRecordingNumber(a.p, 'screen')).toBe(2);
    expect(nextRecordingNumber(a.p, 'camera')).toBe(1);
  });
});

describe('numeración sin confundir modos', () => {
  it('«pantalla con cámara» no cuenta como «pantalla»', () => {
    const a = placeRecordings(VM.createProject(), [item('main')], 'screen-cam', 0, DEFAULT_BUBBLE, ids);
    expect(nextRecordingNumber(a.p, 'screen')).toBe(1);
    expect(nextRecordingNumber(a.p, 'screen-cam')).toBe(2);
  });
});
