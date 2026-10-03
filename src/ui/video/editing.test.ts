import { describe, expect, it } from 'vitest';
import * as VM from '../../video/model';
import * as P from '../../video/title/presets';
import * as S from '../../video/title/subtitles';
import * as E from './editing';

let n = 0;
const nid = () => `n${++n}`;

function base() {
  let p = VM.createProject();
  p = VM.addTrack(p, 'video', { id: 'V' });
  p = VM.addTrack(p, 'audio', { id: 'A' });
  p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'm', duration: 30 });
  p = VM.addMedia(p, { id: 'au', kind: 'audio', name: 'au', duration: 30 });
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'a', mediaId: 'm', start: 0, outP: 4 }));
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'b', mediaId: 'm', start: 5, outP: 3 }));
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'c', mediaId: 'm', start: 10, outP: 2 }));
  p = VM.addClip(p, 'A', VM.makeClip('audio', { id: 'd', mediaId: 'au', start: 1, outP: 6 }));
  return p;
}
const starts = (p: VM.VideoProject, tid: string) => VM.findTrack(p, tid)!.clips.map((c) => `${c.id}@${c.start}`);

describe('mover varios clips', () => {
  it('mueve el grupo conservando la separación', () => {
    const p = E.moveClips(base(), ['a', 'b'], 1);
    expect(starts(p, 'V')).toEqual(['a@1', 'b@6', 'c@10']);
  });
  it('un grupo que choca con un vecino lo empuja, nunca se solapa ni se pierde nada', () => {
    const p = E.moveClips(base(), ['a', 'b'], 4); // b acabaría en 12: choca con c (10)
    const clips = VM.findTrack(p, 'V')!.clips;
    expect(clips.map((c) => c.id).sort()).toEqual(['a', 'b', 'c']);
    for (let i = 1; i < clips.length; i++) expect(clips[i].start).toBeGreaterThanOrEqual(VM.clipEnd(clips[i - 1]) - 1e-9);
  });
  it('un clip suelto puede cambiar de pista (si es compatible); uno de audio no va a una de video', () => {
    let p = VM.addTrack(base(), 'video', { id: 'V2' });
    p = E.moveClips(p, ['a'], 0.5, 'V2');
    expect(VM.findClip(p, 'a')!.track.id).toBe('V2');
    const q = E.moveClips(base(), ['d'], 0, 'V');
    expect(VM.findClip(q, 'd')!.track.id).toBe('A');
  });
  it('no mueve clips de pistas bloqueadas', () => {
    const p0 = VM.updateTrack(base(), 'V', { locked: true });
    expect(E.moveClips(p0, ['a'], 2)).toBe(p0);
  });
  it('mover a la izquierda no baja de 0', () => {
    expect(E.moveClips(base(), ['b'], -50).tracks[0].clips[0].start).toBe(0);
  });
});

describe('eliminar', () => {
  it('borrar deja hueco; ripple lo cierra', () => {
    expect(starts(E.deleteClips(base(), ['b']), 'V')).toEqual(['a@0', 'c@10']);
    expect(starts(E.deleteClips(base(), ['b'], true), 'V')).toEqual(['a@0', 'c@7']);
  });
  it('ripple de varios clips de una misma pista', () => {
    expect(starts(E.deleteClips(base(), ['a', 'b'], true), 'V')).toEqual(['c@3']);
  });
  it('ids inexistentes se ignoran', () => {
    const p = base();
    expect(E.deleteClips(p, ['nada'])).toBe(p);
  });
});

describe('dividir', () => {
  it('divide los seleccionados en el cabezal', () => {
    const r = E.splitAt(base(), ['a'], 2, nid);
    expect(r.ids).toHaveLength(1);
    expect(VM.findTrack(r.p, 'V')!.clips).toHaveLength(4);
  });
  it('sin selección divide todos los que cruza el cabezal (todas las pistas)', () => {
    const r = E.splitAt(base(), [], 2, nid);
    expect(r.ids).toHaveLength(2); // a y d
  });
  it('en un borde no divide', () => {
    expect(E.splitAt(base(), [], 4, nid).ids).toHaveLength(1); // solo d (a acaba en 4)
    const p = base();
    expect(E.splitAt(p, ['a'], 0.01, nid).p).toBe(p);
  });
  it('pistas bloqueadas no se dividen sin selección', () => {
    const p = VM.updateTrack(base(), 'V', { locked: true });
    expect(E.clipsUnder(p, 2)).toEqual(['d']);
  });
});

describe('duplicar, copiar y pegar', () => {
  it('duplica detrás del original y empuja lo posterior', () => {
    const r = E.duplicateClips(base(), ['a'], nid);
    expect(r.ids).toHaveLength(1);
    const clips = VM.findTrack(r.p, 'V')!.clips;
    expect(clips).toHaveLength(4);
    expect(clips[1].start).toBe(4);
  });
  it('copia y pega en el cabezal con la separación original', () => {
    const p = base();
    const clip = E.copyClips(p, ['b', 'c']);
    expect(clip.map((x) => x.offset)).toEqual([0, 5]);
    const r = E.pasteClips(p, clip, 20, nid);
    expect(r.ids).toHaveLength(2);
    const v = VM.findTrack(r.p, 'V')!.clips;
    expect(v.filter((c) => r.ids.includes(c.id)).map((c) => c.start)).toEqual([20, 25]);
    expect(new Set(v.map((c) => c.id)).size).toBe(v.length); // ids únicos
  });
  it('pegar sobre una pista bloqueada va a otra pista compatible o crea una', () => {
    const p = base();
    const items = E.copyClips(p, ['a']);
    const locked = VM.updateTrack(p, 'V', { locked: true });
    const r = E.pasteClips(locked, items, 30, nid);
    expect(r.ids).toHaveLength(1);
    expect(r.p.tracks).toHaveLength(3);
    expect(VM.findClip(r.p, r.ids[0])!.track.id).not.toBe('V');
  });
  it('copiar un clip «hasta el final» fija su duración visible', () => {
    let p = VM.addTrack(base(), 'video', { id: 'T', index: 0 });
    p = VM.addClip(p, 'T', VM.makeClip('text', { id: 't', text: 'x', start: 2, outP: 9999, toEnd: true }));
    const [it] = E.copyClips(p, ['t']);
    expect(it.clip.toEnd).toBeUndefined();
    expect(it.clip.outP).toBeCloseTo(VM.projectDuration(p) - 2, 6);
  });
  it('el portapapeles vacío no pega nada', () => {
    const p = base();
    expect(E.copyClips(p, [])).toEqual([]);
    expect(E.pasteClips(p, [], 3).p).toBe(p);
  });
});

describe('colocar medios', () => {
  it('el primer video crea la pista principal con imán; el siguiente va detrás', () => {
    let p = VM.addMedia(VM.createProject(), { id: 'm', kind: 'video', name: 'm', duration: 5 });
    const r1 = E.placeMedia(p, { id: 'm', kind: 'video', duration: 5 });
    expect(r1.p.tracks).toHaveLength(1);
    expect(r1.p.tracks[0].magnet).toBe(true);
    const r2 = E.placeMedia(r1.p, { id: 'm', kind: 'video', duration: 5 });
    expect(r2.p.tracks).toHaveLength(1);
    expect(VM.findTrack(r2.p, r2.trackId)!.clips.map((c) => c.start)).toEqual([0, 5]);
    p = r2.p;
    expect(VM.projectDuration(p)).toBe(10);
  });
  it('en una pista concreta, en el instante pedido', () => {
    const p = base();
    const r = E.placeMedia(p, { id: 'm', kind: 'video', duration: 2 }, { trackId: 'V', at: 20, clipId: 'x' });
    expect(VM.findClip(r.p, 'x')!.clip.start).toBe(20);
  });
  it('un audio soltado sobre una pista de video crea una pista de audio', () => {
    const p = base();
    const r = E.placeMedia(p, { id: 'au', kind: 'audio', duration: 3 }, { trackId: 'V', at: 2 });
    expect(r.p.tracks.filter((t) => t.kind === 'audio')).toHaveLength(2);
    expect(VM.findClip(r.p, r.clipId)!.track.kind).toBe('audio');
  });
  it('sobre una pista bloqueada crea una nueva', () => {
    const p = VM.updateTrack(base(), 'V', { locked: true });
    const r = E.placeMedia(p, { id: 'm', kind: 'video', duration: 2 }, { trackId: 'V', at: 2 });
    expect(VM.findClip(r.p, r.clipId)!.track.id).not.toBe('V');
  });
  it('una imagen dura 5 s; el texto va en pista nueva encima', () => {
    const p = VM.addMedia(VM.createProject(), { id: 'i', kind: 'image', name: 'i', duration: 0 });
    const r = E.placeMedia(p, { id: 'i', kind: 'image', duration: 0 });
    expect(VM.clipDuration(VM.findClip(r.p, r.clipId)!.clip)).toBe(5);
    const t = E.addTextClip(base(), 3);
    expect(t.p.tracks[0].kind).toBe('video');
    expect(t.p.tracks[0].clips[0].start).toBe(3);
  });
  it('arrastrar a mitad de una pista sin imán, ocupada: empuja, no pierde clips', () => {
    const p = base();
    const r = E.placeMedia(p, { id: 'm', kind: 'video', duration: 3 }, { trackId: 'V', at: 1, clipId: 'x' });
    expect(VM.findTrack(r.p, 'V')!.clips).toHaveLength(4);
  });
});

describe('selección: tramo', () => {
  it('une el inicio y el fin', () => {
    expect(E.selectionSpan(base(), ['a', 'c'])).toEqual({ start: 0, end: 12 });
    expect(E.selectionSpan(base(), ['zz'])).toBeNull();
  });
});

describe('títulos y subtítulos (V4)', () => {
  it('un título con preajuste va a una pista nueva encima de todo, con su estilo y animación', () => {
    const preset = P.TITLE_PRESETS.find((x) => x.id === 'v-tercio-doble')!;
    const r = E.addTitleClip(base(), 2, preset);
    expect(r.p.tracks[0].kind).toBe('video');
    expect(r.p.tracks[0].name).toBe('Tercio inferior');
    const c = VM.findClip(r.p, r.clipId)!.clip;
    expect(c).toMatchObject({ kind: 'text', start: 2, text: preset.text });
    expect(c.tstyle?.fontFamily).toBe('Oswald');
    expect(c.anim?.in).toBe('slideRight');
    expect(c.transform.y).toBe(0.8);
  });
  it('un par de fuentes crea dos clips en dos pistas', () => {
    const r = E.addTitlePair(base(), 1, P.TITLE_PAIRS[0]);
    expect(r.ids).toHaveLength(2);
    const [body, title] = r.ids.map((id) => VM.findClip(r.p, id)!);
    expect(title.clip.transform.y).toBeLessThan(body.clip.transform.y);
    expect(title.track.id).not.toBe(body.track.id);
    expect(r.p.tracks[0].id).toBe(title.track.id); // el título arriba
  });
  it('aplicar un preajuste a un texto conserva su texto, sus tiempos y su posición', () => {
    let r = E.addTextClip(base(), 3, 'Mi texto');
    const id = r.clipId;
    const p2 = VM.updateClip(r.p, id, { transform: { x: 0.2, y: 0.9 } });
    const p3 = E.applyTitlePreset(p2, id, P.TITLE_PRESETS.find((x) => x.id === 'v-karaoke-verde')!);
    const c = VM.findClip(p3, id)!.clip;
    expect(c.text).toBe('Mi texto');
    expect(c.start).toBe(3);
    expect(c.transform.x).toBe(0.2);
    expect(c.tstyle?.presetId).toBe('v-karaoke-verde');
    expect(c.anim?.karaoke?.keep).toBe(true);
    expect(E.applyTitlePreset(base(), 'a', P.TITLE_PRESETS[0])).toEqual(base()); // un clip de video no
  });
  it('dividir un subtítulo en el cabezal parte el texto por una palabra y el tiempo exactamente en t', () => {
    let p = base();
    p = S.newSubtitleTrack(p, { id: 'S' }).p;
    p = S.replaceCues(p, 'S', [{ start: 2, end: 6, text: 'uno dos tres cuatro' }], { ids: ['s'] }).p;
    const r = E.splitAt(p, ['s'], 4, () => 's2');
    const cs = VM.findTrack(r.p, 'S')!.clips;
    expect(cs.map((c) => c.text)).toEqual(['uno dos', 'tres cuatro']);
    expect(cs[1].start).toBeCloseTo(4, 9);
    expect(r.ids).toEqual(['s2']);
  });
  it('pegar un subtítulo vuelve a una pista de subtítulos (la crea si no existe)', () => {
    let p = base();
    p = S.newSubtitleTrack(p, { id: 'S' }).p;
    p = S.replaceCues(p, 'S', [{ start: 1, end: 2, text: 'hola' }], { ids: ['s'] }).p;
    const items = E.copyClips(p, ['s']);
    const q = E.pasteClips(VM.removeTrack(p, 'S'), items, 5);
    const t = q.p.tracks.find((x) => x.kind === 'subtitle')!;
    expect(t.clips[0]).toMatchObject({ kind: 'subtitle', text: 'hola', start: 5 });
    expect(t.subStyle).toBeDefined();
  });
  it('nueva pista de subtítulos: entre las de video y las de audio', () => {
    const r = E.withNewTrack(base(), 'subtitle');
    expect(r.p.tracks.map((t) => t.kind)).toEqual(['video', 'subtitle', 'audio']);
    expect(VM.findTrack(r.p, r.id)!.name).toBe('Subtítulos');
  });
});
