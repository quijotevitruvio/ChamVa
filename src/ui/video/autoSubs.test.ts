import { describe, expect, it } from 'vitest';
import { segmentsToSubtitles } from '../../ai/transcribe/subtitles';
import type { AsrSegment } from '../../ai/transcribe/windows';
import * as VM from '../../video/model';
import * as S from '../../video/title/subtitles';
import * as A from './autoSubs';

function proj() {
  let p = VM.createProject();
  p = VM.addTrack(p, 'video', { id: 'V' });
  p = VM.addTrack(p, 'audio', { id: 'A' });
  p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'entrevista', duration: 60 });
  p = VM.addMedia(p, { id: 'au', kind: 'audio', name: 'voz', duration: 60 });
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'v1', mediaId: 'm', start: 0, outP: 10 }));
  p = VM.addClip(p, 'A', VM.makeClip('audio', { id: 'a1', mediaId: 'au', start: 2, outP: 8 }));
  p = VM.addMedia(p, { id: 'im', kind: 'image', name: 'foto', duration: 0 });
  p = VM.addClip(p, 'V', VM.makeClip('image', { id: 'i1', mediaId: 'im', start: 10, outP: 6 }));
  return p;
}

const seg = (start: number, words: string[]): AsrSegment => ({
  start,
  end: start + words.length * 0.4,
  text: words.join(' '),
  words: words.map((w, i) => ({ t0: start + i * 0.4, t1: start + i * 0.4 + 0.35, w })),
});

describe('alcance', () => {
  it('todo el proyecto: sin rango; vacío o silenciado da un motivo legible', () => {
    expect(A.resolveScope(proj(), 'project', { selection: [], marks: { in: null, out: null } })).toMatchObject({ ok: true });
    expect(A.resolveScope(VM.createProject(), 'project', { selection: [], marks: { in: null, out: null } })).toMatchObject({ ok: false });
    let p = proj();
    p = VM.updateTrack(p, 'V', { muted: true });
    p = VM.updateTrack(p, 'A', { muted: true });
    const r = A.resolveScope(p, 'project', { selection: [], marks: { in: null, out: null } });
    expect(r.ok).toBe(false);
    expect((r as A.ScopeError).reason).toMatch(/silenciadas/);
  });
  it('clip seleccionado: rango y pista del clip; sin selección o con un texto, error', () => {
    const r = A.resolveScope(proj(), 'clip', { selection: ['a1'], marks: { in: null, out: null } });
    expect(r).toMatchObject({ ok: true, range: { start: 2, end: 10 }, trackId: 'A' });
    expect(A.resolveScope(proj(), 'clip', { selection: [], marks: { in: null, out: null } }).ok).toBe(false);
    const t = VM.addClip(proj(), VM.createProject().tracks[0]?.id ?? 'V', VM.makeClip('video', { id: 'x', mediaId: 'm', start: 30, outP: 1 }));
    expect(A.selectedMediaClip(t, ['zzz', 'x'])?.clip.id).toBe('x');
  });
  it('entre marcas: acepta marcas al revés, exige las dos y que haya audio dentro', () => {
    const m = (a: number | null, b: number | null) => ({ selection: [], marks: { in: a, out: b } });
    expect(A.resolveScope(proj(), 'marks', m(5, null)).ok).toBe(false);
    expect(A.resolveScope(proj(), 'marks', m(8, 2))).toMatchObject({ ok: true, range: { start: 2, end: 8 } });
    const gap = A.resolveScope(proj(), 'marks', m(12, 15)); // solo hay una imagen
    expect(gap.ok).toBe(false);
    expect((gap as A.ScopeError).reason).toMatch(/No hay audio entre las marcas/);
    expect(A.resolveScope(proj(), 'marks', m(3, 3.01)).ok).toBe(false);
    expect(A.marksRange({ in: -5, out: 4 })).toEqual({ start: 0, end: 4 });
  });
  it('un medio que falta no cuenta como audio', () => {
    const p = VM.addMedia(proj(), { id: 'au', kind: 'audio', name: 'voz', duration: 60, missing: true });
    expect(A.hasAudioIn(p, { start: 3, end: 5 })).toBe(true); // el video sí suena
    expect(A.hasAudioIn(VM.updateTrack(p, 'V', { muted: true }), { start: 3, end: 5 })).toBe(false); // el audio que falta no
    expect(A.hasAudioIn(VM.updateTrack(VM.updateTrack(p, 'V', { muted: true }), 'A', { muted: true }), { start: 3, end: 5 })).toBe(false);
  });
});

it('formato de marcas', () => {
  expect(A.fmtMark(12.34)).toBe('0:12,3');
  expect(A.fmtMark(65)).toBe('1:05,0');
});

describe('opciones', () => {
  it('idioma automático → null; traducir se conserva', () => {
    expect(A.engineLanguage({ language: 'auto', translate: false })).toEqual({ language: null, translate: false });
    expect(A.engineLanguage({ language: 'es', translate: true })).toEqual({ language: 'es', translate: true });
  });
  it('el diseño de subtítulo se acota aunque lleguen valores absurdos', () => {
    expect(A.layoutOf({ maxChars: 3, maxLines: 99, maxDur: NaN })).toEqual({ maxChars: 12, maxLines: 4, maxDur: 1 });
    expect(A.layoutOf({ maxChars: 42, maxLines: 2, maxDur: 6 })).toEqual({ maxChars: 42, maxLines: 2, maxDur: 6 });
  });
  it('avisos: traducir con karaoke avisa; sin karaoke no', () => {
    expect(A.karaokeWarning({ translate: true, karaoke: true })).toMatch(/menos fiables/);
    expect(A.karaokeWarning({ translate: true, karaoke: false })).toBeNull();
  });
  it('modelos: tamaños exactos por dispositivo y recomendación según equipo', () => {
    const gpu = A.modelChoices({ webgpu: true, memoryGB: 8 }, 'webgpu');
    expect(gpu.find((c) => c.recommended)?.size).toBe('small');
    expect(gpu.find((c) => c.size === 'tiny')!.bytes).toBeGreaterThan(120e6);
    const mobile = A.modelChoices({ webgpu: false, memoryGB: 2, mobile: true }, 'wasm');
    expect(mobile.filter((c) => c.allowed).map((c) => c.size)).toEqual(['tiny']);
    expect(mobile.find((c) => c.size === 'tiny')!.bytes).toBeLessThan(50e6);
  });
  it('texto de consentimiento con tamaño y origen', () => {
    expect(A.consentText(43_600_000)).toBe('Descargar 44 MB desde huggingface.co. El audio nunca sale de tu equipo.');
  });
});

describe('progreso y avisos de velocidad', () => {
  it('tiempo restante: no fiable al principio, proporcional después', () => {
    expect(A.etaSeconds(0.02, 5000)).toBeNull();
    expect(A.etaSeconds(0.5, 1000)).toBeNull();
    expect(A.etaSeconds(0.5, 10_000)).toBeCloseTo(10);
    expect(A.etaSeconds(0.25, 10_000)).toBeCloseTo(30);
    expect(A.etaSeconds(1, 10_000)).toBeNull();
  });
  it('texto de progreso con ventana y tiempo', () => {
    expect(A.progressText('asr', 0.5, 20_000, { done: 1, total: 4 })).toBe('Transcribiendo (ventana 2 de 4) · 50 % · quedan unos 0:20');
    expect(A.progressText('load', 0.1, 100)).toBe('Cargando el modelo · 10 %');
    expect(A.windowOf(0.99, 3)).toEqual({ done: 2, total: 3 });
  });
  it('aviso de velocidad solo con CPU', () => {
    expect(A.speedWarning('webgpu', 120)).toBeNull();
    expect(A.speedWarning('wasm', 120)).toMatch(/CPU.*2:00.*entre 0:30 y 3:00/);
  });
});

describe('errores legibles', () => {
  const ctx = { size: 'base' as const, device: 'wasm' as const };
  it('cancelado', () => expect(A.describeError(Object.assign(new Error('cancelado'), { name: 'AbortError' }), ctx).kind).toBe('cancelled'));
  it('sin modelo', () => {
    const r = A.describeError(Object.assign(new Error('x'), { name: 'MissingModelError' }), ctx);
    expect(r.kind).toBe('missing-model');
    expect(r.title).toContain('base');
  });
  it('sin WebGPU: sugiere CPU', () => {
    const r = A.describeError(new Error('Failed to get WebGPU adapter'), { size: 'small', device: 'webgpu' });
    expect(r).toMatchObject({ kind: 'webgpu', tryCpu: true });
  });
  it('memoria: sugiere el modelo menor (y ninguno si ya es tiny)', () => {
    expect(A.describeError(new Error('Out of memory'), { size: 'small', device: 'wasm' })).toMatchObject({ kind: 'memory', trySize: 'base' });
    expect(A.describeError(new RangeError('Array buffer allocation failed'), ctx)).toMatchObject({ kind: 'memory', trySize: 'tiny' });
    expect(A.describeError(new Error('Out of memory'), { size: 'tiny', device: 'wasm' }).trySize).toBeUndefined();
  });
  it('rango vacío, red y desconocido', () => {
    expect(A.describeError(new Error('El rango elegido está vacío.'), ctx).kind).toBe('no-audio');
    expect(A.describeError(Object.assign(new Error('x'), { name: 'DownloadError' }), ctx).kind).toBe('network');
    expect(A.describeError(new Error('boom'), ctx).title).toContain('boom');
  });
});

describe('aplicar el resultado (un solo cambio)', () => {
  const cues = segmentsToSubtitles([seg(1, ['hola', 'mundo', 'esto', 'es', 'una', 'prueba']), seg(8, ['segunda', 'frase', 'corta'])], A.layoutOf(A.DEFAULT_AUTO));
  it('crea la pista si no hay y aplica el preajuste', () => {
    const r = A.applySubtitles(proj(), cues, { mode: 'replace', karaoke: false, presetId: 's-amarillo' });
    const t = VM.findTrack(r.p, r.trackId)!;
    expect(t.kind).toBe('subtitle');
    expect(t.clips.length).toBe(cues.length);
    expect(t.subStyle?.style.presetId).toBe('s-amarillo');
    expect(t.subStyle?.karaoke).toBeUndefined();
    expect(t.clips.every((c) => !c.words)).toBe(true);
  });
  it('con karaoke conserva los tiempos por palabra y activa el karaoke de la pista', () => {
    const r = A.applySubtitles(proj(), cues, { mode: 'replace', karaoke: true, presetId: 's-clasico' });
    const t = VM.findTrack(r.p, r.trackId)!;
    expect(t.clips[0].words?.length).toBeGreaterThan(0);
    expect(t.subStyle?.karaoke).toEqual(A.DEFAULT_KARAOKE);
    const k = A.applySubtitles(proj(), cues, { mode: 'replace', karaoke: true, presetId: 's-karaoke' });
    expect(VM.findTrack(k.p, k.trackId)!.subStyle?.karaoke?.color).toBe('#ffd84d');
  });
  it('reemplazar vacía la pista existente; añadir crea otra y no toca la primera', () => {
    const first = A.applySubtitles(proj(), cues.slice(0, 1), { mode: 'replace', karaoke: false, presetId: 's-clasico' });
    const rep = A.applySubtitles(first.p, cues, { mode: 'replace', karaoke: false, presetId: 's-clasico' });
    expect(S.subtitleTracks(rep.p).length).toBe(1);
    expect(S.subtitleTracks(rep.p)[0].clips.length).toBe(cues.length);
    const add = A.applySubtitles(first.p, cues, { mode: 'add', karaoke: false, presetId: 's-clasico' });
    expect(S.subtitleTracks(add.p).length).toBe(2);
    expect(S.subtitleTracks(add.p).find((t) => t.id === first.trackId)!.clips.length).toBe(1);
  });
  it('un paso de deshacer deja el proyecto como estaba', () => {
    const h0 = VM.createHistory(proj());
    const r = A.applySubtitles(h0.present, cues, { mode: 'replace', karaoke: true, presetId: 's-karaoke' });
    const h1 = VM.commit(h0, r.p);
    expect(S.subtitleTracks(h1.present).length).toBe(1);
    const h2 = VM.undo(h1);
    expect(S.subtitleTracks(h2.present).length).toBe(0);
    expect(h2.present).toBe(h0.present);
  });
  it('una pista bloqueada no se sobrescribe: se crea otra', () => {
    const first = A.applySubtitles(proj(), cues.slice(0, 1), { mode: 'replace', karaoke: false, presetId: 's-clasico' });
    const locked = VM.updateTrack(first.p, first.trackId, { locked: true });
    const r = A.applySubtitles(locked, cues, { mode: 'replace', karaoke: false, presetId: 's-clasico' });
    expect(S.subtitleTracks(r.p).length).toBe(2);
    expect(VM.findTrack(r.p, first.trackId)!.clips.length).toBe(1);
  });
});
