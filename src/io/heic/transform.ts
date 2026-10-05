// Recorte (clap) y orientación (irot/imir o, si faltan, EXIF) de la imagen principal.
// Devuelve el rectángulo de recorte y la matriz 2D (setTransform) para dibujarla. Puro.
import type { HeifProp } from './isobmff';

export type OrientOp = 'rot90ccw' | 'flipH' | 'flipV';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OrientPlan {
  crop: Rect; // en píxeles de la imagen decodificada (tras la rejilla)
  ops: OrientOp[];
  outW: number;
  outH: number;
  /** [a, b, c, d, e, f] para ctx.setTransform; se dibuja el recorte en (0,0). */
  matrix: [number, number, number, number, number, number];
  orientationFrom: 'heif' | 'exif' | 'none';
}

/** Operaciones para mostrar bien una foto con la orientación EXIF dada (1..8). */
export function exifOps(o: number | null | undefined): OrientOp[] {
  switch (o) {
    case 2:
      return ['flipH'];
    case 3:
      return ['rot90ccw', 'rot90ccw'];
    case 4:
      return ['flipV'];
    case 5:
      return ['rot90ccw', 'rot90ccw', 'rot90ccw', 'flipH'];
    case 6:
      return ['rot90ccw', 'rot90ccw', 'rot90ccw'];
    case 7:
      return ['rot90ccw', 'rot90ccw', 'rot90ccw', 'flipV'];
    case 8:
      return ['rot90ccw'];
    default:
      return [];
  }
}

export function cleanAperture(p: Extract<HeifProp, { kind: 'clap' }> | undefined, w: number, h: number): Rect {
  const full = { x: 0, y: 0, w, h };
  if (!p || !p.wD || !p.hD || !p.xD || !p.yD) return full;
  const cw = p.wN / p.wD;
  const ch = p.hN / p.hD;
  const left = p.xN / p.xD + (w - cw) / 2;
  const top = p.yN / p.yD + (h - ch) / 2;
  const x = Math.round(left);
  const y = Math.round(top);
  const rw = Math.round(cw);
  const rh = Math.round(ch);
  if (!(rw > 0 && rh > 0) || x < 0 || y < 0 || x + rw > w || y + rh > h) return full; // clap inválido: se ignora
  return { x, y, w: rw, h: rh };
}

export function orientationPlan(props: HeifProp[], w: number, h: number, exifOrientation: number | null = null): OrientPlan {
  const crop = cleanAperture(props.find((p) => p.kind === 'clap') as Extract<HeifProp, { kind: 'clap' }> | undefined, w, h);
  const heifOps: OrientOp[] = [];
  let hasHeif = false;
  for (const p of props) {
    if (p.kind === 'irot') {
      hasHeif = true;
      for (let i = 0; i < p.angle; i++) heifOps.push('rot90ccw');
    } else if (p.kind === 'imir') {
      hasHeif = true;
      heifOps.push(p.axis === 0 ? 'flipH' : 'flipV');
    }
  }
  // HEIF manda: si hay irot/imir, la orientación EXIF es solo informativa (ISO/IEC 23008-12).
  const ops = hasHeif ? heifOps : exifOps(exifOrientation);
  const orientationFrom = hasHeif ? 'heif' : ops.length ? 'exif' : 'none';
  let W = crop.w;
  let H = crop.h;
  // M = [a c e; b d f]
  let a = 1,
    b = 0,
    c = 0,
    d = 1,
    e = 0,
    f = 0;
  const pre = (A: number, B: number, C: number, D: number, E: number, F: number) => {
    // M := N · M  con N = [A C E; B D F]
    const na = A * a + C * b;
    const nb = B * a + D * b;
    const nc = A * c + C * d;
    const nd = B * c + D * d;
    const ne = A * e + C * f + E;
    const nf = B * e + D * f + F;
    a = na;
    b = nb;
    c = nc;
    d = nd;
    e = ne;
    f = nf;
  };
  for (const op of ops) {
    if (op === 'rot90ccw') {
      pre(0, -1, 1, 0, 0, W); // x' = y ; y' = W - x
      [W, H] = [H, W];
    } else if (op === 'flipH') pre(-1, 0, 0, 1, W, 0);
    else pre(1, 0, 0, -1, 0, H);
  }
  return { crop, ops, outW: W, outH: H, matrix: [a, b, c, d, e, f], orientationFrom };
}

/** Aplica la matriz a un punto (para pruebas y depuración). */
export function applyMatrix(m: OrientPlan['matrix'], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
