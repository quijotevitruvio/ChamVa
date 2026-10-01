import type { HslFamily, HslMix } from './types';

type PixelData = Pick<ImageData, 'data' | 'width' | 'height'>;

// Las 8 familias, con el tono central (grados) de cada una.
export const HSL_FAMILIES: { id: HslFamily; label: string; hue: number; swatch: string }[] = [
  { id: 'red', label: 'Rojos', hue: 0, swatch: '#ff0000' },
  { id: 'orange', label: 'Naranjas', hue: 30, swatch: '#ff8000' },
  { id: 'yellow', label: 'Amarillos', hue: 60, swatch: '#ffd400' },
  { id: 'green', label: 'Verdes', hue: 120, swatch: '#00b32d' },
  { id: 'aqua', label: 'Aguas', hue: 180, swatch: '#00c8c8' },
  { id: 'blue', label: 'Azules', hue: 240, swatch: '#0040ff' },
  { id: 'purple', label: 'Morados', hue: 275, swatch: '#8a2be2' },
  { id: 'magenta', label: 'Magentas', hue: 320, swatch: '#e000a0' },
];

const MAX_HUE_SHIFT = 30; // ±100 = ±30°

export function hasHslMix(mix: HslMix | undefined): boolean {
  if (!mix) return false;
  for (const f of HSL_FAMILIES) {
    const s = mix[f.id];
    if (s && ((s.h ?? 0) !== 0 || (s.s ?? 0) !== 0 || (s.l ?? 0) !== 0)) return true;
  }
  return false;
}

// Peso de cada familia para un tono (grados): interpolación entre las dos familias vecinas
// (la suma siempre es 1, así que no hay saltos entre familias).
export function familyWeights(hue: number): number[] {
  const h = ((hue % 360) + 360) % 360;
  const nF = HSL_FAMILIES.length;
  const w = new Array<number>(nF).fill(0);
  for (let i = 0; i < nF; i++) {
    const a = HSL_FAMILIES[i].hue;
    const jn = (i + 1) % nF;
    const b = jn === 0 ? 360 : HSL_FAMILIES[jn].hue;
    if (h >= a && h < b) {
      const t = (h - a) / (b - a);
      const s = t * t * (3 - 2 * t);
      w[i] = 1 - s;
      w[jn] = s;
      return w;
    }
  }
  w[0] = 1;
  return w;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// Mezclador por color: tono, saturación y luminosidad por familia. Los grises no cambian.
export function applyHslMix(img: PixelData, mix: HslMix | undefined) {
  if (!hasHslMix(mix)) return;
  // Tablas por grado de tono con la suma ponderada de las 8 familias.
  const dh = new Float32Array(360);
  const ds = new Float32Array(360);
  const dl = new Float32Array(360);
  for (let deg = 0; deg < 360; deg++) {
    const w = familyWeights(deg);
    for (let i = 0; i < HSL_FAMILIES.length; i++) {
      const s = mix![HSL_FAMILIES[i].id];
      if (!s) continue;
      dh[deg] += w[i] * ((s.h ?? 0) / 100);
      ds[deg] += w[i] * ((s.s ?? 0) / 100);
      dl[deg] += w[i] * ((s.l ?? 0) / 100);
    }
  }
  const d = img.data as Uint8ClampedArray;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (s === 0) continue;
    const deg = Math.min(359, Math.floor(h));
    const gate = Math.min(1, s * 4); // casi-grises casi no se tocan
    const kh = dh[deg] * gate;
    const ks = ds[deg] * gate;
    const kl = dl[deg] * gate;
    if (kh === 0 && ks === 0 && kl === 0) continue;
    const h2 = h + kh * MAX_HUE_SHIFT;
    const s2 = ks >= 0 ? s + (1 - s) * ks : s * (1 + ks);
    const l2 = kl >= 0 ? l + (1 - l) * kl * 0.6 : l * (1 + kl * 0.6);
    const [r, g, b] = hslToRgb(h2, Math.min(1, Math.max(0, s2)), Math.min(1, Math.max(0, l2)));
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}
