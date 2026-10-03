import { describe, expect, it } from 'vitest';
import { GROUP_WINDOW_MS, canRedo, canUndo, commit, createHistory, endGroup, mapHistory, redo, replacePresent, undo } from './history';
import { addMedia, addTrack, appendClip, createProject, makeClip, updateClip, updateMedia } from './ops';
import type { VideoProject } from './types';

const start = () => addTrack(addMedia(createProject(), { id: 'm', kind: 'video', name: 'a', duration: 10 }), 'video', { id: 'V', magnet: true });
const volumeOf = (p: VideoProject) => p.tracks[0].clips[0]?.volume;

describe('deshacer / rehacer del video', () => {
  it('apila pasos, deshace y rehace; un cambio nuevo borra el futuro', () => {
    let h = createHistory(start());
    const p1 = appendClip(h.present, 'V', makeClip('video', { id: 'a', mediaId: 'm', outP: 3 }));
    h = commit(h, p1, { now: 0 });
    h = commit(h, updateClip(h.present, 'a', { volume: 0.5 }), { now: 10 });
    expect(volumeOf(h.present)).toBe(0.5);
    h = undo(h);
    expect(volumeOf(h.present)).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(volumeOf(h.present)).toBe(0.5);
    h = undo(undo(h));
    expect(h.present.tracks[0].clips).toHaveLength(0);
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    h = redo(h);
    h = commit(h, updateClip(h.present, 'a', { volume: 2 }), { now: 20 });
    expect(canRedo(h)).toBe(false);
  });

  it('un arrastre (mismo grupo, seguido) es UN paso; endGroup o la pausa lo cierran', () => {
    let h = createHistory(appendClip(start(), 'V', makeClip('video', { id: 'a', mediaId: 'm', outP: 3 })));
    for (let i = 1; i <= 20; i++) h = commit(h, updateClip(h.present, 'a', { volume: i / 10 }), { group: 'vol', now: i * 16 });
    expect(h.past).toHaveLength(1);
    expect(volumeOf(undo(h).present)).toBe(1);
    h = endGroup(h);
    h = commit(h, updateClip(h.present, 'a', { volume: 0.1 }), { group: 'vol', now: 400 });
    expect(h.past).toHaveLength(2);
    h = commit(h, updateClip(h.present, 'a', { volume: 0.2 }), { group: 'vol', now: 400 + GROUP_WINDOW_MS + 1 });
    expect(h.past).toHaveLength(3);
  });

  it('operación sin efecto no crea paso; límite de pasos', () => {
    let h = createHistory(start(), 3);
    expect(commit(h, h.present)).toBe(h);
    for (let i = 0; i < 6; i++) h = commit(h, { ...h.present, normalize: i % 2 === 0 }, { now: i * 5000 });
    expect(h.past).toHaveLength(3);
  });

  it('replacePresent no crea paso; mapHistory llega a todas las instantáneas', () => {
    let h = createHistory(start());
    h = commit(h, appendClip(h.present, 'V', makeClip('video', { id: 'a', mediaId: 'm', outP: 3 })), { now: 0 });
    h = replacePresent(h, updateMedia(h.present, 'm', { duration: 12 }));
    expect(h.past).toHaveLength(1);
    h = mapHistory(h, (p) => updateMedia(p, 'm', { thumb: 'data:x' }));
    expect([...h.past, h.present].every((p) => p.media.m.thumb === 'data:x')).toBe(true);
    expect(mapHistory(h, (p) => p)).toBe(h);
  });
});
