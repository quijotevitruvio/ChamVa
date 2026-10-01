// Herramientas de color puras: conversiones, armonías, contraste y paleta de una imagen.

export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface HSL {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const x = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${x(r)}${x(g)}${x(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const rotate = (hsl: HSL, deg: number): string =>
  rgbToHex(hslToRgb({ ...hsl, h: hsl.h + deg }));

export interface Harmonies {
  complementario: string[];
  analogos: string[];
  triada: string[];
  tetrada: string[];
  complementarioDividido: string[];
  monocromatico: string[];
}

// Cada familia incluye el color base (en su posición natural).
export function harmonies(hex: string): Harmonies {
  const rgb = hexToRgb(hex) ?? { r: 255, g: 255, b: 255 };
  const base = rgbToHex(rgb);
  const hsl = rgbToHsl(rgb);
  const mono = [0.15, 0.3, 0.5, 0.7, 0.85].map((l) =>
    rgbToHex(hslToRgb({ ...hsl, l })),
  );
  return {
    complementario: [base, rotate(hsl, 180)],
    analogos: [rotate(hsl, -30), base, rotate(hsl, 30)],
    triada: [base, rotate(hsl, 120), rotate(hsl, 240)],
    tetrada: [base, rotate(hsl, 90), rotate(hsl, 180), rotate(hsl, 270)],
    complementarioDividido: [base, rotate(hsl, 150), rotate(hsl, 210)],
    monocromatico: mono,
  };
}

export const HARMONY_LABELS: Record<keyof Harmonies, string> = {
  complementario: 'Complementario',
  analogos: 'Análogos',
  triada: 'Tríada',
  tetrada: 'Tétrada',
  complementarioDividido: 'Complementario dividido',
  monocromatico: 'Monocromático',
};

// Luminancia relativa WCAG.
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Blanco o negro, el que más contraste dé sobre `hex`.
export function readableOn(hex: string): '#ffffff' | '#000000' {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#000000')
    ? '#ffffff'
    : '#000000';
}

interface Px {
  r: number;
  g: number;
  b: number;
}

// Paleta dominante por mediana de cortes sobre una versión reducida (<=128px).
// Ignora píxeles casi transparentes; ordena por frecuencia; colores distintos entre sí.
export function extractPalette(
  imageData: { data: ArrayLike<number>; width: number; height: number },
  n = 6,
): string[] {
  const { data, width, height } = imageData;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 128));
  const pixels: Px[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  if (pixels.length === 0 || n <= 0) return [];

  let boxes: Px[][] = [pixels];
  // Pedimos más cajas que n para poder descartar casi-duplicados.
  const target = n * 2;
  while (boxes.length < target) {
    // La caja con más píxeles y rango > 0.
    let bi = -1;
    let best = 1;
    boxes.forEach((b, i) => {
      if (b.length > best && range(b).span > 0) {
        best = b.length;
        bi = i;
      }
    });
    if (bi < 0) break;
    const box = boxes[bi];
    const { ch } = range(box);
    box.sort((p, q) => p[ch] - q[ch]);
    // Corte en la frontera de valor más cercana a la mediana (evita partir bloques planos).
    let mid = box.length >> 1;
    for (let d = 0; d < box.length; d++) {
      const lo = mid - d;
      const hi = mid + d;
      if (lo > 0 && box[lo][ch] !== box[lo - 1][ch]) {
        mid = lo;
        break;
      }
      if (hi < box.length && hi > 0 && box[hi][ch] !== box[hi - 1][ch]) {
        mid = hi;
        break;
      }
    }
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
    boxes = boxes.filter((b) => b.length > 0);
  }

  const entries = boxes
    .map((b) => {
      const sum = b.reduce(
        (a, p) => ({ r: a.r + p.r, g: a.g + p.g, b: a.b + p.b }),
        { r: 0, g: 0, b: 0 },
      );
      return {
        rgb: { r: sum.r / b.length, g: sum.g / b.length, b: sum.b / b.length },
        count: b.length,
      };
    })
    .sort((a, b) => b.count - a.count);

  const out: RGB[] = [];
  for (const e of entries) {
    if (out.length >= n) break;
    const far = out.every((o) => dist(o, e.rgb) > 24);
    if (far) out.push(e.rgb);
  }
  return out.map(rgbToHex);
}

function range(b: Px[]): { ch: 'r' | 'g' | 'b'; span: number } {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const p of b) {
    if (p.r < rMin) rMin = p.r;
    if (p.r > rMax) rMax = p.r;
    if (p.g < gMin) gMin = p.g;
    if (p.g > gMax) gMax = p.g;
    if (p.b < bMin) bMin = p.b;
    if (p.b > bMax) bMax = p.b;
  }
  const dr = rMax - rMin;
  const dg = gMax - gMin;
  const db = bMax - bMin;
  if (dr >= dg && dr >= db) return { ch: 'r', span: dr };
  if (dg >= db) return { ch: 'g', span: dg };
  return { ch: 'b', span: db };
}

function dist(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}
