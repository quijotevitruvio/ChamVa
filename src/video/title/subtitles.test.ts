import { describe, expect, it } from 'vitest';
import * as VM from '../model';
import { migrateVideoProject, normalizeV2, serializeProject } from '../model/migrate';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSrt, parseSubtitles, serializeSrt, serializeTxt, serializeVtt } from './srt';
import { DEFAULT_SUBTITLE_STYLE, forVideo, sanitizeAnim, sanitizeSubtitleStyle, sanitizeTitleStyle } from './style';
import { TITLE_PAIRS, TITLE_PRESETS, SUBTITLE_PRESETS, applyPreset } from './presets';
import * as S from './subtitles';

const base = () => {
  let p = VM.createProject();
  p = VM.addTrack(p, 'video', { id: 'V', magnet: true });
  p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'a.mp4', duration: 20, blob: new Blob(['x']) });
  p = VM.appendClip(p, 'V', VM.makeClip('video', { id: 'v1', mediaId: 'm', outP: 5 }));
  p = VM.appendClip(p, 'V', VM.makeClip('video', { id: 'v2', mediaId: 'm', outP: 5 }));
  p = S.newSubtitleTrack(p, { id: 'S' }).p;
  return p;
};
const texts = (p: VM.VideoProject) => VM.findTrack(p, 'S')!.clips.map((c) => `${c.text}@${c.start}+${VM.clipDuration(c)}`);

describe('pista de subtítulos en el modelo', () => {
  it('se crea con estilo por defecto, entre las de video y las de audio', () => {
    let p = base();
    p = VM.addTrack(p, 'audio', { id: 'A' });
    p = VM.addTrack(p, 'subtitle', { id: 'S2' });
    expect(p.tracks.map((t) => t.id)).toEqual(['V', 'S2', 'S', 'A']);
    expect(VM.findTrack(p, 'S')!.subStyle).toEqual(DEFAULT_SUBTITLE_STYLE);
    expect(VM.findTrack(p, 'S')!.name).toBe('Subtítulos');
  });

  it('un clip de subtítulo solo cabe en pista de subtítulos (y al revés)', () => {
    const p = base();
    const sub = VM.makeClip('subtitle', { id: 's', text: 'hola', outP: 1 });
    expect(() => VM.addClip(p, 'V', sub)).toThrow();
    expect(() => VM.addClip(p, 'S', VM.makeClip('video', { id: 'x', mediaId: 'm', outP: 1 }))).toThrow();
    expect(() => VM.addClip(p, 'S', VM.makeClip('text', { id: 'x', text: 't' }))).toThrow();
    expect(VM.addClip(p, 'S', sub).tracks[1].clips).toHaveLength(1);
  });

  it('no cuenta para la duración del proyecto aunque pase del final', () => {
    let p = base();
    expect(VM.projectDuration(p)).toBe(10);
    p = S.addCue(p, 'S', 30, { dur: 5, text: 'tarde' }).p;
    expect(VM.projectDuration(p)).toBe(10);
    let q = VM.createProject();
    q = S.newSubtitleTrack(q, { id: 'S' }).p;
    q = S.addCue(q, 'S', 0, { text: 'solo' }).p;
    expect(VM.projectDuration(q)).toBe(0);
  });

  it('activos en t: encima de todo, exclusivo en el final, y respeta «oculta»', () => {
    let p = base();
    p = S.addCue(p, 'S', 1, { dur: 2, text: 'uno', id: 'c1' }).p;
    const kinds = (t: number) => VM.clipsAt(p, t).visual.map((a) => a.clip.id);
    expect(kinds(0.99)).toEqual(['v1']);
    expect(kinds(1)).toEqual(['v1', 'c1']);
    expect(kinds(2.999)).toEqual(['v1', 'c1']);
    expect(kinds(3)).toEqual(['v1']);
    expect(VM.clipsAt(p, 1).visual[1].track.id).toBe('S');
    expect(VM.clipsAt(p, 1).audible.map((a) => a.clip.id)).toEqual(['v1']);
    p = VM.updateTrack(p, 'S', { hidden: true });
    expect(kinds(1)).toEqual(['v1']);
  });
});

describe('subtítulos: operaciones', () => {
  it('añadir en el cabezal: 2 s por defecto, recortado al siguiente, y detrás si cae dentro de otro', () => {
    let p = base();
    let r = S.addCue(p, 'S', 1, { text: 'a' });
    p = r.p;
    expect(texts(p)).toEqual(['a@1+2']);
    r = S.addCue(p, 'S', 2, { text: 'dentro' }); // cae dentro de «a» → justo detrás
    expect(texts(r.p)).toEqual(['a@1+2', 'dentro@3+2']);
    r = S.addCue(p, 'S', 0, { text: 'antes', dur: 5 }); // recortado al inicio de «a»
    expect(texts(r.p)).toEqual(['antes@0+1', 'a@1+2']);
    expect(S.addCue(VM.updateTrack(p, 'S', { locked: true }), 'S', 8).id).toBeNull();
    expect(S.addCue(p, 'V', 8).id).toBeNull(); // no es pista de subtítulos
  });

  it('un subtítulo no cabe si no hay hueco', () => {
    let p = base();
    p = S.addCue(p, 'S', 0, { dur: 2, text: 'a' }).p;
    p = S.addCue(p, 'S', 2, { dur: 2, text: 'b' }).p;
    const r = S.addCue(p, 'S', 4, { dur: 0 });
    expect(r.id).toBeNull();
  });

  it('cambiar tiempos: no pisa a los vecinos y respeta el mínimo', () => {
    let p = base();
    p = S.replaceCues(p, 'S', [
      { start: 1, end: 2, text: 'a' },
      { start: 3, end: 4, text: 'b' },
      { start: 5, end: 6, text: 'c' },
    ], { ids: ['a', 'b', 'c'] }).p;
    expect(texts(S.setCueTimes(p, 'b', { start: 0 }))).toEqual(['a@1+1', 'b@2+2', 'c@5+1']); // limitado al final de «a»
    expect(texts(S.setCueTimes(p, 'b', { end: 9 }))).toEqual(['a@1+1', 'b@3+2', 'c@5+1']); // limitado al inicio de «c»
    expect(texts(S.setCueTimes(p, 'b', { start: 3.95 }))).toEqual(['a@1+1', 'b@3.9+0.1', 'c@5+1']); // mínimo 0,1 s
    expect(texts(S.setCueTimes(p, 'b', { end: 3.01 }))).toEqual(['a@1+1', 'b@3+0.1', 'c@5+1']);
    expect(S.setCueTimes(p, 'b', { start: NaN })).toBe(p);
    expect(S.setCueTimes(VM.updateTrack(p, 'S', { locked: true }), 'b', { start: 3.5 })).toEqual(VM.updateTrack(p, 'S', { locked: true }));
  });

  it('texto: sin cambio devuelve el mismo proyecto y borra los tiempos de palabra', () => {
    let p = base();
    const cues = [{ start: 1, end: 3, text: 'uno dos', words: [{ text: 'uno', start: 0, end: 1 }, { text: 'dos', start: 1, end: 2 }] }];
    p = S.replaceCues(p, 'S', cues, { ids: ['a'] }).p;
    expect(S.setCueText(p, 'a', 'uno dos')).toBe(p);
    const q = S.setCueText(p, 'a', 'uno dos tres');
    expect(VM.findClip(q, 'a')!.clip.words).toBeUndefined();
    expect(VM.findClip(q, 'a')!.clip.text).toBe('uno dos tres');
    expect(VM.findClip(p, 'a')!.clip.words).toHaveLength(2); // no muta
  });

  it('dividir por el cursor: el tiempo se reparte por letras', () => {
    let p = base();
    p = S.replaceCues(p, 'S', [{ start: 2, end: 6, text: 'aaaa bbbbbbbbbbbb' }], { ids: ['a'] }).p;
    const r = S.splitCue(p, 'a', 5, 'b');
    expect(r.id).toBe('b');
    expect(texts(r.p)).toEqual(['aaaa@2+1', 'bbbbbbbbbbbb@3+3']);
    // las dos mitades siguen unidas sin hueco ni solape
    const [x, y] = VM.findTrack(r.p, 'S')!.clips;
    expect(VM.clipEnd(x)).toBeCloseTo(y.start, 9);
    expect(VM.clipEnd(y)).toBeCloseTo(6, 9);
  });

  it('dividir en un salto de línea quita el salto; en un extremo no hace nada', () => {
    let p = base();
    p = S.replaceCues(p, 'S', [{ start: 0, end: 4, text: 'hola\nadiós' }], { ids: ['a'] }).p;
    const r = S.splitCue(p, 'a', 4, 'b');
    expect(r.p.tracks[1].clips.map((c) => c.text)).toEqual(['hola', 'adiós']);
    expect(S.splitCue(p, 'a', 0).p).toBe(p);
    expect(S.splitCue(p, 'a', 999).id).toBeNull();
    expect(S.splitCue(p, 'a', 3, 'a').p).toBe(p); // id repetido
  });

  it('dividir en una línea cada una', () => {
    let p = base();
    p = S.replaceCues(p, 'S', [{ start: 1, end: 7, text: 'uno\ndos dos\ntres' }], { ids: ['a'] }).p;
    const r = S.splitCueLines(p, 'a', ['b', 'c']);
    expect(r.ids).toEqual(['a', 'b', 'c']);
    const cs = VM.findTrack(r.p, 'S')!.clips;
    expect(cs.map((c) => c.text)).toEqual(['uno', 'dos dos', 'tres']);
    expect(cs[0].start).toBe(1);
    expect(VM.clipEnd(cs[2])).toBeCloseTo(7, 9);
    for (let i = 0; i + 1 < cs.length; i++) expect(VM.clipEnd(cs[i])).toBeCloseTo(cs[i + 1].start, 9);
    expect(S.splitCueLines(r.p, 'a').ids).toEqual([]); // una sola línea
  });

  it('unir: textos en líneas, del inicio del primero al final del último', () => {
    let p = base();
    p = S.replaceCues(p, 'S', [
      { start: 1, end: 2, text: 'a' },
      { start: 2.5, end: 3, text: 'b' },
      { start: 4, end: 5, text: 'c' },
    ], { ids: ['a', 'b', 'c'] }).p;
    const m = S.mergeCues(p, ['b', 'a']);
    expect(m.tracks[1].clips.map((c) => [c.id, c.text, c.start, VM.clipDuration(c)])).toEqual([
      ['a', 'a\nb', 1, 2],
      ['c', 'c', 4, 1],
    ]);
    expect(S.mergeCues(p, ['a', 'c'])).toBe(p); // no son vecinos: «b» quedaría fuera
    expect(S.mergeCues(p, ['a'])).toBe(p);
  });

  it('desplazar todos, o desde uno; nunca por debajo de 0', () => {
    let p = base();
    p = S.replaceCues(p, 'S', [
      { start: 1, end: 2, text: 'a' },
      { start: 3, end: 4, text: 'b' },
    ], { ids: ['a', 'b'] }).p;
    expect(texts(S.shiftCues(p, 'S', 0.5))).toEqual(['a@1.5+1', 'b@3.5+1']);
    expect(texts(S.shiftCues(p, 'S', -0.5, { fromId: 'b' }))).toEqual(['a@1+1', 'b@2.5+1']);
    expect(texts(S.shiftCues(p, 'S', -5))).toEqual(['a@0+1', 'b@2+1']); // se detiene en 0 sin deformar
    expect(S.shiftCues(p, 'S', 0)).toBe(p);
    expect(S.shiftCues(p, 'V', 1)).toBe(p);
  });

  it('ajustar a escena: pega inicio y fin a los cortes cercanos', () => {
    let p = base(); // cortes de escena: 0, 5, 10
    expect(S.sceneBoundaries(p)).toEqual([0, 5, 10]);
    p = S.replaceCues(p, 'S', [
      { start: 0.12, end: 4.8, text: 'a' }, // ambos cerca de 0 y 5
      { start: 5.9, end: 8, text: 'b' }, // lejos de todo
      { start: 8.1, end: 9.9, text: 'c' }, // el final cerca de 10
    ], { ids: ['a', 'b', 'c'] }).p;
    const r = S.fitCuesToScenes(p, 'S', { tolerance: 0.25 });
    expect(texts(r)).toEqual(['a@0+5', 'b@5.9+2.1', 'c@8.1+1.9']);
    expect(S.fitCuesToScenes(r, 'S', { tolerance: 0.25 })).toBe(r); // idempotente
    expect(S.fitCuesToScenes(p, 'S', { tolerance: 0.01 })).toBe(p);
  });

  it('estilo global de la pista', () => {
    const p = base();
    const q = S.setSubtitleStyle(p, 'S', { position: 'top', style: { fontSize: 70, fill: '#ff0' } });
    const st = VM.findTrack(q, 'S')!.subStyle!;
    expect(st.position).toBe('top');
    expect(st.style.fontSize).toBe(70);
    expect(st.style.strokeWidth).toBe(DEFAULT_SUBTITLE_STYLE.style.strokeWidth);
    expect(VM.findTrack(p, 'S')!.subStyle!.style.fontSize).toBe(DEFAULT_SUBTITLE_STYLE.style.fontSize); // no muta
    const k = S.setSubtitleStyle(q, 'S', { karaoke: { color: '#0f0', scale: 1.2, keep: true } });
    expect(VM.findTrack(k, 'S')!.subStyle!.karaoke!.color).toBe('#0f0');
    expect(VM.findTrack(S.setSubtitleStyle(k, 'S', { karaoke: undefined }), 'S')!.subStyle!.karaoke).toBeUndefined();
    expect(S.setSubtitleStyle(p, 'V', { position: 'top' })).toBe(p);
  });

  it('velocidad de lectura', () => {
    expect(S.readingSpeed('abcdefghij', 2)).toBe(5);
    expect(S.readingSpeed('a  b\nc', 1)).toBe(5);
    expect(S.readingSpeed('x', 0)).toBe(Infinity);
  });
});

describe('importar y exportar SRT sobre el proyecto', () => {
  const SRT = `1
00:00:01,000 --> 00:00:03,500
¿Qué tal, señora Peña?
Hoy hace mucho frío.

2
00:00:04,000 --> 00:00:06,250
Camión, canción, corazón… ¡ñandú!

3
00:01:02,005 --> 00:01:03,999
Último subtítulo.
`;
  it('SRT → pista → SRT: idéntico', () => {
    const p = base();
    const r = S.replaceCues(p, 'S', parseSrt(SRT).cues);
    expect(r.overlapsFixed).toBe(0);
    expect(serializeSrt(S.cuesOfTrack(VM.findTrack(r.p, 'S')!))).toBe(SRT);
  });
  it('también tras guardar y volver a abrir (serializar + migrar)', () => {
    const r = S.replaceCues(base(), 'S', parseSrt(SRT).cues);
    const reopened = migrateVideoProject(JSON.parse(JSON.stringify(serializeProject(r.p)))).project;
    expect(serializeSrt(S.cuesOfTrack(VM.findTrack(reopened, 'S')!))).toBe(SRT);
  });
  it('con solapes: se recortan y no se pierde ninguno', () => {
    const r = S.replaceCues(base(), 'S', parseSrt('1\n00:00:01,000 --> 00:00:04,000\nA\n\n2\n00:00:03,000 --> 00:00:05,000\nB\n').cues);
    expect(r.overlapsFixed).toBe(1);
    expect(texts(r.p)).toEqual(['A@1+2', 'B@3+2']);
  });
  it('en pista bloqueada no hace nada', () => {
    const p = VM.updateTrack(base(), 'S', { locked: true });
    expect(S.replaceCues(p, 'S', parseSrt(SRT).cues).p).toBe(p);
  });
});

describe('formato: aditivo, sin migración y tolerante', () => {
  const build = () => {
    let p = base();
    p = VM.addTrack(p, 'video', { id: 'T' });
    p = VM.addClip(p, 'T', VM.makeClip('text', { id: 't', text: 'Hola', outP: 3, tstyle: forVideo(TITLE_PRESETS[0].style), anim: { in: 'pop', out: 'fade', unit: 'word', karaoke: { color: '#ff0', scale: 1.1, keep: true } }, words: [{ text: 'Hola', start: 0, end: 1 }] }));
    p = S.replaceCues(p, 'S', parseSrt('1\n00:00:01,000 --> 00:00:02,000\nUno dos\n').cues, { ids: ['c1'] }).p;
    p = S.setSubtitleStyle(p, 'S', { position: 'top', karaoke: { color: '#0f0', scale: 1.2, keep: false } });
    return p;
  };
  it('normalizeV2 es idempotente y conserva título, animación, palabras y estilo de la pista', () => {
    const p = build();
    const a = normalizeV2(JSON.parse(JSON.stringify(serializeProject(p))));
    const b = normalizeV2(JSON.parse(JSON.stringify(serializeProject(a))));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const t = VM.findClip(a, 't')!.clip;
    expect(t.tstyle).toEqual(VM.findClip(p, 't')!.clip.tstyle);
    expect(t.anim).toEqual(VM.findClip(p, 't')!.clip.anim);
    expect(t.words).toEqual([{ text: 'Hola', start: 0, end: 1 }]);
    expect(VM.findTrack(a, 'S')!.subStyle).toEqual(VM.findTrack(p, 'S')!.subStyle);
    expect(VM.findClip(a, 'c1')!.clip.kind).toBe('subtitle');
    expect(a.v).toBe(2);
  });
  it('un proyecto v2 de antes (sin campos nuevos) sigue abriendo igual', () => {
    const old = { v: 2, media: {}, tracks: [{ id: 'V', kind: 'video', name: 'Video', muted: false, locked: false, hidden: false, magnet: false, clips: [{ id: 'x', kind: 'text', start: 0, inP: 0, outP: 2, speed: 1, volume: 1, effect: 'none', fadeIn: 0, fadeOut: 0, audioFadeIn: 0, audioFadeOut: 0, transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }, text: 'Hola', color: '#fff', size: 60 }] }], eq: { low: 0, mid: 0, high: 0 }, normalize: false };
    const r = migrateVideoProject(old);
    expect(r.report.complete).toBe(true);
    const c = VM.findClip(r.project, 'x')!.clip;
    expect(c.tstyle).toBeUndefined();
    expect(c.anim).toBeUndefined();
    expect(c.text).toBe('Hola');
    expect(c.size).toBe(60);
  });
  it('un subtítulo suelto en una pista de video (o al revés) va a «huérfanos», no se pierde', () => {
    const raw = JSON.parse(JSON.stringify(serializeProject(build())));
    raw.tracks.find((t: { id: string }) => t.id === 'S').kind = 'video';
    const r = normalizeV2(raw);
    expect(r.legacy?.orphanClips).toHaveLength(1);
  });
  it('lo corrupto se sanea', () => {
    expect(sanitizeTitleStyle({ fontSize: 'enorme', fill: 5, align: 'x', strokeWidth: -4, maxWidth: 9 })).toMatchObject({ fontSize: 96, fill: '#ffffff', align: 'center', strokeWidth: 0, maxWidth: 1 });
    expect(sanitizeTitleStyle(null)).toBeUndefined();
    expect(sanitizeAnim({ in: 'none', out: 7, inDur: -1, unit: 'zzz' })).toBeUndefined();
    expect(sanitizeAnim({ in: 'fade', inDur: 99 })).toEqual({ in: 'fade', inDur: 10 });
    const s = sanitizeSubtitleStyle({ position: 'cielo', maxLines: 99, margin: 5, style: {} })!;
    expect(s).toMatchObject({ position: 'bottom', maxLines: 6, margin: 0.45 });
  });
});

describe('preajustes', () => {
  it('hay 20 o más estilos de título y 10 pares de fuentes, con ids únicos', () => {
    expect(TITLE_PRESETS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TITLE_PRESETS.map((p) => p.id)).size).toBe(TITLE_PRESETS.length);
    expect(TITLE_PAIRS.length).toBe(10);
    expect(SUBTITLE_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(TITLE_PRESETS.filter((p) => p.category === 'Tercios inferiores').length).toBeGreaterThanOrEqual(3);
    expect(TITLE_PRESETS.filter((p) => p.anim?.karaoke).length).toBeGreaterThanOrEqual(3);
  });
  it('los de diseño oscuro pasan a claro para verse sobre video', () => {
    const p = TITLE_PRESETS.find((x) => x.id === 'd-titulo-impacto')!;
    expect(p.style.fill).toBe('#ffffff');
    expect(p.style.shadow).toBe(true);
    const hollow = TITLE_PRESETS.find((x) => x.id === 'd-contorno-hueco')!;
    expect(hollow.style.strokeColor).toBe('#ffffff');
    const box = TITLE_PRESETS.find((x) => x.id === 'd-etiqueta-clara')!;
    expect(box.style.fill).toBe('#111111'); // con caja clara se respeta
  });
  it('aplicar un preajuste conserva id y tiempos y copia la animación', () => {
    const preset = TITLE_PRESETS.find((x) => x.id === 'v-tercio-simple')!;
    const c = VM.makeClip('text', { id: 'q', text: 'x', start: 4, outP: 3 });
    const a = applyPreset(c, preset);
    expect(a).toMatchObject({ id: 'q', start: 4, outP: 3, text: preset.text });
    expect(a.transform.y).toBe(0.82);
    expect(a.anim).toEqual(preset.anim);
    expect(a.anim).not.toBe(preset.anim);
    expect(applyPreset(c, preset, { keepText: true, keepPosition: true })).toMatchObject({ text: 'x', transform: c.transform });
  });
});

describe('SRT real con acentos y eñes (archivo)', () => {
  const dir = new URL('../bench/fixtures/', import.meta.url);
  // el archivo puede salir con CRLF según la configuración de git: se normaliza a LF (que es lo que escribe `serializeSrt`)
  const raw = readFileSync(fileURLToPath(new URL('entrevista.srt', dir)), 'utf8').replace(/\r\n/g, '\n');
  it('el archivo está bien (acentos, eñes, comillas, euro, rayas)', () => {
    expect(raw).toContain('señora Peña');
    expect(raw).toContain('pingüinos y cigüeñas');
    expect(raw).toContain('25 €');
    expect(raw).toContain('“Camión, canción y corazón”');
    expect(raw).toContain('—¡Cuidado!');
  });
  it('importar → pista de subtítulos → exportar: idéntico, byte a byte', () => {
    const cues = parseSrt(raw).cues;
    expect(cues).toHaveLength(8);
    const r = S.replaceCues(base(), 'S', cues);
    expect(r.overlapsFixed).toBe(0);
    const back = serializeSrt(S.cuesOfTrack(VM.findTrack(r.p, 'S')!));
    expect(back).toBe(raw);
    expect(new TextEncoder().encode(back)).toEqual(new TextEncoder().encode(raw));
  });
  it('también con saltos de línea de Windows (CRLF) y BOM', () => {
    const crlf = '﻿' + raw.replace(/\n/g, '\r\n');
    const r = S.replaceCues(base(), 'S', parseSrt(crlf).cues);
    expect(serializeSrt(S.cuesOfTrack(VM.findTrack(r.p, 'S')!))).toBe(raw);
  });
  it('guardar el proyecto, reabrirlo y exportar: idéntico', () => {
    const r = S.replaceCues(base(), 'S', parseSrt(raw).cues);
    const reopened = migrateVideoProject(JSON.parse(JSON.stringify(serializeProject(r.p)))).project;
    expect(serializeSrt(S.cuesOfTrack(VM.findTrack(reopened, 'S')!))).toBe(raw);
  });
  it('VTT y TXT dan los mismos subtítulos', () => {
    const cues = parseSrt(raw).cues;
    expect(parseSubtitles(serializeVtt(cues)).cues).toEqual(cues);
    expect(parseSubtitles(serializeTxt(cues)).cues).toEqual(cues);
  });
});
