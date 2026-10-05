import { describe, expect, it } from 'vitest';
import {
  AUDIO_MIME_CANDIDATES,
  BUBBLE_MAX,
  BUBBLE_MIN,
  DEFAULT_BUBBLE,
  baseMime,
  bubbleLayout,
  composeCanvasSize,
  computeLimits,
  coverCrop,
  drawBubbleComposite,
  extensionFor,
  formatClock,
  levelFromSamples,
  limitState,
  pickMimeType,
  qualityPreset,
  recordErrorMessage,
  recordingName,
  type Ctx2DLike,
} from './recordCore';

describe('pickMimeType', () => {
  it('prefiere webm vp9 + opus', () => {
    expect(pickMimeType(() => true, 'video')).toBe('video/webm;codecs=vp9,opus');
  });
  it('cae a vp8 y luego a mp4 según lo que soporte el navegador', () => {
    expect(pickMimeType((m) => m.startsWith('video/webm;codecs=vp8'), 'video')).toBe('video/webm;codecs=vp8,opus');
    expect(pickMimeType((m) => m.startsWith('video/mp4'), 'video')).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  });
  it('sin MediaRecorder o sin ningún formato devuelve null', () => {
    expect(pickMimeType(null, 'video')).toBeNull();
    expect(pickMimeType(() => false, 'audio')).toBeNull();
  });
  it('un navegador que lanza ante un tipo raro no rompe la elección', () => {
    const f = (m: string) => {
      if (m.includes('vp9')) throw new Error('raro');
      return m === 'video/webm';
    };
    expect(pickMimeType(f, 'video')).toBe('video/webm');
  });
  it('audio: opus primero', () => {
    expect(pickMimeType(() => true, 'audio')).toBe(AUDIO_MIME_CANDIDATES[0]);
  });
  it('extensión y tipo base', () => {
    expect(extensionFor('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg');
    expect(baseMime('video/webm;codecs=vp9,opus')).toBe('video/webm');
  });
});

describe('calidad y lienzo', () => {
  it('720p/1080p, 30/60 fps', () => {
    const a = qualityPreset(720, 30);
    const b = qualityPreset(1080, 60);
    expect(a).toMatchObject({ height: 720, width: 1280, fps: 30 });
    expect(b).toMatchObject({ height: 1080, width: 1920, fps: 60 });
    expect(b.videoBps).toBeGreaterThan(a.videoBps);
  });
  it('el lienzo no pasa del alto pedido, no se amplía y sale par', () => {
    expect(composeCanvasSize(3840, 2160, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(composeCanvasSize(1280, 720, 1080)).toEqual({ w: 1280, h: 720 });
    const odd = composeCanvasSize(1001, 563, 720);
    expect(odd.w % 2).toBe(0);
    expect(odd.h % 2).toBe(0);
    expect(composeCanvasSize(0, 0, 720)).toEqual({ w: 1280, h: 720 });
  });
});

const fakeCtx = () => {
  const calls: string[] = [];
  const draws: number[][] = [];
  const ctx: Ctx2DLike = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: () => calls.push('fillRect'),
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    arc: () => calls.push('arc'),
    clip: () => calls.push('clip'),
    stroke: () => calls.push('stroke'),
    drawImage: (...a: unknown[]) => {
      calls.push('drawImage');
      draws.push(a.slice(1) as number[]);
    },
  };
  return { ctx, calls, draws };
};

describe('burbuja de la cámara', () => {
  it('cabe siempre entera dentro del lienzo, en cualquier esquina y tamaño', () => {
    for (const size of [0, 0.1, 0.24, 0.5, 2]) {
      for (const px of [0, 0.5, 1, -3, 9]) {
        for (const py of [0, 1]) {
          const { cx, cy, r } = bubbleLayout(1920, 1080, { size, px, py });
          expect(cx - r).toBeGreaterThanOrEqual(0);
          expect(cy - r).toBeGreaterThanOrEqual(0);
          expect(cx + r).toBeLessThanOrEqual(1920 + 1e-6);
          expect(cy + r).toBeLessThanOrEqual(1080 + 1e-6);
        }
      }
    }
  });
  it('el tamaño se limita y la esquina inferior derecha queda abajo a la derecha', () => {
    expect(bubbleLayout(1000, 500, { size: 9, px: 0, py: 0 }).d).toBeCloseTo(BUBBLE_MAX * 500);
    expect(bubbleLayout(1000, 500, { size: 0, px: 0, py: 0 }).d).toBeCloseTo(BUBBLE_MIN * 500);
    const br = bubbleLayout(1920, 1080, DEFAULT_BUBBLE);
    const tl = bubbleLayout(1920, 1080, { ...DEFAULT_BUBBLE, px: 0, py: 0 });
    expect(br.cx).toBeGreaterThan(1920 / 2);
    expect(br.cy).toBeGreaterThan(1080 / 2);
    expect(tl.cx).toBeLessThan(1920 / 2);
    expect(tl.cy).toBeLessThan(1080 / 2);
  });
  it('recorte cuadrado centrado', () => {
    expect(coverCrop(1280, 720)).toEqual({ sx: 280, sy: 0, s: 720 });
    expect(coverCrop(720, 1280)).toEqual({ sx: 0, sy: 280, s: 720 });
  });
  it('compone: pantalla encajada, recorte circular, cámara cuadrada y borde', () => {
    const { ctx, calls, draws } = fakeCtx();
    drawBubbleComposite(ctx, 1920, 1080, { el: 'S', w: 2560, h: 1440 }, { el: 'C', w: 1280, h: 720 }, DEFAULT_BUBBLE);
    expect(draws[0]).toEqual([0, 0, 1920, 1080]); // la pantalla llena el lienzo (misma proporción)
    const clipAt = calls.indexOf('clip');
    expect(clipAt).toBeGreaterThan(calls.indexOf('save'));
    expect(calls.indexOf('drawImage', clipAt)).toBeGreaterThan(clipAt); // la cámara se dibuja DENTRO del recorte
    expect(draws[1].slice(0, 4)).toEqual([280, 0, 720, 720]); // recorte cuadrado de la cámara
    expect(draws[1][6]).toBeCloseTo(draws[1][7]); // destino cuadrado (círculo, no óvalo)
    expect(calls.lastIndexOf('stroke')).toBeGreaterThan(calls.indexOf('restore')); // el borde va fuera del recorte
  });
  it('sin cámara solo dibuja la pantalla; una pantalla vertical sobre un lienzo horizontal se encaja con bandas', () => {
    const { ctx, draws } = fakeCtx();
    drawBubbleComposite(ctx, 1920, 1080, { el: 'S', w: 1080, h: 1920 }, null, DEFAULT_BUBBLE);
    expect(draws).toHaveLength(1);
    expect(draws[0][2]).toBeCloseTo(607.5);
    expect(draws[0][3]).toBeCloseTo(1080);
    expect(draws[0][0]).toBeCloseTo((1920 - 607.5) / 2);
  });
});

describe('límites', () => {
  const bps = 8_000_000;
  it('con mucho espacio manda el tope de 60 min / 2 GB', () => {
    const r = computeLimits({ quota: 500 * 1024 ** 3, usage: 1024 ** 3 }, bps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.limits.maxSeconds).toBeLessThanOrEqual(3600);
      expect(r.limits.maxBytes).toBeLessThanOrEqual(2 * 1024 ** 3);
    }
  });
  it('sin espacio suficiente se niega con un mensaje', () => {
    const r = computeLimits({ quota: 100 * 1024 ** 2, usage: 60 * 1024 ** 2 }, bps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/espacio/);
  });
  it('con poco espacio la duración baja en proporción', () => {
    const r = computeLimits({ quota: 700 * 1024 ** 2, usage: 0 }, bps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.limits.maxSeconds).toBeLessThan(3600);
  });
  it('sin estimación se usan los topes por defecto', () => {
    expect(computeLimits(null, bps).ok).toBe(true);
  });
  it('aviso al 90 % y parada al 100 %', () => {
    const l = { maxSeconds: 100, maxBytes: 1000 };
    expect(limitState(10, 100, l)).toBe('ok');
    expect(limitState(91, 100, l)).toBe('warn');
    expect(limitState(10, 950, l)).toBe('warn');
    expect(limitState(100, 0, l)).toBe('stop');
    expect(limitState(1, 1000, l)).toBe('stop');
  });
});

describe('reloj, nivel y nombres', () => {
  it('formatClock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(7.9)).toBe('0:07');
    expect(formatClock(725)).toBe('12:05');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(NaN)).toBe('0:00');
  });
  it('nivel: silencio 0, onda llena 1, −20 dB a dos tercios', () => {
    expect(levelFromSamples([])).toBe(0);
    expect(levelFromSamples(new Float32Array(100))).toBe(0);
    expect(levelFromSamples(new Float32Array(100).fill(1))).toBeCloseTo(1);
    expect(levelFromSamples(new Float32Array(100).fill(0.1))).toBeCloseTo((60 - 20) / 60, 3);
  });
  it('nombres', () => {
    expect(recordingName('screen', 2, 'video/webm;codecs=vp9,opus')).toBe('Grabación de pantalla 2.webm');
    expect(recordingName('screen-cam', 1, 'video/mp4', 'camera')).toBe('Cámara 1.mp4');
  });
});

describe('errores legibles', () => {
  const e = (name: string, message = '') => Object.assign(new Error(message), { name });
  it('pantalla: cancelar el selector y permiso denegado dan el mismo aviso claro', () => {
    const r = recordErrorMessage(e('NotAllowedError'), 'screen');
    expect(r.code).toBe('cancelled-or-denied');
    expect(r.message).toMatch(/selector/);
  });
  it('cámara y micrófono: permiso denegado dice dónde activarlo', () => {
    expect(recordErrorMessage(e('NotAllowedError'), 'camera').message).toMatch(/Cámara/);
    expect(recordErrorMessage(e('NotAllowedError'), 'mic').message).toMatch(/Micrófono/);
  });
  it('sin dispositivo, ocupado, inseguro, sin espacio, sin soporte y desconocido', () => {
    expect(recordErrorMessage(e('NotFoundError'), 'camera').code).toBe('no-device');
    expect(recordErrorMessage(e('NotReadableError'), 'mic').code).toBe('busy');
    expect(recordErrorMessage(e('SecurityError'), 'screen').code).toBe('insecure');
    expect(recordErrorMessage(e('QuotaExceededError'), 'recorder').code).toBe('quota');
    expect(recordErrorMessage(e('NotSupportedError'), 'recorder').code).toBe('unsupported');
    expect(recordErrorMessage('boom', 'camera').code).toBe('unknown');
  });
});
