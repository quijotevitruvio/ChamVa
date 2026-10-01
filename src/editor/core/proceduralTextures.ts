// Texturas y superposiciones procedurales (sin imágenes): papel, grano de película,
// polvo y rayones, bokeh, luz de fuga y trama de lienzo. Deterministas por semilla.
// Devuelven RGBA opaco pensado para fusionarse (overlay / screen / multiply...).
import type { FxBlend, FxTexture } from './types';

export const TEXTURE_KINDS: { id: FxTexture; label: string; mode: FxBlend }[] = [
  { id: 'paper', label: 'Papel', mode: 'overlay' },
  { id: 'film', label: 'Grano de película', mode: 'overlay' },
  { id: 'dust', label: 'Polvo y rayones', mode: 'screen' },
  { id: 'bokeh', label: 'Bokeh', mode: 'screen' },
  { id: 'leak', label: 'Luz de fuga', mode: 'screen' },
  { id: 'canvas', label: 'Lienzo / tela', mode: 'overlay' },
];

export function defaultTextureMode(kind: FxTexture): FxBlend {
  return TEXTURE_KINDS.find((k) => k.id === kind)?.mode ?? 'overlay';
}

// Hash entero → [0,1)
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Ruido de valor suave con `cells` celdas a lo ancho del lado `size`.
function vnoise(x: number, y: number, period: number, seed: number): number {
  const fx = x / period;
  const fy = y / period;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const c255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Genera una textura w×h. `scale` (0.5..3) agranda o reduce el detalle.
export function generateTexture(kind: FxTexture, w: number, h: number, seed = 1, scale = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const sc = Math.max(0.25, Math.min(4, scale || 1));
  const longest = Math.max(w, h);
  const set = (i: number, r: number, g: number, b: number) => {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  };

  if (kind === 'paper' || kind === 'film' || kind === 'canvas') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let v = 128;
        if (kind === 'paper') {
          v += (vnoise(x, y, 90 * sc, seed) - 0.5) * 34;
          v += (vnoise(x, y, 14 * sc, seed + 7) - 0.5) * 30;
          v += (vnoise(x * 0.25, y, 3 * sc, seed + 13) - 0.5) * 22; // fibras
          v += (hash(x, y, seed + 3) - 0.5) * 26;
        } else if (kind === 'film') {
          v += (hash(x, y, seed) + hash(x, y, seed + 99) - 1) * 120;
        } else {
          const p = 7 * sc;
          const tx = Math.sin((2 * Math.PI * x) / p);
          const ty = Math.sin((2 * Math.PI * y) / p);
          v += tx * ty * 38 + (Math.sin((2 * Math.PI * x) / (p * 8)) * 6);
          v += (hash(x >> 1, y >> 1, seed) - 0.5) * 36;
          v += (vnoise(x, y, 60 * sc, seed + 5) - 0.5) * 20;
        }
        v = c255(v);
        set(i, v, kind === 'paper' ? v - 1 : v, kind === 'paper' ? v - 6 : v);
      }
    }
    return out;
  }

  // Fondos negros sobre los que se suma luz.
  for (let i = 0; i < out.length; i += 4) out[i + 3] = 255;
  const rnd = mulberry32(seed * 7919 + 13);

  // Suma (screen simple) de un color con intensidad en un píxel.
  const add = (x: number, y: number, r: number, g: number, b: number, k: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || k <= 0) return;
    const i = (y * w + x) * 4;
    out[i] = c255(out[i] + r * k);
    out[i + 1] = c255(out[i + 1] + g * k);
    out[i + 2] = c255(out[i + 2] + b * k);
  };

  if (kind === 'dust') {
    const specks = Math.round(((w * h) / 3500) * sc * 0.6);
    for (let n = 0; n < specks; n++) {
      const cx = rnd() * w;
      const cy = rnd() * h;
      const rad = (0.5 + rnd() * rnd() * 2.6) * sc;
      const br = 0.45 + rnd() * 0.55;
      const x0 = Math.floor(cx - rad - 1);
      const y0 = Math.floor(cy - rad - 1);
      for (let y = y0; y <= cy + rad + 1; y++)
        for (let x = x0; x <= cx + rad + 1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          add(x, y, 255, 255, 255, br * Math.max(0, Math.min(1, rad + 0.5 - d)));
        }
    }
    const scratches = Math.max(2, Math.round(longest / 140));
    for (let n = 0; n < scratches; n++) {
      let x = rnd() * w;
      let y = rnd() * h * 0.8;
      const len = (0.1 + rnd() * 0.5) * h;
      const drift = (rnd() - 0.5) * 0.04;
      const br = 0.25 + rnd() * 0.5;
      for (let s = 0; s < len; s++) {
        add(Math.round(x), Math.round(y), 255, 250, 240, br * (0.6 + 0.4 * rnd()));
        x += drift + (rnd() - 0.5) * 0.3;
        y += 1;
      }
    }
    return out;
  }

  if (kind === 'bokeh') {
    const palette: [number, number, number][] = [
      [255, 214, 140],
      [255, 170, 120],
      [255, 240, 200],
      [150, 200, 255],
      [255, 190, 220],
    ];
    const count = Math.round(16 * Math.max(0.5, Math.min(2, 1 / sc + 0.3)));
    const m = Math.min(w, h);
    for (let n = 0; n < count; n++) {
      const cx = rnd() * w;
      const cy = rnd() * h;
      const rad = m * (0.03 + rnd() * 0.08) * sc;
      const col = palette[Math.floor(rnd() * palette.length)];
      const k = 0.18 + rnd() * 0.3;
      const x0 = Math.max(0, Math.floor(cx - rad - 1));
      const x1 = Math.min(w - 1, Math.ceil(cx + rad + 1));
      const y0 = Math.max(0, Math.floor(cy - rad - 1));
      const y1 = Math.min(h - 1, Math.ceil(cy + rad + 1));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rad;
          if (d > 1.04) continue;
          const edge = d > 0.88 ? 1.5 : 1; // aro más brillante
          const fall = Math.max(0, Math.min(1, (1.04 - d) / 0.06));
          add(x, y, col[0], col[1], col[2], k * edge * fall);
        }
    }
    return out;
  }

  // leak: manchas grandes y cálidas desde los bordes
  const blobs = 3;
  const m = Math.max(w, h);
  for (let n = 0; n < blobs; n++) {
    const edge = Math.floor(rnd() * 4);
    const cx = edge === 0 ? -0.05 * w : edge === 1 ? 1.05 * w : rnd() * w;
    const cy = edge === 2 ? -0.05 * h : edge === 3 ? 1.05 * h : rnd() * h;
    const rad = m * (0.35 + rnd() * 0.35) * sc;
    const col: [number, number, number] = n === 0 ? [255, 120, 40] : n === 1 ? [255, 200, 90] : [255, 70, 90];
    const k = 0.55 + rnd() * 0.4;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d >= 1) continue;
        const f = (1 - d) * (1 - d);
        add(x, y, col[0], col[1], col[2], k * f);
      }
  }
  return out;
}
