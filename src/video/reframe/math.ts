// Reencuadre (V8): geometría pura. El marco es un recorte del fotograma de origen con la proporción de salida
// (9:16, 1:1, 4:5…): centro (cx, cy) en fracción del origen y zoom (1 = el marco más grande que cabe). Se traduce a la
// transformación del clip (x, y, escala) y a sus fotogramas clave, que es lo que ya dibuja `composeFrame`: así la vista
// previa y la exportación usan la MISMA composición.
import type { Clip, Keyframe, ReframeKey, ReframeSpec } from '../model/types';
import { fitRect, type Fit } from '../engine/timeline';

const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

export const REFRAME_ASPECTS: ReframeSpec['aspect'][] = ['9:16', '1:1', '4:5', '16:9'];
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export interface Dims {
  w: number;
  h: number;
}

/** Lectura segura de `Clip.reframe`. */
export function sanitizeReframe(raw: unknown): ReframeSpec | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (!REFRAME_ASPECTS.includes(r.aspect as ReframeSpec['aspect'])) return undefined;
  const out: ReframeSpec = {
    aspect: r.aspect as ReframeSpec['aspect'],
    cx: isFin(r.cx) ? clamp(r.cx, 0, 1) : 0.5,
    cy: isFin(r.cy) ? clamp(r.cy, 0, 1) : 0.5,
    zoom: isFin(r.zoom) ? clamp(r.zoom, MIN_ZOOM, MAX_ZOOM) : 1,
  };
  if (Array.isArray(r.track)) {
    const track: ReframeKey[] = [];
    for (const k of r.track) {
      if (!k || typeof k !== 'object') continue;
      const q = k as Record<string, unknown>;
      if (!isFin(q.t) || q.t < 0 || !isFin(q.cx) || !isFin(q.cy)) continue;
      track.push({ t: q.t, cx: clamp(q.cx, 0, 1), cy: clamp(q.cy, 0, 1), ...(isFin(q.zoom) ? { zoom: clamp(q.zoom, MIN_ZOOM, MAX_ZOOM) } : {}) });
    }
    track.sort((a, b) => a.t - b.t);
    if (track.length) out.track = track;
  }
  return out;
}

export const aspectRatio = (a: ReframeSpec['aspect']): number => ({ '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 })[a];

export interface Geometry {
  /** rectángulo del origen dibujado en el fotograma de salida con escala 1 (px) */
  dw: number;
  dh: number;
  /** escala a la que el marco más grande llena la salida */
  s0: number;
}

/** Geometría del encaje: `src` = tamaño del fotograma de origen YA girado (el que se ve), `out` = tamaño de salida. */
export function geometry(src: Dims, out: Dims, fit: Fit = 'contain'): Geometry {
  const r = fitRect(src.w, src.h, out.w, out.h, fit, 0);
  return { dw: r.w, dh: r.h, s0: Math.max(out.w / r.w, out.h / r.h) };
}

/** Tamaño del marco (fracción del origen) con ese zoom. */
export function cropSize(g: Geometry, out: Dims, zoom: number): { cw: number; ch: number } {
  const S = g.s0 * clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  return { cw: Math.min(1, out.w / (g.dw * S)), ch: Math.min(1, out.h / (g.dh * S)) };
}

/** Lleva el centro del marco para que no se salga del origen. */
export function clampCenter(g: Geometry, out: Dims, c: { cx: number; cy: number; zoom: number }): { cx: number; cy: number; zoom: number } {
  const zoom = clamp(c.zoom, MIN_ZOOM, MAX_ZOOM);
  const { cw, ch } = cropSize(g, out, zoom);
  return { zoom, cx: clamp(c.cx, cw / 2, 1 - cw / 2), cy: clamp(c.cy, ch / 2, 1 - ch / 2) };
}

/** Marco → transformación del clip (posición del centro del video en el fotograma, y escala). */
export function cropToTransform(g: Geometry, out: Dims, c: { cx: number; cy: number; zoom: number }): { x: number; y: number; scale: number } {
  const k = clampCenter(g, out, c);
  const S = g.s0 * k.zoom;
  return { x: r5(0.5 - ((k.cx - 0.5) * g.dw * S) / out.w), y: r5(0.5 - ((k.cy - 0.5) * g.dh * S) / out.h), scale: r5(S) };
}

/** Transformación → marco (inversa; sirve para ver el marco de un clip que ya tiene su transformación). */
export function transformToCrop(g: Geometry, out: Dims, t: { x: number; y: number; scale: number }): { cx: number; cy: number; zoom: number } {
  const S = Math.max(1e-6, t.scale);
  return { cx: 0.5 - ((t.x - 0.5) * out.w) / (g.dw * S), cy: 0.5 - ((t.y - 0.5) * out.h) / (g.dh * S), zoom: S / g.s0 };
}

/** Marco en el instante local `t` del clip: interpola la lista `track` (lineal entre marcos; fuera, el extremo). */
export function reframeAt(spec: ReframeSpec, t: number): { cx: number; cy: number; zoom: number } {
  const tr = spec.track;
  if (!tr || !tr.length) return { cx: spec.cx, cy: spec.cy, zoom: spec.zoom };
  const z = (k: ReframeKey) => k.zoom ?? spec.zoom;
  if (t <= tr[0].t) return { cx: tr[0].cx, cy: tr[0].cy, zoom: z(tr[0]) };
  const last = tr[tr.length - 1];
  if (t >= last.t) return { cx: last.cx, cy: last.cy, zoom: z(last) };
  let i = 0;
  while (i < tr.length - 2 && t >= tr[i + 1].t) i++;
  const a = tr[i];
  const b = tr[i + 1];
  const p = (t - a.t) / (b.t - a.t || 1);
  return { cx: a.cx + (b.cx - a.cx) * p, cy: a.cy + (b.cy - a.cy) * p, zoom: z(a) + (z(b) - z(a)) * p };
}

function setKeysOf(c: Clip, props: Record<string, Keyframe[] | null>): Clip {
  const keys = { ...(c.keys ?? {}) };
  for (const [k, v] of Object.entries(props)) {
    if (v && v.length) keys[k] = v;
    else delete keys[k];
  }
  const { keys: _old, ...rest } = c;
  return Object.keys(keys).length ? { ...rest, keys } : rest;
}

/**
 * Aplica un reencuadre al clip: deja `reframe` y deriva `transform` (x, y, escala) y los fotogramas clave `x`, `y` y
 * `scale` (uno por marco de `track`, interpolación lineal). Sin `track`, el marco es fijo y se quitan esos fotogramas.
 */
export function applyReframe(clip: Clip, spec: ReframeSpec, src: Dims, out: Dims, fit: Fit = 'contain'): Clip {
  const g = geometry(src, out, fit);
  const track = spec.track && spec.track.length ? spec.track : undefined;
  const first = track ? reframeAt(spec, track[0].t) : { cx: spec.cx, cy: spec.cy, zoom: spec.zoom };
  const base = cropToTransform(g, out, first);
  const next: Clip = { ...clip, reframe: spec, transform: { ...clip.transform, x: base.x, y: base.y, scale: base.scale } };
  if (!track) return setKeysOf(next, { x: null, y: null, scale: null });
  const kx: Keyframe[] = [];
  const ky: Keyframe[] = [];
  const ks: Keyframe[] = [];
  for (const k of track) {
    const tf = cropToTransform(g, out, { cx: k.cx, cy: k.cy, zoom: k.zoom ?? spec.zoom });
    kx.push({ t: r5(k.t), v: tf.x });
    ky.push({ t: r5(k.t), v: tf.y });
    ks.push({ t: r5(k.t), v: tf.scale });
  }
  return setKeysOf(next, { x: kx, y: ky, scale: ks });
}

/** Quita el reencuadre (y la transformación que derivaba de él). */
export function clearReframe(clip: Clip): Clip {
  const { reframe: _r, ...rest } = clip;
  return setKeysOf({ ...rest, transform: { ...clip.transform, x: 0.5, y: 0.5, scale: 1 } }, { x: null, y: null, scale: null });
}

// ---------------- seguimiento: suavizado y reducción a fotogramas ----------------

export interface TrackPoint {
  t: number;
  /** centro del sujeto (fracción del origen) */
  x: number;
  y: number;
  /** confianza 0..1 (opcional) */
  c?: number;
}

/** Mediana móvil (quita saltos sueltos del seguimiento). */
export function medianFilter(v: number[], radius: number): number[] {
  if (radius <= 0) return v.slice();
  return v.map((_, i) => {
    const w = v.slice(Math.max(0, i - radius), Math.min(v.length, i + radius + 1)).sort((a, b) => a - b);
    return w[w.length >> 1];
  });
}

/** Suavizado gaussiano sin retardo (los bordes se replican). `sigma` en muestras. */
export function gaussSmooth(v: number[], sigma: number): number[] {
  if (sigma <= 0.01 || v.length < 2) return v.slice();
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(w);
    sum += w;
  }
  return v.map((_, i) => {
    let a = 0;
    for (let j = -r; j <= r; j++) a += v[clamp(i + j, 0, v.length - 1)] * k[j + r];
    return a / sum;
  });
}

/** «Operador de cámara»: el marco solo se mueve cuando el sujeto sale de una zona muerta alrededor de su centro. */
export function deadzoneFollow(v: number[], zone: number): number[] {
  if (!v.length) return [];
  const out = [v[0]];
  for (let i = 1; i < v.length; i++) {
    const cam = out[i - 1];
    const d = v[i] - cam;
    out.push(Math.abs(d) > zone ? v[i] - Math.sign(d) * zone : cam);
  }
  return out;
}

/** Douglas–Peucker sobre (t, valor normalizado): se queda con los puntos que importan. */
export function reduceSeries(t: number[], series: number[][], tol: number): number[] {
  const n = t.length;
  if (n <= 2) return t.map((_, i) => i);
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let wi = -1;
    for (let i = a + 1; i < b; i++) {
      const p = (t[i] - t[a]) / (t[b] - t[a] || 1);
      let e = 0;
      for (const s of series) e = Math.max(e, Math.abs(s[a] + (s[b] - s[a]) * p - s[i]));
      if (e > worst) {
        worst = e;
        wi = i;
      }
    }
    if (worst > tol && wi > 0) {
      keep[wi] = true;
      stack.push([a, wi], [wi, b]);
    }
  }
  return keep.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
}

export interface AutoFrameOptions {
  /** radio de la mediana en muestras (def. 2) */
  median?: number;
  /** zona muerta, fracción del tamaño del marco (def. 0,12) */
  deadzone?: number;
  /** sigma del suavizado en segundos (def. 0,35) */
  smoothSec?: number;
  /** tolerancia para reducir a fotogramas, fracción del origen (def. 0,004) */
  tol?: number;
  zoom?: number;
}

/**
 * Del seguimiento en bruto a los marcos del reencuadre: mediana → zona muerta (movimiento «de operador») → suavizado
 * sin retardo → ajuste a los bordes → reducción a pocos fotogramas clave editables.
 * `cw`/`ch` = tamaño del marco (fracción del origen) y `fps` = muestras por segundo del seguimiento.
 */
export function framesFromTrack(points: TrackPoint[], cw: number, ch: number, opts: AutoFrameOptions = {}): ReframeKey[] {
  if (!points.length) return [];
  const fps = points.length > 1 ? (points.length - 1) / Math.max(1e-6, points[points.length - 1].t - points[0].t) : 1;
  const med = opts.median ?? 2;
  const zone = opts.deadzone ?? 0.12;
  const sm = (opts.smoothSec ?? 0.35) * fps;
  let xs = medianFilter(points.map((p) => p.x), med);
  let ys = medianFilter(points.map((p) => p.y), med);
  xs = gaussSmooth(deadzoneFollow(xs, zone * cw), sm);
  ys = gaussSmooth(deadzoneFollow(ys, zone * ch), sm);
  xs = xs.map((v) => clamp(v, cw / 2, 1 - cw / 2));
  ys = ys.map((v) => clamp(v, ch / 2, 1 - ch / 2));
  const t = points.map((p) => p.t);
  const idx = reduceSeries(t, [xs, ys], opts.tol ?? 0.004);
  return idx.map((i) => ({ t: r5(t[i]), cx: r5(xs[i]), cy: r5(ys[i]), ...(opts.zoom ? { zoom: opts.zoom } : {}) }));
}
