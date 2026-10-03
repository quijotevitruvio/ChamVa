import { describe, expect, it } from 'vitest';
import { buildProjectMixEntries, drawStillClip, drawVideoClip } from './compose';
import { LIMIT_CEILING } from './dsp';
import { TimelineMixer, type PcmSource } from './mixer';
import { drawOverlays, drawVideoFrame } from './timeline';
import { addClip, addMedia, addTrack, createProject, makeClip, updateTrack } from '../model/ops';
import type { VideoProject } from '../model/types';

/** Contexto 2D falso: registra cada llamada y cada cambio de estado. */
function fakeCtx() {
  const calls: unknown[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, k: string) => (k in state ? state[k] : (...a: unknown[]) => calls.push([k, ...a])),
      set: (_t, k: string, v) => {
        calls.push(['set', k, v]);
        state[k] = v;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const img = { naturalWidth: 200, naturalHeight: 100 } as unknown as HTMLImageElement;

describe('composición: con transformación neutra = mismas llamadas que V1', () => {
  it('video', () => {
    const a = fakeCtx();
    const b = fakeCtx();
    drawVideoFrame(a.ctx, img, 640, 360, 1280, 720, 'contain', 90, 0.4);
    drawVideoClip(b.ctx, img, 640, 360, 1280, 720, 'contain', 90, makeClip('video'), 0.4);
    expect(b.calls).toEqual(a.calls);
  });

  it('texto e imagen', () => {
    const a = fakeCtx();
    const b = fakeCtx();
    const overlays = [
      { kind: 'text' as const, text: 'HOLA', color: '#fff', size: 60, xf: 0.37, yf: 0.17, start: 0, end: 9999 },
      { kind: 'image' as const, text: '', color: '', size: 0.3, img, xf: 0.5, yf: 0.6, start: 0, end: 9999 },
    ];
    drawOverlays(a.ctx, 1920, 1080, overlays, 1);
    drawStillClip(b.ctx, 1920, 1080, makeClip('text', { text: 'HOLA', color: '#fff', size: 60, transform: { x: 0.37, y: 0.17 } as any }), null, 1);
    drawStillClip(b.ctx, 1920, 1080, makeClip('image', { size: 0.3, transform: { x: 0.5, y: 0.6 } as any }), img, 1);
    expect(b.calls).toEqual(a.calls);
  });

  it('transformación: traslada al centro pedido, gira, escala y aplica opacidad × fundido', () => {
    const { ctx, calls } = fakeCtx();
    const clip = makeClip('video', { transform: { x: 0.25, y: 0.75, scale: 0.5, rotation: 90, opacity: 0.5 } });
    drawVideoClip(ctx, img, 1280, 720, 1280, 720, 'contain', 0, clip, 0.8);
    expect(calls).toEqual([
      ['save'],
      ['set', 'globalAlpha', 0.4],
      ['translate', 320, 540],
      ['rotate', Math.PI / 2],
      ['scale', 0.5, 0.5],
      ['drawImage', img, -640, -360, 1280, 720],
      ['restore'],
    ]);
  });
});

// ---------- mezcla de varias pistas ----------

const SR = 48000;
class Const implements PcmSource {
  constructor(private v: number) {}
  async read(_s: number, _st: number, n: number, L: Float32Array, R: Float32Array) {
    L.fill(this.v, 0, n);
    R.fill(this.v, 0, n);
  }
  close() {}
}

async function mixAll(p: VideoProject, dur: number, level: Record<string, number>) {
  const entries = buildProjectMixEntries(p, dur, (c) => async () => new Const(level[c.id] ?? 0));
  const m = new TimelineMixer(entries, { eq: p.eq, normalize: p.normalize }, dur);
  const L = new Float32Array(m.totalSamples);
  while (!m.finished) {
    const b = await m.render(4800);
    L.set(b.L, b.startSample);
  }
  return { L, m, entries };
}

function threeAudioTracks() {
  let p = createProject();
  p = addMedia(p, { id: 'v', kind: 'video', name: 'v', duration: 10, blob: new Blob(['v']) });
  p = addMedia(p, { id: 'a', kind: 'audio', name: 'a', duration: 10, blob: new Blob(['a']) });
  p = addTrack(p, 'video', { id: 'V' });
  // sin filtros (el paso alto de 20 Hz de «Ninguno» se comería la señal continua de prueba)
  const voice = { hp: 0, lp: 24000, echo: 0, gate: false };
  p = addClip(p, 'V', makeClip('video', { id: 'vid', mediaId: 'v', outP: 2, voice }));
  for (const [k, id] of ['A1', 'A2', 'A3'].entries()) {
    p = addTrack(p, 'audio', { id, index: p.tracks.length });
    p = addClip(p, id, makeClip('audio', { id: `${id}c`, mediaId: 'a', start: k * 0.5, outP: 10, voice }));
  }
  return p;
}

describe('mezcla multipista', () => {
  it('suma las pistas activas en cada instante, respeta el silencio y corta al final', async () => {
    let p = threeAudioTracks();
    const lv = { vid: 0.1, A1c: 0.1, A2c: 0.1, A3c: 0.1 };
    const { L, entries } = await mixAll(p, 2, lv);
    expect(entries.map((e) => [e.start, e.end])).toEqual([
      [0, 2],
      [0, 2],
      [0.5, 2],
      [1, 2],
    ]);
    const at = (t: number) => L[Math.round(t * SR)];
    expect(at(0.25)).toBeCloseTo(0.2, 5); // video + A1
    expect(at(0.75)).toBeCloseTo(0.3, 5); // + A2
    expect(at(1.5)).toBeCloseTo(0.4, 5); // + A3
    p = updateTrack(p, 'A2', { muted: true });
    const muted = await mixAll(p, 2, lv);
    expect(muted.entries).toHaveLength(3);
  });

  it('tres pistas fuertes: el limitador deja el pico ≤ −1 dBFS', async () => {
    const p = threeAudioTracks();
    const { L, m } = await mixAll(p, 2, { vid: 0.9, A1c: 0.9, A2c: 0.9, A3c: 0.9 });
    let peak = 0;
    for (const x of L) peak = Math.max(peak, Math.abs(x));
    expect(m.master.limiter.peakIn).toBeGreaterThan(3);
    expect(peak).toBeLessThanOrEqual(LIMIT_CEILING + 1e-7);
  });

  it('fundido de sonido del clip (lineal)', async () => {
    let p = createProject();
    p = addMedia(p, { id: 'a', kind: 'audio', name: 'a', duration: 4, blob: new Blob(['a']) });
    p = addTrack(p, 'audio', { id: 'A' });
    p = addClip(p, 'A', makeClip('audio', { id: 'c', mediaId: 'a', outP: 2, audioFadeIn: 1, audioFadeOut: 0.5, effect: 'none' }));
    p = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, voice: { hp: 0, lp: 24000, echo: 0, gate: false } })) })) };
    const { L } = await mixAll(p, 2, { c: 0.5 });
    expect(L[Math.round(0.5 * SR)]).toBeCloseTo(0.25, 3);
    expect(L[Math.round(1.2 * SR)]).toBeCloseTo(0.5, 3);
    expect(L[Math.round(1.75 * SR)]).toBeCloseTo(0.25, 3);
  });
});
