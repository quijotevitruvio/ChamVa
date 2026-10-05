// Estabilización de video (V9): lógica PURA (sin lienzo), propia y sin dependencias.
//
// 1) Movimiento entre fotogramas consecutivos (`estimateMotion`): traslación global grueso→fino en una pirámide (SAD) y
//    luego vectores por bloques con textura alrededor de ella, con ajuste subpíxel; con esos vectores se ajusta una
//    SIMILITUD (traslación + giro + escala) por mínimos cuadrados con rechazo de atípicos (un sujeto que se mueve no
//    arrastra la estimación de la cámara).
// 2) Trayectoria = suma de los movimientos; se suaviza con una gaussiana (bordes por reflexión impar: conserva la
//    tendencia, así un paneo no deja zoom ni tirón al principio o al final).
// 3) Corrección = trayectoria suavizada − real; el recorte (zoom) mínimo que esconde los bordes, con tope.
//
// OpenCV.js (Apache-2.0, ya en dependencias) se descartó: trae calcOpticalFlowPyrLK y goodFeaturesToTrack pero no
// estimateAffinePartial2D, pesa 13 MB y su carga bloquea; este método da la misma similitud con lo justo.
import type { Gray } from '../reframe/tracker';

export interface Motion {
  /** desplazamiento del contenido (px del análisis), referido al centro del fotograma */
  dx: number;
  dy: number;
  /** giro (rad) y log de la escala */
  da: number;
  ds: number;
  /** false = no se pudo medir con confianza (se toma como sin movimiento) */
  ok: boolean;
  /** vectores de bloque usados tras quitar atípicos */
  inliers?: number;
}

function down2(g: Gray): Gray {
  const w = Math.max(1, g.w >> 1);
  const h = Math.max(1, g.h >> 1);
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 2 * y * g.w + 2 * x;
      const x1 = 2 * x + 1 < g.w ? 1 : 0;
      const y1 = 2 * y + 1 < g.h ? g.w : 0;
      d[y * w + x] = (g.d[i] + g.d[i + x1] + g.d[i + y1] + g.d[i + y1 + x1]) * 0.25;
    }
  return { w, h, d };
}

/** SAD medio de `a` (rectángulo x0..x1, y0..y1) contra `b` desplazado (vx, vy); paso `st` para ir rápido. */
function sad(a: Gray, b: Gray, x0: number, y0: number, x1: number, y1: number, vx: number, vy: number, st = 1): number {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y += st) {
    const yb = y + vy;
    if (yb < 0 || yb >= b.h) continue;
    const ra = y * a.w;
    const rb = yb * b.w;
    for (let x = x0; x < x1; x += st) {
      const xb = x + vx;
      if (xb < 0 || xb >= b.w) continue;
      const d = a.d[ra + x] - b.d[rb + xb];
      s += d < 0 ? -d : d;
      n++;
    }
  }
  return n ? s / n : Infinity;
}

/** Mejor desplazamiento entero en ±r alrededor de (cx, cy) y su ajuste subpíxel (parábola en cada eje). */
function search(a: Gray, b: Gray, x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number, st = 1) {
  let best = Infinity;
  let bx = cx;
  let by = cy;
  for (let vy = cy - r; vy <= cy + r; vy++)
    for (let vx = cx - r; vx <= cx + r; vx++) {
      const s = sad(a, b, x0, y0, x1, y1, vx, vy, st);
      if (s < best) {
        best = s;
        bx = vx;
        by = vy;
      }
    }
  const sub = (m: number, c: number, p: number) => {
    const den = m - 2 * c + p;
    return Number.isFinite(den) && den > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / den)) : 0;
  };
  const sx = sub(sad(a, b, x0, y0, x1, y1, bx - 1, by, st), best, sad(a, b, x0, y0, x1, y1, bx + 1, by, st));
  const sy = sub(sad(a, b, x0, y0, x1, y1, bx, by - 1, st), best, sad(a, b, x0, y0, x1, y1, bx, by + 1, st));
  return { x: bx + sx, y: by + sy, ix: bx, iy: by, cost: best };
}

/** Energía de gradiente media de un bloque (los bloques planos no dicen nada del movimiento). */
function texture(g: Gray, x0: number, y0: number, x1: number, y1: number): number {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1 - 1; y++)
    for (let x = x0; x < x1 - 1; x++) {
      const i = y * g.w + x;
      s += Math.abs(g.d[i + 1] - g.d[i]) + Math.abs(g.d[i + g.w] - g.d[i]);
      n++;
    }
  return n ? s / n : 0;
}

export interface MotionOptions {
  /** desplazamiento máximo buscado (fracción del lado corto, def. 0,12) */
  maxShift?: number;
  /** rejilla de bloques (def. 8 × 6) */
  grid?: [number, number];
}

/** Movimiento del contenido de `a` (fotograma anterior) a `b` (actual). Mismo tamaño. */
export function estimateMotion(a: Gray, b: Gray, o: MotionOptions = {}): Motion {
  if (a.w !== b.w || a.h !== b.h || a.w < 16 || a.h < 16) return { dx: 0, dy: 0, da: 0, ds: 0, ok: false };
  // --- pirámide y traslación global grueso → fino ---
  const pa: Gray[] = [a];
  const pb: Gray[] = [b];
  while (Math.max(pa[pa.length - 1].w, pa[pa.length - 1].h) > 72) {
    pa.push(down2(pa[pa.length - 1]));
    pb.push(down2(pb[pb.length - 1]));
  }
  const L = pa.length - 1;
  const top = pa[L];
  const R = Math.max(2, Math.ceil((o.maxShift ?? 0.12) * Math.min(top.w, top.h)));
  let g = search(top, pb[L], R, R, top.w - R, top.h - R, 0, 0, R);
  let gx = g.ix;
  let gy = g.iy;
  for (let l = L - 1; l >= 0; l--) {
    const A = pa[l];
    const m = Math.ceil(Math.abs(gx * 2)) + 3;
    const n = Math.ceil(Math.abs(gy * 2)) + 3;
    g = search(A, pb[l], m, n, A.w - m, A.h - n, gx * 2, gy * 2, 2, l === 0 ? 2 : 1);
    gx = g.ix;
    gy = g.iy;
  }
  // --- vectores por bloque alrededor de la traslación global ---
  const [GX, GY] = o.grid ?? [8, 6];
  const bw = Math.floor(a.w / GX);
  const bh = Math.floor(a.h / GY);
  const pts: { x: number; y: number; vx: number; vy: number; tex: number }[] = [];
  const margin = 3;
  for (let j = 0; j < GY; j++)
    for (let i = 0; i < GX; i++) {
      const x0 = i * bw + 2;
      const y0 = j * bh + 2;
      const x1 = (i + 1) * bw - 2;
      const y1 = (j + 1) * bh - 2;
      if (x0 + gx - margin < 0 || y0 + gy - margin < 0 || x1 + gx + margin > a.w || y1 + gy + margin > a.h) continue;
      const tex = texture(a, x0, y0, x1, y1);
      if (tex < 2) continue;
      const s = search(a, b, x0, y0, x1, y1, gx, gy, margin);
      // un mínimo en el borde de la búsqueda no es fiable
      if (Math.abs(s.ix - gx) >= margin || Math.abs(s.iy - gy) >= margin) continue;
      pts.push({ x: (x0 + x1) / 2 - a.w / 2, y: (y0 + y1) / 2 - a.h / 2, vx: s.x, vy: s.y, tex });
    }
  if (pts.length < 4) return { dx: g.x, dy: g.y, da: 0, ds: 0, ok: pts.length > 0 || g.cost < 40, inliers: pts.length };
  let use = pts;
  let fit = fitSimilarity(use);
  for (let it = 0; it < 3; it++) {
    const res = pts.map((p) => residual(fit, p));
    const med = [...res].sort((x, y) => x - y)[Math.floor(res.length / 2)];
    const lim = Math.max(0.75, 2.5 * med);
    const next = pts.filter((_, k) => res[k] <= lim);
    if (next.length < 4 || next.length === use.length) break;
    use = next;
    fit = fitSimilarity(use);
  }
  return { dx: fit.tx, dy: fit.ty, da: Math.atan2(fit.b, fit.a), ds: Math.log(Math.hypot(fit.a, fit.b) || 1), ok: true, inliers: use.length };
}

interface Sim {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/** Similitud q = [a −b; b a]·p + t por mínimos cuadrados (p centrado en el fotograma, q = p + v). */
export function fitSimilarity(pts: { x: number; y: number; vx: number; vy: number }[]): Sim {
  const n = pts.length;
  let mx = 0;
  let my = 0;
  let qx = 0;
  let qy = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
    qx += p.x + p.vx;
    qy += p.y + p.vy;
  }
  mx /= n;
  my /= n;
  qx /= n;
  qy /= n;
  let sxx = 0;
  let dot = 0;
  let crs = 0;
  for (const p of pts) {
    const X = p.x - mx;
    const Y = p.y - my;
    const QX = p.x + p.vx - qx;
    const QY = p.y + p.vy - qy;
    sxx += X * X + Y * Y;
    dot += X * QX + Y * QY;
    crs += X * QY - Y * QX;
  }
  let a = sxx > 1e-9 ? dot / sxx : 1;
  let b = sxx > 1e-9 ? crs / sxx : 0;
  // giros y escalas absurdos entre dos fotogramas = mala medida: solo traslación
  if (Math.abs(Math.atan2(b, a)) > 0.2 || Math.abs(Math.hypot(a, b) - 1) > 0.15) {
    a = 1;
    b = 0;
  }
  return { a, b, tx: qx - (a * mx - b * my), ty: qy - (b * mx + a * my) };
}

function residual(s: Sim, p: { x: number; y: number; vx: number; vy: number }): number {
  const ex = s.a * p.x - s.b * p.y + s.tx - (p.x + p.vx);
  const ey = s.b * p.x + s.a * p.y + s.ty - (p.y + p.vy);
  return Math.hypot(ex, ey);
}

/** Suavizado gaussiano (σ en muestras) con bordes por reflexión impar (2·x0 − x_k): conserva la pendiente. */
export function gaussianSmooth(xs: ArrayLike<number>, sigma: number): Float64Array {
  const n = xs.length;
  const out = new Float64Array(n);
  if (!n) return out;
  if (!(sigma > 0.01)) {
    for (let i = 0; i < n; i++) out[i] = xs[i];
    return out;
  }
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float64Array(2 * r + 1);
  let ks = 0;
  for (let j = -r; j <= r; j++) ks += k[j + r] = Math.exp(-(j * j) / (2 * sigma * sigma));
  const at = (i: number): number => {
    if (n === 1) return xs[0];
    if (i < 0) return 2 * xs[0] - at(-i);
    if (i >= n) return 2 * xs[n - 1] - at(2 * (n - 1) - i);
    return xs[i];
  };
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += k[j + r] * at(i + j);
    out[i] = s / ks;
  }
  return out;
}

export interface Corrections {
  /** primer índice de fotograma (del archivo) */
  i0: number;
  /** corrección por fotograma: traslación en FRACCIÓN del fotograma analizado, giro en rad */
  cx: Float64Array;
  cy: Float64Array;
  ca: Float64Array;
  /** zoom de recorte que esconde los bordes (≥ 1) */
  zoom: number;
  /** la corrección se limitó porque el zoom necesario pasaba del tope */
  clamped: boolean;
}

/** Trayectoria acumulada desde i0 (C_i0 = 0). Un movimiento que falta o no es fiable cuenta como 0. */
export function trajectory(get: (i: number) => Motion | undefined, i0: number, i1: number) {
  const n = Math.max(0, i1 - i0 + 1);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const a = new Float64Array(n);
  for (let k = 1; k < n; k++) {
    const m = get(i0 + k);
    const ok = m && m.ok;
    x[k] = x[k - 1] + (ok ? m.dx : 0);
    y[k] = y[k - 1] + (ok ? m.dy : 0);
    a[k] = a[k - 1] + (ok ? m.da : 0);
  }
  return { x, y, a };
}

/**
 * Correcciones de un tramo: `smooth` = radio del suavizado en s (0,1–3; más = más estable, más recorte), `rotation` corrige el
 * giro, `maxZoom` tope del recorte (1–1,5). w/h = tamaño del análisis.
 */
export function stabCorrections(
  get: (i: number) => Motion | undefined,
  i0: number,
  i1: number,
  o: { fps: number; w: number; h: number; smooth: number; rotation?: boolean; maxZoom?: number },
): Corrections {
  const tr = trajectory(get, i0, i1);
  const sigma = Math.max(0.05, Math.min(3, o.smooth)) * o.fps * 0.5;
  const sx = gaussianSmooth(tr.x, sigma);
  const sy = gaussianSmooth(tr.y, sigma);
  const sa = gaussianSmooth(tr.a, sigma);
  const n = tr.x.length;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const ca = new Float64Array(n);
  const ar = Math.max(o.w / o.h, o.h / o.w);
  let need = 1;
  for (let k = 0; k < n; k++) {
    cx[k] = (sx[k] - tr.x[k]) / o.w;
    cy[k] = (sy[k] - tr.y[k]) / o.h;
    ca[k] = o.rotation === false ? 0 : sa[k] - tr.a[k];
    need = Math.max(need, zoomFor(cx[k], cy[k], ca[k], ar));
  }
  const maxZoom = Math.max(1, Math.min(1.5, o.maxZoom ?? 1.2));
  const zoom = Math.min(maxZoom, need);
  let clamped = false;
  if (need > zoom + 1e-9) {
    // se recorta la corrección (no se ven bordes; queda algo de temblor en los picos)
    for (let k = 0; k < n; k++) {
      const rot = Math.abs(Math.cos(ca[k])) + Math.abs(Math.sin(ca[k])) * ar;
      const room = Math.max(0, (zoom - rot) / 2);
      if (Math.abs(cx[k]) > room || Math.abs(cy[k]) > room) clamped = true;
      cx[k] = Math.max(-room, Math.min(room, cx[k]));
      cy[k] = Math.max(-room, Math.min(room, cy[k]));
    }
  }
  return { i0, cx, cy, ca, zoom, clamped };
}

/** Zoom que hace falta para que el fotograma desplazado (cx, cy fracción) y girado `a` siga cubriendo la salida. */
export function zoomFor(cx: number, cy: number, a: number, ar = 16 / 9): number {
  return Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)) * ar + 2 * Math.max(Math.abs(cx), Math.abs(cy));
}

/** Temblor de una serie de posiciones: RMS de lo que queda tras quitarle su tendencia suave (σ en muestras). */
export function jitterRms(xs: ArrayLike<number>, sigma = 8): number {
  const s = gaussianSmooth(xs, sigma);
  let e = 0;
  for (let i = 0; i < xs.length; i++) e += (xs[i] - s[i]) ** 2;
  return xs.length ? Math.sqrt(e / xs.length) : 0;
}

/** Estimación previa del análisis de estabilización (rápido: un fotograma pequeño en gris por fotograma). */
export function estimateStab(seconds: number, fps = 30, msPerFrame = 9): { frames: number; seconds: number; bytes: number } {
  const frames = Math.max(0, Math.ceil(seconds * fps - 1e-6) + 1);
  return { frames, seconds: (frames * msPerFrame) / 1000, bytes: frames * 64 };
}
