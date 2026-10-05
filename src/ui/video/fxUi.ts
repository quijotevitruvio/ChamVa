// Lógica pura de la interfaz de V6 (sin React ni DOM): qué se arrastra desde los paneles, dónde cae en la línea de
// tiempo, símbolos de unión, agrupación de fotogramas clave y etiquetas. Se prueba en fxUi.test.ts.
import * as VM from '../../video/model';
import { FX_DEFS, fxDef, makeLookFx, lookById } from '../../video/fx/effects';
import { addFx, addFxOfType, newFxId, junctionSpec, setBlend, setJunctionTransition, setTransition } from '../../video/fx/clipOps';
import { BASE_PROPS, KEY_EPS, PROP_LABEL, type BaseProp } from '../../video/fx/keyframes';
import { areJoined, junctionDur, junctionOf, makeTransition, transitionInfo } from '../../video/fx/transitions';
import * as T from './timelineMath';

// ---------- lo que se arrastra desde los paneles ----------
export const FX_MIME = 'application/x-chamva-fx';

export type FxPayload = { kind: 'transition'; id: string } | { kind: 'effect'; type: string } | { kind: 'look'; id: string } | { kind: 'blend'; mode: VM.BlendMode };
export type FxKind = FxPayload['kind'];

/** Un tipo MIME por clase: durante `dragover` solo se leen los tipos, no los datos, y hace falta saber qué viene. */
export const payloadMime = (k: FxKind) => `${FX_MIME}-${k}`;

export function encodePayload(dt: Pick<DataTransfer, 'setData'>, p: FxPayload): void {
  dt.setData(FX_MIME, JSON.stringify(p));
  dt.setData(payloadMime(p.kind), '1');
}

const KINDS: FxKind[] = ['transition', 'effect', 'look', 'blend'];
/** La clase de lo que se está arrastrando (null si no es del panel de efectos). */
export function dragKind(types: ArrayLike<string> | readonly string[]): FxKind | null {
  const list = Array.from(types);
  return KINDS.find((k) => list.includes(payloadMime(k))) ?? null;
}

/** Lee y valida lo arrastrado (los datos de un arrastre no son de fiar). */
export function decodePayload(raw: string): FxPayload | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v.kind === 'transition' && typeof v.id === 'string' && transitionInfo(v.id)) return { kind: 'transition', id: v.id };
    if (v.kind === 'effect' && typeof v.type === 'string' && fxDef(v.type)) return { kind: 'effect', type: v.type };
    if (v.kind === 'look' && typeof v.id === 'string' && lookById(v.id).id === v.id) return { kind: 'look', id: v.id };
    if (v.kind === 'blend' && typeof v.mode === 'string' && BLEND_LABEL[v.mode as VM.BlendMode]) return { kind: 'blend', mode: v.mode as VM.BlendMode };
  } catch {
    /* no es nuestro */
  }
  return null;
}

export { BLEND_LABEL } from '../../editor/core/blend';
import { BLEND_LABEL } from '../../editor/core/blend';

export const payloadLabel = (p: FxPayload): string => {
  switch (p.kind) {
    case 'transition':
      return transitionInfo(p.id)?.label ?? p.id;
    case 'effect':
      return fxDef(p.type)?.label ?? p.type;
    case 'look':
      return lookById(p.id).label;
    case 'blend':
      return `Fusión: ${BLEND_LABEL[p.mode]}`;
  }
};

/** Dónde se aplica una transición: en la unión con el clip anterior, como entrada o como salida. `auto`: la unión si la hay. */
export type TransMode = 'auto' | 'junction' | 'in' | 'out';

/** Aplica lo arrastrado/pulsado a un clip. Devuelve el MISMO proyecto si no aplica (pista bloqueada, clip de audio…). */
export function applyPayload(p: VM.VideoProject, clipId: string, payload: FxPayload, mode: TransMode = 'auto'): VM.VideoProject {
  const loc = VM.findClip(p, clipId);
  if (!loc || loc.track.locked) return p;
  switch (payload.kind) {
    case 'transition': {
      const spec = makeTransition(payload.id);
      if (mode === 'out') {
        const i = loc.track.clips.findIndex((c) => c.id === clipId);
        const next = loc.track.clips[i + 1];
        // la salida de un clip unido al siguiente ES la unión con él
        return next && areJoined(loc.clip, next) ? setJunctionTransition(p, next.id, spec) : setTransition(p, clipId, 'out', spec);
      }
      return mode === 'in' ? setTransition(p, clipId, 'in', spec) : setJunctionTransition(p, clipId, spec);
    }
    case 'effect':
      return addFxOfType(p, clipId, payload.type);
    case 'look':
      return addFx(p, clipId, { ...makeLookFx(payload.id), id: newFxId() });
    case 'blend':
      return setBlend(p, clipId, payload.mode);
  }
}

// ---------- uniones en la línea de tiempo ----------
export interface JunctionMark {
  aId: string;
  bId: string;
  /** instante del corte (inicio de B) */
  cut: number;
  /** duración efectiva de la ventana (0 si no hay transición) */
  dur: number;
  type: string | null;
  label: string;
}

/** Uniones de una pista de video: cada par de clips contiguos, con su transición si la hay. */
export function junctionMarks(track: VM.Track, projectDur: number): JunctionMark[] {
  void projectDur;
  const out: JunctionMark[] = [];
  if (track.kind !== 'video') return out;
  for (let i = 1; i < track.clips.length; i++) {
    const j = junctionOf(track, track.clips[i].id);
    if (!j) continue;
    const js = junctionSpec(j.a, j.b);
    const dur = js ? junctionDur(js.spec, j.a, j.b) : 0;
    out.push({ aId: j.a.id, bId: j.b.id, cut: j.b.start, dur, type: js?.spec.type ?? null, label: js ? (transitionInfo(js.spec.type)?.label ?? js.spec.type) : '' });
  }
  return out;
}

export interface FxDropTarget {
  clipId: string;
  mode: TransMode | 'clip';
  /** rectángulo a resaltar (px del contenido de las pistas) */
  rect: { x: number; y: number; w: number; h: number };
}

/** Qué recibe lo soltado en (x, y) del contenido de las pistas; null si ahí no se puede aplicar. */
export function fxDropTarget(p: VM.VideoProject, rows: T.Row[], pps: number, x: number, y: number, kind: FxKind): FxDropTarget | null {
  const row = T.rowAtY(rows, y);
  const track = row ? VM.findTrack(p, row.trackId) : null;
  if (!row || !track || track.locked) return null;
  const dur = VM.projectDuration(p);
  if (kind === 'transition') {
    if (track.kind !== 'video') return null;
    for (const m of junctionMarks(track, dur)) {
      const half = Math.max(16, (m.dur * pps) / 2);
      if (Math.abs(x - m.cut * pps) <= half) return { clipId: m.bId, mode: 'junction', rect: { x: m.cut * pps - half, y: row.y, w: half * 2, h: row.h } };
    }
  }
  const hit = T.hitTest(p, rows, pps, x, y);
  const loc = hit ? VM.findClip(p, hit.clipId) : null;
  if (!hit || !loc) return null;
  const k = loc.clip.kind;
  const r = T.clipRect(loc.clip, row, pps, dur);
  if (kind === 'transition') {
    if (k === 'audio' || k === 'subtitle') return null;
    const left = x - r.x < r.w / 2;
    return { clipId: loc.clip.id, mode: left ? 'in' : 'out', rect: { x: left ? r.x : r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h } };
  }
  if (k === 'audio' || k === 'subtitle') return null;
  if (kind === 'blend' && k === 'adjust') return null;
  return { clipId: loc.clip.id, mode: 'clip', rect: r };
}

// ---------- fotogramas clave ----------
export interface KeyMember {
  prop: string;
  index: number;
}
export interface KeyCluster {
  /** instante local (s desde el inicio del clip) */
  t: number;
  members: KeyMember[];
}

/** Agrupa los fotogramas de TODAS las propiedades del clip que caen en el mismo instante (±1 ms): un rombo por instante. */
export function keyClusters(clip: Pick<VM.Clip, 'keys'>): KeyCluster[] {
  const all: { t: number; m: KeyMember }[] = [];
  for (const [prop, list] of Object.entries(clip.keys ?? {})) list.forEach((k, index) => all.push({ t: k.t, m: { prop, index } }));
  all.sort((a, b) => a.t - b.t);
  const out: KeyCluster[] = [];
  for (const e of all) {
    const last = out[out.length - 1];
    if (last && e.t - last.t <= KEY_EPS && !last.members.some((m) => m.prop === e.m.prop)) last.members.push(e.m);
    else out.push({ t: e.t, members: [e.m] });
  }
  return out;
}

/** Índice del fotograma de `prop` que hay en el instante t de la línea de tiempo (±1 ms), o -1. */
export function keyIndexAt(clip: Pick<VM.Clip, 'keys' | 'start'>, prop: string, t: number): number {
  const list = clip.keys?.[prop];
  if (!list) return -1;
  return list.findIndex((k) => Math.abs(k.t - (t - clip.start)) <= KEY_EPS);
}

/** Fotograma anterior (dir −1) o siguiente (dir 1) al instante t, en tiempo de línea de tiempo; null si no hay. */
export function neighborKey(clip: Pick<VM.Clip, 'keys' | 'start'>, prop: string, t: number, dir: -1 | 1): number | null {
  const list = clip.keys?.[prop];
  if (!list?.length) return null;
  const local = t - clip.start;
  if (dir > 0) {
    const k = list.find((x) => x.t > local + KEY_EPS);
    return k ? clip.start + k.t : null;
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].t < local - KEY_EPS) return clip.start + list[i].t;
  return null;
}

/** Nombre legible de una propiedad animable («Escala», «Brillo · Intensidad»…). */
export function propLabel(clip: Pick<VM.Clip, 'fx'>, prop: string): string {
  if ((BASE_PROPS as readonly string[]).includes(prop)) return PROP_LABEL[prop as BaseProp];
  const m = /^fx\.([^.]+)\.(.+)$/.exec(prop);
  if (!m) return prop;
  const fx = clip.fx?.find((f) => f.id === m[1]);
  const def = fx ? fxDef(fx.type) : undefined;
  const param = m[2] === 'amount' ? 'Intensidad' : (def?.params.find((pd) => pd.key === m[2])?.label ?? m[2]);
  return `${def?.label ?? 'Efecto'} · ${param}`;
}

/** Un efecto «de Color» (para la pestaña Ajustes) frente a los de imagen, forma y croma (pestaña Efectos). */
export const COLOR_FX = FX_DEFS.filter((d) => d.category === 'Color' && d.type !== 'look');
export const IMAGE_FX = (cat: 'Imagen' | 'Forma' | 'Croma') => FX_DEFS.filter((d) => d.category === cat);
