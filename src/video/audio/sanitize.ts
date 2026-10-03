// Lectura saneada (idempotente) de los campos de audio de V7 de un proyecto guardado. Un dato corrupto
// se descarta; un valor neutro (pan 0, ganancia 0 dB…) no añade campo, así un proyecto sin ajustes de
// audio se lee igual que en V6 y no gana ninguna propiedad.
import type { BeatInfo, ProjectAudio } from '../model/types';
import { DEFAULT_DUCK, type DuckSpec } from './duck';
import { sanitizeEqBands } from './eq';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Panorámica −1..1; null si es 0 / inválida. */
export function sanitizePan(v: unknown): number | undefined {
  if (!fin(v)) return undefined;
  const p = Math.round(clamp(v, -1, 1) * 1000) / 1000;
  return p === 0 ? undefined : p;
}

/** Ganancia en dB (−60..+60); undefined si es 0. */
export function sanitizeGainDb(v: unknown): number | undefined {
  if (!fin(v)) return undefined;
  const g = Math.round(clamp(v, -60, 60) * 100) / 100;
  return g === 0 ? undefined : g;
}

/** Intensidad 0..1; undefined si es 0. */
export function sanitizeAmount(v: unknown): number | undefined {
  if (!fin(v)) return undefined;
  const a = Math.round(clamp(v, 0, 1) * 1000) / 1000;
  return a === 0 ? undefined : a;
}

export function sanitizeDuck(raw: unknown): DuckSpec | undefined {
  if (!isObj(raw)) return undefined;
  const d: DuckSpec = {
    on: raw.on === true,
    db: fin(raw.db) ? clamp(raw.db, 0, 40) : DEFAULT_DUCK.db,
    thr: fin(raw.thr) ? clamp(raw.thr, -70, -5) : DEFAULT_DUCK.thr,
    attack: fin(raw.attack) ? clamp(raw.attack, 1, 1000) : DEFAULT_DUCK.attack,
    release: fin(raw.release) ? clamp(raw.release, 10, 5000) : DEFAULT_DUCK.release,
    hold: fin(raw.hold) ? clamp(raw.hold, 0, 2000) : DEFAULT_DUCK.hold,
  };
  if (Array.isArray(raw.by)) {
    const by = raw.by.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (by.length) d.by = [...new Set(by)];
  }
  return d;
}

export function sanitizeBeats(raw: unknown): BeatInfo | undefined {
  if (!isObj(raw) || !Array.isArray(raw.beats)) return undefined;
  const beats = raw.beats.filter(fin).filter((t) => t >= 0).slice(0, 200000).sort((a, b) => a - b);
  if (!beats.length) return undefined;
  const out: BeatInfo = { bpm: fin(raw.bpm) && raw.bpm > 0 ? clamp(raw.bpm, 20, 400) : 0, beats };
  if (Array.isArray(raw.onsets)) {
    const on = raw.onsets.filter(fin).filter((t) => t >= 0).slice(0, 200000).sort((a, b) => a - b);
    if (on.length) out.onsets = on;
  }
  return out;
}

export function sanitizeProjectAudio(raw: unknown): ProjectAudio | undefined {
  if (!isObj(raw)) return undefined;
  const a: ProjectAudio = {};
  const eq = sanitizeEqBands(raw.eq);
  if (eq) a.eq = eq;
  if (isObj(raw.loud) && raw.loud.on === true && fin(raw.loud.target)) a.loud = { on: true, target: clamp(raw.loud.target, -40, -10) };
  else if (isObj(raw.loud) && fin(raw.loud.target)) a.loud = { on: false, target: clamp(raw.loud.target, -40, -10) };
  if (fin(raw.xfade) && raw.xfade > 0) a.xfade = clamp(raw.xfade, 0.01, 3);
  if (raw.beatSnap === true) a.beatSnap = true;
  if (raw.showBeats === true) a.showBeats = true;
  return Object.keys(a).length ? a : undefined;
}
