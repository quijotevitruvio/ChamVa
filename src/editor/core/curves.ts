import type { CurvePoint, ToneCurves } from './types';

type PixelData = Pick<ImageData, 'data' | 'width' | 'height'>;

export const IDENTITY_CURVE: CurvePoint[] = [
  [0, 0],
  [255, 255],
];

// Ordena por entrada, recorta a 0..255 y elimina entradas repetidas (se queda con la última).
export function normalizeCurve(points: CurvePoint[] | undefined): CurvePoint[] {
  if (!points || points.length === 0) return IDENTITY_CURVE.map((p) => [...p] as CurvePoint);
  const clean = points
    .filter((p) => isFinite(p[0]) && isFinite(p[1]))
    .map((p) => [Math.min(255, Math.max(0, p[0])), Math.min(255, Math.max(0, p[1]))] as CurvePoint)
    .sort((a, b) => a[0] - b[0]);
  const out: CurvePoint[] = [];
  for (const p of clean) {
    if (out.length && out[out.length - 1][0] === p[0]) out[out.length - 1] = p;
    else out.push(p);
  }
  return out.length ? out : IDENTITY_CURVE.map((p) => [...p] as CurvePoint);
}

// ¿La curva no cambia nada? (vacía, undefined o la diagonal)
export function isIdentityCurve(points: CurvePoint[] | undefined): boolean {
  if (!points || points.length === 0) return true;
  return points.every((p) => Math.abs(p[0] - p[1]) < 0.5);
}

// Spline cúbica monótona (Fritsch-Carlson): suave y sin sobreoscilaciones entre puntos.
// Devuelve una tabla de 256 entradas. Antes del primer punto y tras el último es plana.
export function curveLut(points: CurvePoint[] | undefined): Uint8Array {
  const lut = new Uint8Array(256);
  const pts = normalizeCurve(points);
  const n = pts.length;
  if (n === 1) {
    lut.fill(Math.round(pts[0][1]));
    return lut;
  }
  const dx: number[] = [];
  const delta: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    dx[k] = pts[k + 1][0] - pts[k][0];
    delta[k] = (pts[k + 1][1] - pts[k][1]) / dx[k];
  }
  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = delta[k - 1] * delta[k] <= 0 ? 0 : (delta[k - 1] + delta[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (delta[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / delta[k];
    const b = m[k + 1] / delta[k];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * delta[k];
      m[k + 1] = t * b * delta[k];
    }
  }
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    let y: number;
    if (x <= pts[0][0]) y = pts[0][1];
    else if (x >= pts[n - 1][0]) y = pts[n - 1][1];
    else {
      while (seg < n - 2 && x > pts[seg + 1][0]) seg++;
      const h = dx[seg];
      const t = (x - pts[seg][0]) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      y =
        (2 * t3 - 3 * t2 + 1) * pts[seg][1] +
        (t3 - 2 * t2 + t) * h * m[seg] +
        (-2 * t3 + 3 * t2) * pts[seg + 1][1] +
        (t3 - t2) * h * m[seg + 1];
    }
    lut[x] = Math.round(y < 0 ? 0 : y > 255 ? 255 : y);
  }
  return lut;
}

export function hasCurves(c: ToneCurves | undefined): boolean {
  return !!c && (!isIdentityCurve(c.rgb) || !isIdentityCurve(c.r) || !isIdentityCurve(c.g) || !isIdentityCurve(c.b));
}

// Tablas finales por canal: primero la maestra y después la del canal.
export function curveLuts(c: ToneCurves | undefined): { r: Uint8Array; g: Uint8Array; b: Uint8Array } | null {
  if (!c || !hasCurves(c)) return null;
  const m = curveLut(c.rgb);
  const combine = (ch: CurvePoint[] | undefined) => {
    const l = curveLut(ch);
    const out = new Uint8Array(256);
    for (let i = 0; i < 256; i++) out[i] = l[m[i]];
    return out;
  };
  return { r: combine(c.r), g: combine(c.g), b: combine(c.b) };
}

export function applyCurves(img: PixelData, c: ToneCurves | undefined) {
  const luts = curveLuts(c);
  if (!luts) return;
  const d = img.data as Uint8ClampedArray;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = luts.r[d[i]];
    d[i + 1] = luts.g[d[i + 1]];
    d[i + 2] = luts.b[d[i + 2]];
  }
}

// --- Edición de puntos (la usa el editor interactivo) ---

export const MIN_POINT_GAP = 4; // separación mínima entre entradas vecinas

// Inserta un punto manteniendo el orden. Devuelve la nueva lista y el índice del punto.
export function addCurvePoint(
  points: CurvePoint[] | undefined,
  x: number,
  y: number,
): { points: CurvePoint[]; index: number } {
  const pts = normalizeCurve(points).map((p) => [...p] as CurvePoint);
  const px = Math.round(Math.min(255, Math.max(0, x)));
  const py = Math.round(Math.min(255, Math.max(0, y)));
  let idx = pts.findIndex((p) => p[0] >= px);
  if (idx === -1) idx = pts.length;
  if (idx < pts.length && pts[idx][0] - px < MIN_POINT_GAP) return { points: pts, index: idx }; // coge el existente
  if (idx > 0 && px - pts[idx - 1][0] < MIN_POINT_GAP) return { points: pts, index: idx - 1 };
  pts.splice(idx, 0, [px, py]);
  return { points: pts, index: idx };
}

// Mueve un punto sin cruzarse con sus vecinos.
export function moveCurvePoint(points: CurvePoint[], index: number, x: number, y: number): CurvePoint[] {
  const pts = points.map((p) => [...p] as CurvePoint);
  if (index < 0 || index >= pts.length) return pts;
  const lo = index > 0 ? pts[index - 1][0] + MIN_POINT_GAP : 0;
  const hi = index < pts.length - 1 ? pts[index + 1][0] - MIN_POINT_GAP : 255;
  pts[index] = [Math.round(Math.min(hi, Math.max(lo, x))), Math.round(Math.min(255, Math.max(0, y)))];
  return pts;
}

// Quita un punto interior (los extremos se conservan).
export function removeCurvePoint(points: CurvePoint[], index: number): CurvePoint[] {
  if (points.length <= 2 || index <= 0 || index >= points.length - 1) return points;
  return points.filter((_, i) => i !== index);
}
