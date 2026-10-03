// Datos derivados de los medios que no se guardan ni se deshacen: URL de objeto,
// imágenes, tira de miniaturas (video) y forma de onda (audio). Se calculan UNA vez
// por medio (en segundo plano, de uno en uno) y se sirven desde caché al hacer
// scroll o zoom. Las vistas se suscriben para repintarse cuando llega algo.
import type { MediaAsset } from '../../video/model';

export interface Waveform {
  /** trazo SVG con coordenadas x = intervalo (0..bins), y = 0..24 */
  path: string;
  bins: number;
}

export interface Strip {
  url: string;
  /** fotogramas en la tira (de izquierda a derecha, repartidos en todo el medio) */
  frames: number;
}

const STRIP_H = 54;
const STRIP_W = 96;
const MAX_FRAMES = 40;
/** intervalos de la forma de onda por segundo (y tope por medio, para no crear trazos enormes) */
const BINS_PER_SEC = 24;
const MAX_BINS = 3000;

export class MediaCache {
  private urls = new Map<string, string>();
  private images = new Map<string, HTMLImageElement>();
  private strips = new Map<string, Strip | 'failed'>();
  private waves = new Map<string, Waveform | 'failed'>();
  private queue: (() => Promise<void>)[] = [];
  private running = false;
  private listeners = new Set<() => void>();
  private disposed = false;
  private version = 0;
  /** cuántas veces se calculó algo (para las pruebas de caché) */
  readonly stats = { strips: 0, waves: 0 };

  // useSyncExternalStore
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  urlOf(m: MediaAsset | undefined): string {
    if (!m?.blob) return '';
    let u = this.urls.get(m.id);
    if (!u) {
      u = URL.createObjectURL(m.blob);
      this.urls.set(m.id, u);
    }
    return u;
  }

  imageOf(m: MediaAsset | undefined): HTMLImageElement | null {
    if (!m?.blob) return null;
    let img = this.images.get(m.id);
    if (!img) {
      img = new window.Image();
      img.onload = () => this.bump();
      img.src = this.urlOf(m);
      this.images.set(m.id, img);
    }
    return img;
  }

  /** Imágenes ya cargadas por id de medio (para el motor de exportación). */
  loadedImages(): Map<string, HTMLImageElement> {
    const out = new Map<string, HTMLImageElement>();
    this.images.forEach((img, id) => img.naturalWidth && out.set(id, img));
    return out;
  }

  stripOf(id: string): Strip | undefined {
    const s = this.strips.get(id);
    return s && s !== 'failed' ? s : undefined;
  }
  waveOf(id: string): Waveform | undefined {
    const w = this.waves.get(id);
    return w && w !== 'failed' ? w : undefined;
  }

  /** Pide (una sola vez por medio) lo que falte: tira de miniaturas o forma de onda. */
  ensure(m: MediaAsset) {
    if (!m.blob || m.missing || this.disposed) return;
    if (m.kind === 'video' && !this.strips.has(m.id) && m.duration > 0) {
      this.enqueueOnce('s:' + m.id, async () => {
        const s = await this.makeStrip(m);
        this.strips.set(m.id, s ?? 'failed');
        if (s) this.bump();
      });
    }
    if (m.kind === 'audio' && !this.waves.has(m.id)) {
      this.enqueueOnce('w:' + m.id, async () => {
        const w = await this.makeWave(m);
        this.waves.set(m.id, w ?? 'failed');
        if (w) this.bump();
      });
    }
  }

  private pending = new Set<string>();
  private enqueueOnce(key: string, job: () => Promise<void>) {
    if (this.pending.has(key)) return;
    this.pending.add(key);
    this.queue.push(async () => {
      try {
        await job();
      } catch {
        /* sin miniatura / onda: se queda el marcador */
      }
    });
    void this.run();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length && !this.disposed) await this.queue.shift()!();
    this.running = false;
  }

  private async makeStrip(m: MediaAsset): Promise<Strip | null> {
    const url = this.urlOf(m);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.src = url;
    try {
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error('video'));
        setTimeout(() => rej(new Error('tiempo')), 8000);
      });
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : m.duration;
      const frames = Math.max(3, Math.min(MAX_FRAMES, Math.ceil(dur / 1.5)));
      const canvas = document.createElement('canvas');
      canvas.width = frames * STRIP_W;
      canvas.height = STRIP_H;
      const g = canvas.getContext('2d');
      if (!g || !v.videoWidth) return null;
      g.fillStyle = '#000';
      g.fillRect(0, 0, canvas.width, canvas.height);
      const s = Math.max(STRIP_W / v.videoWidth, STRIP_H / v.videoHeight); // cubre la casilla
      for (let i = 0; i < frames && !this.disposed; i++) {
        await new Promise<void>((res) => {
          const done = () => {
            v.removeEventListener('seeked', done);
            clearTimeout(to);
            res();
          };
          const to = setTimeout(done, 1500);
          v.addEventListener('seeked', done);
          try {
            v.currentTime = Math.min(dur - 0.05, ((i + 0.5) * dur) / frames);
          } catch {
            done();
          }
        });
        const dw = v.videoWidth * s;
        const dh = v.videoHeight * s;
        g.drawImage(v, i * STRIP_W + (STRIP_W - dw) / 2, (STRIP_H - dh) / 2, dw, dh);
      }
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.6));
      if (!blob) return null;
      this.stats.strips++;
      return { url: URL.createObjectURL(blob), frames };
    } finally {
      v.removeAttribute('src');
      v.load();
    }
  }

  private async makeWave(m: MediaAsset): Promise<Waveform | null> {
    const buf = await m.blob!.arrayBuffer();
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    try {
      const audio = await ac.decodeAudioData(buf);
      const data = audio.getChannelData(0);
      const dur = audio.duration || m.duration || data.length / audio.sampleRate;
      const bins = Math.max(8, Math.min(MAX_BINS, Math.round(dur * BINS_PER_SEC)));
      const block = Math.max(1, Math.floor(data.length / bins));
      const peaks: number[] = [];
      let top = 0.01;
      for (let i = 0; i < bins; i++) {
        let max = 0;
        const from = i * block;
        const step = Math.max(1, Math.floor(block / 64)); // muestreo: basta para un dibujo
        for (let j = 0; j < block; j += step) {
          const v = Math.abs(data[from + j] || 0);
          if (v > max) max = v;
        }
        peaks.push(max);
        if (max > top) top = max;
      }
      let path = '';
      for (let i = 0; i < bins; i++) {
        const a = Math.max(0.04, peaks[i] / top) * 11;
        path += `M${i + 0.5} ${(12 - a).toFixed(2)}V${(12 + a).toFixed(2)}`;
      }
      this.stats.waves++;
      return { path, bins };
    } finally {
      void ac.close().catch(() => {});
    }
  }

  /** Olvida un medio (nuevo proyecto). */
  clear() {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.strips.forEach((s) => s !== 'failed' && URL.revokeObjectURL(s.url));
    this.urls.clear();
    this.images.clear();
    this.strips.clear();
    this.waves.clear();
    this.pending.clear();
    this.queue = [];
    this.bump();
  }

  dispose() {
    this.disposed = true;
    this.clear();
    this.listeners.clear();
  }
}
