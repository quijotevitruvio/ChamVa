// Normalización de sonoridad en la interfaz: mientras el proyecto tenga un objetivo LUFS, se vuelve a medir la
// mezcla (con el MISMO mezclador y cadena que la exportación, en segundo plano y con espera tras cada cambio) y la
// ganancia resultante se manda a la vista previa en vivo. Así lo que se oye = lo que se exporta.
import { useEffect, useSyncExternalStore } from 'react';
import { solveProjectLoudness } from '../../video/engine/audioExport';
import type { LoudnessSolve } from '../../video/engine/loudnessPass';
import type { Clip, VideoProject } from '../../video/model';
import type { PreviewEngine } from './previewEngine';

export interface LoudnessState {
  status: 'off' | 'wait' | 'analyzing' | 'ready' | 'error';
  solve: LoudnessSolve | null;
  progress: number;
  error?: string;
}

let state: LoudnessState = { status: 'off', solve: null, progress: 0 };
const listeners = new Set<() => void>();
const set = (s: LoudnessState) => {
  state = s;
  listeners.forEach((f) => f());
};
export const getLoudnessState = () => state;
export const subscribeLoudness = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const useLoudnessState = () => useSyncExternalStore(subscribeLoudness, getLoudnessState);

const CLIP_KEYS: (keyof Clip)[] = ['id', 'kind', 'mediaId', 'start', 'inP', 'outP', 'speed', 'volume', 'effect', 'voice', 'audioFadeIn', 'audioFadeOut', 'pan', 'gainDb', 'eq', 'denoise', 'curve', 'reverse', 'pitch', 'freeze', 'loop'];

/** Huella de todo lo que cambia el sonido de la mezcla (no la imagen, no los títulos). */
export function audioSignature(p: VideoProject): string {
  const tracks = p.tracks
    .filter((t) => t.kind !== 'subtitle')
    .map((t) => ({
      id: t.id,
      k: t.kind,
      m: t.muted,
      s: t.solo,
      g: t.gainDb,
      pn: t.pan,
      eq: t.eq,
      d: t.duck,
      c: t.clips
        .filter((c) => c.kind === 'video' || c.kind === 'audio')
        .map((c) => {
          const o: Record<string, unknown> = {};
          for (const k of CLIP_KEYS) if (c[k] !== undefined) o[k] = c[k];
          if (c.keys?.volume) o.kv = c.keys.volume;
          return o;
        }),
    }));
  const media = Object.values(p.media)
    .filter((m) => m.kind !== 'image')
    .map((m) => [m.id, m.duration, !!m.blob, m.missing === true]);
  return JSON.stringify({ tracks, media, eq: p.eq, n: p.normalize, a: p.audio && (p.audio.eq || p.audio.loud || p.audio.xfade) ? { eq: p.audio.eq, loud: p.audio.loud, xfade: p.audio.xfade } : null });
}

const DEBOUNCE_MS = 1200;

/** Mantiene al día la ganancia de sonoridad de la vista previa. Un solo uso, en el editor. */
export function useLoudnessAnalysis(project: VideoProject, engine: PreviewEngine) {
  const sig = audioSignature(project);
  const on = !!project.audio?.loud?.on;
  useEffect(() => {
    if (!on) {
      engine.setLoudnessGain(0);
      set({ status: 'off', solve: null, progress: 0 });
      return;
    }
    const ac = new AbortController();
    set({ ...state, status: 'wait', progress: 0 });
    const timer = setTimeout(async () => {
      set({ ...state, status: 'analyzing', progress: 0 });
      try {
        const r = await solveProjectLoudness(project, { signal: ac.signal, onProgress: (p) => !ac.signal.aborted && set({ ...state, status: 'analyzing', progress: p }) });
        if (ac.signal.aborted) return;
        if (!r) {
          engine.setLoudnessGain(0);
          set({ status: 'ready', solve: null, progress: 1 });
          return;
        }
        engine.setLoudnessGain(r.silent ? 0 : r.gainDb);
        set({ status: 'ready', solve: r, progress: 1 });
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
        console.warn('[video] no se pudo medir la sonoridad:', e);
        set({ status: 'error', solve: null, progress: 0, error: (e as Error).message });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
    // la huella decide cuándo se mide de nuevo; `project` se lee al disparar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, on, engine]);
}
