// Fotogramas clave por clip: interpolación, edición (añadir, mover, copiar, pegar) y presets de animación.
// Puro: trabaja sobre `Clip.keys` y devuelve clips nuevos (o el mismo si no cambia nada).
import type { Bezier, Clip, FxInstance, Keyframe, KeyInterp, Transform } from '../model/types';
import { applyEase, DEFAULT_BEZIER, smoothstep } from './ease';

export type KeyMap = Record<string, Keyframe[]>;

/** Propiedades animables de un clip (más `fx.<id>.<parámetro>` de los efectos). */
export const BASE_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'] as const;
export type BaseProp = (typeof BASE_PROPS)[number];
export const PROP_LABEL: Record<BaseProp, string> = { x: 'Posición X', y: 'Posición Y', scale: 'Escala', rotation: 'Rotación', opacity: 'Opacidad', volume: 'Volumen' };
export const fxProp = (fxId: string, param: string) => `fx.${fxId}.${param}`;
export const isFxProp = (prop: string) => prop.startsWith('fx.');

export const INTERPS: KeyInterp[] = ['linear', 'smooth', 'hold', 'bezier'];
export const INTERP_LABEL: Record<KeyInterp, string> = { linear: 'Lineal', smooth: 'Suave', hold: 'Mantener', bezier: 'Bézier' };

/** Dos fotogramas más cerca que esto (s) cuentan como el mismo. */
export const KEY_EPS = 1e-3;

/**
 * Valor de una lista de fotogramas (ordenada por `t`) en el instante local `t`.
 * Antes del primero y después del último: el valor del extremo. Entre dos: según la interpolación del primero.
 * Lista vacía: undefined (el llamador usa el valor base).
 */
export function interpolateKeys(keys: readonly Keyframe[] | undefined, t: number): number | undefined {
  if (!keys || keys.length === 0) return undefined;
  const n = keys.length;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[n - 1].t) return keys[n - 1].v;
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  if (!(span > 0)) return b.v;
  const p = (t - a.t) / span;
  switch (a.e ?? 'linear') {
    case 'hold':
      return a.v;
    case 'smooth':
      return a.v + (b.v - a.v) * smoothstep(p);
    case 'bezier':
      return a.v + (b.v - a.v) * applyEase('bezier', p, a.bz ?? DEFAULT_BEZIER);
    default:
      return a.v + (b.v - a.v) * p;
  }
}

export const hasKeys = (c: Pick<Clip, 'keys'>) => !!c.keys && Object.values(c.keys).some((k) => k.length > 0);

/** Valor animado de una propiedad en t (segundos de la línea de tiempo); `base` si no tiene fotogramas. */
export function valueAt(clip: Pick<Clip, 'keys' | 'start'>, prop: string, t: number, base: number): number {
  const v = interpolateKeys(clip.keys?.[prop], t - clip.start);
  return v === undefined ? base : v;
}

/** Transformación del clip en t, con los fotogramas aplicados (el mismo objeto si no hay ninguno). */
export function transformAt(clip: Pick<Clip, 'keys' | 'start' | 'transform'>, t: number): Transform {
  const k = clip.keys;
  if (!k) return clip.transform;
  const tr = clip.transform;
  let out: Transform | null = null;
  for (const p of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
    const kk = k[p];
    if (!kk || kk.length === 0) continue;
    const v = interpolateKeys(kk, t - clip.start)!;
    const val = p === 'opacity' ? Math.max(0, Math.min(1, v)) : p === 'scale' ? Math.max(0, v) : v;
    if (val !== tr[p]) (out ??= { ...tr })[p] = val;
  }
  return out ?? tr;
}

/** Volumen del clip en t (con fotogramas). */
export const volumeAt = (clip: Pick<Clip, 'keys' | 'start' | 'volume'>, t: number): number => Math.max(0, valueAt(clip, 'volume', t, clip.volume));

/** Efecto con sus parámetros y su intensidad animados en t (el mismo objeto si no hay fotogramas). */
export function fxAt(clip: Pick<Clip, 'keys' | 'start'>, fx: FxInstance, t: number): FxInstance {
  const k = clip.keys;
  if (!k) return fx;
  let out: FxInstance | null = null;
  const prefix = `fx.${fx.id}.`;
  for (const prop of Object.keys(k)) {
    if (!prop.startsWith(prefix) || k[prop].length === 0) continue;
    const name = prop.slice(prefix.length);
    const v = interpolateKeys(k[prop], t - clip.start)!;
    out ??= { ...fx, p: { ...fx.p } };
    if (name === 'amount') out.amount = Math.max(0, Math.min(1, v));
    else out.p![name] = v;
  }
  return out ?? fx;
}

// ---------------- edición (puras) ----------------

const sortKeys = (ks: Keyframe[]) => ks.slice().sort((a, b) => a.t - b.t);
const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function withKeys(c: Clip, keys: KeyMap): Clip {
  const clean: KeyMap = {};
  for (const [k, v] of Object.entries(keys)) if (v.length) clean[k] = v;
  if (Object.keys(clean).length === 0) {
    if (!c.keys) return c;
    const { keys: _drop, ...rest } = c;
    return rest;
  }
  return { ...c, keys: clean };
}

/** Pone (o reemplaza si ya hay uno a menos de KEY_EPS) un fotograma clave en `prop` en el instante local `t`. */
export function setKey(c: Clip, prop: string, t: number, v: number, o: { e?: KeyInterp; bz?: Bezier } = {}): Clip {
  if (!Number.isFinite(t) || !Number.isFinite(v)) return c;
  const lt = Math.max(0, t);
  const list = (c.keys?.[prop] ?? []).slice();
  const at = list.findIndex((k) => Math.abs(k.t - lt) <= KEY_EPS);
  const prev = at >= 0 ? list[at] : undefined;
  const e = o.e ?? prev?.e;
  const bz = o.bz ?? prev?.bz;
  const key: Keyframe = { t: prev ? prev.t : lt, v, ...(e ? { e } : {}), ...(bz ? { bz } : {}) };
  if (at >= 0) list[at] = key;
  else list.push(key);
  return withKeys(c, { ...c.keys, [prop]: sortKeys(list) });
}

/** Quita el fotograma `index` de `prop`. */
export function removeKey(c: Clip, prop: string, index: number): Clip {
  const list = c.keys?.[prop];
  if (!list || index < 0 || index >= list.length) return c;
  return withKeys(c, { ...c.keys, [prop]: list.filter((_, i) => i !== index) });
}

/** Quita todos los fotogramas de una propiedad (o de todas). */
export function clearKeys(c: Clip, prop?: string): Clip {
  if (!c.keys) return c;
  if (!prop) return withKeys(c, {});
  if (!c.keys[prop]) return c;
  const { [prop]: _d, ...rest } = c.keys;
  return withKeys(c, rest);
}

/** Cambia valor/interpolación de un fotograma. */
export function updateKey(c: Clip, prop: string, index: number, patch: Partial<Keyframe>): Clip {
  const list = c.keys?.[prop];
  if (!list || !list[index]) return c;
  const next = list.slice();
  next[index] = { ...list[index], ...patch, t: Math.max(0, finite(patch.t, list[index].t)), v: finite(patch.v, list[index].v) };
  return withKeys(c, { ...c.keys, [prop]: sortKeys(next) });
}

/** Mueve un fotograma a otro instante (los demás no se tocan; si cae sobre otro, lo sustituye). */
export function moveKey(c: Clip, prop: string, index: number, newT: number): Clip {
  const list = c.keys?.[prop];
  if (!list || !list[index] || !Number.isFinite(newT)) return c;
  const t = Math.max(0, newT);
  const moved = { ...list[index], t };
  const others = list.filter((k, i) => i !== index && Math.abs(k.t - t) > KEY_EPS);
  return withKeys(c, { ...c.keys, [prop]: sortKeys([...others, moved]) });
}

/** Copia los fotogramas (todas las propiedades, o solo `prop`) cuyo `t` esté en [t0, t1], con t relativo a t0. */
export function copyKeys(c: Clip, t0: number, t1: number, prop?: string): { prop: string; keys: Keyframe[] }[] {
  const out: { prop: string; keys: Keyframe[] }[] = [];
  for (const [p, list] of Object.entries(c.keys ?? {})) {
    if (prop && p !== prop) continue;
    const sel = list.filter((k) => k.t >= t0 - KEY_EPS && k.t <= t1 + KEY_EPS).map((k) => ({ ...k, t: Math.max(0, k.t - t0) }));
    if (sel.length) out.push({ prop: p, keys: sel });
  }
  return out;
}

/** Pega lo copiado en el instante local `at` (sustituye los que coincidan). */
export function pasteKeys(c: Clip, clipboard: { prop: string; keys: Keyframe[] }[], at: number): Clip {
  let out = c;
  for (const { prop, keys } of clipboard) for (const k of keys) out = setKey(out, prop, at + k.t, k.v, { e: k.e, bz: k.bz });
  return out;
}

/** Desplaza todos los fotogramas `delta` s (p. ej. al recortar el inicio del clip); los que queden antes de 0 se sustituyen por uno en 0 con el valor interpolado. */
export function shiftKeys(c: Clip, delta: number): Clip {
  if (!c.keys || delta === 0) return c;
  const out: KeyMap = {};
  for (const [p, list] of Object.entries(c.keys)) {
    let shifted = list.map((k) => ({ ...k, t: k.t + delta }));
    if (delta < 0) {
      const edge = interpolateKeys(list, -delta);
      shifted = shifted.filter((k) => k.t > KEY_EPS);
      if (edge !== undefined) shifted.unshift({ t: 0, v: edge, ...(list[0].e ? { e: list[0].e } : {}) });
    }
    out[p] = shifted;
  }
  return withKeys(c, out);
}

/** Reparte los fotogramas al dividir en `local` s: la izquierda conserva hasta el corte (con un fotograma allí), la derecha empieza en 0 con el valor del corte. */
export function splitKeys(keys: KeyMap | undefined, local: number): { left?: KeyMap; right?: KeyMap } {
  if (!keys) return {};
  const left: KeyMap = {};
  const right: KeyMap = {};
  for (const [p, list] of Object.entries(keys)) {
    if (!list.length) continue;
    const mid = interpolateKeys(list, local)!;
    const before = list.filter((k) => k.t < local - KEY_EPS);
    const after = list.filter((k) => k.t > local + KEY_EPS);
    const prev = before[before.length - 1];
    const l = before.slice();
    if (after.length) l.push({ t: local, v: mid });
    left[p] = l.length ? l : [{ t: 0, v: mid }];
    right[p] = [{ t: 0, v: mid, ...(prev?.e ? { e: prev.e } : {}), ...(prev?.bz ? { bz: prev.bz } : {}) }, ...after.map((k) => ({ ...k, t: k.t - local }))];
  }
  return { left: Object.keys(left).length ? left : undefined, right: Object.keys(right).length ? right : undefined };
}

// ---------------- presets de animación ----------------

export interface AnimPreset {
  id: string;
  label: string;
  hint: string;
  /** fotogramas por propiedad para un clip de duración `dur` (s); t local */
  build(dur: number, base: Transform): KeyMap;
}

const kf = (t: number, v: number, e: KeyInterp = 'smooth'): Keyframe => ({ t, v, e });

function dedupe(list: Keyframe[]): Keyframe[] {
  const out: Keyframe[] = [];
  for (const k of list) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - k.t) <= KEY_EPS) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

export const ANIM_PRESETS: AnimPreset[] = [
  {
    id: 'kenburns-in',
    label: 'Ken Burns: acercar',
    hint: 'Zoom lento hacia dentro con una ligera deriva',
    build: (d, b) => ({ scale: [kf(0, b.scale, 'linear'), kf(d, b.scale * 1.25, 'linear')], x: [kf(0, b.x, 'linear'), kf(d, b.x - 0.02, 'linear')], y: [kf(0, b.y, 'linear'), kf(d, b.y - 0.01, 'linear')] }),
  },
  {
    id: 'kenburns-out',
    label: 'Ken Burns: alejar',
    hint: 'Zoom lento hacia fuera',
    build: (d, b) => ({ scale: [kf(0, b.scale * 1.25, 'linear'), kf(d, b.scale, 'linear')], x: [kf(0, b.x + 0.02, 'linear'), kf(d, b.x, 'linear')] }),
  },
  {
    id: 'pulse',
    label: 'Latido',
    hint: 'Pulsa la escala como un latido, una vez por segundo',
    build: (d, b) => {
      const sc: Keyframe[] = [];
      for (let t = 0; t < d - 1e-6; t += 1)
        sc.push(kf(t, b.scale), kf(Math.min(d, t + 0.15), b.scale * 1.12), kf(Math.min(d, t + 0.35), b.scale), kf(Math.min(d, t + 0.5), b.scale * 1.06), kf(Math.min(d, t + 0.8), b.scale));
      return { scale: dedupe(sc) };
    },
  },
  {
    id: 'in-out',
    label: 'Entrada y salida',
    hint: 'Aparece con un pequeño zoom y se va con un fundido',
    build: (d, b) => {
      const e = Math.min(0.5, d / 3);
      return { opacity: [kf(0, 0), kf(e, 1), kf(Math.max(e, d - e), 1), kf(d, 0)], scale: [kf(0, b.scale * 0.85), kf(e, b.scale), kf(d, b.scale * 1.04, 'linear')] };
    },
  },
  {
    id: 'slide-in',
    label: 'Entrar desde la izquierda',
    hint: 'Desliza desde fuera del cuadro con frenado',
    build: (d, b) => ({ x: [{ t: 0, v: b.x - 0.6, e: 'bezier', bz: [0.16, 1, 0.3, 1] }, kf(Math.min(0.7, d), b.x)] }),
  },
  {
    id: 'shake',
    label: 'Sacudida',
    hint: 'Vibración corta de posición',
    build: (d, b) => {
      const n = Math.min(12, Math.max(2, Math.round(d * 12)));
      const xs: Keyframe[] = [];
      for (let i = 0; i <= n; i++) xs.push(kf((d * i) / n, b.x + (i === 0 || i === n ? 0 : (i % 2 ? 1 : -1) * 0.012), 'linear'));
      return { x: xs };
    },
  },
];

/** Aplica un preset (sustituye los fotogramas de las propiedades que toca; las demás se conservan). */
export function applyAnimPreset(c: Clip, presetId: string, dur: number): Clip {
  const pr = ANIM_PRESETS.find((p) => p.id === presetId);
  if (!pr || !(dur > 0.05)) return c;
  return withKeys(c, { ...c.keys, ...pr.build(dur, c.transform) });
}
