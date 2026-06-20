import { DEFAULT_ADJUST, type ImageAdjust } from './types';

export interface FilterDef {
  id: string;
  label: string;
  css?: string; // filtro CSS (ctx.filter)
  overlay?: { color: string; alpha: number }; // tinte (source-atop)
  duotone?: { shadow: string; highlight: string }; // mapeo de luminancia a 2 colores
}

export interface FilterCategory {
  name: string;
  filters: FilterDef[];
}

const D = (id: string, label: string, shadow: string, highlight: string): FilterDef => ({
  id,
  label,
  duotone: { shadow, highlight },
});

export const FILTER_CATEGORIES: FilterCategory[] = [
  {
    name: 'Natural',
    filters: [
      { id: 'none', label: 'Original' },
      { id: 'fresco', label: 'Fresco', css: 'contrast(1.05) saturate(1.12) brightness(1.03)' },
      { id: 'flint', label: 'Flint', css: 'contrast(1.1) saturate(0.9) sepia(0.1)' },
      { id: 'luna', label: 'Luna', css: 'contrast(1.1) brightness(1.05) saturate(0.85) hue-rotate(-8deg)' },
      { id: 'aero', label: 'Aero', css: 'brightness(1.05) contrast(0.95) saturate(1.05)' },
      { id: 'myst', label: 'Myst', css: 'contrast(1.05) saturate(0.9) hue-rotate(6deg) brightness(0.98)' },
    ],
  },
  {
    name: 'Cálido',
    filters: [
      { id: 'bali', label: 'Bali', css: 'sepia(0.25) saturate(1.3) brightness(1.05)' },
      { id: 'capri', label: 'Capri', css: 'sepia(0.15) saturate(1.4) contrast(1.05)' },
      { id: 'latte', label: 'Latte', css: 'sepia(0.4) saturate(1.2) brightness(1.05)' },
      { id: 'bronz', label: 'Bronz', css: 'sepia(0.5) saturate(1.3) contrast(1.05)' },
      { id: 'sandi', label: 'Sandi', css: 'sepia(0.3) saturate(1.5) brightness(1.03)', overlay: { color: '#ff8a3d', alpha: 0.08 } },
      { id: 'sangri', label: 'Sangri', css: 'sepia(0.2) saturate(1.6) contrast(1.05)', overlay: { color: '#ff5e62', alpha: 0.1 } },
    ],
  },
  {
    name: 'Frío',
    filters: [
      { id: 'scandi', label: 'Scandi', css: 'saturate(0.85) brightness(1.05) contrast(1.05) hue-rotate(10deg)' },
      { id: 'nordic', label: 'Nordic', css: 'saturate(0.9) brightness(1.05) hue-rotate(15deg)' },
      { id: 'astro', label: 'Astro', css: 'contrast(1.1) saturate(1.1) hue-rotate(20deg)' },
      { id: 'arctic', label: 'Arctic', css: 'brightness(1.1) contrast(0.95) saturate(0.8) hue-rotate(15deg)' },
      { id: 'polar', label: 'Polar', css: 'brightness(1.12) contrast(1.05) saturate(0.85) hue-rotate(10deg)' },
      { id: 'tundra', label: 'Tundra', css: 'saturate(1.1) hue-rotate(25deg)', overlay: { color: '#3fa9ff', alpha: 0.1 } },
    ],
  },
  {
    name: 'Vívido',
    filters: [
      { id: 'chroma', label: 'Chroma', css: 'saturate(1.6) contrast(1.15)' },
      { id: 'rustiq', label: 'Rustiq', css: 'saturate(1.4) contrast(1.2) sepia(0.15)' },
      { id: 'eldar', label: 'Eldar', css: 'saturate(1.5) contrast(1.1) hue-rotate(-10deg)' },
      { id: 'zeal', label: 'Zeal', css: 'saturate(1.7) contrast(1.2) hue-rotate(10deg)' },
      { id: 'aria', label: 'Aria', css: 'saturate(1.5) brightness(1.05) contrast(1.1)' },
      { id: 'stark', label: 'Stark', css: 'contrast(1.4) saturate(1.2) brightness(0.97)' },
    ],
  },
  {
    name: 'Suave',
    filters: [
      { id: 'aura', label: 'Aura', css: 'brightness(1.08) contrast(0.9) saturate(1.05) sepia(0.1)' },
      { id: 'hazel', label: 'Hazel', css: 'brightness(1.05) contrast(0.92) saturate(0.95) sepia(0.15)' },
      { id: 'whimsi', label: 'Whimsi', css: 'brightness(1.1) contrast(0.88) saturate(1.1)' },
      { id: 'rose', label: 'Rose', css: 'brightness(1.05) contrast(0.95) sepia(0.2)', overlay: { color: '#ff9ec2', alpha: 0.1 } },
      { id: 'oceanic', label: 'Oceanic', css: 'brightness(1.05) contrast(0.92) saturate(0.9) hue-rotate(10deg)' },
      { id: 'nimbus', label: 'Nimbus', css: 'brightness(1.08) contrast(0.9) saturate(0.85)' },
    ],
  },
  {
    name: 'Vintage',
    filters: [
      { id: 'vinto', label: 'Vinto', css: 'sepia(0.4) contrast(1.1) saturate(0.9) brightness(1.02)' },
      { id: 'fade', label: 'Fade', css: 'contrast(0.85) brightness(1.1) saturate(0.8) sepia(0.2)' },
      { id: 'antiq', label: 'Antiq', css: 'sepia(0.55) contrast(1.05) saturate(0.85)' },
      { id: 'nostalg', label: 'Nostalg', css: 'sepia(0.45) contrast(0.95) saturate(0.9) hue-rotate(-5deg)' },
      { id: 'dream', label: 'Dream', css: 'brightness(1.08) contrast(0.9) saturate(1.1) sepia(0.15)' },
      { id: 'retro', label: 'Retro', css: 'sepia(0.5) saturate(1.2) contrast(1.1) hue-rotate(-10deg)' },
    ],
  },
  {
    name: 'Mono',
    filters: [
      { id: 'classic', label: 'Classic', css: 'grayscale(1)' },
      { id: 'ink', label: 'Ink', css: 'grayscale(1) contrast(1.3)' },
      { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.5) brightness(0.95)' },
      { id: 'film', label: 'Film', css: 'grayscale(1) contrast(1.1) sepia(0.1) brightness(1.05)' },
      { id: 'newspaper', label: 'Newspaper', css: 'grayscale(1) contrast(1.4) brightness(1.1)' },
      { id: 'slate', label: 'Slate', css: 'grayscale(1) contrast(1.05) brightness(1.05)' },
      { id: 'invert', label: 'Invertir', css: 'invert(1)' },
    ],
  },
  {
    name: 'Color Pop',
    filters: [
      D('outrun', 'Outrun', '#20043d', '#ff8a00'),
      D('heatwave', 'Heatwave', '#00204a', '#ff2e2e'),
      D('amethyst', 'Amethyst', '#1a0b3d', '#7b5cff'),
      D('minty', 'Minty', '#102a1a', '#5cff9d'),
      { id: 'hibiscus', label: 'Hibiscus', css: 'saturate(1.8) contrast(1.3) hue-rotate(300deg)' },
      { id: 'poster', label: 'Poster', css: 'contrast(1.6) saturate(1.7) brightness(1.05)' },
      { id: 'xpro_minus', label: 'X-Pro −', css: 'saturate(1.3) contrast(1.2) hue-rotate(60deg) sepia(0.2)' },
      { id: 'xpro_plus', label: 'X-Pro +', css: 'sepia(0.4) saturate(1.6) contrast(1.2)' },
    ],
  },
  {
    name: 'Duotono',
    filters: [
      D('duo_cereza', 'Cereza', '#2a0010', '#ff3b6b'),
      D('duo_fucsia', 'Fucsia', '#2a0026', '#ff3df0'),
      D('duo_pop', 'Pop', '#14003d', '#b14bff'),
      D('duo_violeta', 'Violeta', '#1a0033', '#9b6bff'),
      D('duo_azulmar', 'Azul mar', '#001a40', '#3fa9ff'),
      D('duo_verdemar', 'Verde mar', '#002a1a', '#2bd47a'),
      D('duo_mostaza', 'Mostaza', '#2a2400', '#ffcf3f'),
      D('duo_ambar', 'Ámbar', '#2a1400', '#ff9a3f'),
      D('duo_pomelo', 'Pomelo', '#2a0010', '#ff7a59'),
      D('duo_rubor', 'Rubor', '#2a0018', '#ff8fb0'),
      D('duo_menta', 'Menta', '#002a26', '#5fe3c0'),
      D('duo_mistico', 'Místico', '#00203a', '#6fd0ff'),
      D('duo_pastel', 'Pasteles', '#cdbcff', '#fff0c7'),
      D('duo_coral', 'Coral', '#2a0d00', '#ff7a59'),
      D('duo_lavanda', 'Lavanda', '#1a1030', '#c0a8ff'),
      D('duo_atardecer', 'Atardecer', '#2a0a2a', '#ff9a7a'),
      D('duo_alba', 'Alba', '#2a1810', '#ffc0a0'),
      D('duo_mirto', 'Mirto', '#00200f', '#4fd07a'),
      D('duo_chocomenta', 'Choco menta', '#1a1000', '#9fe0b0'),
      D('duo_sepia', 'Sepia', '#2b1a0a', '#f0d9b0'),
    ],
  },
];

const BY_ID = new Map<string, FilterDef>();
for (const cat of FILTER_CATEGORIES)
  for (const f of cat.filters) BY_ID.set(f.id, f);

export function getFilter(id: string | undefined): FilterDef {
  return (id && BY_ID.get(id)) || { id: 'none', label: 'Original' };
}

// String de ctx.filter combinando ajustes (brillo/contraste/saturación) + el filtro.
export function cssFor(def: FilterDef, adjust?: ImageAdjust): string {
  const a = adjust ?? DEFAULT_ADJUST;
  const parts = [
    `brightness(${a.brightness})`,
    `contrast(${a.contrast})`,
    `saturate(${a.saturate})`,
  ];
  if (def.css) parts.push(def.css);
  return parts.join(' ');
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// Aplica tinte (overlay) y/o duotono sobre el contenido ya dibujado.
export function applyOverlayDuotone(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  def: FilterDef,
) {
  if (def.overlay) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = def.overlay.alpha;
    ctx.fillStyle = def.overlay.color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (def.duotone) {
    const sh = hexToRgb(def.duotone.shadow);
    const hi = hexToRgb(def.duotone.highlight);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue; // respeta transparencia
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      d[i] = sh.r + (hi.r - sh.r) * lum;
      d[i + 1] = sh.g + (hi.g - sh.g) * lum;
      d[i + 2] = sh.b + (hi.b - sh.b) * lum;
    }
    ctx.putImageData(img, 0, 0);
  }
}
