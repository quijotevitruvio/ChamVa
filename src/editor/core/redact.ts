// Censurar zona: pixelar, desenfocar o tapar con barra negra una región (rectángulo o elipse).
// Lógica pura (sin DOM): opera sobre buffers compatibles con ImageData.

export interface PixelBuf {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type RedactMode = 'pixelate' | 'blur' | 'bar';
export type RedactShape = 'rect' | 'ellipse';

export interface RedactRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Intensidad (1..100) → tamaño de bloque del pixelado, relativo al lado mayor de la imagen.
export function blockSize(intensity: number, longest: number): number {
  return Math.max(2, Math.round((longest * Math.max(1, intensity)) / 600) + 1);
}

// Intensidad (1..100) → radio del desenfoque, relativo al lado mayor de la imagen.
export function blurRadius(intensity: number, longest: number): number {
  return Math.max(2, Math.round((longest * Math.max(1, intensity)) / 500) + 1);
}

// Margen de píxeles extra que necesita leerse alrededor de la zona para el modo dado.
export function redactMargin(mode: RedactMode, intensity: number, longest: number): number {
  return mode === 'blur' ? blurRadius(intensity, longest) * 2 : 0;
}

// ¿El píxel (px, py) (centro) está dentro de la forma inscrita en `r`?
function inside(shape: RedactShape, r: RedactRect, px: number, py: number): boolean {
  if (px < r.x || py < r.y || px >= r.x + r.w || py >= r.y + r.h) return false;
  if (shape === 'rect') return true;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const dx = (px + 0.5 - (r.x + rx)) / rx;
  const dy = (py + 0.5 - (r.y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}

function clampRect(img: PixelBuf, r: RedactRect): RedactRect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.w));
  const y1 = Math.min(img.height, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Pixelado: cada celda de la cuadrícula (anclada al origen de la zona) toma su color medio.
export function pixelate(img: PixelBuf, rect: RedactRect, shape: RedactShape, block: number): void {
  const r = clampRect(img, rect);
  if (!r) return;
  const b = Math.max(1, Math.round(block));
  const { data, width } = img;
  for (let by = r.y; by < r.y + r.h; by += b) {
    for (let bx = r.x; bx < r.x + r.w; bx += b) {
      const x1 = Math.min(bx + b, r.x + r.w);
      const y1 = Math.min(by + b, r.y + r.h);
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const k = (y * width + x) * 4;
          const a = data[k + 3];
          sr += data[k] * a;
          sg += data[k + 1] * a;
          sb += data[k + 2] * a;
          sa += a;
          n++;
        }
      }
      if (!n) continue;
      const alpha = sa / n;
      const R = sa ? sr / sa : 0;
      const G = sa ? sg / sa : 0;
      const B = sa ? sb / sa : 0;
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          if (!inside(shape, rect, x, y)) continue;
          const k = (y * width + x) * 4;
          data[k] = R;
          data[k + 1] = G;
          data[k + 2] = B;
          data[k + 3] = alpha;
        }
      }
    }
  }
}

// Una pasada de desenfoque de caja separable sobre la región [r] (lee con bordes fijados).
function boxBlurRegion(img: PixelBuf, r: RedactRect, radius: number): void {
  const { data, width } = img;
  const rad = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(r.w * r.h * 4);
  const win = rad * 2 + 1;
  // Horizontal: img → tmp (premultiplicado por alfa).
  for (let y = 0; y < r.h; y++) {
    const yy = r.y + y;
    for (let x = 0; x < r.w; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let k = -rad; k <= rad; k++) {
        const xx = Math.min(width - 1, Math.max(0, r.x + x + k));
        const i = (yy * width + xx) * 4;
        const a = data[i + 3];
        sr += data[i] * a;
        sg += data[i + 1] * a;
        sb += data[i + 2] * a;
        sa += a;
      }
      const o = (y * r.w + x) * 4;
      tmp[o] = sr / win;
      tmp[o + 1] = sg / win;
      tmp[o + 2] = sb / win;
      tmp[o + 3] = sa / win;
    }
  }
  // Vertical: tmp → img.
  for (let x = 0; x < r.w; x++) {
    for (let y = 0; y < r.h; y++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let k = -rad; k <= rad; k++) {
        const yy = Math.min(r.h - 1, Math.max(0, y + k));
        const o = (yy * r.w + x) * 4;
        sr += tmp[o];
        sg += tmp[o + 1];
        sb += tmp[o + 2];
        sa += tmp[o + 3];
      }
      const i = ((r.y + y) * width + (r.x + x)) * 4;
      const a = sa / win;
      data[i + 3] = a;
      if (a > 0) {
        data[i] = sr / win / a || 0;
        data[i + 1] = sg / win / a || 0;
        data[i + 2] = sb / win / a || 0;
      }
    }
  }
}

// Desenfoque (3 pasadas de caja ≈ gaussiano) restringido a la forma. Lee píxeles fuera de la
// zona (hasta `radius*2`) para que el borde se funda con el entorno.
export function blurRegion(img: PixelBuf, rect: RedactRect, shape: RedactShape, radius: number): void {
  const r = clampRect(img, rect);
  if (!r) return;
  const rad = Math.max(1, Math.round(radius));
  // Trabajo sobre una copia de la zona + margen y se vuelca solo lo que cae dentro de la forma.
  const m = rad * 2;
  const wr = clampRect(img, { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 })!;
  const copy: PixelBuf = {
    width: wr.w,
    height: wr.h,
    data: new Uint8ClampedArray(wr.w * wr.h * 4),
  };
  for (let y = 0; y < wr.h; y++) {
    const s = ((wr.y + y) * img.width + wr.x) * 4;
    copy.data.set(img.data.subarray(s, s + wr.w * 4), y * wr.w * 4);
  }
  const full = { x: 0, y: 0, w: wr.w, h: wr.h };
  const per = Math.max(1, Math.round(rad / 1.7));
  for (let i = 0; i < 3; i++) boxBlurRegion(copy, full, per);
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!inside(shape, rect, x, y)) continue;
      const s = ((y - wr.y) * wr.w + (x - wr.x)) * 4;
      const d = (y * img.width + x) * 4;
      img.data[d] = copy.data[s];
      img.data[d + 1] = copy.data[s + 1];
      img.data[d + 2] = copy.data[s + 2];
      img.data[d + 3] = copy.data[s + 3];
    }
  }
}

// Barra opaca del color dado (por defecto negro) sobre la forma.
export function blackBar(
  img: PixelBuf,
  rect: RedactRect,
  shape: RedactShape,
  color: [number, number, number] = [0, 0, 0],
): void {
  const r = clampRect(img, rect);
  if (!r) return;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!inside(shape, rect, x, y)) continue;
      const k = (y * img.width + x) * 4;
      img.data[k] = color[0];
      img.data[k + 1] = color[1];
      img.data[k + 2] = color[2];
      img.data[k + 3] = 255;
    }
  }
}

// Punto de entrada: aplica el modo con intensidad 1..100 (relativa al lado mayor `longest`).
export function redactRegion(
  img: PixelBuf,
  rect: RedactRect,
  shape: RedactShape,
  mode: RedactMode,
  intensity: number,
  longest = Math.max(img.width, img.height),
): void {
  if (mode === 'pixelate') pixelate(img, rect, shape, blockSize(intensity, longest));
  else if (mode === 'blur') blurRegion(img, rect, shape, blurRadius(intensity, longest));
  else blackBar(img, rect, shape);
}
