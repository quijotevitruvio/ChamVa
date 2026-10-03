// Operaciones de proyecto de V6 (transiciones, efectos, fusión, fotogramas clave). Puras, como las de model/ops.ts:
// devuelven un proyecto nuevo o EL MISMO si no aplican (pista bloqueada, clip inexistente…). Todas pasan por
// `updateClip`, así que una llamada = un paso de deshacer.
import { findClip, clipDuration, effectiveEnd, projectDuration } from '../model/query';
import { addClip, makeClip, updateClip } from '../model/ops';
import type { BlendMode, Clip, FxInstance, FxParams, Keyframe, KeyInterp, TransitionSpec, VideoProject, Bezier } from '../model/types';
import { fxDef, makeFx } from './effects';
import { applyAnimPreset, clearKeys, copyKeys, fxProp, interpolateKeys, moveKey, pasteKeys, removeKey, setKey, updateKey } from './keyframes';
import { areJoined, clampTransDur, junctionOf } from './transitions';

const swap = (p: VideoProject, clipId: string, fn: (c: Clip) => Partial<Clip> | null): VideoProject => {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked) return p;
  const patch = fn(loc.clip);
  return patch ? updateClip(p, clipId, patch) : p;
};

// ---------------- transiciones ----------------

/** Pone (o quita con `null`) la transición de entrada o de salida de un clip. */
export function setTransition(p: VideoProject, clipId: string, side: 'in' | 'out', spec: TransitionSpec | null): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.kind !== 'video' || loc.clip.kind === 'audio') return p;
  const s = spec ? { ...spec, dur: clampTransDur(spec.dur) } : undefined;
  return updateClip(p, clipId, side === 'in' ? { tin: s } : { tout: s });
}

/**
 * Pone la transición de la UNIÓN entre B y el clip anterior de su pista (se guarda en `B.tin` y se quita `A.tout`
 * para que no haya dos). Si B no tiene anterior contiguo, queda como transición de entrada de B.
 */
export function setJunctionTransition(p: VideoProject, clipBId: string, spec: TransitionSpec | null): VideoProject {
  const loc = findClip(p, clipBId);
  if (!loc || loc.track.locked || loc.track.kind !== 'video') return p;
  let out = setTransition(p, clipBId, 'in', spec);
  const j = junctionOf(loc.track, clipBId);
  if (j && j.a.tout) out = updateClip(out, j.a.id, { tout: undefined });
  return out;
}

/** Cambia solo la duración o la curva de la transición de un clip (en la unión si `side` = 'in' y hay anterior contiguo). */
export function updateTransition(p: VideoProject, clipId: string, side: 'in' | 'out', patch: Partial<TransitionSpec>): VideoProject {
  return swap(p, clipId, (c) => {
    const cur = side === 'in' ? c.tin : c.tout;
    if (!cur) return null;
    const next: TransitionSpec = { ...cur, ...patch, dur: clampTransDur(patch.dur ?? cur.dur) };
    return side === 'in' ? { tin: next } : { tout: next };
  });
}

/** La transición «de la unión» que mira el usuario en la línea de tiempo: la de B (si tiene) o la de salida de A. */
export function junctionSpec(a: Clip, b: Clip): { spec: TransitionSpec; owner: 'in' | 'out' } | null {
  if (!areJoined(a, b)) return null;
  if (b.tin) return { spec: b.tin, owner: 'in' };
  if (a.tout) return { spec: a.tout, owner: 'out' };
  return null;
}

// ---------------- efectos ----------------

export const newFxId = (): string => `fx${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36).slice(-3)}`;

/** Añade un efecto a la pila (al final, o en `index`). Los clips de audio no admiten efectos de imagen. */
export function addFx(p: VideoProject, clipId: string, fx: FxInstance, index?: number): VideoProject {
  return swap(p, clipId, (c) => {
    if (c.kind === 'audio' || c.kind === 'subtitle' || !fxDef(fx.type)) return null;
    const list = (c.fx ?? []).filter((f) => f.id !== fx.id).slice();
    list.splice(index === undefined ? list.length : Math.max(0, Math.min(list.length, index)), 0, fx);
    return { fx: list };
  });
}

/** Atajo: añade un efecto nuevo del catálogo con sus valores por defecto. */
export function addFxOfType(p: VideoProject, clipId: string, type: string, o: { id?: string; amount?: number; p?: FxParams } = {}): VideoProject {
  return addFx(p, clipId, makeFx(type, { ...o, id: o.id ?? newFxId() }));
}

/** Quita un efecto (y sus fotogramas clave). */
export function removeFx(p: VideoProject, clipId: string, fxId: string): VideoProject {
  return swap(p, clipId, (c) => {
    if (!c.fx?.some((f) => f.id === fxId)) return null;
    let keys = c.keys;
    if (keys) {
      const prefix = `fx.${fxId}.`;
      const kept = Object.fromEntries(Object.entries(keys).filter(([k]) => !k.startsWith(prefix)));
      keys = Object.keys(kept).length ? kept : undefined;
    }
    return { fx: c.fx.filter((f) => f.id !== fxId), keys };
  });
}

/** Lleva un efecto a otra posición de la pila (el orden cuenta: cada uno actúa sobre el resultado del anterior). */
export function moveFx(p: VideoProject, clipId: string, fxId: string, toIndex: number): VideoProject {
  return swap(p, clipId, (c) => {
    const list = c.fx?.slice();
    const from = list?.findIndex((f) => f.id === fxId) ?? -1;
    if (!list || from < 0) return null;
    const to = Math.max(0, Math.min(list.length - 1, Math.round(toIndex)));
    if (to === from) return null;
    const [f] = list.splice(from, 1);
    list.splice(to, 0, f);
    return { fx: list };
  });
}

/** Cambia encendido, intensidad o parámetros de un efecto. */
export function updateFx(p: VideoProject, clipId: string, fxId: string, patch: { on?: boolean; amount?: number; p?: FxParams }): VideoProject {
  return swap(p, clipId, (c) => {
    const i = c.fx?.findIndex((f) => f.id === fxId) ?? -1;
    if (!c.fx || i < 0) return null;
    const cur = c.fx[i];
    const next: FxInstance = { ...cur };
    if (patch.on !== undefined) {
      if (patch.on) delete next.on;
      else next.on = false;
    }
    if (patch.amount !== undefined && Number.isFinite(patch.amount)) next.amount = Math.max(0, Math.min(1, patch.amount));
    if (patch.p) next.p = { ...cur.p, ...patch.p };
    const list = c.fx.slice();
    list[i] = next;
    return { fx: list };
  });
}

export function setBlend(p: VideoProject, clipId: string, blend: BlendMode): VideoProject {
  return swap(p, clipId, (c) => (c.kind === 'audio' || c.kind === 'adjust' ? null : { blend }));
}

/** Añade una capa de ajuste (clip `adjust`) en una pista de video; sus efectos afectan a todo lo que hay debajo. */
export function addAdjustClip(p: VideoProject, trackId: string, start: number, dur: number, o: { id?: string; fx?: FxInstance[] } = {}): VideoProject {
  const t = p.tracks.find((x) => x.id === trackId);
  if (!t || t.kind !== 'video' || t.locked) return p;
  const clip = makeClip('adjust', { id: o.id, start: Math.max(0, start), outP: Math.max(0.1, dur), fx: o.fx, name: 'Ajuste' });
  return addClip(p, trackId, clip);
}

// ---------------- fotogramas clave ----------------

/** Valor base (sin animar) de una propiedad animable. */
export function baseValue(c: Clip, prop: string): number | undefined {
  if (prop === 'volume') return c.volume;
  if (prop === 'x' || prop === 'y' || prop === 'scale' || prop === 'rotation' || prop === 'opacity') return c.transform[prop];
  const m = /^fx\.([^.]+)\.(.+)$/.exec(prop);
  if (!m) return undefined;
  const fx = c.fx?.find((f) => f.id === m[1]);
  if (!fx) return undefined;
  if (m[2] === 'amount') return fx.amount;
  const v = fx.p?.[m[2]];
  if (typeof v === 'number') return v;
  const def = fxDef(fx.type)?.params.find((pd) => pd.key === m[2]);
  return typeof def?.def === 'number' ? def.def : undefined;
}

/** Valor de la propiedad en t (animado si tiene fotogramas, si no el base). */
export function valueNow(c: Clip, prop: string, t: number): number | undefined {
  const k = interpolateKeys(c.keys?.[prop], t - c.start);
  return k !== undefined ? k : baseValue(c, prop);
}

const withKeysPatch = (_c: Clip, next: Clip) => ({ keys: next.keys });

/** Pone un fotograma en la propiedad en el instante t de la línea de tiempo. */
export function setKeyAt(p: VideoProject, clipId: string, prop: string, t: number, v: number, o: { e?: KeyInterp; bz?: Bezier } = {}): VideoProject {
  return swap(p, clipId, (c) => {
    const dur = c.toEnd ? Math.max(0, projectDuration(p) - c.start) : clipDuration(c);
    const local = Math.max(0, Math.min(dur, t - c.start));
    const next = setKey(c, prop, local, v, o);
    return next === c ? null : withKeysPatch(c, next);
  });
}

/** «Añadir fotograma» en el cabezal: con el valor que la propiedad tiene en ese instante. */
export function addKeyAtPlayhead(p: VideoProject, clipId: string, prop: string, t: number): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc) return p;
  const v = valueNow(loc.clip, prop, t);
  return v === undefined ? p : setKeyAt(p, clipId, prop, t, v);
}

/**
 * Edita una propiedad animable. Si ya tiene fotogramas o `autoKey` está activo, el valor se escribe como fotograma en t
 * (si no, el cambio no se vería); si no, cambia el valor base.
 */
export function setPropValue(p: VideoProject, clipId: string, prop: string, v: number, t: number, autoKey: boolean): VideoProject {
  const loc = findClip(p, clipId);
  if (!loc || !Number.isFinite(v)) return p;
  const c = loc.clip;
  if (autoKey || (c.keys?.[prop]?.length ?? 0) > 0) return setKeyAt(p, clipId, prop, t, v);
  if (prop === 'volume') return updateClip(p, clipId, { volume: v });
  if (prop === 'x' || prop === 'y' || prop === 'scale' || prop === 'rotation' || prop === 'opacity') return updateClip(p, clipId, { transform: { [prop]: v } });
  const m = /^fx\.([^.]+)\.(.+)$/.exec(prop);
  if (m) return m[2] === 'amount' ? updateFx(p, clipId, m[1], { amount: v }) : updateFx(p, clipId, m[1], { p: { [m[2]]: v } });
  return p;
}

export function removeKeyAt(p: VideoProject, clipId: string, prop: string, index: number): VideoProject {
  return swap(p, clipId, (c) => {
    const next = removeKey(c, prop, index);
    return next === c ? null : withKeysPatch(c, next);
  });
}
export function moveKeyTo(p: VideoProject, clipId: string, prop: string, index: number, t: number): VideoProject {
  return swap(p, clipId, (c) => {
    const next = moveKey(c, prop, index, t - c.start);
    return next === c ? null : withKeysPatch(c, next);
  });
}
export function updateKeyAt(p: VideoProject, clipId: string, prop: string, index: number, patch: Partial<Keyframe>): VideoProject {
  return swap(p, clipId, (c) => {
    const next = updateKey(c, prop, index, patch);
    return next === c ? null : withKeysPatch(c, next);
  });
}
export function clearClipKeys(p: VideoProject, clipId: string, prop?: string): VideoProject {
  return swap(p, clipId, (c) => {
    const next = clearKeys(c, prop);
    return next === c ? null : withKeysPatch(c, next);
  });
}
/** Pega fotogramas copiados (relativos) en el instante t de la línea de tiempo; los que caerían después del final del clip se descartan. */
export function pasteClipKeys(p: VideoProject, clipId: string, clipboard: { prop: string; keys: Keyframe[] }[], t: number): VideoProject {
  return swap(p, clipId, (c) => {
    const dur = c.toEnd ? Math.max(0, projectDuration(p) - c.start) : clipDuration(c);
    const at = Math.max(0, t - c.start);
    const fit = clipboard.map((e) => ({ prop: e.prop, keys: e.keys.filter((k) => at + k.t <= dur + 1e-6) })).filter((e) => e.keys.length);
    const next = pasteKeys(c, fit, at);
    return next === c ? null : withKeysPatch(c, next);
  });
}
export { copyKeys };

/** Aplica un preset de animación al clip (Ken Burns, latido, entrada y salida…). */
export function applyPreset(p: VideoProject, clipId: string, presetId: string): VideoProject {
  return swap(p, clipId, (c) => {
    const dur = c.toEnd ? Math.max(0, projectDuration(p) - c.start) : effectiveEnd(c, projectDuration(p)) - c.start;
    const next = applyAnimPreset(c, presetId, dur);
    return next === c ? null : withKeysPatch(c, next);
  });
}

export { fxProp };
