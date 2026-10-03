// Pruebas de los desmultiplexores con archivos REALES generados por los mismos
// multiplexores que usa la exportación (mp4-muxer y webm-muxer), con datos de
// muestra conocidos: se comprueba que cada muestra sale con su posición, tamaño,
// tiempo y marca de clave exactos.
import { describe, expect, it } from 'vitest';
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { demux, keyIndexBefore, indexAtOrBefore, hevcCodecFromHvcC, aacCodecFromAsc } from './demux';
import { opusHeadFromDOps, parseEsds } from './demux/mp4';
import { readVint } from './demux/webm';

// avcC mínimo: versión 1, perfil High (0x64), compat 0, nivel 4.0 (0x28)
const AVCC = new Uint8Array([1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
const ASC = new Uint8Array([0x11, 0x90]); // AAC-LC, 48 kHz, estéreo

function payload(i: number, size: number): Uint8Array {
  const d = new Uint8Array(size);
  for (let k = 0; k < size; k++) d[k] = (i * 31 + k) & 0xff;
  d[0] = i & 0xff;
  return d;
}

async function readSample(blob: Blob, offset: number, size: number) {
  return new Uint8Array(await blob.slice(offset, offset + size).arrayBuffer());
}

function makeMp4(opts: { fastStart: false | 'in-memory'; rotation?: 0 | 90 | 180 | 270; vfr?: boolean; frames?: number }) {
  const target = new Mp4Target();
  const mux = new Mp4Muxer({
    target,
    video: { codec: 'avc', width: 640, height: 360, rotation: opts.rotation ?? 0 },
    audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 },
    fastStart: opts.fastStart,
  });
  const n = opts.frames ?? 60;
  const times: number[] = [];
  let t = 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const dur = opts.vfr ? (i % 2 ? 1 / 24 : 1 / 40) : 1 / 30;
    times.push(t);
    mux.addVideoChunkRaw(payload(i, 200 + i), i % 30 === 0 ? 'key' : 'delta', Math.round(t * 1e6), Math.round(dur * 1e6), i === 0 ? { decoderConfig: { codec: 'avc1.640028', description: AVCC } } : undefined);
    // audio intercalado: tramas AAC de 1024 muestras
    while (a * (1024 / 48000) <= t) {
      mux.addAudioChunkRaw(payload(1000 + a, 50), 'key', Math.round(a * (1024 / 48000) * 1e6), Math.round((1024 / 48000) * 1e6), a === 0 ? { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, description: ASC } } : undefined);
      a++;
    }
    t += dur;
  }
  mux.finalize();
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), times, audioCount: a };
}

describe('desmultiplexor MP4', () => {
  for (const fastStart of [false, 'in-memory'] as const) {
    it(`muestras exactas (moov ${fastStart ? 'al principio' : 'al final'})`, async () => {
      const { blob, times, audioCount } = makeMp4({ fastStart });
      const d = await demux(blob);
      expect(d.container).toBe('mp4');
      expect(d.video!.codec).toBe('avc1.640028');
      expect([...d.video!.description!]).toEqual([...AVCC]);
      expect(d.video!.codedWidth).toBe(640);
      expect(d.video!.codedHeight).toBe(360);
      const s = d.video!.samples;
      expect(s.count).toBe(60);
      for (const i of [0, 1, 29, 30, 59]) {
        expect(s.pts[i]).toBeCloseTo(times[i], 3);
        expect(s.key[i]).toBe(i % 30 === 0 ? 1 : 0);
        expect(s.size[i]).toBe(200 + i);
        expect(await readSample(blob, s.offset[i], s.size[i])).toEqual(payload(i, 200 + i));
      }
      expect(d.audio!.codec).toBe('mp4a.40.2');
      expect([...d.audio!.description!]).toEqual([...ASC]);
      expect(d.audio!.samples.count).toBe(audioCount);
      const as = d.audio!.samples;
      expect(await readSample(blob, as.offset[5], as.size[5])).toEqual(payload(1005, 50));
      expect(d.duration).toBeGreaterThan(1.9);
    });
  }

  it('fotogramas variables: respeta cada instante', async () => {
    const { blob, times } = makeMp4({ fastStart: false, vfr: true });
    const s = (await demux(blob)).video!.samples;
    for (let i = 0; i < 60; i++) expect(s.pts[i]).toBeCloseTo(times[i], 3);
  });

  it('lee la rotación de los videos de móvil', async () => {
    for (const r of [90, 180, 270] as const) {
      const { blob } = makeMp4({ fastStart: false, rotation: r });
      expect((await demux(blob)).video!.rotation).toBe(r);
    }
  });

  it('busca el fotograma clave anterior para empezar a decodificar', async () => {
    const { blob, times } = makeMp4({ fastStart: false });
    const s = (await demux(blob)).video!.samples;
    expect(keyIndexBefore(s, 0)).toBe(0);
    expect(keyIndexBefore(s, times[45])).toBe(30);
    expect(keyIndexBefore(s, times[29])).toBe(0);
    expect(indexAtOrBefore(s, times[45] + 0.001)).toBe(45);
  });

  it('cajas auxiliares: esds, dOps→OpusHead, hvcC, AAC', () => {
    // ES_Descriptor con DecoderConfig (AAC) y DecSpecificInfo
    const esds = new Uint8Array([3, 25, 0, 1, 0, 4, 17, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 2, 0x11, 0x90, 6, 1, 2]);
    const e = parseEsds(esds)!;
    expect(e.oti).toBe(0x40);
    expect([...e.asc!]).toEqual([0x11, 0x90]);
    expect(aacCodecFromAsc(e.asc)).toBe('mp4a.40.2');
    const head = opusHeadFromDOps(new Uint8Array([0, 2, 0x01, 0x38, 0, 0, 0xbb, 0x80, 0, 0, 0]));
    expect(String.fromCharCode(...head.subarray(0, 8))).toBe('OpusHead');
    expect(head[9]).toBe(2);
    expect(head[10] | (head[11] << 8)).toBe(312); // pre-skip
    expect(head[12] | (head[13] << 8)).toBe(48000);
    // hvcC de un HEVC Main 4.1 típico de móvil
    const hvcC = new Uint8Array(23);
    hvcC.set([1, 0x01, 0x60, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 123]);
    expect(hevcCodecFromHvcC(hvcC)).toBe('hvc1.1.6.L123.90');
  });

  it('rechaza lo que no es un contenedor conocido', async () => {
    await expect(demux(new Blob([new Uint8Array(64)]))).rejects.toThrow(/no reconocido/);
  });
});

function makeWebm(opts: { streaming?: boolean } = {}) {
  const target = new WebmTarget();
  const mux = new WebmMuxer({
    target,
    video: { codec: 'V_VP8', width: 320, height: 240, frameRate: 30 },
    audio: { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 2 },
    streaming: opts.streaming,
  });
  const n = 90;
  for (let i = 0; i < n; i++) {
    const t = i / 30;
    mux.addVideoChunkRaw(payload(i, 300 + i), i % 30 === 0 ? 'key' : 'delta', Math.round(t * 1e6), i === 0 ? { decoderConfig: { codec: 'vp8', codedWidth: 320, codedHeight: 240 } } : undefined);
    for (let k = 0; k < 2; k++) {
      const at = t + k * (1 / 60);
      const opusHead = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]);
      mux.addAudioChunkRaw(payload(5000 + i * 2 + k, 40), 'key', Math.round(at * 1e6), i === 0 && k === 0 ? { decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description: opusHead } } : undefined);
    }
  }
  mux.finalize();
  return new Blob([target.buffer], { type: 'video/webm' });
}

describe('desmultiplexor WebM', () => {
  for (const streaming of [false, true]) {
    it(`bloques exactos (${streaming ? 'tamaños desconocidos, como MediaRecorder' : 'con Cues y duración'})`, async () => {
      const blob = makeWebm({ streaming });
      const d = await demux(blob);
      expect(d.container).toBe('webm');
      expect(d.video!.codec).toBe('vp8');
      expect(d.video!.codedWidth).toBe(320);
      const s = d.video!.samples;
      expect(s.count).toBe(90);
      for (const i of [0, 1, 30, 31, 89]) {
        expect(s.pts[i]).toBeCloseTo(i / 30, 2); // WebM guarda milisegundos
        expect(s.key[i]).toBe(i % 30 === 0 ? 1 : 0);
        expect(await readSample(blob, s.offset[i], s.size[i])).toEqual(payload(i, 300 + i));
      }
      expect(d.audio!.codec).toBe('opus');
      expect(d.audio!.samples.count).toBe(180);
      const as = d.audio!.samples;
      expect(await readSample(blob, as.offset[7], as.size[7])).toEqual(payload(5007, 40));
      expect(d.duration).toBeGreaterThan(2.9);
    });
  }

  it('vint EBML: marcador, valor y tamaño desconocido', () => {
    expect(readVint(new Uint8Array([0x81]), 0)).toEqual({ value: 1, len: 1 });
    expect(readVint(new Uint8Array([0x40, 0x02]), 0)).toEqual({ value: 2, len: 2 });
    expect(readVint(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), 0, true)).toEqual({ value: 0x1a45dfa3, len: 4 });
    expect(readVint(new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), 0)!.value).toBe(-1);
  });
});
