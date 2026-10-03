// Curvas de velocidad (V8): puras. La velocidad `v(s)` depende del instante `s` del ARCHIVO, así que el tiempo de
// salida es la integral ∫ ds / v(s): el mapeo entre el tiempo de fuente y el de salida es exacto (forma cerrada en los
// tramos lineales; tabla fina en los suaves) y la misma función sirve para la duración del clip, la exportación, la
// vista previa y el audio.
//
// Entre dos puntos la velocidad se interpola en escala logarítmica: v = va·(vb/va)^x. Con `smooth`, x = smoothstep(p).
import type { SpeedCurve, SpeedPoint } from '../model/types';

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 100;
export const clampSpeed = (v: number): number => (Number.isFinite(v) ? Math.max(MIN_SPEED, Math.min(MAX_SPEED, v)) : 1);

const smoothstep = (x: number) => x * x * (3 - 2 * x);
const EPS_LN = 1e-9;

/** Lectura segura de una curva guardada (idempotente, no muta). Una curva de un solo punto es velocidad constante. */
export function sanitizeCurve(raw: unknown): SpeedCurve | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.pts)) return undefined;
  const pts: SpeedPoint[] = [];
  for (const q of r.pts) {
    if (!q || typeof q !== 'object') continue;
    const { s, v } = q as Record<string, unknown>;
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || typeof v !== 'number' || !Number.isFinite(v)) continue;
    pts.push({ s, v: clampSpeed(v) });
  }
  pts.sort((a, b) => a.s - b.s);
  const dedup: SpeedPoint[] = [];
  for (const p of pts) {
    if (dedup.length && Math.abs(dedup[dedup.length - 1].s - p.s) < 1e-4) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  if (!dedup.length) return undefined;
  const out: SpeedCurve = { pts: dedup };
  if (r.smooth === true) out.smooth = true;
  return out;
}

/** Velocidad en el instante de archivo `s`. */
export function speedAt(c: SpeedCurve, s: number): number {
  const p = c.pts;
  if (!p.length) return 1;
  if (s <= p[0].s) return p[0].v;
  if (s >= p[p.length - 1].s) return p[p.length - 1].v;
  let i = 0;
  while (i < p.length - 2 && s >= p[i + 1].s) i++;
  const a = p[i];
  const b = p[i + 1];
  let x = (s - a.s) / (b.s - a.s);
  if (c.smooth) x = smoothstep(x);
  return a.v * Math.pow(b.v / a.v, x);
}

interface Seg {
  /** tramo de archivo [a, b] */
  a: number;
  b: number;
  /** segmento original al que pertenece (constante si va = vb) */
  sa: number;
  sb: number;
  va: number;
  vb: number;
  smooth: boolean;
  const: boolean;
  /** parte del segmento original que cubre: x en [x0, x1] */
  x0: number;
  x1: number;
  /** tiempo de salida acumulado al empezar el tramo */
  T0: number;
  /** duración del tramo en salida */
  dT: number;
}

/** ∫ de 1/v sobre x∈[x0,x1] de un segmento de interpolación logarítmica, en unidades de (sb−sa)/va. */
function unitIntegral(rho: number, smooth: boolean, x0: number, x1: number): number {
  const lr = Math.log(rho);
  if (!smooth) {
    if (Math.abs(lr) < EPS_LN) return x1 - x0;
    return (Math.pow(rho, x1) - Math.pow(rho, x0)) / lr;
  }
  // Simpson compuesto (64 paneles): el integrando es analítico y muy suave
  const n = 64;
  const h = (x1 - x0) / n;
  const f = (x: number) => Math.pow(rho, smoothstep(x));
  let sum = f(x0) + f(x1);
  for (let i = 1; i < n; i++) sum += f(x0 + i * h) * (i % 2 ? 4 : 2);
  return (sum * h) / 3;
}

/**
 * Mapa de tiempo de una curva sobre el tramo de archivo [lo, hi]:
 *  - `duration`: segundos de salida de todo el tramo (a velocidad 1× serían hi − lo);
 *  - `toLocal(s)`: segundos de salida desde `lo` hasta el instante de archivo `s`;
 *  - `toSource(l)`: instante de archivo que se ve a los `l` segundos de salida desde `lo` (inversa exacta).
 */
export class SpeedMap {
  readonly lo: number;
  readonly hi: number;
  readonly duration: number;
  private segs: Seg[] = [];

  constructor(
    readonly curve: SpeedCurve,
    lo: number,
    hi: number,
  ) {
    this.lo = lo;
    this.hi = Math.max(lo, hi);
    const p = curve.pts;
    const smooth = !!curve.smooth;
    const cuts = [this.lo, this.hi];
    for (const q of p) if (q.s > this.lo && q.s < this.hi) cuts.push(q.s);
    cuts.sort((x, y) => x - y);
    let T = 0;
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k];
      const b = cuts[k + 1];
      if (!(b > a)) continue;
      const mid = (a + b) / 2;
      let seg: Seg;
      if (!p.length || mid <= p[0].s || mid >= p[p.length - 1].s || p.length === 1) {
        const v = !p.length ? 1 : mid <= p[0].s ? p[0].v : p[p.length - 1].v;
        seg = { a, b, sa: a, sb: b, va: v, vb: v, smooth: false, const: true, x0: 0, x1: 1, T0: T, dT: (b - a) / v };
      } else {
        let i = 0;
        while (i < p.length - 2 && mid >= p[i + 1].s) i++;
        const sa = p[i].s;
        const sb = p[i + 1].s;
        const va = p[i].v;
        const vb = p[i + 1].v;
        const x0 = (a - sa) / (sb - sa);
        const x1 = (b - sa) / (sb - sa);
        const dT = ((sb - sa) / va) * unitIntegral(va / vb, smooth, x0, x1);
        seg = { a, b, sa, sb, va, vb, smooth, const: va === vb, x0, x1, T0: T, dT };
      }
      this.segs.push(seg);
      T += seg.dT;
    }
    this.duration = T;
  }

  toLocal(s: number): number {
    const segs = this.segs;
    if (!segs.length || s <= this.lo) return 0;
    if (s >= this.hi) return this.duration;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (segs[m].a <= s) lo = m;
      else hi = m - 1;
    }
    const g = segs[lo];
    if (g.const) return g.T0 + (s - g.a) / g.va;
    const x = (s - g.sa) / (g.sb - g.sa);
    return g.T0 + ((g.sb - g.sa) / g.va) * unitIntegral(g.va / g.vb, g.smooth, g.x0, x);
  }

  toSource(l: number): number {
    const segs = this.segs;
    if (!segs.length || l <= 0) return this.lo;
    if (l >= this.duration) return this.hi;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (segs[m].T0 <= l) lo = m;
      else hi = m - 1;
    }
    const g = segs[lo];
    const tau = Math.min(g.dT, Math.max(0, l - g.T0));
    if (g.const) return g.a + tau * g.va;
    const span = g.sb - g.sa;
    const rho = g.va / g.vb;
    const lr = Math.log(rho);
    if (!g.smooth) {
      if (Math.abs(lr) < EPS_LN) return g.sa + (g.x0 + (tau * g.va) / span) * span;
      const arg = Math.pow(rho, g.x0) + (tau * g.va * lr) / span;
      const x = Math.log(Math.max(arg, 1e-300)) / lr;
      return g.sa + Math.min(g.x1, Math.max(g.x0, x)) * span;
    }
    // tramo suave: bisección sobre la integral (monótona)
    let xl = g.x0;
    let xh = g.x1;
    const target = (tau * g.va) / span;
    for (let it = 0; it < 48; it++) {
      const xm = (xl + xh) / 2;
      if (unitIntegral(rho, true, g.x0, xm) < target) xl = xm;
      else xh = xm;
    }
    return g.sa + ((xl + xh) / 2) * span;
  }

  /** Velocidad en el instante de salida `l` (s de archivo por s de salida). */
  speedAtLocal(l: number): number {
    return speedAt(this.curve, this.toSource(l));
  }
}

const cache = new WeakMap<SpeedCurve, Map<string, SpeedMap>>();

/** Mapa en caché por curva y tramo (las curvas del modelo son inmutables). */
export function speedMap(curve: SpeedCurve, lo: number, hi: number): SpeedMap {
  let m = cache.get(curve);
  if (!m) cache.set(curve, (m = new Map()));
  const key = `${lo}|${hi}`;
  let r = m.get(key);
  if (!r) {
    if (m.size > 8) m.clear();
    m.set(key, (r = new SpeedMap(curve, lo, hi)));
  }
  return r;
}

// ---------------- edición (pura) ----------------

const MIN_GAP = 0.02;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Curva constante. */
export const constantCurve = (v: number): SpeedCurve => ({ pts: [{ s: 0, v: clampSpeed(v) }] });

/** Cambia la velocidad de un punto. */
export function setPointSpeed(c: SpeedCurve, index: number, v: number): SpeedCurve {
  if (!c.pts[index]) return c;
  const nv = r6(clampSpeed(v));
  if (nv === c.pts[index].v) return c;
  return { ...c, pts: c.pts.map((p, i) => (i === index ? { ...p, v: nv } : p)) };
}

/** Mueve un punto a otro instante de archivo (sin pasar a sus vecinos). */
export function movePoint(c: SpeedCurve, index: number, s: number, lo = 0, hi = Infinity): SpeedCurve {
  const p = c.pts[index];
  if (!p || !Number.isFinite(s)) return c;
  const min = Math.max(lo, (c.pts[index - 1]?.s ?? -Infinity) + MIN_GAP);
  const max = Math.min(hi, (c.pts[index + 1]?.s ?? Infinity) - MIN_GAP);
  const ns = r6(Math.max(min, Math.min(max, s)));
  if (ns === p.s) return c;
  return { ...c, pts: c.pts.map((q, i) => (i === index ? { ...q, s: ns } : q)) };
}

/** Añade un punto en `s` con la velocidad actual de la curva (o `v`). */
export function addPoint(c: SpeedCurve, s: number, v?: number): SpeedCurve {
  if (!Number.isFinite(s) || c.pts.some((p) => Math.abs(p.s - s) < MIN_GAP)) return c;
  const pts = [...c.pts, { s: r6(s), v: r6(clampSpeed(v ?? speedAt(c, s))) }].sort((a, b) => a.s - b.s);
  return { ...c, pts };
}

/** Quita un punto (siempre queda al menos uno). */
export function removePoint(c: SpeedCurve, index: number): SpeedCurve {
  if (c.pts.length <= 1 || !c.pts[index]) return c;
  return { ...c, pts: c.pts.filter((_, i) => i !== index) };
}

// ---------------- preajustes ----------------

export interface SpeedPreset {
  id: string;
  label: string;
  smooth: boolean;
  /** (progreso 0..1 en el tramo, velocidad) */
  pts: [number, number][];
}

export const SPEED_PRESETS: SpeedPreset[] = [
  { id: 'slow-fast', label: 'Cámara lenta → rápido', smooth: true, pts: [[0, 0.25], [1, 4]] },
  { id: 'fast-slow', label: 'Rápido → cámara lenta', smooth: true, pts: [[0, 4], [1, 0.25]] },
  { id: 'jump', label: 'Salto', smooth: false, pts: [[0, 1], [0.4, 1], [0.45, 0.15], [0.6, 0.15], [0.65, 3], [1, 3]] },
  { id: 'coaster', label: 'Montaña rusa', smooth: true, pts: [[0, 1], [0.2, 4], [0.4, 0.3], [0.6, 4], [0.8, 0.3], [1, 1]] },
  { id: 'bullet', label: 'Cámara lenta en el medio', smooth: true, pts: [[0, 1], [0.35, 1], [0.5, 0.15], [0.65, 1], [1, 1]] },
  { id: 'burst', label: 'Ráfaga en el medio', smooth: true, pts: [[0, 1], [0.35, 1], [0.5, 8], [0.65, 1], [1, 1]] },
];

/** Curva de un preajuste sobre el tramo de archivo [lo, hi]. */
export function presetCurve(id: string, lo: number, hi: number): SpeedCurve | null {
  const pr = SPEED_PRESETS.find((p) => p.id === id);
  if (!pr || !(hi > lo)) return null;
  return { pts: pr.pts.map(([u, v]) => ({ s: r6(lo + u * (hi - lo)), v })), ...(pr.smooth ? { smooth: true } : {}) };
}

/** Muestras (s de archivo, velocidad) para dibujar la curva. */
export function curveSamples(c: SpeedCurve, lo: number, hi: number, n = 64): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = lo + ((hi - lo) * i) / n;
    out.push([s, speedAt(c, s)]);
  }
  return out;
}
