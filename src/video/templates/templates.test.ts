import { describe, expect, it } from 'vitest';
import * as VM from '../model';
import { areJoined } from '../fx/transitions';
import { applyAsProject, applyTemplate, insertTemplate } from './apply';
import { VIDEO_TEMPLATES, buildTemplate, getVideoTemplate, type VideoTemplate } from './templates';

let seq = 0;
const counter = () => {
  const k = ++seq;
  let n = 0;
  return () => `id${k}-${++n}`;
};
const blobsFor = (t: VideoTemplate) => Object.fromEntries(t.placeholders.map((h) => [h.id, new Blob([new Uint8Array(4)], { type: 'image/png' })]));
const build = (t: VideoTemplate, uid = counter()) => buildTemplate(t, blobsFor(t), uid);

/** Claves ordenadas: compara sin depender del orden de los campos. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));

describe('las 12 plantillas', () => {
  it('hay 12, con ids y nombres únicos y descripciones', () => {
    expect(VIDEO_TEMPLATES).toHaveLength(12);
    expect(new Set(VIDEO_TEMPLATES.map((t) => t.id)).size).toBe(12);
    expect(new Set(VIDEO_TEMPLATES.map((t) => t.name)).size).toBe(12);
    for (const t of VIDEO_TEMPLATES) expect(t.description.length).toBeGreaterThan(20);
    for (const id of ['titulo-animado', 'tercios-inferiores', 'subtitulos-karaoke', 'intro', 'cierre', 'historia-vertical', 'presentacion', 'collage-3-clips', 'cuenta-regresiva', 'recordatorio-suscripcion']) expect(getVideoTemplate(id)).toBeTruthy();
    expect(VIDEO_TEMPLATES.filter((t) => t.insertable).map((t) => t.id)).toEqual(expect.arrayContaining(['intro', 'cierre']));
    expect(VIDEO_TEMPLATES.find((t) => t.aspect === '9:16')?.id).toBe('historia-vertical');
  });

  for (const t of VIDEO_TEMPLATES) {
    describe(t.name, () => {
      const p = build(t);
      it('es un VideoProject v2 con clips, duración cercana a la declarada y todo dentro de ella', () => {
        expect(p.v).toBe(2);
        const dur = VM.projectDuration(p);
        expect(dur).toBeGreaterThan(0);
        expect(Math.abs(dur - t.duration)).toBeLessThan(0.75);
        for (const tr of p.tracks) for (const c of tr.clips) expect(VM.clipEnd(c)).toBeLessThanOrEqual(dur + 1e-6);
      });
      it('ids únicos y cada clip con medio apunta a un medio con archivo', () => {
        const ids = p.tracks.flatMap((tr) => [tr.id, ...tr.clips.map((c) => c.id)]);
        expect(new Set(ids).size).toBe(ids.length);
        for (const tr of p.tracks)
          for (const c of tr.clips) {
            expect(VM.fitsTrack(c, tr)).toBe(true);
            if (c.mediaId) {
              expect(p.media[c.mediaId]).toBeTruthy();
              expect(p.media[c.mediaId].blob).toBeInstanceOf(Blob);
            }
          }
        expect(Object.keys(p.media)).toHaveLength(t.placeholders.length);
      });
      it('los textos son editables (tienen texto y estilo) y quedan dentro del encuadre', () => {
        for (const tr of p.tracks)
          for (const c of tr.clips) {
            if (c.kind === 'text') {
              expect(c.text && c.text.length).toBeGreaterThan(0);
              expect(c.tstyle).toBeTruthy();
              expect(c.transform.x).toBeGreaterThanOrEqual(0);
              expect(c.transform.x).toBeLessThanOrEqual(1);
              expect(c.transform.y).toBeGreaterThanOrEqual(0);
              expect(c.transform.y).toBeLessThanOrEqual(1);
            }
          }
      });
      it('las transiciones están en uniones reales (clips contiguos)', () => {
        for (const tr of p.tracks)
          tr.clips.forEach((c, i) => {
            if (c.tin) {
              expect(i).toBeGreaterThan(0);
              expect(areJoined(tr.clips[i - 1], c)).toBe(true);
            }
          });
      });
      it('los marcadores tienen la proporción de la plantilla', () => {
        for (const h of t.placeholders) {
          if (h.id === 'logo') continue;
          const ratio = h.w / h.h;
          const frame = t.aspect === '16:9' ? 16 / 9 : 9 / 16;
          expect(Math.abs(ratio - frame)).toBeLessThan(0.02);
        }
      });
      it('sobrevive a la lectura de un proyecto guardado (normalizeV2) sin perder nada', () => {
        const saved = JSON.parse(JSON.stringify(VM.serializeProject(p)));
        const back = VM.normalizeV2(saved);
        expect(canon(back.tracks)).toBe(canon(p.tracks));
        expect(back.legacy).toBeUndefined();
      });
      it('se puede recortar y dividir (el modelo la acepta como cualquier proyecto)', () => {
        const first = p.tracks.find((tr) => tr.clips.length && tr.kind === 'video')!.clips[0];
        const cut = VM.splitClip(p, first.id, first.start + VM.clipDuration(first) / 2, 'nuevo');
        expect(cut).not.toBe(p);
      });
    });
  }

  it('el karaoke trae pista de subtítulos con estilo karaoke', () => {
    const p = build(getVideoTemplate('subtitulos-karaoke')!);
    const tr = p.tracks.find((x) => x.kind === 'subtitle')!;
    expect(tr.clips.length).toBeGreaterThanOrEqual(5);
    expect(tr.subStyle?.karaoke).toBeTruthy();
  });
  it('la historia vertical lleva transiciones y tres pantallas', () => {
    const p = build(getVideoTemplate('historia-vertical')!);
    const fondos = p.tracks.find((x) => x.name === 'Fondos')!;
    expect(fondos.clips).toHaveLength(3);
    expect(fondos.clips.filter((c) => c.tin)).toHaveLength(2);
  });
});

describe('aplicar', () => {
  const t = getVideoTemplate('intro')!;
  /** proyecto con una pista principal con imán y un clip de 10 s, y un texto encima a los 6 s */
  const base = () => {
    let p = VM.createProject();
    p = VM.addMedia(p, { id: 'v', kind: 'image', name: 'v', duration: 0, blob: new Blob([new Uint8Array(1)]) });
    p = VM.addTrack(p, 'video', { id: 'main', magnet: true });
    p = VM.appendClip(p, 'main', VM.makeClip('image', { id: 'a', mediaId: 'v', outP: 10 }));
    p = VM.addTrack(p, 'video', { id: 'top', index: 0 });
    p = VM.addClip(p, 'top', VM.makeClip('text', { id: 'tx', text: 'hola', start: 6, outP: 2 }));
    return p;
  };

  it('proyecto nuevo = el de la plantilla tal cual', () => {
    const tp = build(t);
    expect(applyAsProject(tp)).toBe(tp);
    expect(applyTemplate(base(), getVideoTemplate('titulo-animado')!, tp, 'insert', 0)).toBe(tp); // no insertable: siempre proyecto nuevo
  });

  it('intro al principio: empuja el clip principal y lo que está encima', () => {
    const p0 = base();
    const dur = t.duration;
    const p = insertTemplate(p0, build(t), { at: 0, ripple: true, newId: counter() });
    const main = p.tracks.find((x) => x.id === 'main')!;
    expect(main.clips[0].start).toBe(0);
    expect(VM.clipEnd(main.clips[0])).toBeCloseTo(dur);
    expect(VM.findClip(p, 'a')!.clip.start).toBeCloseTo(dur);
    expect(VM.findClip(p, 'tx')!.clip.start).toBeCloseTo(6 + dur);
    expect(VM.projectDuration(p)).toBeCloseTo(10 + dur);
    // los títulos y el logo de la intro van en pistas nuevas, a partir de 0
    expect(p.tracks.length).toBe(p0.tracks.length + build(t).tracks.length - 1);
  });

  it('insertar en medio de un clip lo divide y todo lo posterior se corre', () => {
    const p = insertTemplate(base(), build(t), { at: 4, ripple: true, newId: counter() });
    const main = p.tracks.find((x) => x.id === 'main')!;
    const total = main.clips.reduce((s, c) => s + VM.clipDuration(c), 0);
    expect(total).toBeCloseTo(10 + t.duration);
    expect(VM.findClip(p, 'a')!.clip.start).toBeCloseTo(0);
    expect(VM.clipEnd(VM.findClip(p, 'a')!.clip)).toBeCloseTo(4);
    expect(VM.findClip(p, 'tx')!.clip.start).toBeCloseTo(6 + t.duration);
  });

  it('el cierre al final no mueve nada', () => {
    const o = getVideoTemplate('cierre')!;
    const p0 = base();
    const p = insertTemplate(p0, build(o), { at: 10, ripple: true, newId: counter() });
    expect(VM.findClip(p, 'a')!.clip.start).toBe(0);
    expect(VM.findClip(p, 'tx')!.clip.start).toBe(6);
    expect(VM.projectDuration(p)).toBeCloseTo(10 + o.duration);
  });

  it('el recordatorio (sin relevo) se pone encima en el cabezal sin tocar el proyecto', () => {
    const s = getVideoTemplate('recordatorio-suscripcion')!;
    const p0 = base();
    const p = insertTemplate(p0, build(s), { at: 3, ripple: false, newId: counter() });
    expect(VM.findClip(p, 'a')!.clip.start).toBe(0);
    expect(VM.clipDuration(VM.findClip(p, 'a')!.clip)).toBe(10);
    const added = p.tracks.filter((x) => !p0.tracks.some((y) => y.id === x.id));
    expect(added.length).toBe(build(s).tracks.length);
    expect(Math.min(...added.flatMap((x) => x.clips.map((c) => c.start)))).toBeGreaterThanOrEqual(3);
    expect(p.tracks[0].id).toBe(added[0].id); // encima de todo
  });

  it('sin pista principal la crea con imán', () => {
    const p = insertTemplate(VM.createProject(), build(t), { at: 0, ripple: true, newId: counter() });
    const main = p.tracks[p.tracks.length - 1];
    expect(main.magnet).toBe(true);
    expect(main.clips.length).toBe(1);
  });

  it('cada aplicación es UN paso de deshacer', () => {
    const p0 = base();
    for (const how of ['project', 'insert'] as const) {
      const tp = build(t);
      let h = VM.createHistory(p0);
      h = VM.commit(h, applyTemplate(h.present, t, tp, how, 0, counter()));
      expect(h.present).not.toBe(p0);
      expect(VM.undo(h).present).toBe(p0);
    }
  });

  it('las insertadas siguen siendo un proyecto válido (misma lectura guardada)', () => {
    const p = insertTemplate(base(), build(t), { at: 2, ripple: true, newId: counter() });
    const back = VM.normalizeV2(JSON.parse(JSON.stringify(VM.serializeProject(p))));
    expect(canon(back.tracks)).toBe(canon(p.tracks));
  });
});
