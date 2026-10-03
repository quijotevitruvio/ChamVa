import { describe, expect, it } from 'vitest';
import { buildSegments, segmentIndexAt, sourceTimeAt as v1SourceTime, fadeAlpha, frameCount, overlayVisible } from '../engine/timeline';
import { buildMixEntries } from '../engine/mixer';
import { buildProjectMixEntries } from '../engine/compose';
import { detectVersion, migrateVideoProject, normalizeV2, serializeProject } from './migrate';
import { clipFadeAlpha, clipsAt, projectDuration, sourceTimeAt } from './query';
import { effectById } from './effects';
import realV1Json from './fixtures/v1-real.json';

/** Rehace los Blob del fixture (mismo __blob → MISMO objeto, como hace IndexedDB). */
function reviveBlobs<T>(json: T): T {
  const blobs = new Map<string, Blob>();
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.__blob === 'string') {
        if (!blobs.has(o.__blob)) blobs.set(o.__blob, new Blob([new Uint8Array(Number(o.size) % 97)], { type: String(o.type) }));
        return blobs.get(o.__blob);
      }
      return Object.fromEntries(Object.entries(o).filter(([k]) => k !== '_nota').map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(json) as T;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !(o instanceof Blob)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

type V1 = { clips: any[]; overlays: any[]; eq: any; normalize: boolean };
const realV1 = () => reviveBlobs(realV1Json) as unknown as V1;

/** Lo que V1 hacía con un guardado: filtra clips con Blob y separa por tipo. */
function v1View(raw: V1) {
  const clips = raw.clips.filter((c) => c.blob);
  return { video: clips.filter((c) => c.type === 'video'), audio: clips.filter((c) => c.type === 'audio'), overlays: raw.overlays };
}

/** Compara la línea de tiempo de V1 (motor de 0bdf437) con la del proyecto migrado, fotograma a fotograma. */
function expectSameTimeline(raw: V1, fps = 30) {
  const { project } = migrateVideoProject(raw);
  const { video, audio, overlays } = v1View(raw);
  const segs = buildSegments(video.map((c) => ({ ...c, speed: c.speed })));
  const v1Dur = segs.length ? segs[segs.length - 1].end : 0;
  expect(projectDuration(project)).toBe(v1Dur); // bit a bit
  const frames = frameCount(v1Dur, fps);
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    const seg = segs[segmentIndexAt(segs, t)];
    const { visual } = clipsAt(project, t);
    const vids = visual.filter((x) => x.clip.kind === 'video');
    expect(vids.map((x) => x.clip.id)).toEqual([seg.clip.id]);
    expect(sourceTimeAt(vids[0].clip, t)).toBe(v1SourceTime(seg, t));
    expect(clipFadeAlpha(vids[0].clip, t, v1Dur)).toBe(fadeAlpha(seg, t));
    const overlayIds = visual.filter((x) => x.clip.kind !== 'video').map((x) => x.clip.id);
    expect(overlayIds).toEqual(overlays.filter((o) => (o.kind === 'text' || (o.kind === 'image' && o.blob)) && overlayVisible(o, t)).map((o) => o.id));
  }
  // audio: mismas entradas de mezcla (orden incluido) que V1
  const fx = (c: any) => ({ ...c, ...effectById(c.effect), gate: !!effectById(c.effect).gate, speed: c.speed });
  const open = () => () => Promise.resolve(null);
  const v1Mix = buildMixEntries(segs.map((s) => ({ ...s, clip: fx(s.clip) })), audio.map(fx), frames / fps, open);
  const v2Mix = buildProjectMixEntries(project, frames / fps, open);
  const strip = (e: any) => ({ start: e.start, end: e.end, inP: e.inP, outP: e.outP, speed: e.speed, fx: e.fx, fadeIn: e.fadeIn ?? 0, fadeOut: e.fadeOut ?? 0 });
  expect(v2Mix.map(strip)).toEqual(v1Mix.map(strip));
  return project;
}

describe('migración v1 → v2', () => {
  it('detecta versiones', () => {
    expect(detectVersion(null)).toBe('empty');
    expect(detectVersion({ clips: [] })).toBe(1);
    expect(detectVersion({ v: 2, tracks: [] })).toBe(2);
    expect(detectVersion({ v: 3 })).toBe('future');
    expect(detectVersion('basura')).toBe('unknown');
  });

  it('guardado REAL de V1: no muta el original, migra todo y la imagen/el sonido coinciden con V1', () => {
    const raw = deepFreeze(realV1());
    const { project, report } = migrateVideoProject(raw);
    expect(report).toMatchObject({ from: 1, v1Clips: 4, v1Overlays: 2, clips: 4, overlays: 2, orphanClips: 0, complete: true, repaired: [] });
    // medios por referencia: el clip dividido comparte UN medio y el MISMO Blob
    const main = project.tracks.find((t) => t.id === 'v1-video')!;
    expect(main.clips.map((c) => c.name)).toEqual(['rojo.webm', 'amarillo.mp4', 'amarillo.mp4']);
    expect(main.clips[1].mediaId).toBe(main.clips[2].mediaId);
    expect(project.media[main.clips[1].mediaId!].blob).toBe(raw.clips[1].blob);
    expect(Object.keys(project.media)).toHaveLength(4);
    // orden de capas: texto (última capa de V1) arriba, luego imagen, video y audio
    expect(project.tracks.map((t) => [t.kind, t.clips[0]?.kind])).toEqual([
      ['video', 'text'],
      ['video', 'image'],
      ['video', 'video'],
      ['audio', 'audio'],
    ]);
    expect(project.eq).toEqual({ low: 3, mid: 0, high: 0 });
    expect(project.normalize).toBe(true);
    expect(main.clips[0]).toMatchObject({ effect: 'clean', volume: 0.6, fadeIn: 0.5, inP: 0.3, audioFadeIn: 0 });
    expectSameTimeline(raw);
  });

  it('idempotente: migrar el resultado (y su copia guardada) da lo mismo', () => {
    const raw = realV1();
    const a = migrateVideoProject(raw).project;
    expect(migrateVideoProject(raw).project).toEqual(a);
    expect(migrateVideoProject(a).project).toEqual(a);
    expect(normalizeV2(serializeProject(a) as any)).toEqual(a);
  });

  it('tolera campos que faltan o inválidos y conserva lo inservible en legacy', () => {
    const blob = new Blob(['x']);
    const raw = {
      clips: [
        { type: 'video', blob, outP: 2 }, // sin id, inP, speed, volumen, efecto…
        { id: 'sinArchivo', type: 'video', url: 'blob:viejo', inP: 0, outP: 3 }, // V1 lo descartaba al cargar
        { id: 'raro', type: 'gif', blob },
        { id: 'nan', type: 'video', blob, inP: NaN, outP: NaN, duration: 5, speed: 0, volume: -1 },
        { id: 'rec', type: 'audio', blob, inP: 0, outP: Infinity, duration: Infinity }, // grabación WebM de V1
        null,
      ],
      overlays: [{ kind: 'text' }, { id: 'img', kind: 'image', start: 2, end: 1 }, { kind: 'sticker' }],
    };
    const { project, report } = migrateVideoProject(raw);
    expect(report.complete).toBe(true);
    expect(report).toMatchObject({ clips: 3, orphanClips: 3, overlays: 2, orphanOverlays: 1 });
    expect(project.legacy!.orphanClips!.map((c: any) => c?.id ?? null)).toEqual(['sinArchivo', 'raro', null]);
    const main = project.tracks.find((t) => t.id === 'v1-video')!;
    expect(main.clips[0]).toMatchObject({ id: 'v1c-0', inP: 0, outP: 2, speed: 1, volume: 1, effect: 'none', start: 0 });
    expect(main.clips[1]).toMatchObject({ id: 'nan', inP: 0, outP: 5, speed: 1, volume: 1, start: 2 });
    expect(report.repaired).toEqual(expect.arrayContaining(['clip nan: inP', 'clip nan: outP', 'clip nan: speed', 'clip nan: volume']));
    const rec = project.tracks.find((t) => t.id === 'v1-audio')!.clips[0];
    expect(rec.outP).toBe(Infinity); // se conserva: V1 lo reproducía hasta el final
    const [text, img] = project.tracks.slice(0, 2).map((t) => t.clips[0]);
    expect(img).toMatchObject({ kind: 'text', text: '', color: '#ffffff', size: 60, toEnd: true }); // la última capa, arriba
    expect(text).toMatchObject({ kind: 'image', outP: 0 }); // start > end: nunca visible, como en V1
    expect(project.media[text.mediaId!].missing).toBe(true);
    expect(projectDuration(project)).toBe(7);
  });

  it('capas con fin dentro del video: fin INCLUSIVO como V1 (se ve en t = fin)', () => {
    const blob = new Blob(['x']);
    const raw = { clips: [{ id: 'v', type: 'video', blob, inP: 0, outP: 6, duration: 6, volume: 1, speed: 1, effect: 'none' }], overlays: [{ id: 't', kind: 'text', text: 'a', start: 1, end: 3, xf: 0.5, yf: 0.5, size: 60, color: '#fff' }] };
    const p = expectSameTimeline(raw as any);
    expect(clipsAt(p, 3).visual.map((x) => x.clip.id)).toEqual(['v', 't']);
    expect(clipsAt(p, 3 + 1 / 30).visual.map((x) => x.clip.id)).toEqual(['v']);
  });

  it('secuencias sintéticas variadas: misma línea de tiempo que V1 fotograma a fotograma', () => {
    const blob = new Blob(['x']);
    for (const seed of [1, 2, 3, 4, 5]) {
      let s = seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const clips: any[] = [];
      for (let i = 0; i < 4; i++) {
        const inP = Math.round(rnd() * 20) / 10;
        clips.push({ id: `c${seed}-${i}`, type: i === 3 ? 'audio' : 'video', blob, inP, outP: inP + 0.3 + Math.round(rnd() * 30) / 10, speed: [0.5, 1, 1.5, 2, 0.75][i % 5], fadeIn: rnd() > 0.5 ? 0.4 : 0, fadeOut: rnd() > 0.5 ? 0.7 : 0, effect: ['none', 'echo', 'denoise'][i % 3], volume: 1 });
      }
      const overlays = [
        { id: `o${seed}a`, kind: 'text', text: 'x', start: Math.round(rnd() * 20) / 10, end: Math.round(rnd() * 60) / 10, xf: 0.3, yf: 0.6, size: 50, color: '#f00' },
        { id: `o${seed}b`, kind: 'image', blob, start: 0.5, end: 9999, xf: 0.5, yf: 0.5, size: 0.2 },
      ];
      expectSameTimeline({ clips, overlays, eq: { low: 0, mid: 0, high: 0 }, normalize: false });
    }
  });

  it('versión futura o valor irreconocible → proyecto vacío y migración NO completa', () => {
    expect(migrateVideoProject({ v: 9, tracks: [] }).report.complete).toBe(false);
    expect(migrateVideoProject(42).report.complete).toBe(false);
    expect(migrateVideoProject(null).report.complete).toBe(true);
  });

  it('serializeProject no guarda URLs ni medios sin usar', () => {
    const { project } = migrateVideoProject(realV1());
    const id = Object.keys(project.media)[0];
    const withUrl = { ...project, media: { ...project.media, [id]: { ...project.media[id], url: 'blob:x' }, huerfano: { id: 'huerfano', kind: 'audio' as const, name: '', duration: 0 } } } as typeof project;
    const s = serializeProject(withUrl);
    expect(s.media[id].url).toBeUndefined();
    expect(s.media.huerfano).toBeUndefined();
    expect(withUrl.media[id].url).toBe('blob:x'); // no muta
  });
});
