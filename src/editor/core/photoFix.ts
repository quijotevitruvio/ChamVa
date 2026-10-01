// Correcciones de foto por píxel: reducir ruido, quitar neblina y corregir la lente.
// Funciones puras sobre arrays tipados (respetan el alfa); las llama processImage.

type PixelData = Pick<ImageData, 'data' | 'width' | 'height'>;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// Reducir ruido: filtro bilateral (conserva bordes) con luminancia y color por separado
// ---------------------------------------------------------------------------

// Bilateral conjunto: promedia `chans` con pesos espaciales (gauss) y de rango (distancia en `guides`).
function bilateral(
  chans: Float32Array[],
  guides: Float32Array[],
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  step: number,
  sigmaS: number,
  sigmaR: number,
): Float32Array[] {
  const offs: { dx: number; dy: number; ws: number }[] = [];
  for (let dy = -r; dy <= r; dy += step)
    for (let dx = -r; dx <= r; dx += step)
      offs.push({ dx, dy, ws: Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS)) });
  const inv = 1 / (2 * sigmaR * sigmaR);
  const k = chans.length;
  const g = guides.length;
  const out = chans.map(() => new Float32Array(w * h));
  const acc = new Float64Array(k);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (alpha[p * 4 + 3] < 16) {
        for (let c = 0; c < k; c++) out[c][p] = chans[c][p];
        continue;
      }
      acc.fill(0);
      let wsum = 0;
      for (let o = 0; o < offs.length; o++) {
        const qx = x + offs[o].dx;
        const qy = y + offs[o].dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = qy * w + qx;
        if (alpha[q * 4 + 3] < 16) continue;
        let dist = 0;
        for (let c = 0; c < g; c++) {
          const df = guides[c][q] - guides[c][p];
          dist += df * df;
        }
        const wt = offs[o].ws * Math.exp(-dist * inv);
        wsum += wt;
        for (let c = 0; c < k; c++) acc[c] += chans[c][q] * wt;
      }
      for (let c = 0; c < k; c++) out[c][p] = wsum > 0 ? acc[c] / wsum : chans[c][p];
    }
  }
  return out;
}

// luma / color: 0..100. Convierte a luminancia + diferencias de color y filtra cada parte.
export function applyDenoise(img: PixelData, luma: number, color: number) {
  const lm = clamp01(luma / 100);
  const cm = clamp01(color / 100);
  if (lm <= 0 && cm <= 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const N = w * h;
  let Y = new Float32Array(N);
  let Cb = new Float32Array(N);
  let Cr = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    Y[p] = y;
    Cb[p] = d[i + 2] - y;
    Cr[p] = d[i] - y;
  }
  if (cm > 0) {
    // El color se promedia en un radio mayor, guiado por luminancia y color para no sangrar.
    const [cb, cr] = bilateral([Cb, Cr], [Y, Cb, Cr], d, w, h, 4, 2, 3, 6 + cm * 54);
    Cb = cb;
    Cr = cr;
  }
  if (lm > 0) {
    const [y2] = bilateral([Y], [Y], d, w, h, lm > 0.5 ? 3 : 2, 1, lm > 0.5 ? 2 : 1.5, 3 + lm * 37);
    Y = y2;
  }
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (d[i + 3] === 0) continue;
    const y = Y[p];
    const r = y + Cr[p];
    const b = y + Cb[p];
    d[i] = r;
    d[i + 1] = (y - 0.299 * r - 0.114 * b) / 0.587;
    d[i + 2] = b;
  }
}

// ---------------------------------------------------------------------------
// Quitar neblina (canal oscuro simplificado)
// ---------------------------------------------------------------------------

// Filtro de mínimo separable (ventana cuadrada de radio r).
function minFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      const a = Math.max(0, x - r);
      const b = Math.min(w - 1, x + r);
      for (let k = a; k <= b; k++) if (src[row + k] < m) m = src[row + k];
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = Infinity;
      const a = Math.max(0, y - r);
      const b = Math.min(h - 1, y + r);
      for (let k = a; k <= b; k++) if (tmp[k * w + x] < m) m = tmp[k * w + x];
      out[y * w + x] = m;
    }
  }
  return out;
}

// Desenfoque de caja separable por ventana deslizante (suaviza el mapa de transmisión).
function boxSmooth(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    let cnt = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) {
      sum += src[row + x];
      cnt++;
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / cnt;
      const add = x + r + 1;
      const rem = x - r;
      if (add < w) {
        sum += src[row + add];
        cnt++;
      }
      if (rem >= 0) {
        sum -= src[row + rem];
        cnt--;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let cnt = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) {
      sum += tmp[y * w + x];
      cnt++;
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / cnt;
      const add = y + r + 1;
      const rem = y - r;
      if (add < h) {
        sum += tmp[add * w + x];
        cnt++;
      }
      if (rem >= 0) {
        sum -= tmp[rem * w + x];
        cnt--;
      }
    }
  }
  return out;
}

// amount 0..100. Estima la luz de la bruma (A) y la transmisión por píxel y recupera J = (I - A) / t + A.
export function applyDehaze(img: PixelData, amount: number, scale = 1) {
  if (amount <= 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;
  const N = w * h;
  const rr = Math.max(1, Math.round(6 * scale));
  const strength = clamp01(amount / 100) * 0.95;

  // Canal oscuro: mínimo de RGB y luego mínimo local. Los píxeles transparentes cuentan como claros.
  const mn = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4)
    mn[p] = d[i + 3] === 0 ? 255 : Math.min(d[i], d[i + 1], d[i + 2]);
  const dark = minFilter(mn, w, h, rr);

  // Luz atmosférica: media de los píxeles opacos con canal oscuro en el 0,1 % superior.
  const hist = new Uint32Array(256);
  let opaque = 0;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (d[i + 3] === 0) continue;
    hist[Math.min(255, Math.round(dark[p]))]++;
    opaque++;
  }
  if (opaque === 0) return;
  const want = Math.max(1, Math.round(opaque * 0.001));
  let acc = 0;
  let thr = 255;
  for (; thr > 0; thr--) {
    acc += hist[thr];
    if (acc >= want) break;
  }
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let cnt = 0;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (d[i + 3] === 0 || Math.round(dark[p]) < thr) continue;
    ar += d[i];
    ag += d[i + 1];
    ab += d[i + 2];
    cnt++;
  }
  const A = [Math.max(90, ar / cnt), Math.max(90, ag / cnt), Math.max(90, ab / cnt)];

  // Transmisión: t = 1 - strength * mínimo local de min_c(I_c / A_c), suavizada.
  const norm = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4)
    norm[p] = d[i + 3] === 0 ? 1 : Math.min(d[i] / A[0], d[i + 1] / A[1], d[i + 2] / A[2]);
  const tRaw = minFilter(norm, w, h, rr);
  for (let p = 0; p < N; p++) tRaw[p] = 1 - strength * Math.min(1, tRaw[p]);
  const t = boxSmooth(tRaw, w, h, rr * 2);

  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (d[i + 3] === 0) continue;
    const tt = Math.max(0.25, t[p]);
    d[i] = (d[i] - A[0]) / tt + A[0];
    d[i + 1] = (d[i + 1] - A[1]) / tt + A[1];
    d[i + 2] = (d[i + 2] - A[2]) / tt + A[2];
  }
}

// ---------------------------------------------------------------------------
// Corregir distorsión de lente (remapeo radial) y viñeteo
// ---------------------------------------------------------------------------

// distortion -100..100: + corrige barril (estira los bordes), - corrige cojín (los comprime con zoom
// automático para no dejar bordes vacíos). vignette 0..100: aclara los bordes (corrige viñeteo).
export function applyLens(img: PixelData, distortion: number, vignette: number) {
  const dist = Math.max(-100, Math.min(100, distortion)) / 100;
  const vig = clamp01(vignette / 100);
  if (dist === 0 && vig === 0) return;
  const { width: w, height: h } = img;
  const d = img.data as Uint8ClampedArray;

  if (dist !== 0) {
    const src = new Uint8ClampedArray(d); // copia: la salida se lee de aquí
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const rmax = Math.sqrt(cx * cx + cy * cy) || 1;
    const k = -dist * 0.5; // k<0 → fuente más cerca del centro (corrige barril)
    const zoom = k > 0 ? 1 / (1 + k) : 1; // cojín: evita salirse de la imagen
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = ((x - cx) / rmax) * zoom;
        const ny = ((y - cy) / rmax) * zoom;
        const f = 1 + k * (nx * nx + ny * ny);
        let sx = cx + nx * f * rmax;
        let sy = cy + ny * f * rmax;
        sx = sx < 0 ? 0 : sx > w - 1 ? w - 1 : sx;
        sy = sy < 0 ? 0 : sy > h - 1 ? h - 1 : sy;
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = Math.min(w - 1, x0 + 1);
        const y1 = Math.min(h - 1, y0 + 1);
        const fx = sx - x0;
        const fy = sy - y0;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const i00 = (y0 * w + x0) * 4;
        const i10 = (y0 * w + x1) * 4;
        const i01 = (y1 * w + x0) * 4;
        const i11 = (y1 * w + x1) * 4;
        const a00 = src[i00 + 3] * w00;
        const a10 = src[i10 + 3] * w10;
        const a01 = src[i01 + 3] * w01;
        const a11 = src[i11 + 3] * w11;
        const a = a00 + a10 + a01 + a11;
        const o = (y * w + x) * 4;
        if (a <= 0) {
          d[o + 3] = 0;
          continue;
        }
        for (let c = 0; c < 3; c++)
          d[o + c] = (src[i00 + c] * a00 + src[i10 + c] * a10 + src[i01 + c] * a01 + src[i11 + c] * a11) / a;
        d[o + 3] = a;
      }
    }
  }

  if (vig > 0) {
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const rmax = Math.sqrt(cx * cx + cy * cy) || 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const rn = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / rmax;
        const gain = 1 + vig * 0.8 * rn * rn * rn * rn;
        const o = (y * w + x) * 4;
        d[o] *= gain;
        d[o + 1] *= gain;
        d[o + 2] *= gain;
      }
    }
  }
}
