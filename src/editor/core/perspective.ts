// Transformación proyectiva (homografía de 4 puntos) y remuestreo bilineal.
// Lógica pura (sin DOM): trabaja sobre `PixelBuf`, compatible con ImageData.

export interface Pt {
  x: number;
  y: number;
}

export interface PixelBuf {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// Matriz 3x3 en fila: [h0 h1 h2; h3 h4 h5; h6 h7 h8].
export type Mat3 = number[];

// Resuelve A·x = b por eliminación gaussiana con pivote parcial. null si es singular.
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Homografía H tal que H·src[i] = dst[i] para 4 pares de puntos. null si es degenerada.
export function homography(src: Pt[], dst: Pt[]): Mat3 | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

export function applyH(H: Mat3, x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

export function invertMat3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Tamaño natural de salida de un cuadrilátero (TL, TR, BR, BL): lados opuestos más largos.
export function quadOutputSize(q: Pt[]): { w: number; h: number } {
  return {
    w: Math.max(dist(q[0], q[1]), dist(q[3], q[2])),
    h: Math.max(dist(q[0], q[3]), dist(q[1], q[2])),
  };
}

// ¿El cuadrilátero es convexo y no degenerado? (orden TL, TR, BR, BL)
export function isConvexQuad(q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) return false;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function sampleBilinear(src: PixelBuf, x: number, y: number, out: Uint8ClampedArray, o: number) {
  const { width: w, height: h, data } = src;
  // Centro de píxel: la coordenada (0.5, 0.5) cae justo en el píxel (0,0).
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const px = Math.min(w - 1, Math.max(0, x0 + i));
      const py = Math.min(h - 1, Math.max(0, y0 + j));
      const wt = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
      const k = (py * w + px) * 4;
      const al = data[k + 3] * wt; // premultiplicado para no sangrar color transparente
      r += data[k] * al;
      g += data[k + 1] * al;
      b += data[k + 2] * al;
      a += al;
    }
  }
  if (a <= 0) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  out[o] = r / a;
  out[o + 1] = g / a;
  out[o + 2] = b / a;
  out[o + 3] = a;
}

// Rellena un buffer de salida outW×outH: cada píxel de salida se lee de `src` en outToSrc(píxel).
// Fuera del origen = transparente.
export function warpWithMatrix(
  src: PixelBuf,
  outToSrc: Mat3,
  outW: number,
  outH: number,
): PixelBuf {
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyH(outToSrc, x + 0.5, y + 0.5);
      if (!isFinite(p.x + p.y) || p.x < 0 || p.y < 0 || p.x > src.width || p.y > src.height) {
        continue; // transparente
      }
      sampleBilinear(src, p.x, p.y, out, (y * outW + x) * 4);
    }
  }
  return { data: out, width: outW, height: outH };
}

// Endereza el cuadrilátero `quad` (TL, TR, BR, BL en píxeles del origen) a un rectángulo outW×outH.
export function warpPerspective(src: PixelBuf, quad: Pt[], outW: number, outH: number): PixelBuf | null {
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const H = homography(rect, quad); // salida → origen
  if (!H) return null;
  return warpWithMatrix(src, H, outW, outH);
}

// Inverso: deforma todo `src` para que sus esquinas caigan sobre `quad` (en un lienzo outW×outH).
export function warpToQuad(src: PixelBuf, quad: Pt[], outW: number, outH: number): PixelBuf | null {
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: src.width, y: 0 },
    { x: src.width, y: src.height },
    { x: 0, y: src.height },
  ];
  const H = homography(quad, rect); // salida → origen
  if (!H) return null;
  return warpWithMatrix(src, H, outW, outH);
}
