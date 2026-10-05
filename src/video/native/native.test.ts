import { describe, expect, it } from 'vitest';
import {
  chooseImportRoute,
  codecLabel,
  defaultProxyOptions,
  describeProbe,
  etaSeconds,
  formatBytes,
  formatEta,
  isCacheKey,
  isProxyHeight,
  missingNativeMessage,
  parseProgress,
  proxyFileName,
  qualityNotice,
} from './pure';
import type { ProbeInfo } from './types';

const ev = (fields: Record<string, string>, outTimeUs: number | null = null, end = false) => ({ fields, outTimeUs, end });

describe('parseProgress', () => {
  it('usa out_time_us y calcula la fracción', () => {
    const p = parseProgress(ev({ speed: '2.5x', frame: '120' }, 2_000_000), 4);
    expect(p.fraction).toBeCloseTo(0.5);
    expect(p.outSeconds).toBe(2);
    expect(p.speed).toBe(2.5);
    expect(p.frame).toBe(120);
  });
  it('lee los campos si Rust no dio out_time_us', () => {
    expect(parseProgress(ev({ out_time_us: '1000000' }), 10).fraction).toBeCloseTo(0.1);
    expect(parseProgress(ev({ out_time_ms: '3000000' }), 10).fraction).toBeCloseTo(0.3);
  });
  it('ignora N/A, negativos y velocidades rotas', () => {
    const p = parseProgress(ev({ out_time_us: 'N/A', speed: 'N/A', frame: '-3' }, -5), 10);
    expect(p.fraction).toBeNull();
    expect(p.outSeconds).toBeNull();
    expect(p.speed).toBeNull();
    expect(p.frame).toBeNull();
  });
  it('no retrocede, no llega a 1 hasta el final y sin duración no inventa', () => {
    expect(parseProgress(ev({}, 1_000_000), 10, 0.4).fraction).toBe(0.4);
    expect(parseProgress(ev({}, 50_000_000), 10).fraction).toBe(0.999);
    expect(parseProgress(ev({}, null, true), 10).fraction).toBe(1);
    expect(parseProgress(ev({}, 1_000_000), 0).fraction).toBeNull();
    expect(parseProgress(ev({}, 1_000_000), Number.NaN).fraction).toBeNull();
  });
});

describe('etaSeconds y formatos', () => {
  it('estima lo que queda', () => {
    expect(etaSeconds(0.5, 10)).toBeCloseTo(10);
    expect(etaSeconds(0.25, 30)).toBeCloseTo(90);
    expect(etaSeconds(0.01, 30)).toBeNull();
    expect(etaSeconds(null, 30)).toBeNull();
    expect(etaSeconds(1, 30)).toBe(0);
  });
  it('formatea', () => {
    expect(formatEta(null)).toBe('calculando…');
    expect(formatEta(0.2)).toBe('1 s');
    expect(formatEta(125)).toBe('2 min 5 s');
    expect(formatEta(3700)).toBe('1 h 1 min');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(150 * 1048576)).toBe('150 MB');
    expect(formatBytes(-1)).toBe('?');
  });
});

describe('chooseImportRoute', () => {
  const base = { demuxOk: false, decodable: false, htmlPlayable: false, desktop: true, nativeAvailable: true };
  it('motor propio primero; con FFmpeg, todo lo demás va al proxy', () => {
    expect(chooseImportRoute({ ...base, demuxOk: true, decodable: true, htmlPlayable: true })).toBe('direct');
    expect(chooseImportRoute(base)).toBe('proxy');
    // HEVC: el demux lo abre pero no se decodifica
    expect(chooseImportRoute({ ...base, demuxOk: true })).toBe('proxy');
    // ProRes / MP4 fragmentado: <video> da duración pero el motor propio no puede
    expect(chooseImportRoute({ ...base, htmlPlayable: true })).toBe('proxy');
  });
  it('sin FFmpeg: igual que siempre (lenta si <video> puede, si no, explicar)', () => {
    const off = { ...base, nativeAvailable: false };
    expect(chooseImportRoute({ ...off, demuxOk: true, decodable: true })).toBe('direct');
    expect(chooseImportRoute({ ...off, htmlPlayable: true })).toBe('slow');
    expect(chooseImportRoute(off)).toBe('missing-native');
  });
  it('web y Android siguen como siempre', () => {
    const web = { ...base, desktop: false, nativeAvailable: false };
    expect(chooseImportRoute({ ...web, htmlPlayable: true })).toBe('slow');
    expect(chooseImportRoute(web)).toBe('unsupported');
    expect(chooseImportRoute({ ...web, demuxOk: true, decodable: true })).toBe('direct');
  });
});

const probe = (o: Partial<ProbeInfo['video']> = {}, audio: ProbeInfo['audio'] = { codec: 'aac', channels: 2, sampleRate: 48000 }): ProbeInfo => ({
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  duration: 12,
  size: 1000,
  audioStreams: audio ? 1 : 0,
  audio,
  video: { codec: 'hevc', profile: 'main 10', pixFmt: 'yuv420p10le', width: 1920, height: 1080, fps: 29.97, variableFps: false, rotation: 0, bitDepth: 10, colorTransfer: null, hdr: null, ...o },
});

describe('opciones por defecto', () => {
  it('720p como mucho y nunca más que el original', () => {
    expect(defaultProxyOptions(probe(), { hasZscale: true }).height).toBe('720');
    expect(defaultProxyOptions(probe({ width: 640, height: 480 }), null).height).toBe('360');
    expect(defaultProxyOptions(probe({ width: 960, height: 540 }), null).height).toBe('540');
    expect(defaultProxyOptions(probe({ width: 320, height: 240 }), null).height).toBe('360');
    expect(defaultProxyOptions(null, null)).toEqual({ height: '720', video: 'auto', tonemap: false });
  });
  it('vertical de móvil: cuenta el lado que queda en horizontal tras rotar', () => {
    expect(defaultProxyOptions(probe({ width: 1080, height: 1920, rotation: 90 }), null).height).toBe('720');
    expect(defaultProxyOptions(probe({ width: 480, height: 854, rotation: 270 }), null).height).toBe('360');
  });
  it('HDR → SDR solo si el build trae zscale/tonemap', () => {
    expect(defaultProxyOptions(probe({ hdr: 'hlg' }), { hasZscale: true }).tonemap).toBe(true);
    expect(defaultProxyOptions(probe({ hdr: 'pq' }), { hasZscale: false }).tonemap).toBe(false);
    expect(defaultProxyOptions(probe(), { hasZscale: true }).tonemap).toBe(false);
  });
  it('valida alturas', () => {
    expect(isProxyHeight('720')).toBe(true);
    expect(isProxyHeight('719')).toBe(false);
    expect(isProxyHeight('-vf')).toBe(false);
  });
});

describe('textos', () => {
  it('describe HEVC HDR girado y con fps variable', () => {
    const t = describeProbe(probe({ hdr: 'hlg', rotation: 90, variableFps: true }, { codec: 'pcm_s24le', channels: 6, sampleRate: 48000 })).join('\n');
    expect(t).toMatch(/HEVC \(H\.265\) main 10 · 1920×1080 · 10 bits · 29\.97 fps/);
    expect(t).toMatch(/HDR \(HLG\): el proxy se convierte a SDR/);
    expect(t).toMatch(/Girado 90°/);
    expect(t).toMatch(/cadencia constante/);
    expect(t).toMatch(/PCM \(s24le\) · 6 canales → estéreo/);
    expect(describeProbe(probe({ hdr: 'pq' }), { height: '720', video: 'auto', tonemap: false }).join()).toMatch(/sin convertir a SDR/);
    expect(describeProbe({ ...probe(), video: null, audio: null }).join()).toMatch(/Sin pista de video.*Sin audio/);
  });
  it('etiquetas de códec', () => {
    expect(codecLabel('prores')).toBe('Apple ProRes');
    expect(codecLabel('pcm_s16le')).toBe('PCM (s16le)');
    expect(codecLabel('xyz')).toBe('XYZ');
  });
  it('aviso de calidad de exportación', () => {
    expect(qualityNotice('720', 2160)).toMatch(/menos resolución que el original \(2160p\).*1080p/);
    expect(qualityNotice('1080', 1080)).toBe('La exportación usará el proxy (1080p).');
  });
  it('nombre del proxy y mensaje sin ffmpeg', () => {
    expect(proxyFileName('IMG_0001.MOV', '720', 'video/mp4')).toBe('IMG_0001 (proxy 720p).mp4');
    expect(proxyFileName('clip.final.mkv', '360', 'video/webm')).toBe('clip.final (proxy 360p).webm');
    expect(proxyFileName('.mov', '540', 'video/mp4')).toBe('video (proxy 540p).mp4');
    expect(missingNativeMessage('a.mov', { reason: 'no instalado' })).toMatch(/«a\.mov».*FFmpeg.*\(no instalado\)/);
  });
});

describe('claves de caché', () => {
  it('solo 64 hex en minúsculas (las valida también Rust)', () => {
    expect(isCacheKey('a'.repeat(64))).toBe(true);
    expect(isCacheKey('A'.repeat(64))).toBe(false);
    expect(isCacheKey('../'.padEnd(64, 'a'))).toBe(false);
    expect(isCacheKey('a'.repeat(63))).toBe(false);
  });
});
