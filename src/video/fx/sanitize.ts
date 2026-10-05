// Lectura segura de los campos de V6 de un proyecto guardado (idempotente, sin mutar la entrada).
import type { BlendMode, FxInstance, FxParams, Keyframe, KeyInterp, TransitionSpec } from '../model/types';
import { sanitizeBezier } from './ease';
import { clampTransDur } from './transitions';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export { BLEND_MODES } from '../../editor/core/blend';
import { BLEND_MODES } from '../../editor/core/blend';
export const sanitizeBlend = (v: unknown): BlendMode | undefined => (BLEND_MODES.includes(v as BlendMode) && v !== 'normal' ? (v as BlendMode) : undefined);

const EASES = ['linear', 'smooth', 'in', 'out', 'bounce', 'bezier'];

export function sanitizeTransition(v: unknown): TransitionSpec | undefined {
  if (!isObj(v) || typeof v.type !== 'string' || !v.type) return undefined;
  const out: TransitionSpec = { type: v.type, dur: clampTransDur(isFin(v.dur) ? v.dur : 0.8) };
  if (typeof v.ease === 'string' && EASES.includes(v.ease)) out.ease = v.ease as TransitionSpec['ease'];
  const bz = sanitizeBezier(v.bz);
  if (bz) out.bz = bz;
  return out;
}

export function sanitizeFxList(v: unknown): FxInstance[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: FxInstance[] = [];
  const seen = new Set<string>();
  for (const r of v) {
    if (!isObj(r) || typeof r.type !== 'string' || !r.type) continue;
    let id = typeof r.id === 'string' && r.id ? r.id : `fx${out.length}`;
    while (seen.has(id)) id += '~';
    seen.add(id);
    const p: FxParams = {};
    if (isObj(r.p)) for (const [k, val] of Object.entries(r.p)) if (typeof val === 'string' || isFin(val)) p[k] = val;
    const fx: FxInstance = { id, type: r.type, amount: isFin(r.amount) ? Math.max(0, Math.min(1, r.amount)) : 1 };
    if (r.on === false) fx.on = false;
    if (Object.keys(p).length) fx.p = p;
    out.push(fx);
  }
  return out.length ? out : undefined;
}

const INTERPS = ['linear', 'smooth', 'hold', 'bezier'];

export function sanitizeKeys(v: unknown): Record<string, Keyframe[]> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, Keyframe[]> = {};
  for (const [prop, list] of Object.entries(v)) {
    if (!Array.isArray(list)) continue;
    const ks: Keyframe[] = [];
    for (const r of list) {
      if (!isObj(r) || !isFin(r.t) || !isFin(r.v)) continue;
      const k: Keyframe = { t: Math.max(0, r.t), v: r.v };
      if (typeof r.e === 'string' && INTERPS.includes(r.e)) k.e = r.e as KeyInterp;
      const bz = sanitizeBezier(r.bz);
      if (bz) k.bz = bz;
      ks.push(k);
    }
    ks.sort((a, b) => a.t - b.t);
    // sin dos fotogramas en el mismo instante (se queda el último)
    const dedup: Keyframe[] = [];
    for (const k of ks) {
      if (dedup.length && Math.abs(dedup[dedup.length - 1].t - k.t) <= 1e-3) dedup[dedup.length - 1] = k;
      else dedup.push(k);
    }
    if (dedup.length) out[prop] = dedup;
  }
  return Object.keys(out).length ? out : undefined;
}
